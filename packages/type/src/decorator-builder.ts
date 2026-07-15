/*
 * Deepkit Framework
 * Copyright (c) Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { AbstractClassType, ClassType, DeepkitError, getClassName } from '@deepkit/core';

//standard (TC39) decorators: TypeScript's emit only creates `context.metadata` when
//`Symbol.metadata` exists, and no engine ships it natively yet. Install it before the first
//decorated class evaluates — applying any deepkit decorator transitively evaluates this module
//first. `Symbol.for` so dual CJS/ESM copies of this package agree on the same symbol.
(Symbol as any).metadata ??= Symbol.for('Symbol.metadata');

//registry symbol (not a local one) for the same dual-package reason as Symbol.metadata above.
const deepkitPendingDecorators = Symbol.for('deepkit:decorators:pending');

//both decorator ABIs: standard (TC39) first, legacy last — the legacy signature must stay the
//LAST intersection member because `Parameters<Fn>` (used for `_fetch`) resolves to it.
export type ClassDecoratorFn = ((value: AbstractClassType, context: ClassDecoratorContext) => void) &
    ((classType: AbstractClassType, property?: string, parameterIndexOrDescriptor?: any) => void);
export type PropertyDecoratorFn = ((
    value: unknown,
    context:
        | ClassMethodDecoratorContext
        | ClassFieldDecoratorContext
        | ClassGetterDecoratorContext
        | ClassSetterDecoratorContext
        | ClassAccessorDecoratorContext,
) => void) &
    ((prototype: object, property?: number | string | symbol, parameterIndexOrDescriptor?: any) => void);

interface StandardDecoratorContext {
    kind: 'class' | 'method' | 'field' | 'getter' | 'setter' | 'accessor';
    name: string | symbol;
    metadata?: Record<PropertyKey, unknown>;
    static?: boolean;
    private?: boolean;
}

function isStandardContext(v: unknown): v is StandardDecoratorContext {
    return 'object' === typeof v && v !== null && 'string' === typeof (v as any).kind;
}

type PendingDecorator = (classType: ClassType) => void;

//Object.hasOwn is ES2022 lib; this package targets es2020.
function hasOwn(obj: object, key: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Standard member decorators receive no class/prototype — only `context.metadata`, which the
 * runtime installs on the class as `Class[Symbol.metadata]` after definition. So member
 * application is deferred: a replay thunk is stashed here and drained with the real class by
 * the next deepkit class decorator on the same class (eager) or by the first metadata read
 * (`_fetch`/reflection — lazy, see drainPendingDecorators()).
 */
function stashPendingDecorator(context: StandardDecoratorContext, thunk: PendingDecorator): void {
    const metadata = context.metadata;
    if (!metadata) {
        //TS only wires context.metadata when Symbol.metadata exists at class-definition time.
        //Silently no-opping here would quietly disable routes/listeners/entity metadata, so throw.
        throw new DeepkitError(
            'DK-T120',
            `Decorator on ${String(context.name)}: context.metadata is undefined. ` +
                `Ensure the Symbol.metadata polyfill ran before the decorated class was defined ` +
                `(importing any deepkit decorator does this; otherwise: (Symbol as any).metadata ??= Symbol.for('Symbol.metadata')).`,
        );
    }
    //own-key check: a subclass's metadata object prototype-chains to its parent's — without the
    //guard a subclass would push into (and later drain from) its parent's pending array.
    if (hasOwn(metadata, deepkitPendingDecorators)) {
        (metadata[deepkitPendingDecorators] as PendingDecorator[]).push(thunk);
    } else {
        metadata[deepkitPendingDecorators] = [thunk];
    }
}

function drainPendingFromMetadata(metadata: Record<PropertyKey, unknown> | undefined, classType: ClassType): void {
    if (!metadata || !hasOwn(metadata, deepkitPendingDecorators)) return;
    const pending = metadata[deepkitPendingDecorators] as PendingDecorator[];
    delete metadata[deepkitPendingDecorators];
    for (const thunk of pending) thunk(classType);
}

