import {
    AbstractClassType,
    Builder,
    ClassType,
    DeepkitError,
    Ref,
    arg,
    fn,
    fnJITTop,
    getClassName,
    getPathValue,
    isArray,
    isClass,
    isFunction,
    isPrototypeOfBase,
    named,
} from '@deepkit/core';
import {
    Packed,
    ReceiveType,
    ReflectionClass,
    ReflectionFunction,
    ReflectionKind,
    Type,
    isOptional,
    isWithAnnotations,
    reflect,
    resolveReceiveType,
    stringifyType,
    typeAnnotation,
} from '@deepkit/type';

import {
    ConfigurationProviderRegistry,
    ConfigureProviderEntry,
    InjectorModule,
    PreparedProvider,
    findModuleForConfig,
    getScope,
} from './module.js';
import {
    NormalizedProvider,
    ProviderWithScope,
    Tag,
    TagProvider,
    TagRegistry,
    Token,
    isClassProvider,
    isExistingProvider,
    isFactoryProvider,
    isValueProvider,
} from './provider.js';

export class InjectorError extends DeepkitError {
    constructor(code: string, message: string, options?: { cause?: Error }) {
        super(code, message, options);
    }
}

export class CircularDependencyError extends InjectorError {
    constructor(message: string, options?: { cause?: Error }) {
        super('DK-I010', message, options);
    }
}

export class ServiceNotFoundError extends InjectorError {
    constructor(message: string, options?: { cause?: Error }) {
        super('DK-I020', message, options);
    }
}

export class DependenciesUnmetError extends InjectorError {
    constructor(message: string, options?: { cause?: Error }) {
        super('DK-I030', message, options);
    }
}

export function tokenLabel(token: Token): string {
    if (token === null) return 'null';
    if (token === undefined) return 'undefined';
    if (token instanceof TagProvider) return 'Tag(' + getClassName(token.provider.provide) + ')';
    if (typeof token === 'symbol') return token.toString();
    if (
        typeof token === 'string' ||
        typeof token === 'number' ||
        typeof token === 'boolean' ||
        typeof token === 'bigint'
    )
        return token + '';
    if (isClass(token)) return getClassName(token);
    if (isType(token)) return stringifyType(token).replace(/\n/gm, '');
    if (isFunction(token)) return token.name;

    return token + '';
}

function functionParameterNotFound(ofName: string, name: string, position: number, token: any) {
    const argsCheck: string[] = [];
    for (let i = 0; i < position; i++) argsCheck.push('✓');
    argsCheck.push('?');

    throw new DependenciesUnmetError(
        `Unknown function argument '${name}: ${tokenLabel(token)}' of ${ofName}(${argsCheck.join(', ')}). Make sure '${tokenLabel(token)}' is provided.`,
    );
}

function constructorParameterNotFound(ofName: string, name: string, position: number, token: any) {
    const argsCheck: string[] = [];
    for (let i = 0; i < position; i++) argsCheck.push('✓');
    argsCheck.push('?');

    throw new DependenciesUnmetError(
        `Constructor argument '${name}: ${tokenLabel(token)}' of ${ofName}(${argsCheck.join(', ')}) is known but has no value. Make sure '${tokenLabel(token)}' is set.`,
    );
}

function knownServiceNotFoundError(label: string, scopes: string[], scope?: Scope) {
    throw new ServiceNotFoundError(
        `Service '${label}' is known but has no value.${scopes.length ? ` Available in scopes: ${scopes.join(', ')}, requested scope is ${scope ? scope.name : 'global'}.` : ''}`,
    );
}

function serviceNotFoundError(label: string) {
    throw new ServiceNotFoundError(`Service '${label}' not found. No matching provider.`);
}

function knownServiceNotFoundInScope(label: string, scopes: string[], scope?: Scope) {
    throw new ServiceNotFoundError(
        `Service '${label}' is known but is not available in scope ${scope?.name || 'global'}. Available in scopes: ${scopes.join(', ')}.`,
    );
}

function factoryDependencyNotFound(ofName: string, name: string, position: number, token: any) {
    const argsCheck: string[] = [];
    for (let i = 0; i < position; i++) argsCheck.push('✓');
    argsCheck.push('?');

    throw new DependenciesUnmetError(
        `Unknown factory dependency argument '${tokenLabel(token)}' of ${ofName}(${argsCheck.join(', ')}). Make sure '${tokenLabel(token)}' is provided.`,
    );
}

function propertyParameterNotFound(ofName: string, name: string, position: number, token: any) {
    throw new DependenciesUnmetError(
        `Unknown property parameter ${name} of ${ofName}. Make sure '${tokenLabel(token)}' is provided.`,
    );
}

function transientInjectionTargetUnavailable(ofName: string, name: string, position: number, token: any) {
    throw new DependenciesUnmetError(
        `${TransientInjectionTarget.name} is not available for ${name} of ${ofName}. ${TransientInjectionTarget.name} is only available when injecting into other providers`,
    );
}

type Destination = { token: Token };

function createTransientInjectionTarget(destination: Destination | undefined) {
    if (!destination) {
        return undefined;
    }

    return new TransientInjectionTarget(destination.token);
}

interface StackEntry {
    label: string;
    creation: number;
    id: number;
    cause: boolean;
}

function stackToPath(stack: StackEntry[]): string[] {
    const cause = stack.find(v => v.cause);
    stack.sort((a, b) => a.id - b.id);
    const labels = stack.map(v => v.label);
    if (cause) labels.push(cause.label);
    return labels;
}

function throwCircularDependency(paths: string[]) {
    const path = paths.join(' -> ');
    throw new CircularDependencyError(`Circular dependency found ${path}`);
}

export interface Scope {
    name: string;
}

export type ResolveToken<T> = T extends ClassType<infer R> ? R : T extends AbstractClassType<infer R> ? R : T;

export function resolveToken(provider: ProviderWithScope): Token {
    if (isClass(provider)) return provider;
    if (provider instanceof TagProvider) return resolveToken(provider.provider);

    return provider.provide;
}

/** @reflection never */
export type ContainerToken = symbol | number | bigint | boolean | string | AbstractClassType<unknown> | Function;

export function getContainerTokenFromType(type: Type): ContainerToken {
    if (type.id) return type.id;
    if (type.kind === ReflectionKind.literal) {
        if (type.literal instanceof RegExp) return type.literal.toString();
        return type.literal;
    }
    if (type.kind === ReflectionKind.class) return type.classType;
    if (type.kind === ReflectionKind.function && type.function) return type.function;
    return 'unknown';
}

export function isType(obj: any): obj is Type {
    return obj && typeof obj === 'object' && typeof (obj as any).kind === 'number';
}

function isPacked(obj: any): obj is Packed {
    return obj && typeof obj === 'object' && typeof (obj as any).length === 'number';
}

/**
 * Returns a value that can be compared with `===` to check if two tokens are actually equal even though
 * they are the result of different type expressions.
 *
 * This is used in the big switch-case statement in the generated code to match DI tokens.
 */
export function getContainerToken(type: Token): ContainerToken {
    if (type instanceof TagProvider) return getContainerToken(type.provider.provide);

    if (isType(type)) {
        return getContainerTokenFromType(type);
    }

    return type as ContainerToken;
}

/**
 * Returns the injector token type if the given type was decorated with `Inject<T>`.
 */
export function getInjectOptions(type: Type): Type | undefined {
    const annotations = typeAnnotation.getType(type, 'inject');
    if (!annotations) return;
    const t = annotations;
    return t && t.kind !== ReflectionKind.never ? t : type;
}

function getPickArguments(type: Type): Type[] | undefined {
    if (type.typeName === 'Pick' && type.typeArguments && type.typeArguments.length === 2) {
        return type.typeArguments;
    }
    if (!type.originTypes) return;

    for (const origin of type.originTypes) {
        if (origin.typeName === 'Pick' && origin.typeArguments && origin.typeArguments.length === 2) {
            return origin.typeArguments;
        }
    }

    return;
}

/**
 * Class describing where a transient provider will be injected.
 *
 * @reflection never
 */
export class TransientInjectionTarget {
    constructor(public readonly token: Token) {}
}

