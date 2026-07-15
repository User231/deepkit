import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { createClassDecoratorContext, createPropertyDecoratorContext, drainPendingDecorators, mergeDecorator } from '../src/decorator-builder.js';

/**
 * These tests hand-invoke the standard (TC39) decorator ABI — `(value, context)` with a
 * `context.metadata` object — the way TypeScript's standard-decorators emit does, so the
 * dual-mode builder is exercised without flipping this package's own compilation mode.
 * Real standard-emit coverage lives in tests/standard-decorators/ (own tsconfig without
 * experimentalDecorators).
 */

const metadataSymbol: symbol = (Symbol as any).metadata;

interface StandardMember {
    name: string;
    kind?: 'method' | 'field' | 'getter' | 'setter';
    static?: boolean;
    decorators: Function[];
}

/** Emulates TS standard-decorator emit: member decorators first, then class decorators, then Symbol.metadata install. */
function applyStandard(classType: any, apply: { classDecorators?: Function[]; members?: StandardMember[] }, parent?: any): void {
    const parentMetadata = parent ? parent[metadataSymbol] : undefined;
    const metadata = Object.create(parentMetadata ?? null);
    const noop = () => undefined;
    for (const member of apply.members || []) {
        const kind = member.kind || 'method';
        const holder = member.static ? classType : classType.prototype;
        const value = kind === 'field' ? undefined : holder[member.name];
        for (const decorator of [...member.decorators].reverse()) {
            decorator(value, {
                kind,
                name: member.name,
                static: !!member.static,
                private: false,
                metadata,
                access: {},
                addInitializer: noop,
            });
        }
    }
    for (const decorator of [...(apply.classDecorators || [])].reverse()) {
        decorator(classType, { kind: 'class', name: classType.name, metadata, addInitializer: noop });
    }
    Object.defineProperty(classType, metadataSymbol, {
        value: metadata,
        configurable: true,
        writable: true,
        enumerable: false,
    });
}

test('symbol.metadata polyfill installed by importing the builder', () => {
    expect(metadataSymbol).toBe(Symbol.for('Symbol.metadata'));
});

test('class decorator: standard ABI parity with legacy', () => {
    class Data {
        name: string = '';
    }

    const dec = createClassDecoratorContext(
        class {
            t = new Data();

            name(name: string) {
                this.t.name = name;
            }
        },
    );

    class LegacyUser {}

    (dec as any).name('legacy')(LegacyUser);

    class StandardUser {}

    applyStandard(StandardUser, { classDecorators: [(dec as any).name('standard')] });

    expect(dec._fetch(LegacyUser)!.name).toBe('legacy');
    expect(dec._fetch(StandardUser)!.name).toBe('standard');
});

test('member decorator: stashes and drains lazily at first _fetch', () => {
    class Data {
        names: string[] = [];
    }

    let executed = 0;
    const dec = createPropertyDecoratorContext(
        class {
            t = new Data();

            name(name: string) {
                executed++;
                this.t.names.push(name);
            }
        },
    );

    class Controller {
        action() {}
    }

    applyStandard(Controller, { members: [{ name: 'action', decorators: [(dec as any).name('hello')] }] });

    //standard member decorators cannot reach the class — application is deferred until first read.
    expect(executed).toBe(0);

    const data = dec._fetch(Controller as any, 'action');
    expect(executed).toBe(1);
    expect(data!.names).toEqual(['hello']);

    //idempotent: draining again must not re-apply.
    const again = dec._fetch(Controller as any, 'action');
    expect(executed).toBe(1);
    expect(again!.names).toEqual(['hello']);

    //explicit double-drain is a no-op too.
    drainPendingDecorators(Controller);
    drainPendingDecorators(Controller);
    expect(executed).toBe(1);
});

test('class decorator drains members eagerly, member-before-class order', () => {
    const order: string[] = [];

    const classDec = createClassDecoratorContext(
        class {
            t = {};

            mark() {
                order.push('class');
            }
        },
    );
    const propDec = createPropertyDecoratorContext(
        class {
            t = {};

            mark() {
                order.push('member');
            }
        },
    );

    class Controller {
        action() {}
    }

    applyStandard(Controller, {
        classDecorators: [(classDec as any).mark()],
        members: [{ name: 'action', decorators: [(propDec as any).mark()] }],
    });

    //the class decorator ran the pending member modifiers first — same order as legacy emit.
    expect(order).toEqual(['member', 'class']);
});

test('subclass isolation: own metadata drained onto own class, exact-class fetch semantics', () => {
    class Data {
        names: string[] = [];
    }

    const dec = createPropertyDecoratorContext(
        class {
            t = new Data();

            name(name: string) {
                this.t.names.push(name);
            }
        },
    );

    class Base {
        base() {}
    }

    applyStandard(Base, { members: [{ name: 'base', decorators: [(dec as any).name('base')] }] });

    class Sub extends Base {
        sub() {}
    }

    //standard emit prototype-chains the subclass metadata to the parent's.
    applyStandard(Sub, { members: [{ name: 'sub', decorators: [(dec as any).name('sub')] }] }, Base);

    expect(dec._fetch(Sub as any, 'sub')!.names).toEqual(['sub']);
    //exact-class store: the parent's member is keyed on the parent, like legacy decorators.
    expect(dec._fetch(Sub as any, 'base')).toBe(undefined);
    expect(dec._fetch(Base as any, 'base')!.names).toEqual(['base']);
    //draining the subclass must not re-run (or steal) the parent's pending entries.
    expect(dec._fetch(Base as any, 'base')!.names).toEqual(['base']);
});