/**
 * Applies member-decorator data stashed by standard (TC39) decorators (see
 * stashPendingDecorator) to the builder's metadata stores. Idempotent; walks the prototype
 * chain parent-first so exact-class store semantics match legacy decorators. Every metadata
 * read that may observe member decorators must call this first — the builder's `_fetch`
 * implementations and the two `__decorators` readers in reflection do.
 */
export function drainPendingDecorators(classType: object | undefined | null): void {
    if ('function' !== typeof classType) return;
    const chain: ClassType[] = [];
    let current: any = classType;
    while (current && current !== Object && 'function' === typeof current) {
        chain.unshift(current);
        current = Object.getPrototypeOf(current);
    }
    const metadataSymbol = (Symbol as any).metadata;
    for (const ctor of chain) {
        if (!hasOwn(ctor, metadataSymbol)) continue;
        drainPendingFromMetadata((ctor as any)[metadataSymbol], ctor);
    }
}

export type FluidDecorator<T, D extends Function> = {
    [name in keyof T]: T[name] extends (...args: infer K) => any
        ? (...args: K) => D & FluidDecorator<T, D>
        : D & FluidDecorator<T, D> & { _data: ExtractApiDataType<T> };
};

export function createFluidDecorator<API extends APIClass<any> | APIProperty<any>, D extends Function>(
    api: API,
    modifier: { name: string; args?: any; Ω?: any }[],
    collapse: (
        modifier: { name: string; args?: any }[],
        target: any,
        property?: string,
        parameterIndexOrDescriptor?: any,
    ) => void,
    returnCollapse: boolean = false,
    fluidFunctionSymbol?: symbol,
): FluidDecorator<ExtractClass<API>, D> {
    const fn = function (target: any, property?: any, parameterIndexOrDescriptor?: any) {
        if (isStandardContext(property)) {
            const context = property;
            if (context.kind === 'class') {
                //standard member decorators of this class ran before us and stashed; apply them
                //first so member-before-class ordering matches legacy decorators.
                drainPendingFromMetadata(context.metadata, target);
                collapse(modifier, target);
                return;
            }
            //member decorator: no class at hand yet — defer through the legacy path (which
            //recovers the class from the prototype) once a class is known. Statics replay with
            //the constructor itself for exact legacy parity (legacy mis-keys statics; unsupported).
            stashPendingDecorator(context, classType =>
                collapse(modifier, context.static ? classType : classType.prototype, String(context.name), undefined),
            );
            return;
        }
        const res = collapse(modifier, target, property, parameterIndexOrDescriptor);
        if (returnCollapse || target === Object) return res;
    };
    Object.defineProperty(fn, 'name', { value: undefined });
    Object.defineProperty(fn, '_data', {
        get: () => {
            return collapse(modifier, Object);
        },
    });

    const methods: string[] = [];
    Object.defineProperty(fn, '_methods', { value: methods });
    if (fluidFunctionSymbol) Object.defineProperty(fn, fluidFunctionSymbol, { value: true });

    let current = api;
    while (current.prototype) {
        let proto = current.prototype;
        for (const name of Object.getOwnPropertyNames(proto)) {
            if (name === 'constructor') continue;
            if (name === 'onDecorator') continue;

            const descriptor = Object.getOwnPropertyDescriptor(proto, name);
            methods.push(name);
            if (descriptor && descriptor.get) {
                //its a magic shizzle
                Object.defineProperty(fn, name, {
                    configurable: true,
                    enumerable: false,
                    get: () => {
                        return createFluidDecorator(
                            api,
                            [...modifier, { name }],
                            collapse,
                            returnCollapse,
                            fluidFunctionSymbol,
                        );
                    },
                });
            } else {
                //regular method
                Object.defineProperty(fn, name, {
                    configurable: true,
                    enumerable: false,
                    value: function fn(...args: any[]) {
                        return createFluidDecorator(
                            api,
                            [...modifier, { name, args, Ω: (fn as any).Ω }],
                            collapse,
                            returnCollapse,
                            fluidFunctionSymbol,
                        );
                    },
                });
            }
        }

        //resolve parent
        current = Object.getPrototypeOf(current);
    }

    return fn as any;
}