function* forEachDependency(provider: NormalizedProvider): Generator<{ type: Type; optional: boolean }> {
    if (isValueProvider(provider)) {
    } else if (isClassProvider(provider)) {
        let useClass = provider.useClass;
        if (!useClass) {
            if (isClass(provider.provide)) useClass = provider.provide as ClassType;
            if (isType(provider.provide) && provider.provide.kind === ReflectionKind.class)
                useClass = provider.provide.classType;
            if (!useClass) {
                throw new InjectorError(
                    'DK-I040',
                    `UseClassProvider needs to set either 'useClass' or 'provide' as a ClassType. Got ${provider.provide as any}.`,
                );
            }
        }

        const reflectionClass = ReflectionClass.from(useClass);

        const constructor = reflectionClass.getMethodOrUndefined('constructor');
        const constructorProperties: string[] = [];
        if (constructor) {
            for (const parameter of constructor.getParameters()) {
                if (parameter.getVisibility() !== undefined) constructorProperties.push(parameter.name);
                const tokenType = getInjectOptions(parameter.getType() as Type);
                const type = tokenType || (parameter.getType() as Type);
                yield { type, optional: !parameter.isValueRequired() };
            }
        }

        for (const property of reflectionClass.getProperties()) {
            if (constructorProperties.includes(property.name)) continue;
            const tokenType = getInjectOptions(property.type);
            if (!tokenType) continue;
            yield { type: tokenType, optional: !property.isValueRequired() };
        }
    } else if (isExistingProvider(provider)) {
        for (const item of forEachDependency({ provide: provider.useExisting })) {
            yield item;
        }
    } else if (isFactoryProvider(provider)) {
        const reflection = ReflectionFunction.from(provider.useFactory);
        for (const parameter of reflection.getParameters()) {
            const tokenType = getInjectOptions(parameter.getType() as Type);
            const type = tokenType || (parameter.getType() as Type);
            yield { type, optional: !parameter.isValueRequired() };
        }
    }
}

function isTransientInjectionTargetProvider(prepared: PreparedProvider): boolean {
    for (const provider of prepared.providers) {
        if (!provider.transient) continue;
        for (const { type } of forEachDependency(provider)) {
            if (type.kind === ReflectionKind.class && type.classType === TransientInjectionTarget) {
                return true;
            }
        }
    }
    return false;
}

/**
 * A factory function for some class.
 * All properties that are not provided will be resolved using the injector that was used to create the factory.
 */
export type PartialFactory<C> = (args: Partial<{ [K in keyof C]: C[K] }>) => C;

interface BuiltInjector {
    set(token: Token, value: any, scope?: Scope): void;

    get(token: Token, scope?: Scope, optional?: boolean): unknown;

    instantiationCount(token: any, scope?: Scope): number;

    clear(): void;

    resolver(token: Token, scope?: Scope, optional?: boolean): Resolver<unknown>;

    setter(token: Token, scopeName?: string): Setter<unknown>;

    collectStack(stack: StackEntry[]): void;
}

type BuiltNormalizedProvider = NormalizedProvider & { needsDestination?: boolean };

/** How the value of a dependency is written where a factory needs it; `scope` is the factory's argument. */
type WriteDependency = (b: Builder, scope: Ref) => Ref;

/** What is called when a required dependency answers nothing: it throws, naming the dependency. */
type NotFound = (ofName: string, name: string, position: number, token: any) => unknown;

/** What the statements that make an instance are written against: the factory's arguments, and where the instance is kept. */
interface FactoryScope {
    scope: Ref;
    optional: Ref;
    /** The request's scope for a scoped provider, the injector's instances for the others. */
    holder: Ref;
    env: BuildEnvironment;
}

/** One provider of a prepared provider — one scope it exists in — as its functions are built from it. */
interface ScopePlan {
    provider: BuiltNormalizedProvider;
    /** The scope's name; empty for a provider that is in none. */
    scope: string;
    state: { label: string; count: number; creating: number; cause: boolean };
    /** How many dependencies making the instance resolves: none means no circle can run through it. */
    dependencies: number;
    write: (b: Builder, at: FactoryScope) => void;
}

interface ProviderPlan {
    prepared: PreparedProvider;
    /** The property an instance is kept under, on the injector's instances or on a scope. */
    name: string;
    label: string;
    scopes: ScopePlan[];
    /** The providers of this module its factories call. */
    siblings: Set<PreparedProvider>;
}

/** What the generated functions of one injector share. */
interface BuildEnvironment {
    runtimeContext: { creation: number; destination?: Destination };
    /** The instances of the providers that are in no scope, by {@link ProviderPlan.name}. */
    instances: Record<string, unknown>;
    lookupGetter: Record<PropertyKey, unknown>;
    lookupSetter: Record<PropertyKey, unknown>;
    lookupInstantiations: Record<PropertyKey, unknown>;
    /** This injector's own keys on a class that is a token: where its resolver, setter and counter are found. */
    symbolResolver: symbol;
    symbolSetter: symbol;
    symbolInstantiations: symbol;
    createResolver: (token: Token, scope?: Scope, label?: string) => unknown;
    names: Map<PreparedProvider, { name: string; label: string }>;
    /** The factory of each provider declared so far: `(scope, optional)`, whatever the scope. */
    declared: Map<PreparedProvider, Function>;
    resolver?: Function;
    collectStack?: Function;
    reset?: Function;
}

function noop() {}

/** A function that answers `value`: what a lookup holds for a provider with one resolver, whatever the scope. */
function alwaysAnswer<T>(value: T): () => T {
    return () => value;
}

/** `injector.built`: the functions of another injector, read when the generated function runs. */
function builtOf(b: Builder, injector: Ref): Ref {
    return b.get(injector, 'built');
}

/**
 * This is the actual dependency injection container.
 * Every module has its own injector.
 *
 * @reflection never
 */
export class Injector {
    private built?: BuiltInjector;

    private resolverMap = new Map<any, Resolver<unknown>>();
    private setterMap = new Map<any, Setter<unknown>>();

    constructor(
        public readonly module: InjectorModule,
        private buildContext: BuildContext,
    ) {
        module.injector = this;
        this.build(buildContext);
    }

    static from(providers: ProviderWithScope[], parent?: Injector): Injector {
        return new Injector(new InjectorModule(providers, parent?.module), new BuildContext());
    }

    static fromModule(module: InjectorModule): Injector {
        return new Injector(module, new BuildContext());
    }

    get<T>(token?: ReceiveType<T> | Token<T>, scope?: Scope, optional: boolean = false): ResolveToken<T> {
        if (!this.built)
            throw new InjectorError('DK-I050', 'Injector was not built. Call build() before using the injector.');
        token = isPacked(token) ? resolveReceiveType(token) : token;
        return this.built.get(token, scope, optional) as ResolveToken<T>;
    }

    set<T>(token: Token<T>, value: any, scope?: Scope): void {
        if (!this.built)
            throw new InjectorError('DK-I050', 'Injector was not built. Call build() before using the injector.');
        this.built.set(token, value, scope);
    }

    instantiationCount(token: any, scope?: Scope): number {
        if (!this.built)
            throw new InjectorError('DK-I050', 'Injector was not built. Call build() before using the injector.');
        return this.built.instantiationCount(token, scope);
    }

    getSetter<T>(token: ReceiveType<T> | Token<T>, scopeName?: string): Setter<T> {
        let setter = this.setterMap.get(token);
        if (!setter) {
            setter = this.createSetter(token as ReceiveType<T> | Token, scopeName);
            if (!scopeName) this.setterMap.set(token, setter);
        }
        return setter;
    }

    getResolver<T>(token?: ReceiveType<T> | Token<T>, label?: string): Resolver<T> {
        if (!token) throw new InjectorError('DK-I060', 'No token provided to getResolver().');
        let resolver = this.resolverMap.get(token);
        if (!resolver) {
            resolver = this.createResolver(token as ReceiveType<T> | Token, undefined, label);
            this.resolverMap.set(token, resolver);
        }
        return resolver as Resolver<T>;
    }

    clear() {
        this.built?.clear();
    }

