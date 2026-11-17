/**
 * What an injector's generated functions do, where the other specs do not already say it: the
 * functions `Injector.build()` writes. Every test here holds on the source before the move to the
 * JIT as well, except those under "what the move changed" and "about the move itself".
 */
import { describe, test } from 'node:test';

import { Builder, arg, compilesFunctions, fn } from '@deepkit/core';
import { expect } from '@deepkit/run/expect';

import { Injector, InjectorContext, ServiceNotFoundError } from '../src/injector.js';
import { InjectorModule } from '../src/module.js';
import { Tag } from '../src/provider.js';

test('dependencies are made in the order the constructor names them, each once', () => {
    const made: string[] = [];

    class First {
        constructor() {
            made.push('First');
        }
    }

    class Second {
        constructor(public first: First) {
            made.push('Second');
        }
    }

    class Third {
        constructor() {
            made.push('Third');
        }
    }

    class Service {
        constructor(
            public third: Third,
            public second: Second,
            public first: First,
        ) {
            made.push('Service');
        }
    }

    // Listed before what it depends on: the order of the list is not the order things are made in.
    const injector = Injector.from([Service, Third, Second, First]);
    const service = injector.get(Service);

    expect(made).toEqual(['Third', 'First', 'Second', 'Service']);
    expect(service.second.first).toBe(service.first);
    expect(injector.get(Service)).toBe(service);
    expect(made.length).toBe(4);
});

test('a tag is resolved where its argument stands, after the arguments before it', () => {
    const made: string[] = [];

    class Plugin {
        constructor(public name: string) {
            made.push(name);
        }
    }

    class Plugins extends Tag<Plugin> {}

    class Before {
        constructor() {
            made.push('Before');
        }
    }

    class After {
        constructor() {
            made.push('After');
        }
    }

    class Host {
        constructor(
            public before: Before,
            public plugins: Plugins,
            public after: After,
        ) {}
    }

    const injector = Injector.from([Host, After, Before, Plugins.provide({ provide: 'a', useFactory: () => new Plugin('a') }), Plugins.provide({ provide: 'b', useFactory: () => new Plugin('b') })]);
    const host = injector.get(Host);

    expect(made).toEqual(['Before', 'a', 'b', 'After']);
    expect(host.plugins.services.map(plugin => plugin.name)).toEqual(['a', 'b']);
});

test('a circle is found when it is resolved, named from where it was entered, and leaves the injector usable', () => {
    class A {
        constructor(public b: B) {}
    }

    class B {
        constructor(public c: C) {}
    }

    class C {
        constructor(public a: A) {}
    }

    class Alone {}

    // Building it is no error.
    const injector = Injector.from([A, B, C, Alone]);

    expect(() => injector.get(A)).toThrow('Circular dependency found A -> B -> C -> A');
    // Entered elsewhere, it is the same circle; the path ends with the provider it was entered at.
    expect(() => injector.get(B)).toThrow(/Circular dependency found .* -> B\n/);
    expect(() => injector.get(A)).toThrow('Circular dependency found A -> B -> C -> A');
    expect(injector.get(Alone)).toBeInstanceOf(Alone);
});

test('a provider that depends on itself is a circle of one', () => {
    class Self {
        constructor(public self: Self) {}
    }

    const injector = Injector.from([Self]);
    expect(() => injector.get(Self)).toThrow('Circular dependency found Self -> Self');
});

test('a token with a provider in a scope and one in none: each scope its own, by get, set and count', () => {
    let made = 0;

    class Connection {
        id = ++made;
    }

    const root = new InjectorModule([
        { provide: Connection, scope: 'http' },
        { provide: Connection, scope: 'rpc' },
        { provide: 'label', useValue: 'global' },
        { provide: 'label', useValue: 'request', scope: 'http' },
    ]);
    const context = new InjectorContext(root);
    const http = context.createChildScope('http');
    const http2 = context.createChildScope('http');
    const rpc = context.createChildScope('rpc');

    expect(context.get('label')).toBe('global');
    expect(http.get('label')).toBe('request');
    // A scope the token has no provider for is not handed the one that is in no scope.
    expect(() => rpc.get('label')).toThrow(`Service 'label' is known but is not available in scope rpc. Available in scopes: http.`);

    const first = http.get(Connection);
    expect(http.get(Connection)).toBe(first);
    expect(http2.get(Connection)).not.toBe(first);
    expect(rpc.get(Connection)).not.toBe(first);
    expect(() => context.get(Connection)).toThrow(ServiceNotFoundError);
    expect(() => context.get(Connection)).toThrow('is not available in scope global');
    expect(context.getOrUndefined(Connection)).toBe(undefined);

    expect(context.instantiationCount(Connection, undefined, 'http')).toBe(2);
    expect(context.instantiationCount(Connection, undefined, 'rpc')).toBe(1);

    const replacement = new Connection();
    http.set(Connection, replacement);
    expect(http.get(Connection)).toBe(replacement);
    expect(http2.get(Connection)).not.toBe(replacement);

    // A resolver asked for once answers for whichever scope it is called with.
    const resolver = context.resolve(root, Connection);
    expect(resolver(http.scope)).toBe(replacement);
    expect(resolver(rpc.scope)).toBe(rpc.get(Connection));
    expect(resolver(undefined, true)).toBe(undefined);
});