export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
export type Merge<U> = {
    [K in keyof U]: U[K] extends (...a: infer A) => infer R
        ? R extends DualDecorator
            ? (...a: A) => PropertyDecoratorFn & R & U
            : (...a: A) => R
        : never;
};

/**
 * A dual decorator is a decorator that can be used on a class and class property.
 */
export type DualDecorator = void & { __DualDecorator?: true };

export function mergeDecorator<T extends any[]>(
    ...args: T
): Merge<Omit<UnionToIntersection<T[number]>, '_fetch' | 't'>> {
    const res: any = {};

    //dual decorator are decorators that share the same name for class decorators and class property decorator
    //and need a special runtime check when collapsed.
    const tracked: string[] = [];
    const dualDecorator: string[] = [];

    for (const arg of args) {
        for (const method of arg._methods) {
            if (tracked.includes(method)) {
                if (!dualDecorator.includes(method)) dualDecorator.push(method);
                continue;
            }
            tracked.push(method);
        }
    }

    for (const arg of args) {
        for (const method of arg._methods) {
            if (!dualDecorator.includes(method)) {
                Object.defineProperty(res, method, {
                    get() {
                        return arg[method];
                    },
                });
            }
        }
    }

    function fluid(
        modifier: { name: string; args?: any; Ω?: any }[],
        collapse: (
            modifier: { name: string; args?: any }[],
            target: any,
            property?: string,
            parameterIndexOrDescriptor?: any,
        ) => void,
    ): any {
        const fn = function (target: any, property?: any, parameterIndexOrDescriptor?: any) {
            if (isStandardContext(property)) {
                const context = property;
                if (context.kind === 'class') {
                    drainPendingFromMetadata(context.metadata, target);
                    collapse(modifier, target);
                    return;
                }
                stashPendingDecorator(context, classType =>
                    collapse(
                        modifier,
                        context.static ? classType : classType.prototype,
                        String(context.name),
                        undefined,
                    ),
                );
                return;
            }
            const res = collapse(modifier, target, property, parameterIndexOrDescriptor);
            if (target === Object) return res;
        };
        Object.defineProperty(fn, 'name', { value: undefined });

        for (const name of tracked) {
            const decorator = args.find(v => v[name]);
            if (!decorator) continue;
            const descriptor = Object.getOwnPropertyDescriptor(decorator, name);
            if (descriptor && descriptor.get) {
                //its a magic shizzle
                Object.defineProperty(fn, name, {
                    configurable: true,
                    enumerable: false,
                    get: () => {
                        return fluid([...modifier, { name }], collapse);
                    },
                });
            } else {
                //regular method
                Object.defineProperty(fn, name, {
                    configurable: true,
                    enumerable: false,
                    value: function fn(...args: any[]) {
                        return fluid([...modifier, { name, args, Ω: (fn as any).Ω }], collapse);
                    },
                });
            }
        }
        return fn;
    }

    function collapse(
        modifier: { name: string; args?: any; Ω?: any }[],
        target: object,
        property?: string,
        parameterIndexOrDescriptor?: any,
    ) {
        const results: any[] = [];
        if (property) {
            loop: for (const mod of modifier) {
                for (const decorator of args) {
                    if (decorator._type === 'propertyDecorator' && decorator[mod.name]) {
                        if (mod.args) {
                            (decorator[mod.name] as any).Ω = mod.Ω;
                            results.push(
                                decorator[mod.name](...mod.args)(target, property, parameterIndexOrDescriptor),
                            );
                        } else {
                            results.push(decorator[mod.name](target, property, parameterIndexOrDescriptor));
                        }
                        continue loop;
                    }
                }
                throw new Error(
                    `Decorator '${mod.name}' can not be used on class property ${getClassName(target)}.${property}`,
                );
            }
        } else {
            loop: for (const mod of modifier) {
                for (const decorator of args) {
                    if (decorator._type === 'classDecorator' && decorator[mod.name]) {
                        if (mod.args) {
                            (decorator[mod.name] as any).Ω = mod.Ω;
                            results.push(decorator[mod.name](...mod.args)(target));
                        } else {
                            results.push(decorator[mod.name](target));
                        }
                        continue loop;
                    }
                }

                throw new Error(`Decorator '${mod.name}' can not be used on class ${getClassName(target)}`);
            }
        }
        return results;
    }

    return fluid([], collapse);
}