    /**
     * Build this module's injector: ONE unit of generated functions, made with the JIT of
     * `@deepkit/core` (compiled where code generation is allowed, interpreted where it is not).
     *
     * Per provider and scope it holds a factory `(scope, optional)`, a setter and an instantiation
     * counter; a provider that exists in several scopes gets routers that choose by the scope's
     * name; and the module's own `resolver`, `setter`, `get`, `set`, `clear`, `instantiationCount`
     * and `collectStack` are what the unit answers. A factory reads
     *
     *     if (!scope || scope.name !== 'http') return optional ? undefined : <not in this scope>;
     *     if (scope.i3_Session) return scope.i3_Session;
     *     <the circular-dependency check, where it has dependencies>
     *     try {
     *         scope.i3_Session = new Session(<each dependency, by calling ITS factory>);
     *         <what was configured for the provider>
     *     } finally { … }
     *     return scope.i3_Session;
     *
     * Everything is worked out first ({@link planProvider}) and declared afterwards: a provider's
     * functions after those of the providers it depends on, so that a dependency is a direct call.
     */
    protected build(buildContext: BuildContext): void {
        const env = this.environment(buildContext);

        const prepared = this.module.getPreparedProviders(buildContext) as PreparedProvider[];
        for (const provider of prepared) {
            const label = tokenLabel(provider.token);
            const name = 'i' + this.buildContext.providerIndex.reserve() + '_' + label.replace(/[^a-zA-Z0-9]/g, '_');
            env.names.set(provider, { name, label });
        }
        const plans = prepared.map(provider => this.planProvider(env, provider));
        const byProvider = new Map(plans.map(plan => [plan.prepared, plan]));
        const states = plans.flatMap(plan => plan.scopes.map(scope => scope.state));
        const moduleName = getClassName(this.module);

        // Never a nested function of whatever is being declared when an injector happens to be built.
        const unit = fnJITTop<BuiltInjector>(named(`injector_${moduleName}`), (b: Builder) => {
            // What every factory may call is declared first.
            const collectStack = fn(named('collectStack'), arg('stack'), (b: Builder, stack: Ref) => {
                for (const state of states) {
                    b.if_(b.get(b.lit(state), 'creating'), () => b.push(stack, b.lit(state)));
                }
                for (const imported of this.module.imports) {
                    b.exec(b.method(builtOf(b, b.get(b.lit(imported), 'injector')), 'collectStack', stack));
                }
            });

            const reset = fn(named('reset'), (b: Builder) => {
                b.set(b.lit(env.runtimeContext), 'creation', b.lit(0));
                for (const state of states) {
                    b.set(b.lit(state), 'creating', b.lit(0));
                    b.set(b.lit(state), 'cause', b.lit(false));
                }
            });

            // resolver(token: Token, scope?: Scope, optional?: boolean): Resolver<unknown>;
            const resolver = fn(
                named('resolver'),
                arg('token'),
                arg('scope'),
                arg('optional'),
                (b: Builder, token: Ref, scope: Ref, optional: Ref) => {
                    // token could be: Type, ClassType, or primitive
                    const containerToken = b.let(b.call(getContainerToken, token), 'containerToken');
                    const found = b.let(
                        b.or(
                            b.get(containerToken, b.lit(env.symbolResolver)),
                            b.get(b.lit(env.lookupGetter), containerToken),
                        ),
                        'found',
                    );
                    b.if_(found, () => b.invoke(found, scope));

                    const created = b.let(b.call(env.createResolver, token, scope), 'created');
                    b.if_(created, () => {
                        b.set(b.lit(env.lookupSetter), containerToken, created);
                        return created;
                    });

                    b.if_(optional, () => b.lit(noop));
                    b.throw_(b.call(serviceNotFoundError, b.call(tokenLabel, token)));
                },
            );
            env.resolver = resolver;
            env.collectStack = collectStack;
            env.reset = reset;

            // setter(token: Token, scopeName?: string): Setter<unknown>;
            const setter = fn(
                named('setter'),
                arg('token'),
                arg('scopeName'),
                (b: Builder, token: Ref, scopeName: Ref) => {
                    const containerToken = b.let(b.call(getContainerToken, token), 'containerToken');
                    const found = b.let(
                        b.or(
                            b.get(containerToken, b.lit(env.symbolSetter)),
                            b.get(b.lit(env.lookupSetter), containerToken),
                        ),
                        'found',
                    );
                    b.if_(found, () => b.invoke(found, scopeName));
                    b.throw_(b.call(serviceNotFoundError, b.call(tokenLabel, token)));
                },
            );

            // set(token: Token, value: any, scope?: Scope): void;
            const set = fn(
                named('set'),
                arg('token'),
                arg('value'),
                arg('scope'),
                (b: Builder, token: Ref, value: Ref, scope: Ref) => {
                    const scopeName = b.ternary(b.isNullish(scope), b.lit(undefined), b.get(scope, 'name'));
                    b.exec(b.invoke(b.call(setter, token, scopeName), value, scope));
                },
            );

            // get(token: Token, scope?: Scope, optional?: boolean): unknown;
            const get = fn(
                named('get'),
                arg('token'),
                arg('scope'),
                arg('optional'),
                (b: Builder, token: Ref, scope: Ref, optional: Ref) =>
                    b.invoke(b.call(resolver, token, scope), scope, optional),
            );

            // instantiationCount<T>(token: any, scope?: string): number;
            const instantiationCount = fn(
                named('instantiationCount'),
                arg('token'),
                arg('scope'),
                (b: Builder, token: Ref, scope: Ref) => {
                    const containerToken = b.let(b.call(getContainerToken, token), 'containerToken');
                    const found = b.let(b.get(b.lit(env.lookupInstantiations), containerToken), 'found');
                    b.if_(found, () => b.invoke(b.invoke(found, scope), scope));
                    return b.lit(0);
                },
            );

            // The providers: each after the providers of this module it depends on. A dependency
            // that leads back to a provider still being declared is a circle — legal to build,
            // an error when it is resolved — and goes through the lookup instead of a call.
            const references: (() => void)[] = [];
            const visiting = new Set<ProviderPlan>();
            const declare = (plan: ProviderPlan) => {
                if (env.declared.has(plan.prepared) || visiting.has(plan)) return;
                visiting.add(plan);
                for (const sibling of plan.siblings) {
                    const dependency = byProvider.get(sibling);
                    if (dependency) declare(dependency);
                }
                references.push(this.declareProvider(b, env, plan));
                visiting.delete(plan);
            };
            for (const plan of plans) declare(plan);

            // Where each provider is found: on its class, by this injector's own symbols, and in
            // the lookup tables for every other kind of token.
            for (const setReferences of references) setReferences();

            // clear(): void;
            const clear = fn(named('clear'), (b: Builder) => {
                for (const plan of plans) {
                    for (const scope of plan.scopes) {
                        // What a scope holds goes with the scope: there is none here to clear it from.
                        if (!scope.scope) b.set(b.lit(env.instances), plan.name, b.lit(undefined));
                    }
                }
            });

            return b.obj({
                resolver: b.lit(resolver),
                setter: b.lit(setter),
                get: b.lit(get),
                set: b.lit(set),
                clear: b.lit(clear),
                instantiationCount: b.lit(instantiationCount),
                collectStack: b.lit(collectStack),
            });
        });

        //for ${moduleName}
        this.built = unit();
    }

    /** What the generated functions of this injector share: its state, its symbols, and the functions declared so far. */
    protected environment(buildContext: BuildContext): BuildEnvironment {
        return {
            runtimeContext: buildContext.runtimeContext,
            instances: {},
            lookupGetter: {},
            lookupSetter: {},
            lookupInstantiations: {},
            symbolResolver: Symbol('resolver'),
            symbolSetter: Symbol('setter'),
            symbolInstantiations: Symbol('instantiations'),
            createResolver: (token: Token, scope?: Scope, label?: string) => this.createResolver(token, scope, label),
            names: new Map(),
            declared: new Map(),
        };
    }