test('undecorated subclass: drain reaches the parent through the prototype chain', () => {
    class Data {
        names: string[] = [];
    }

    const dec = createPropertyDecoratorContext(
        class {
            t = new Data();

            name(name: string) {
                this.t.names.push(name);
            }
        },
    );

    class Base {
        base() {}
    }

    applyStandard(Base, { members: [{ name: 'base', decorators: [(dec as any).name('base')] }] });

    class Sub extends Base {}

    //fetching on the subclass walks up and drains the parent's pending entries.
    expect(dec._fetch(Sub as any, 'base')).toBe(undefined);
    expect(dec._fetch(Base as any, 'base')!.names).toEqual(['base']);
});

test('static members replay with legacy parity (mis-keyed, documented unsupported)', () => {
    class Data {
        names: string[] = [];
    }

    const dec = createPropertyDecoratorContext(
        class {
            t = new Data();

            name(name: string) {
                this.t.names.push(name);
            }
        },
    );

    class LegacyStatics {
        static action() {}
    }

    //legacy ABI for a static member: target is the constructor itself.
    (dec as any).name('legacy')(LegacyStatics, 'action');

    class StandardStatics {
        static action() {}
    }

    applyStandard(StandardStatics, {
        members: [{ name: 'action', static: true, decorators: [(dec as any).name('standard')] }],
    });
    drainPendingDecorators(StandardStatics);

    //both modes mis-key statics identically (constructor recovery lands on Function).
    expect(dec._fetch(LegacyStatics as any, 'action')).toBe(undefined);
    expect(dec._fetch(StandardStatics as any, 'action')).toBe(undefined);
    expect(dec._fetch(Function as any, 'action')).not.toBe(undefined);
});

test('merged decorator: standard class and member paths', () => {
    class ClassData {
        name: string = '';
    }

    class PropData {
        actions: string[] = [];
    }

    const classDec = createClassDecoratorContext(
        class {
            t = new ClassData();

            controller(name: string) {
                this.t.name = name;
            }
        },
    );
    const propDec = createPropertyDecoratorContext(
        class {
            t = new PropData();

            action(name: string) {
                this.t.actions.push(name);
            }
        },
    );

    const merged = mergeDecorator(classDec, propDec) as any;

    class Controller {
        list() {}
    }

    applyStandard(Controller, {
        classDecorators: [merged.controller('main')],
        members: [{ name: 'list', decorators: [merged.action('list')] }],
    });

    expect(classDec._fetch(Controller)!.name).toBe('main');
    expect(propDec._fetch(Controller as any, 'list')!.actions).toEqual(['list']);
});

test('merged decorator misuse errors match legacy', () => {
    const classDec = createClassDecoratorContext(
        class {
            t = {};

            controller() {}
        },
    );
    const propDec = createPropertyDecoratorContext(
        class {
            t = {};

            action() {}
        },
    );

    const merged = mergeDecorator(classDec, propDec) as any;

    //member-only modifier on a class: throws at decoration time (class path collapses eagerly).
    class OnClass {}

    expect(() => applyStandard(OnClass, { classDecorators: [merged.action()] })).toThrow(`Decorator 'action' can not be used on class OnClass`);

    //class-only modifier on a member: throws at first fetch (member application is deferred).
    class OnMember {
        action() {}
    }

    applyStandard(OnMember, { members: [{ name: 'action', decorators: [merged.controller()] }] });
    expect(() => propDec._fetch(OnMember as any, 'action')).toThrow(`Decorator 'controller' can not be used on class property OnMember.action`);
});

test('property decorator applied to a class throws in both modes', () => {
    const propDec = createPropertyDecoratorContext(
        class {
            t = {};

            action() {}
        },
    );

    class LegacyTarget {}

    expect(() => (propDec as any).action()(LegacyTarget)).toThrow('Property decorators can only be used on class properties');

    class StandardTarget {}

    expect(() => applyStandard(StandardTarget, { classDecorators: [(propDec as any).action()] })).toThrow('Property decorators can only be used on class properties');
});

test('missing context.metadata throws DK-T120 instead of silently no-opping', () => {
    const propDec = createPropertyDecoratorContext(
        class {
            t = {};

            action() {}
        },
    );

    class Controller {
        action() {}
    }

    expect(() =>
        (propDec as any).action()(Controller.prototype.action, {
            kind: 'method',
            name: 'action',
            static: false,
            private: false,
            metadata: undefined,
            access: {},
            addInitializer: () => undefined,
        }),
    ).toThrow('DK-T120');
});

test('mixed ABI: legacy base class, standard subclass', () => {
    class Data {
        names: string[] = [];
    }

    const dec = createPropertyDecoratorContext(
        class {
            t = new Data();

            name(name: string) {
                this.t.names.push(name);
            }
        },
    );

    class Base {
        base() {}
    }

    //legacy ABI: (prototype, property).
    (dec as any).name('base')(Base.prototype, 'base');

    class Sub extends Base {
        sub() {}
    }

    applyStandard(Sub, { members: [{ name: 'sub', decorators: [(dec as any).name('sub')] }] });

    expect(dec._fetch(Base as any, 'base')!.names).toEqual(['base']);
    expect(dec._fetch(Sub as any, 'sub')!.names).toEqual(['sub']);
});