export interface ClassApiTypeInterface<T> {
    t: T;
    onDecorator?: (classType: ClassType, property?: string, parameterIndexOrDescriptor?: any) => void;
}

export type APIClass<T> = ClassType<ClassApiTypeInterface<T>>;
export type ExtractClass<T> = T extends ClassType<infer K> ? K : never;
export type ExtractApiDataType<T> =
    T extends AbstractClassType<infer K>
        ? K extends { t: infer P }
            ? P
            : never
        : T extends { t: infer P }
          ? P
          : never;

export type ClassDecoratorResult<API extends APIClass<any>> = FluidDecorator<ExtractClass<API>, ClassDecoratorFn> &
    DecoratorAndFetchSignature<API, ClassDecoratorFn>;

export function createClassDecoratorContext<API extends APIClass<any>, T = ExtractApiDataType<API>>(
    apiType: API,
): ClassDecoratorResult<API> {
    const map = new Map<object, ClassApiTypeInterface<any>>();

    function collapse(modifier: { name: string; args?: any; Ω?: any }[], target: ClassType): any {
        const api: ClassApiTypeInterface<any> = map.get(target) ?? new apiType(target);

        for (const fn of modifier) {
            if (fn.args) {
                const f = (api as any)[fn.name];
                f.Ω = fn.Ω;
                f.call(api, ...fn.args);
            } else {
                //just call the getter
                (api as any)[fn.name];
            }
        }

        if (api.onDecorator) api.onDecorator(target);

        map.set(target, api);
        if (target === Object) return api.t;
    }

    const fn = createFluidDecorator(apiType, [], collapse);

    Object.defineProperty(fn, '_fetch', {
        configurable: true,
        enumerable: false,
        get: () => {
            return (target: object) => {
                drainPendingDecorators(target);
                const api = map.get(target);
                return api ? api.t : undefined;
            };
        },
    });

    (fn as any)._type = 'classDecorator';
    return fn as any;
}

export interface PropertyApiTypeInterface<T> {
    t: T;
    onDecorator?: (target: ClassType, property: string | undefined, parameterIndexOrDescriptor?: any) => void;
}

export type APIProperty<T> = ClassType<PropertyApiTypeInterface<T>>;

export type DecoratorAndFetchSignature<API extends APIProperty<any>, FN extends (...args: any[]) => any> = FN & {
    _fetch: (...args: Parameters<FN>) => ExtractApiDataType<API> | undefined;
};

export type PropertyDecoratorResult<API extends APIProperty<any>> = FluidDecorator<
    ExtractClass<API>,
    PropertyDecoratorFn
> &
    DecoratorAndFetchSignature<API, PropertyDecoratorFn>;