    /**
     * Declare the functions of one provider, and answer what registers them — to be run once every
     * provider's functions exist.
     */
    protected declareProvider(b: Builder, env: BuildEnvironment, plan: ProviderPlan): () => void {
        const { prepared, name, label } = plan;
        const containerToken = getContainerToken(prepared.token);
        const scopeNames = prepared.providers.map(v => v.scope).filter(v => !!v) as string[];

        /** Where the provider is found: the three functions that answer its resolver, setter and counter. */
        const register = (resolve: () => Ref, setter: () => Ref, instantiations: () => Ref) => () => {
            const targets: unknown[] = [];
            if (isClass(containerToken)) targets.push(containerToken);
            if (isType(prepared.token) && prepared.token.kind === ReflectionKind.class) {
                targets.push(prepared.token.classType);
            }
            const resolveFn = b.let(resolve());
            const setterFn = b.let(setter());
            const instantiationsFn = b.let(instantiations());
            for (const target of targets) {
                b.set(b.lit(target), b.lit(env.symbolResolver), resolveFn);
                b.set(b.lit(target), b.lit(env.symbolSetter), setterFn);
                b.set(b.lit(target), b.lit(env.symbolInstantiations), instantiationsFn);
            }
            b.set(b.lit(env.lookupGetter), b.lit(containerToken), resolveFn);
            b.set(b.lit(env.lookupSetter), b.lit(containerToken), setterFn);
            b.set(b.lit(env.lookupInstantiations), b.lit(containerToken), instantiationsFn);
        };
        const always = (value: Function) => () => b.call(alwaysAnswer, b.lit(value));

        if (prepared.resolveFrom) {
            // The provider is another module's: its injector has the functions.
            const built = (b: Builder) => builtOf(b, b.lit(prepared.resolveFrom!.injector));
            const factory = fn(
                named(`factory${name}`),
                arg('scope'),
                arg('optional'),
                (b: Builder, scope: Ref, optional: Ref) =>
                    b.method(built(b), 'get', b.lit(containerToken), scope, optional),
            );
            const setter = fn(
                named(`setter${name}`),
                arg('value'),
                arg('scope'),
                (b: Builder, value: Ref, scope: Ref) => {
                    b.exec(b.method(built(b), 'set', b.lit(containerToken), value, scope));
                },
            );
            const instantiations = fn(named(`instantiations${name}`), arg('scope'), (b: Builder, scope: Ref) =>
                b.method(built(b), 'instantiationCount', b.lit(containerToken), scope),
            );
            return register(always(factory), always(setter), always(instantiations));
        }

        /** A scoped provider answers its own scope only. */
        const inScope = (b: Builder, scopeName: string, scope: Ref, optional: Ref | undefined) => {
            if (!scopeName) return;
            b.if_(b.or(b.not(scope), b.neq(b.get(scope, 'name'), b.lit(scopeName))), () => {
                const notInScope = b.call(knownServiceNotFoundInScope, b.lit(label), b.lit(scopeNames), scope);
                return optional ? b.ternary(optional, b.lit(undefined), notInScope) : notInScope;
            });
        };

        const perScope = plan.scopes.map(scopePlan => {
            const { provider, state } = scopePlan;
            const scopeName = scopePlan.scope;
            const affix = scopeName ? '_' + scopeName : '_global';
            const holderOf = (b: Builder, scope: Ref) => (scopeName ? scope : b.lit(env.instances));

            //${label}, from ${prepared.modules.map(getClassName).join(', ')}
            const factory = fn(
                named(`factory${name}${affix}`),
                arg('scope'),
                arg('optional'),
                (b: Builder, scope: Ref, optional: Ref) => {
                    const holder = holderOf(b, scope);
                    const stateRef = b.lit(state);
                    const runtimeContext = b.lit(env.runtimeContext);

                    inScope(b, scopeName, scope, optional);
                    if (!provider.transient) b.if_(b.get(holder, name), () => b.get(holder, name));

                    if (scopePlan.dependencies) {
                        b.if_(b.gt(b.get(stateRef, 'creating'), b.lit(0)), () => {
                            b.set(stateRef, 'cause', b.lit(true));
                            const stack = b.let(b.emptyArr(), 'stack');
                            b.exec(b.call(env.collectStack!, stack));
                            const paths = b.let(b.call(stackToPath, stack), 'paths');
                            b.exec(b.call(env.reset!));
                            b.exec(b.call(throwCircularDependency, paths));
                        });
                        b.set(runtimeContext, 'creation', b.add(b.get(runtimeContext, 'creation'), b.lit(1)));
                        b.set(stateRef, 'creating', b.get(runtimeContext, 'creation'));
                    }

                    // What a transient dependency is being made FOR, while this provider is made.
                    const needsDestination = !!provider.needsDestination;
                    const oldContext = needsDestination
                        ? b.let(b.get(runtimeContext, 'destination'), 'oldContext')
                        : undefined;
                    if (needsDestination) b.set(runtimeContext, 'destination', b.obj({ token: b.lit(prepared.token) }));

                    b.try_(
                        () => {
                            scopePlan.write(b, { scope, optional, holder, env });
                            b.set(stateRef, 'count', b.add(b.get(stateRef, 'count'), b.lit(1)));
                        },
                        {
                            finally: () => {
                                if (oldContext) b.set(runtimeContext, 'destination', oldContext);
                                b.set(stateRef, 'creating', b.lit(0));
                            },
                        },
                    );
                    if (scopePlan.dependencies) b.set(stateRef, 'creating', b.lit(0));

                    b.if_(b.and(b.not(b.get(holder, name)), b.not(optional)), () => {
                        b.exec(b.call(knownServiceNotFoundError, b.lit(label), b.lit(scopeNames), scope));
                    });
                    return b.get(holder, name);
                },
            );

            const setter = fn(
                named(`setter${name}${affix}`),
                arg('value'),
                arg('scope'),
                arg('optional'),
                (b: Builder, value: Ref, scope: Ref, optional: Ref) => {
                    inScope(b, scopeName, scope, optional);
                    b.set(holderOf(b, scope), name, value);
                },
            );

            const instantiations = fn(
                named(`instantiations${name}${affix}`),
                arg('scope'),
                (b: Builder, scope: Ref) => {
                    inScope(b, scopeName, scope, undefined);
                    return b.get(b.lit(state), 'count');
                },
            );

            return { scope: scopeName, factory, setter, instantiations };
        });

        if (perScope.length === 0) return () => {};

        if (perScope.length === 1) {
            const only = perScope[0];
            env.declared.set(prepared, only.factory);
            return register(always(only.factory), always(only.setter), always(only.instantiations));
        }

        // The provider exists in several scopes: routers choose by the scope's name.
        const nameOf = (b: Builder, scope: Ref) =>
            b.or(b.ternary(b.isNullish(scope), b.lit(undefined), b.get(scope, 'name')), b.lit(''));
        const notInAnyScope = (b: Builder, scope: Ref) =>
            b.exec(b.call(knownServiceNotFoundInScope, b.lit(label), b.lit(scopeNames), scope));

        const routerFactory = fn(
            named(`router${name}_factory`),
            arg('scope'),
            arg('optional'),
            (b: Builder, scope: Ref, optional: Ref) => {
                b.switch_(
                    nameOf(b, scope),
                    perScope.map((v): [string, () => Ref] => [v.scope, () => b.call(v.factory, scope, optional)]),
                    () => {
                        b.if_(optional, () => b.lit(undefined));
                        notInAnyScope(b, scope);
                    },
                );
            },
        );

        // scope router for ${perScope.map(v => v.scope).join(', ')}
        const resolve = fn(named(`resolve${name}`), arg('scope'), arg('optional'), (b: Builder, scope: Ref) => {
            b.switch_(
                nameOf(b, scope),
                perScope.map((v): [string, () => Ref] => [v.scope, () => b.lit(v.factory)]),
                // no scope given, so return route for value itself
                () => b.lit(routerFactory),
            );
        });

        const routerSetter = fn(
            named(`router${name}_setter`),
            arg('value'),
            arg('scope'),
            arg('optional'),
            (b: Builder, value: Ref, scope: Ref, optional: Ref) => {
                b.switch_(
                    nameOf(b, scope),
                    perScope.map((v): [string, () => Ref] => [v.scope, () => b.call(v.setter, value, scope, optional)]),
                    () => {
                        b.if_(optional, () => b.lit(undefined));
                        notInAnyScope(b, scope);
                    },
                );
            },
        );

        const setterOfScope = fn(named(`setter_router${name}`), arg('scopeName'), (b: Builder, scopeName: Ref) => {
            b.switch_(
                scopeName,
                perScope.map((v): [string, () => Ref] => [v.scope, () => b.lit(v.setter)]),
                // no scope given, so return route for value itself
                () => b.lit(routerSetter),
            );
        });

        const instantiationsOfScope = fn(
            named(`instantiations_router${name}`),
            arg('scope'),
            (b: Builder, scope: Ref) => {
                b.switch_(
                    nameOf(b, scope),
                    perScope.map((v): [string, () => Ref] => [v.scope, () => b.lit(v.instantiations)]),
                    () => notInAnyScope(b, scope),
                );
            },
        );

        env.declared.set(prepared, routerFactory);
        return register(
            () => b.lit(resolve),
            () => b.lit(setterOfScope),
            () => b.lit(instantiationsOfScope),
        );
    }