test('a provider of another module is resolved through that module, where its own dependencies are', () => {
    class Hidden {
        name = 'hidden';
    }

    class Exported {
        constructor(public hidden: Hidden) {}
    }

    class Consumer {
        constructor(public exported: Exported) {}
    }

    const library = new InjectorModule([Hidden, Exported]).addExport(Exported);
    const root = new InjectorModule([Consumer]).addImport(library);
    const context = new InjectorContext(root);

    const consumer = context.get(Consumer);
    expect(consumer.exported.hidden.name).toBe('hidden');
    expect(context.get(Exported)).toBe(consumer.exported);
    expect(() => context.get(Hidden)).toThrow(ServiceNotFoundError);
    expect(context.instantiationCount(Exported)).toBe(1);
});

test('a factory that answers nothing: an error for a required dependency, nothing for an optional one', () => {
    class Maybe {}

    class Needs {
        constructor(public maybe: Maybe) {}
    }

    class Tolerates {
        constructor(public maybe?: Maybe) {}
    }

    const injector = Injector.from([{ provide: Maybe, useFactory: () => undefined as any }, Needs, Tolerates]);

    expect(() => injector.get(Needs)).toThrow(`Constructor argument 'maybe: Maybe' of Needs(?) is known but has no value`);
    expect(injector.get(Tolerates).maybe).toBe(undefined);
    expect(() => injector.get(Maybe)).toThrow(`Service 'Maybe' is known but has no value`);
    expect(injector.get(Maybe, undefined, true)).toBe(undefined);
});

test('a transient is made on every call, and counted', () => {
    class Dependency {}

    class Fresh {
        constructor(public dependency: Dependency) {}
    }

    const injector = Injector.from([Dependency, { provide: Fresh, transient: true }]);
    const one = injector.get(Fresh);
    const two = injector.get(Fresh);

    expect(one).not.toBe(two);
    expect(one.dependency).toBe(two.dependency);
    expect(injector.instantiationCount(Fresh)).toBe(2);
    expect(injector.instantiationCount(Dependency)).toBe(1);
});

describe('what the move changed', () => {
    // Each of these threw a ReferenceError: the generated text named a variable that the function
    // it was written into does not have (`optional` in a setter, `scope` in clear()).
    test('setting a scoped provider outside its scope says so', () => {
        class Session {}

        const context = new InjectorContext(new InjectorModule([{ provide: Session, scope: 'http' }]));
        const http = context.createChildScope('http');
        http.set(Session, new Session());

        expect(() => context.set(Session, new Session())).toThrow(ServiceNotFoundError);
        expect(() => context.set(Session, new Session())).toThrow(`Service 'Session' is known but is not available in scope global`);
        expect(() => context.createChildScope('rpc').set(Session, new Session())).toThrow('is not available in scope rpc');
    });

    test('clear() forgets the instances that are in no scope, and leaves a scope its own', () => {
        let made = 0;

        class Global {
            id = ++made;
        }

        class Scoped {
            id = ++made;
        }

        const root = new InjectorModule([Global, { provide: Scoped, scope: 'http' }]);
        const context = new InjectorContext(root);
        const http = context.createChildScope('http');
        const global = context.get(Global);
        const scoped = http.get(Scoped);

        context.getInjector(root).clear();

        expect(context.get(Global)).not.toBe(global);
        expect(http.get(Scoped)).toBe(scoped);
    });
});

describe('about the move itself', () => {
    test('a stack trace names the generated function a failure went through', { skip: !compilesFunctions() }, () => {
        class Broken {
            constructor() {
                throw new RangeError('the constructor failed');
            }
        }

        class Service {
            constructor(public broken: Broken) {}
        }

        const injector = Injector.from([Service, Broken]);
        let stack = '';
        try {
            injector.get(Service);
        } catch (error) {
            stack = String((error as Error).stack);
        }

        expect(stack).toContain('the constructor failed');
        expect(stack).toMatch(/at _nfn_\d+_factoryi\d+_Broken_global /);
        expect(stack).toMatch(/at _nfn_\d+_factoryi\d+_Service_global /);
    });

    // Where functions are interpreted there are no units to keep apart.
    test('an injector built while another function is being declared is no part of that function', { skip: !compilesFunctions() }, () => {
        class Service {
            name = 'service';
        }

        let injector: Injector | undefined;
        const outer = fn(arg(), (b: Builder) => {
            injector = Injector.from([Service]);
            return b.lit('outer');
        });

        expect(outer(0)).toBe('outer');
        expect(injector!.get(Service).name).toBe('service');
        // Its functions are its own unit's: not markers of the declaration that happened to be open.
        const resolver = injector!.getResolver(Service) as { __nestedFnId?: number };
        expect(resolver.__nestedFnId).toBe(undefined);
    });
});