export function createPropertyDecoratorContext<API extends APIProperty<any>>(
    apiType: API,
): PropertyDecoratorResult<API> {
    const targetMap = new Map<object, Map<any, PropertyApiTypeInterface<any>>>();

    function collapse(
        modifier: { name: string; args?: any; Ω?: any }[],
        target: object,
        property?: string,
        parameterIndexOrDescriptor?: any,
    ): any {
        if (property === undefined && parameterIndexOrDescriptor === undefined)
            throw new Error('Property decorators can only be used on class properties');

        target = target === Object ? target : (target as any)['constructor']; //property decorators get the prototype instead of the class.
        let map = targetMap.get(target);
        if (!map) {
            map = new Map();
            targetMap.set(target, map);
        }
        const secondIndex = 'number' === typeof parameterIndexOrDescriptor ? parameterIndexOrDescriptor : '';
        const index = (property || 'constructor') + '$$' + secondIndex;
        const api: PropertyApiTypeInterface<any> = map.get(index) ?? new apiType(target, property || 'constructor');

        for (const fn of modifier) {
            if (fn.args) {
                const f = (api as any)[fn.name];
                f.Ω = fn.Ω;
                f.call(api, ...fn.args);
            } else {
                //just call the getter
                (api as any)[fn.name];
            }
        }

        if (api.onDecorator)
            api.onDecorator(
                target as ClassType,
                property,
                'number' === typeof parameterIndexOrDescriptor ? parameterIndexOrDescriptor : undefined,
            );

        map.set(index, api);
        if (target === Object) return api.t;
    }

    const fn = createFluidDecorator(apiType, [], collapse);

    Object.defineProperty(fn, '_fetch', {
        configurable: true,
        enumerable: false,
        get: () => {
            return (target: object, property?: string, parameterIndexOrDescriptor?: any) => {
                drainPendingDecorators(target);
                const map = targetMap.get(target);
                const secondIndex = 'number' === typeof parameterIndexOrDescriptor ? parameterIndexOrDescriptor : '';
                const index = property + '$$' + secondIndex;
                const api = map ? map.get(index) : undefined;
                return api ? api.t : undefined;
            };
        },
    });

    (fn as any)._type = 'propertyDecorator';
    return fn as any;
}

export type FreeDecoratorFn<API> = {
    (target?: any, property?: number | string | symbol, parameterIndexOrDescriptor?: any): ExtractApiDataType<API>;
} & { _data: ExtractApiDataType<API> };

export type FreeFluidDecorator<API> = {
    [name in keyof ExtractClass<API>]: ExtractClass<API>[name] extends (...args: infer K) => any
        ? (...args: K) => FreeFluidDecorator<API>
        : FreeFluidDecorator<API>;
} & FreeDecoratorFn<API>;

export type FreeDecoratorResult<API extends APIClass<any>> = FreeFluidDecorator<API> & { _fluidFunctionSymbol: symbol };

export function createFreeDecoratorContext<API extends APIClass<any>, T = ExtractApiDataType<API>>(
    apiType: API,
): FreeDecoratorResult<API> {
    function collapse(
        modifier: { name: string; args?: any; Ω?: any }[],
        target?: any,
        property?: string,
        parameterIndexOrDescriptor?: any,
    ) {
        const api = new apiType();

        for (const fn of modifier) {
            if (fn.args) {
                const f = (api as any)[fn.name];
                f.Ω = fn.Ω;
                f.call(api, ...fn.args);
            } else {
                //just call the getter
                (api as any)[fn.name];
            }
        }

        if (api.onDecorator && target) api.onDecorator(target, property, parameterIndexOrDescriptor);

        return api.t;
    }

    const fluidFunctionSymbol = Symbol('fluidFunctionSymbol');

    const fn = createFluidDecorator(apiType, [], collapse, true, fluidFunctionSymbol);

    Object.defineProperty(fn, '_fluidFunctionSymbol', {
        configurable: true,
        enumerable: false,
        value: fluidFunctionSymbol,
    });

    return fn as any;
}

export function isDecoratorContext<API extends APIClass<any>>(
    context: FreeDecoratorResult<API>,
    fn: Function,
): fn is FreeFluidDecorator<API> {
    const symbol = context._fluidFunctionSymbol;

    if (Object.getOwnPropertyDescriptor(fn, symbol)) return true;

    return false;
}