    /**
     * Work out everything the functions of one provider are made of: per scope, how its instance
     * is made and which providers of this module that calls.
     */
    protected planProvider(env: BuildEnvironment, prepared: PreparedProvider): ProviderPlan {
        const { name, label } = env.names.get(prepared)!;
        const plan: ProviderPlan = { prepared, name, label, scopes: [], siblings: new Set() };
        if (prepared.resolveFrom) return plan;

        // scopes will be created first, so they are returned instead of the unscoped instance
        prepared.providers.sort((a, b) => {
            if (a.scope && !b.scope) return -1;
            if (!a.scope && b.scope) return +1;
            return 0;
        });

        // console.log(`${label} got ${prepared.providers.length} providers for module ${getClassName(this.module)}. ` +
        //     `scopes ${prepared.providers.map(v => v.scope).join(', ')}. ` +
        //     `resolveFrom=${prepared.resolveFrom ? getClassName(prepared.resolveFrom) : 'none'}. ` +
        //     `resolve from modules ${prepared.modules.map(getClassName).join(', ')}. `);

        for (const provider of prepared.providers) {
            const made = this.planInstance(env, name, prepared.token, provider, prepared.modules);
            for (const sibling of made.siblings) plan.siblings.add(sibling);
            plan.scopes.push({
                provider,
                scope: getScope(provider),
                state: { label, count: 0, creating: 0, cause: false },
                dependencies: made.dependencies,
                write: made.write,
            });
        }
        return plan;
    }

    /** How the instance of one provider is made, and set up: the statements inside its factory's `try`. */
    protected planInstance(
        env: BuildEnvironment,
        name: string,
        token: Token,
        provider: BuiltNormalizedProvider,
        resolveDependenciesFrom: InjectorModule[],
    ): { dependencies: number; siblings: PreparedProvider[]; write: (b: Builder, at: FactoryScope) => void } {
        const siblings: PreparedProvider[] = [];
        const dependency = (
            options: { name: string; type: Type; optional: boolean },
            ofName: string,
            argPosition: number,
            notFound: NotFound,
        ): WriteDependency => {
            const planned = this.planDependency(
                env,
                options,
                provider,
                resolveDependenciesFrom,
                ofName,
                argPosition,
                notFound,
            );
            if (planned.sibling) siblings.push(planned.sibling);
            return planned.write;
        };

        let dependencies = 0;
        /** Makes the instance and answers it. */
        let make: (b: Builder, at: FactoryScope) => Ref;
        /** The instance is put in its place by `make` itself: a class's, whose properties are set on it there. */
        let inPlace = false;

        if (isValueProvider(provider)) {
            make = b => b.lit(provider.useValue);
        } else if (isClassProvider(provider)) {
            let useClass = provider.useClass;
            if (!useClass) {
                if (isClass(provider.provide)) useClass = provider.provide as ClassType;
                if (isType(provider.provide) && provider.provide.kind === ReflectionKind.class)
                    useClass = provider.provide.classType;
                if (!useClass) {
                    throw new InjectorError(
                        'DK-I040',
                        `UseClassProvider needs to set either 'useClass' or 'provide' as a ClassType. Got ${provider.provide as any}.`,
                    );
                }
            }
            const classType = useClass;
            if (!classType) throw new InjectorError('DK-I080', 'Cannot create factory for undefined ClassType.');
            const reflectionClass = ReflectionClass.from(classType);
            const args: WriteDependency[] = [];
            const properties: { name: string; write: WriteDependency }[] = [];

            const constructor = reflectionClass.getMethodOrUndefined('constructor');
            const constructorProperties: string[] = [];
            if (constructor) {
                for (const parameter of constructor.getParameters()) {
                    if (parameter.getVisibility() !== undefined) constructorProperties.push(parameter.name);
                    dependencies++;
                    const tokenType = getInjectOptions(parameter.getType() as Type);
                    args.push(
                        dependency(
                            {
                                name: parameter.name,
                                type: tokenType || (parameter.getType() as Type),
                                optional: !parameter.isValueRequired(),
                            },
                            getClassName(classType),
                            args.length,
                            constructorParameterNotFound,
                        ),
                    );
                }
            }

            for (const property of reflectionClass.getProperties()) {
                if (constructorProperties.includes(property.name)) continue; // already assigned in constructor
                const tokenType = getInjectOptions(property.type);
                if (!tokenType) continue;

                dependencies++;
                try {
                    properties.push({
                        name: String(property.getName()),
                        write: dependency(
                            { name: property.name, type: tokenType, optional: !property.isValueRequired() },
                            getClassName(classType),
                            -1,
                            propertyParameterNotFound,
                        ),
                    });
                } catch (error: any) {
                    throw new DependenciesUnmetError(
                        `Could not resolve property injection token ${getClassName(classType)}.${String(property.getName())}: ${error.message}`,
                        { cause: error },
                    );
                }
            }

            inPlace = true;
            make = (b, at) => {
                // Each argument in its order, as the arguments of a call are evaluated.
                const values = args.map(write => b.let(write(b, at.scope)));
                b.set(at.holder, name, b.new_(classType, ...values));
                for (const property of properties) {
                    b.set(b.get(at.holder, name), property.name, property.write(b, at.scope));
                }
                return b.get(at.holder, name);
            };
        } else if (isExistingProvider(provider)) {
            const existingToken = getContainerToken(provider.useExisting);
            make = (b, at) => b.method(builtOf(b, b.lit(this)), 'get', b.lit(existingToken), at.scope, at.optional);
        } else if (isFactoryProvider(provider)) {
            const args: WriteDependency[] = [];
            const reflection = ReflectionFunction.from(provider.useFactory);
            const ofName = reflection.name === 'anonymous' ? 'useFactory' : reflection.name;

            for (const parameter of reflection.getParameters()) {
                dependencies++;
                const tokenType = getInjectOptions(parameter.getType() as Type);
                args.push(
                    dependency(
                        {
                            name: parameter.name,
                            type: tokenType || (parameter.getType() as Type),
                            optional: !parameter.isValueRequired(),
                        },
                        ofName,
                        args.length,
                        factoryDependencyNotFound,
                    ),
                );
            }

            make = (b, at) => b.call(provider.useFactory, ...args.map(write => b.let(write(b, at.scope))));
        } else {
            throw new InjectorError(
                'DK-I070',
                'Invalid provider. Must be a class, value, factory, or existing provider.',
            );
        }

        const configurations: ConfigureProviderEntry[] = [];
        for (const module of resolveDependenciesFrom) {
            configurations.push(...module.configurationProviderRegistry.get(token));
        }
        configurations.push(...this.buildContext.globalConfigurationProviderRegistry.get(token));

        const configure: { call: Function; replace: boolean; args: WriteDependency[] }[] = [];
        if (configurations?.length) {
            configurations.sort((a, b) => {
                return a.options.order - b.options.order;
            });

            for (const configuration of configurations) {
                const args: WriteDependency[] = [];
                const reflection = ReflectionFunction.from(configuration.call);
                const ofName = reflection.name === 'anonymous' ? 'configureProvider' : reflection.name;

                for (const parameter of reflection.getParameters().slice(1)) {
                    const tokenType = getInjectOptions(parameter.getType() as Type);
                    args.push(
                        dependency(
                            {
                                name: parameter.name,
                                type: tokenType || (parameter.getType() as Type),
                                optional: !parameter.isValueRequired(),
                            },
                            ofName,
                            // The provider's instance is the first argument of what configures it.
                            args.length + 1,
                            functionParameterNotFound,
                        ),
                    );
                }
                configure.push({ call: configuration.call, replace: !!configuration.options.replace, args });
            }
        }

        return {
            dependencies,
            siblings,
            write: (b, at) => {
                const made = make(b, at);
                if (!inPlace) b.set(at.holder, name, made);

                if (!configure.length) return; //no custom provider setup
                b.if_(b.neq(b.get(at.holder, name), b.lit(undefined)), () => {
                    for (const entry of configure) {
                        const args = entry.args.map(write => b.let(write(b, at.scope)));
                        const call = b.call(entry.call, b.get(at.holder, name), ...args);
                        if (entry.replace) b.set(at.holder, name, call);
                        else b.exec(call);
                    }
                });
            },
        };
    }

    /**
     * One dependency of a provider: an argument of its constructor or its factory, an injected
     * property, a parameter of what configures it. Answers how its value is written where the
     * factory needs it — and, where that is a call of another provider of this module, which one.
     */
    protected planDependency(
        env: BuildEnvironment,
        options: { name: string; type: Type; optional: boolean },
        fromProvider: BuiltNormalizedProvider,
        resolveDependenciesFrom: InjectorModule[],
        ofName: string,
        argPosition: number,
        notFound: NotFound,
    ): { write: WriteDependency; sibling?: PreparedProvider } {
        let of = `${ofName}.${options.name}`;
        const value = (constant: unknown): { write: WriteDependency } => ({ write: b => b.lit(constant) });

        if (options.type.kind === ReflectionKind.class) {
            const found = findModuleForConfig(options.type.classType, resolveDependenciesFrom);
            if (found) return value(getPathValue(found.module.getConfig(), found.path));
        }

        if (options.type.kind === ReflectionKind.class && options.type.classType === TransientInjectionTarget) {
            if (fromProvider.transient === true) {
                const target = options.type.classType;
                return {
                    write: b => {
                        const made = b.call(
                            createTransientInjectionTarget,
                            b.get(b.lit(env.runtimeContext), 'destination'),
                        );
                        if (options.optional) return made;
                        return b.nullish(
                            made,
                            b.call(
                                transientInjectionTargetUnavailable,
                                b.lit(ofName),
                                b.lit(options.name),
                                b.lit(argPosition),
                                b.lit(target),
                            ),
                        );
                    },
                };
            } else {
                throw new InjectorError(
                    'DK-I090',
                    `Cannot inject ${TransientInjectionTarget.name} into ${JSON.stringify(ofName)}.${JSON.stringify(options.name)}, as ${JSON.stringify(ofName)} is not transient.`,
                );
            }
        }

        if (options.type.kind === ReflectionKind.class && options.type.classType === InjectorModule) {
            // the last entry is always the module that defined the provider (no matter if it was exported)
            return value(resolveDependenciesFrom[resolveDependenciesFrom.length - 1]);
        }

        if (options.type.kind === ReflectionKind.class && options.type.classType === Injector) {
            // the last entry is always the module that defined the provider (no matter if it was exported)
            const module = resolveDependenciesFrom[resolveDependenciesFrom.length - 1];
            return { write: b => b.get(b.lit(module), 'injector') };
        }

        if (options.type.kind === ReflectionKind.class && options.type.classType === TagRegistry) {
            return value(this.buildContext.tagRegistry);
        }

        if (options.type.kind === ReflectionKind.class) {
            for (const module of resolveDependenciesFrom) {
                if (module instanceof options.type.classType) return value(module);
            }
        }

        if (options.type.kind === ReflectionKind.class && isPrototypeOfBase(options.type.classType, Tag)) {
            const tagClass = options.type.classType;
            // What the tag's providers answered, resolved by the first factory that needs them and kept.
            const resolved: { services?: unknown[] } = {};
            const entries = this.buildContext.tagRegistry.resolve(options.type.classType);
            return {
                write: (b, scope) => {
                    b.if_(b.not(b.get(b.lit(resolved), 'services')), () => {
                        b.set(
                            b.lit(resolved),
                            'services',
                            b.arr(
                                ...entries.map(entry =>
                                    b.method(
                                        builtOf(b, b.get(b.lit(entry.module), 'injector')),
                                        'get',
                                        b.lit(getContainerToken(entry.tagProvider.provider.provide)),
                                        scope,
                                    ),
                                ),
                            ),
                        );
                    });
                    return b.new_(tagClass, b.get(b.lit(resolved), 'services'));
                },
            };
        }

        if (options.type.kind === ReflectionKind.function && options.type.typeName === 'PartialFactory') {
            const type = options.type.typeArguments?.[0];
            const factory = partialFactory(type, this);
            return { write: (b, scope) => b.call(factory, scope) };
        }

        if (options.type.kind === ReflectionKind.objectLiteral) {
            const pickArguments = getPickArguments(options.type);
            if (pickArguments) {
                if (pickArguments[0].kind === ReflectionKind.class) {
                    const found = findModuleForConfig(pickArguments[0].classType, resolveDependenciesFrom);
                    if (found) {
                        const fullConfig = getPathValue(found.module.getConfig(), found.path);
                        let index = pickArguments[1];
                        if (index.kind === ReflectionKind.literal) {
                            index = { kind: ReflectionKind.union, types: [index] };
                        }
                        if (index.kind === ReflectionKind.union) {
                            const members: string[] = [];
                            for (const t of index.types) {
                                if (t.kind === ReflectionKind.literal) members.push(String(t.literal));
                            }

                            return {
                                write: b =>
                                    b.obj(
                                        members.map((member): [string, Ref] => [
                                            member,
                                            b.get(b.lit(fullConfig), member),
                                        ]),
                                    ),
                            };
                        }
                    }
                }
            }
        }

        if (options.type.indexAccessOrigin) {
            let current = options.type;
            let module = undefined as InjectorModule | undefined;
            const accesses: string[] = [];

            while (current && current.indexAccessOrigin) {
                let found: { module: InjectorModule; path: string } | undefined = undefined;
                if (current.indexAccessOrigin.container.kind === ReflectionKind.class) {
                    found = findModuleForConfig(current.indexAccessOrigin.container.classType, resolveDependenciesFrom);
                }
                if (current.indexAccessOrigin.index.kind === ReflectionKind.literal) {
                    accesses.unshift(String(current.indexAccessOrigin.index.literal));
                }
                current = current.indexAccessOrigin.container;
                if (found) {
                    module = found.module;
                    if (found.path) accesses.unshift(found.path);
                    break;
                }
            }
            if (module) {
                const fullConfig = module.getConfig();
                return { write: b => accesses.reduce((config, key) => b.get(config, key), b.lit(fullConfig)) };
            }
        }

        let foundPreparedProvider: PreparedProvider | undefined = undefined;
        for (const module of resolveDependenciesFrom) {
            foundPreparedProvider = module.getPreparedProvider(options.type, foundPreparedProvider);
        }

        if (resolveDependenciesFrom[0] !== this.module) {
            //the provider was exported from another module, so we need to check if there is a more specific candidate
            foundPreparedProvider = this.module.getPreparedProvider(options.type, foundPreparedProvider);
        }
        const fromScope = getScope(fromProvider);

        function invalidMatch(foundPreparedProvider?: PreparedProvider): boolean {
            if (!foundPreparedProvider) return true;
            const allPossibleScopes = foundPreparedProvider.providers.map(getScope);
            const unscoped = allPossibleScopes.includes('') && allPossibleScopes.length === 1;
            return !unscoped && !allPossibleScopes.includes(fromScope);
        }

        // go up parent hierarchy and find a match
        let current: InjectorModule | undefined = this.module;
        while (current && invalidMatch(foundPreparedProvider)) {
            foundPreparedProvider = current.getPreparedProvider(options.type, foundPreparedProvider);
            current = current.parent;
        }

        if (!foundPreparedProvider && options.optional) return value(undefined);

        if (!foundPreparedProvider) {
            if (argPosition >= 0) {
                const argsCheck: string[] = [];
                for (let i = 0; i < argPosition; i++) argsCheck.push('✓');
                argsCheck.push('?');
                of = `${ofName}(${argsCheck.join(', ')})`;
            }

            const type = stringifyType(options.type, { showFullDefinition: false })
                .replace(/\n/g, '')
                .replace(/\s\s+/g, ' ')
                .replace(' & InjectMeta', '');
            if (options.optional) return value(undefined);
            throw new DependenciesUnmetError(
                `Undefined dependency "${options.name}: ${type}" of ${of}. Type has no provider${fromScope ? ' in scope ' + fromScope : ''}.`,
            );
        }

        const found = foundPreparedProvider;
        const dependencyToken = getContainerToken(found.token);
        const foundProviderLabel = found.providers
            .map(v => v.provide)
            .map(tokenLabel)
            .join(', ');

        if (invalidMatch(found)) {
            const allPossibleScopes = found.providers.map(getScope);
            const t = stringifyType(options.type, { showFullDefinition: false });
            throw new DependenciesUnmetError(
                `Dependency '${options.name}: ${t}' of ${of} can not be injected into ${fromScope ? 'scope ' + fromScope : 'no scope'}, ` +
                    `since ${foundProviderLabel} only exists in scope${allPossibleScopes.length === 1 ? '' : 's'} ${allPossibleScopes.join(', ')}.`,
            );
        }

        //when the dependency is FactoryProvider it might return undefined.
        //in this case, if the dependency is not optional, we throw an error.
        const orThrow = (b: Builder, resolved: Ref) =>
            options.optional
                ? resolved
                : b.nullish(
                      resolved,
                      b.call(notFound, b.lit(ofName), b.lit(options.name), b.lit(argPosition), b.lit(dependencyToken)),
                  );

        if (isTransientInjectionTargetProvider(found)) {
            fromProvider.needsDestination = true;
        }

        if (found.resolveFrom) {
            const injector = found.resolveFrom.injector;
            return {
                write: (b, scope) =>
                    orThrow(
                        b,
                        b.method(builtOf(b, b.lit(injector)), 'get', b.lit(dependencyToken), scope, b.lit(true)),
                    ),
            };
        }

        const resolveFromModule = found.resolveFrom || found.modules[0];
        if (resolveFromModule === this.module) {
            return {
                // A provider of this module with functions of its own here.
                sibling: env.names.has(found) ? found : undefined,
                write: (b, scope) => {
                    const factory = env.declared.get(found);
                    // Its factory, where it is declared by now. Where it is not — it is being
                    // declared right now, a circle — it is looked up when the factory runs.
                    return orThrow(
                        b,
                        factory
                            ? b.call(factory, scope, b.lit(true))
                            : b.invoke(
                                  b.call(env.resolver!, b.lit(dependencyToken), scope, b.lit(true)),
                                  scope,
                                  b.lit(true),
                              ),
                    );
                },
            };
        }

        // go through module injector
        return {
            write: (b, scope) =>
                orThrow(
                    b,
                    b.invoke(
                        b.method(
                            builtOf(b, b.get(b.lit(resolveFromModule), 'injector')),
                            'resolver',
                            b.lit(dependencyToken),
                            scope,
                            b.lit(true),
                        ),
                        scope,
                        b.lit(true),
                    ),
                ),
        };
    }

    protected resolveType(type: Type): PreparedProvider | undefined {
        const resolveDependenciesFrom = [this.module];

        let foundPreparedProvider: PreparedProvider | undefined = undefined;
        for (const module of resolveDependenciesFrom) {
            foundPreparedProvider = module.getPreparedProvider(type, foundPreparedProvider);
        }

        if (resolveDependenciesFrom[0] !== this.module) {
            //the provider was exported from another module, so we need to check if there is a more specific candidate
            foundPreparedProvider = this.module.getPreparedProvider(type, foundPreparedProvider);
        }

        if (!foundPreparedProvider) {
            //go up parent hierarchy
            let current: InjectorModule | undefined = this.module;
            while (current && !foundPreparedProvider) {
                foundPreparedProvider = current.getPreparedProvider(type, foundPreparedProvider);
                current = current.parent;
            }
        }

        return foundPreparedProvider;
    }

    createSetter<T>(token: ReceiveType<T> | Token<T>, scopeName?: string, label?: string): Setter<T> {
        if (token instanceof TagProvider) token = token.provider.provide;

        // todo remove isClass since it's slow
        let type: Type | undefined = isType(token)
            ? token
            : isArray(token) || isClass(token)
              ? resolveReceiveType(token)
              : undefined;

        if (!type) {
            const containerToken = getContainerToken(token as Token);
            return this.built!.setter(containerToken);
        }

        const foundPreparedProvider = this.resolveType(type);

        if (!foundPreparedProvider) {
            const t = stringifyType(type, { showFullDefinition: false });
            const message = label ? `${label}: ${t}` : t;
            throw serviceNotFoundError(message);
        }

        const containerToken = getContainerToken(foundPreparedProvider.token);
        const resolveFromModule = foundPreparedProvider.resolveFrom || foundPreparedProvider.modules[0];
        return resolveFromModule.injector!.built!.setter(containerToken, scopeName);
    }

    createResolver<T>(token: ReceiveType<T> | Token<T>, scope?: Scope, label?: string): Resolver<T> {
        if (token instanceof TagProvider) token = token.provider.provide;

        // todo remove isClass since it's slow
        let type: Type | undefined = isType(token)
            ? token
            : isArray(token) || isClass(token)
              ? resolveReceiveType(token)
              : undefined;

        if (!type) {
            const containerToken = getContainerToken(token as Token);
            return this.built!.resolver(containerToken, scope) as any;
        }

        const resolveDependenciesFrom = [this.module];
        const optional = isOptional(type);
        if (type.kind === ReflectionKind.propertySignature || type.kind === ReflectionKind.property) type = type.type;
        if (type.kind === ReflectionKind.parameter) type = type.type;

        type = getInjectOptions(type) || type;

        // if (type.kind === ReflectionKind.union) {
        //     type = type.types.some(v => v.kind !== ReflectionKind.undefined);
        // }

        if (type.kind === ReflectionKind.class) {
            const found = findModuleForConfig(type.classType, resolveDependenciesFrom);
            if (found) return () => getPathValue(found.module.getConfig(), found.path);
        }

        if (type.kind === ReflectionKind.class && type.classType === TagRegistry)
            return (() => this.buildContext.tagRegistry) as any;

        if (type.kind === ReflectionKind.class) {
            for (const module of resolveDependenciesFrom) {
                if (module instanceof type.classType) return (() => module) as any;
            }
        }

        if (type.kind === ReflectionKind.class && isPrototypeOfBase(type.classType, Tag)) {
            const entries = this.buildContext.tagRegistry.resolve(type.classType);
            const args: any[] = [];
            for (const entry of entries) {
                args.push(entry.module.injector!.built!.resolver(entry.tagProvider.provider.provide, scope));
            }

            return new type.classType(args);
        }

        if (type.kind === ReflectionKind.function && type.typeName === 'PartialFactory') {
            const factoryType = type.typeArguments?.[0];
            const factory = partialFactory(factoryType, this);
            return ((scopeIn?: Scope) => factory(scopeIn)) as any;
        }

        if (isWithAnnotations(type)) {
            if (type.kind === ReflectionKind.objectLiteral) {
                const pickArguments = getPickArguments(type);
                if (pickArguments) {
                    if (pickArguments[0].kind === ReflectionKind.class) {
                        const found = findModuleForConfig(pickArguments[0].classType, resolveDependenciesFrom);
                        if (found) {
                            const fullConfig = getPathValue(found.module.getConfig(), found.path);
                            let index = pickArguments[1];
                            if (index.kind === ReflectionKind.literal) {
                                index = { kind: ReflectionKind.union, types: [index] };
                            }
                            if (index.kind === ReflectionKind.union) {
                                const pickedConfig: { [name: string]: any } = {};
                                for (const t of index.types) {
                                    if (t.kind === ReflectionKind.literal) {
                                        const index = JSON.stringify(t.literal);
                                        pickedConfig[index] = fullConfig[index];
                                    }
                                }

                                return (() => pickedConfig) as any;
                            }
                        }
                    }
                }
            }

            if (type.indexAccessOrigin) {
                let current = type;
                let config: { [name: string]: any } | undefined = undefined;

                while (current && current.indexAccessOrigin) {
                    if (current.indexAccessOrigin.container.kind === ReflectionKind.class) {
                        const found = findModuleForConfig(
                            current.indexAccessOrigin.container.classType,
                            resolveDependenciesFrom,
                        );
                        // Only because it has indexAccessOrigin as class doesn't mean it must be a config reference.
                        // We can safely ignore it if it's not a config reference.
                        if (found) {
                            config = getPathValue(found.module.getConfig(), found.path);
                        }
                    }
                    if (config !== undefined && current.indexAccessOrigin.index.kind === ReflectionKind.literal) {
                        const index = current.indexAccessOrigin.index.literal;
                        config = config[String(index)];
                    }
                    current = current.indexAccessOrigin.container;
                }

                if (config !== undefined) return (() => config) as any;
            }
        }

        const foundPreparedProvider = this.resolveType(type);
        if (!foundPreparedProvider) {
            if (optional) return (() => undefined) as any;

            const t = stringifyType(type, { showFullDefinition: false });
            const message = label ? `${label}: ${t}` : t;
            throw serviceNotFoundError(message);
        }

        const containerToken = getContainerToken(foundPreparedProvider.token);
        const resolveFromModule = foundPreparedProvider.resolveFrom || foundPreparedProvider.modules[0];
        if (!resolveFromModule.injector?.built) {
            throw new Error('Injector was not built');
        }

        return resolveFromModule.injector.built.resolver(containerToken, scope) as Resolver<T>;
    }
}

class BuildProviderIndex {
    protected offset: number = 0;

    reserve(): number {
        return this.offset++;
    }
}

export class BuildContext {
    static ids: number = 0;
    id: number = BuildContext.ids++;

    // this is shared in all built injectors to track the instantiation stack
    // for circular dependency detection.
    runtimeContext = { creation: 0 };

    tagRegistry: TagRegistry = new TagRegistry();
    providerIndex: BuildProviderIndex = new BuildProviderIndex();

    /**
     * In the process of preparing providers, each module redirects their
     * global setup calls in this registry.
     */
    globalConfigurationProviderRegistry: ConfigurationProviderRegistry = new ConfigurationProviderRegistry();
}

export interface Resolver<T> {
    (scope: Scope | undefined, optional: true): T | undefined;

    (scope?: Scope, optional?: boolean): T;
}

export type Setter<T> = (value: T, scope?: Scope, optional?: boolean) => void;

/**
 * A InjectorContext is responsible for taking a root InjectorModule and build all Injectors.
 *
 * It also can create scopes aka a sub InjectorContext with providers from a particular scope.
 */
export class InjectorContext {
    constructor(
        public rootModule: InjectorModule,
        public scope?: Scope,
    ) {}

    /**
     * Returns a resolver for the given token. The returned resolver can
     * be executed to resolve the token. This increases performance in hot paths.
     */
    resolve<T>(module?: InjectorModule, type?: ReceiveType<T> | Token<T>): Resolver<T> {
        const injector = this.getInjector(module || this.rootModule);
        return injector.getResolver(type) as Resolver<T>;
    }

    setter<T>(module?: InjectorModule, type?: ReceiveType<T> | Token<T>, scopeName?: string): Setter<T> {
        const injector = this.getInjector(module || this.rootModule);
        return injector.getSetter(type, scopeName || this.scope?.name) as Setter<T>;
    }

    /**
     * Returns an instance of the given token or type from the injector associated with the specified module.
     *
     * If there is no provider for the token or the provider returns undefined, it returns undefined.
     */
    getOrUndefined<T>(token?: ReceiveType<T> | Token<T>, module?: InjectorModule): ResolveToken<T> | undefined {
        const injector = (module || this.rootModule).getOrCreateInjector();
        return injector.get(token, this.scope, true);
    }

    /**
     * Returns an instance of the given token or type from the injector associated with the specified module.
     *
     * If there is no provider for the token or the provider returns undefined, it throws an error.
     */
    get<T>(token?: ReceiveType<T> | Token<T>, module?: InjectorModule): ResolveToken<T> {
        const injector = (module || this.rootModule).getOrCreateInjector();
        return injector.get(token, this.scope) as ResolveToken<T>;
    }

    /**
     * Returns the instantiation count of the given token.
     *
     * This is either 0 or 1 for normal providers, and >= 0 for transient or scoped providers.
     */
    instantiationCount(token: Token, module?: InjectorModule, scope?: string): number {
        const injector = this.getInjector(module || this.rootModule);
        return injector.instantiationCount(token, scope ? { name: scope } : this.scope);
    }

    /**
     * Sets a value for the given token in the injector associated with the specified module.
     *
     * This is useful for scoped providers like HttpRequest that are created dynamically
     * outside the injector container and need to be injected into services.
     */
    set<T>(token: T, value: any, module?: InjectorModule): void {
        const injector = (module || this.rootModule).getOrCreateInjector();
        return injector.set(token, value, this.scope);
    }

    static forProviders(providers: ProviderWithScope[]) {
        return new InjectorContext(new InjectorModule(providers));
    }

    getInjector(module: InjectorModule): Injector {
        return module.getOrCreateInjector();
    }

    getRootInjector(): Injector {
        return this.getInjector(this.rootModule);
    }

    createChildScope(scope: string): InjectorContext {
        return new InjectorContext(this.rootModule, { name: scope });
    }
}

export function injectedFunction<T extends (...args: any) => any>(
    fn: T,
    injector: Injector,
    skipParameters: number = 0,
    type?: Type,
    skipTypeParameters?: number,
): (scope?: Scope, ...args: any[]) => ReturnType<T> {
    type = type || reflect(fn);
    skipTypeParameters = skipTypeParameters === undefined ? skipParameters : skipTypeParameters;
    if (type.kind === ReflectionKind.function || type.kind === ReflectionKind.method) {
        const args: Resolver<any>[] = [];
        for (let i = skipTypeParameters; i < type.parameters.length; i++) {
            const parameter = type.parameters[i];
            const resolver = injector.getResolver(parameter, parameter.name);
            args.push((scope?: Scope) => resolver(scope, parameter.optional));
        }

        if (skipParameters === 0) {
            return ((scope: Scope | undefined) => {
                return fn(...args.map(v => v(scope)));
            }) as any;
        } else if (skipParameters === 1) {
            return ((scope: Scope | undefined, p1: any) => {
                return fn(p1, ...args.map(v => v(scope)));
            }) as any;
        } else if (skipParameters === 2) {
            return ((scope: Scope | undefined, p1: any, p2: any) => {
                return fn(p1, p2, ...args.map(v => v(scope)));
            }) as any;
        } else if (skipParameters === 3) {
            return ((scope: Scope | undefined, p1: any, p2: any, p3: any) => {
                return fn(p1, p2, p3, ...args.map(v => v(scope)));
            }) as any;
        } else {
            return ((scope: Scope | undefined, ...input: any[]) => {
                while (input.length !== skipParameters) {
                    input.push(undefined);
                }
                return fn(...input.slice(0, skipParameters), ...args.map(v => v(scope)));
            }) as any;
        }
    }
    return fn;
}

export function partialFactory(type: Type | undefined, injector: Injector) {
    if (!type) throw new InjectorError('DK-I100', 'Cannot create partial factory for undefined type.');

    // must be lazy because creating resolvers for types that are never resolved & unresolvable will throw
    function createLazyResolver(type: Type, label?: string): Resolver<any> {
        let resolver: Resolver<any> | undefined = undefined;
        return (scope?: Scope) => {
            if (!resolver) {
                resolver = injector.getResolver(type, label);
            }
            return resolver(scope);
        };
    }

    if (type.kind === ReflectionKind.class) {
        const classType = type.classType;
        const reflectionClass = ReflectionClass.from(classType);

        const args: { name: string; resolve: (scope?: Scope) => ReturnType<Resolver<any>> }[] = [];
        const constructor = reflectionClass.getMethodOrUndefined('constructor');
        const constructorProperties: string[] = [];
        if (constructor) {
            for (const parameter of constructor.getParameters()) {
                if (parameter.getVisibility() !== undefined) constructorProperties.push(parameter.name);
                args.push({
                    name: parameter.name,
                    resolve: createLazyResolver(parameter.getType() as Type, parameter.name),
                });
            }
        }

        const properties = new Map<keyof any, (scope?: Scope) => ReturnType<Resolver<any>>>();
        for (const property of reflectionClass.getProperties()) {
            if (constructorProperties.includes(property.name)) continue; // already assigned in constructor
            const tokenType = getInjectOptions(property.type);
            if (!tokenType) continue;

            properties.set(property.getName(), createLazyResolver(tokenType, property.name));
        }

        return (scope?: Scope) =>
            <T>(partial: Partial<{ [K in keyof T]: T[K] }>) => {
                const instance = new classType(...args.map(v => partial[v.name as keyof T] ?? v.resolve(scope)));
                for (const [property, resolve] of properties.entries()) {
                    instance[property] ??= partial[property as keyof T] ?? resolve(scope);
                }
                return instance as T;
            };
    }

    if (type.kind === ReflectionKind.objectLiteral) {
        const properties = new Map<keyof any, (scope?: Scope) => ReturnType<Resolver<any>>>();
        for (const property of type.types) {
            if (property.kind !== ReflectionKind.propertySignature) continue;
            properties.set(property.name, createLazyResolver(property, String(property.name)));
        }

        return (scope?: Scope) =>
            <T>(partial: Partial<{ [K in keyof T]: T[K] }>) => {
                const obj: any = {};
                for (const [property, resolve] of properties.entries()) {
                    obj[property] = partial[property as keyof T] ?? resolve(scope);
                }
                return obj as T;
            };
    }

    throw new InjectorError(
        'DK-I101',
        `Cannot create partial factory for ${stringifyType(type, { showFullDefinition: false })}. Only class and object literal types are supported.`,
    );
}
