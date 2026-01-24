/*
 * Deepkit Framework
 * Copyright (c) Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { Context, Slot, jit, toFastProperties } from '@deepkit/core';

import {
    ReflectionKind,
    Type,
    TypeClass,
    TypeObjectLiteral,
    copyAndSetParent,
    getTypeJitContainer,
    getTypeObjectLiteralFromTypeClass,
} from '../reflection/type.js';
import { ValidationErrorItem } from '../validator.js';
import { NamingStrategy } from './naming.js';
import { HandlerRegistry } from './registry.js';
import { BuildState, SerializationOptions } from './state.js';

export type SerializeFunction<T = any, R = any> = (data: T, options?: SerializationOptions) => R;

export type Guard<T> = (data: any, state?: { errors?: ValidationErrorItem[] }) => data is T;

/**
 * Main serializer class that coordinates type handlers for serialization,
 * deserialization, and type guards.
 *
 * Uses jit.fn() for CSP-compliant code generation with tiered execution.
 *
 * @example
 * ```typescript
 * const serializer = new Serializer('json');
 *
 * interface User {
 *     name: string;
 *     age: number;
 * }
 *
 * const serialize = serializer.buildSerializer<User>(typeOf<User>());
 * const result = serialize({ name: 'John', age: 30 });
 * ```
 */
export class Serializer {
    /** Registry for serialization handlers */
    readonly serializeRegistry = new HandlerRegistry('serialize');

    /** Registry for deserialization handlers */
    readonly deserializeRegistry = new HandlerRegistry('deserialize');

    /** Registry for type guards (unified: fast, strict, and error-collecting all use this) */
    readonly typeGuards = new HandlerRegistry();

    /** Cache for built fast type guard functions */
    private readonly fastTypeGuardCache = new Map<Type, (data: unknown) => boolean>();

    /** Cache for built strict type guard functions */
    private readonly strictTypeGuardCache = new Map<Type, (data: unknown) => boolean>();

    /** Cache for built weak type guard functions (no NaN checks) */
    private readonly weakTypeGuardCache = new Map<Type, (data: unknown) => boolean>();

    /** Types currently being built as fast guards (for recursive type detection) */
    private readonly buildingFastTypeGuards = new Set<Type>();

    /** Types currently being built as strict guards (for recursive type detection) */
    private readonly buildingStrictTypeGuards = new Set<Type>();

    /** Types currently being built as weak guards (for recursive type detection) */
    private readonly buildingWeakTypeGuards = new Set<Type>();

    constructor(public name: string = 'json') {
        this.registerSerializers();
        this.registerTypeGuards();
    }

    /**
     * Whether to set explicit undefined for missing optional properties.
     * Can be overridden in subclasses.
     */
    public setExplicitUndefined(type: Type, state: BuildState): boolean {
        return true;
    }

    /**
     * Register default serializers. Override in subclasses to customize.
     */
    protected registerSerializers(): void {
        // Handlers will be registered via registerDefaultHandlers() from handlers.ts
    }

    /**
     * Register default type guards. Override in subclasses to customize.
     */
    protected registerTypeGuards(): void {
        // Guards will be registered via registerDefaultTypeGuards() from handlers.ts
    }

    /**
     * Clear all registries.
     */
    clear(): void {
        this.serializeRegistry.clear();
        this.deserializeRegistry.clear();
        this.typeGuards.clear();
        this.fastTypeGuardCache.clear();
        this.strictTypeGuardCache.clear();
        this.weakTypeGuardCache.clear();
        this.buildingFastTypeGuards.clear();
        this.buildingStrictTypeGuards.clear();
        this.buildingWeakTypeGuards.clear();
    }

    /**
     * Build a serializer function for a type.
     *
     * @param type - The type to serialize
     * @returns A function that serializes data of that type
     */
    buildSerializer<T>(type: Type): SerializeFunction<T> {
        return jit.fn(
            jit.arg<T>(),
            jit.arg<SerializationOptions>(),
            (ctx: Context, data: Slot<T>, options: Slot<SerializationOptions>) => {
                const optionsSlot = ctx.lazyLet(ctx.ternary(options, options, ctx.objExpr<SerializationOptions>()));

                const state = new BuildState('serialize', this, ctx, optionsSlot, this.serializeRegistry);

                return state.build(type, data);
            },
        );
    }

    /**
     * Build a deserializer function for a type.
     *
     * @param type - The type to deserialize to
     * @returns A function that deserializes data to that type
     */
    buildDeserializer<T>(type: Type): SerializeFunction<any, T> {
        return jit.fn(
            jit.arg<any>(),
            jit.arg<SerializationOptions>(),
            (ctx: Context, data: Slot<any>, options: Slot<SerializationOptions>) => {
                const optionsSlot = ctx.lazyLet(ctx.ternary(options, options, ctx.objExpr<SerializationOptions>()));

                const state = new BuildState('deserialize', this, ctx, optionsSlot, this.deserializeRegistry);

                return state.build(type, data);
            },
        );
    }

    /**
     * Build a validator function for a type.
     *
     * @param type - The type to validate
     * @returns A function that validates data and returns errors
     */
    buildValidator<T>(type: Type): (data: any, errors?: ValidationErrorItem[]) => boolean {
        return jit.fn(
            jit.arg<any>(),
            jit.arg<{ errors?: ValidationErrorItem[] }>(),
            (ctx: Context, data: Slot<any>, stateArg: Slot<{ errors?: ValidationErrorItem[] }>) => {
                const optionsSlot = ctx.lazyLet(ctx.ternary(stateArg, stateArg, ctx.objExpr()));

                const state = new BuildState('validate', this, ctx, optionsSlot, this.typeGuards, {
                    validation: 'strict',
                    collectErrors: true,
                    rejectUnknownKeys: false,
                });

                // For validation, we return a boolean
                const result = state.build(type, data);
                return result as Slot<boolean>;
            },
        );
    }

    /**
     * Build a type guard function.
     *
     * @param type - The type to guard
     * @param withLoose - Whether to include loose guards
     * @returns A type guard function
     */
    buildTypeGuard<T>(type: Type, withLoose: boolean = true): Guard<T> {
        return jit.fn(
            jit.arg<any>(),
            jit.arg<{ errors?: ValidationErrorItem[] }>(),
            (ctx: Context, data: Slot<any>, stateArg: Slot<{ errors?: ValidationErrorItem[] }>) => {
                const optionsSlot = ctx.lazyLet(ctx.ternary(stateArg, stateArg, ctx.objExpr()));

                const state = new BuildState('validate', this, ctx, optionsSlot, this.typeGuards, {
                    validation: withLoose ? 'loose' : 'strict',
                    collectErrors: true,
                    rejectUnknownKeys: false,
                });

                const result = state.build(type, data);
                return result as Slot<boolean>;
            },
        ) as Guard<T>;
    }

    /**
     * Build a fast type guard function (pure && chain, no error collection).
     *
     * Generated code returns a simple boolean without error collection infrastructure.
     * Use this for maximum performance when you only need to know if data matches the type.
     *
     * Uses caching to handle recursive types without infinite recursion.
     *
     * @example
     * ```typescript
     * const isFast = serializer.buildFastTypeGuard<User>(typeOf<User>());
     * if (isFast(data)) {
     *     // data is User
     * }
     * ```
     *
     * @param type - The type to guard
     * @returns A fast type guard function
     */
    buildFastTypeGuard<T>(type: Type): (data: unknown) => data is T {
        // Return cached function if available
        const cached = this.fastTypeGuardCache.get(type);
        if (cached) return cached as (data: unknown) => data is T;

        // Detect recursive call during build (type is still being built)
        if (this.buildingFastTypeGuards.has(type)) {
            // Return a lazy wrapper that will call the cached function once it's built
            return ((data: unknown) => {
                const fn = this.fastTypeGuardCache.get(type);
                if (!fn) throw new Error('Recursive type guard not yet initialized');
                return fn(data);
            }) as (data: unknown) => data is T;
        }

        // Mark as building to detect recursion
        this.buildingFastTypeGuards.add(type);

        try {
            const fn = jit.fn(jit.arg<unknown>(), (ctx: Context, data: Slot<unknown>) => {
                const state = new BuildState('validate', this, ctx, ctx.objExpr(), this.typeGuards, {
                    validation: 'fast',
                    collectErrors: false,
                    rejectUnknownKeys: false,
                });
                return state.build(type, data);
            }) as (data: unknown) => data is T;

            // Cache before returning
            this.fastTypeGuardCache.set(type, fn as (data: unknown) => boolean);
            return fn;
        } finally {
            this.buildingFastTypeGuards.delete(type);
        }
    }

    /**
     * Build a strict type guard function (rejects unknown keys).
     *
     * Similar to buildFastTypeGuard but also checks for extra/unknown properties.
     * This corresponds to "assertStrict" in benchmark terminology.
     *
     * Uses caching to handle recursive types without infinite recursion.
     *
     * @example
     * ```typescript
     * const isStrict = serializer.buildStrictTypeGuard<User>(typeOf<User>());
     * isStrict({ name: 'John', age: 30 });        // true
     * isStrict({ name: 'John', age: 30, x: 1 }); // false (unknown key 'x')
     * ```
     *
     * @param type - The type to guard
     * @returns A strict type guard function
     */
    buildStrictTypeGuard<T>(type: Type): (data: unknown) => data is T {
        // Return cached function if available
        const cached = this.strictTypeGuardCache.get(type);
        if (cached) return cached as (data: unknown) => data is T;

        // Detect recursive call during build (type is still being built)
        if (this.buildingStrictTypeGuards.has(type)) {
            // Return a lazy wrapper that will call the cached function once it's built
            return ((data: unknown) => {
                const fn = this.strictTypeGuardCache.get(type);
                if (!fn) throw new Error('Recursive type guard not yet initialized');
                return fn(data);
            }) as (data: unknown) => data is T;
        }

        // Mark as building to detect recursion
        this.buildingStrictTypeGuards.add(type);

        try {
            const fn = jit.fn(jit.arg<unknown>(), (ctx: Context, data: Slot<unknown>) => {
                const state = new BuildState('validate', this, ctx, ctx.objExpr(), this.typeGuards, {
                    validation: 'strict',
                    collectErrors: false,
                    rejectUnknownKeys: true,
                });
                return state.build(type, data);
            }) as (data: unknown) => data is T;

            // Cache before returning
            this.strictTypeGuardCache.set(type, fn as (data: unknown) => boolean);
            return fn;
        } finally {
            this.buildingStrictTypeGuards.delete(type);
        }
    }

    /**
     * Build a weak type guard function (skips NaN checks for maximum speed).
     *
     * This is the fastest validation mode - it only checks structure/types but skips
     * the Number.isNaN() check that other modes perform. Use when you trust your data
     * won't contain NaN values, or when NaN is acceptable.
     *
     * Uses caching to handle recursive types without infinite recursion.
     *
     * @example
     * ```typescript
     * const isWeak = serializer.buildWeakTypeGuard<User>(typeOf<User>());
     * isWeak({ name: 'John', age: 30 });  // true
     * isWeak({ name: 'John', age: NaN }); // true (NaN not rejected!)
     * ```
     *
     * @param type - The type to guard
     * @returns A weak type guard function (fastest, no NaN check)
     */
    buildWeakTypeGuard<T>(type: Type): (data: unknown) => data is T {
        // Return cached function if available
        const cached = this.weakTypeGuardCache.get(type);
        if (cached) return cached as (data: unknown) => data is T;

        // Detect recursive call during build (type is still being built)
        if (this.buildingWeakTypeGuards.has(type)) {
            // Return a lazy wrapper that will call the cached function once it's built
            return ((data: unknown) => {
                const fn = this.weakTypeGuardCache.get(type);
                if (!fn) throw new Error('Recursive type guard not yet initialized');
                return fn(data);
            }) as (data: unknown) => data is T;
        }

        // Mark as building to detect recursion
        this.buildingWeakTypeGuards.add(type);

        try {
            const fn = jit.fn(jit.arg<unknown>(), (ctx: Context, data: Slot<unknown>) => {
                const state = new BuildState('validate', this, ctx, ctx.objExpr(), this.typeGuards, {
                    validation: 'fast',
                    collectErrors: false,
                    rejectUnknownKeys: false,
                    skipNaN: true, // Key difference: skip NaN checks
                });
                return state.build(type, data);
            }) as (data: unknown) => data is T;

            // Cache before returning
            this.weakTypeGuardCache.set(type, fn as (data: unknown) => boolean);
            return fn;
        } finally {
            this.buildingWeakTypeGuards.delete(type);
        }
    }
}

/**
 * Get a cached serializer function for a type.
 */
export function getSerializeFunction(
    type: Type,
    registry: HandlerRegistry,
    namingStrategy: NamingStrategy = new NamingStrategy(),
    path: string = '',
): SerializeFunction {
    const jitContainer = getTypeJitContainer(type);
    const id = `${registry.id}_${namingStrategy.id}_${path}`;

    if (jitContainer[id]) {
        return jitContainer[id];
    }

    jitContainer[id] = createSerializeFunction(type, registry, namingStrategy, path);
    toFastProperties(jitContainer);

    return jitContainer[id];
}

/**
 * Create a serializer function for a type (not cached).
 */
export function createSerializeFunction(
    type: Type,
    registry: HandlerRegistry,
    namingStrategy: NamingStrategy = new NamingStrategy(),
    path: string = '',
): SerializeFunction {
    // Get direction from registry
    const direction = registry.direction;

    return jit.fn(
        jit.arg<any>(),
        jit.arg<SerializationOptions>(),
        (ctx: Context, data: Slot<any>, options: Slot<SerializationOptions>) => {
            const optionsSlot = ctx.lazyLet(ctx.ternary(options, options, ctx.objExpr<SerializationOptions>()));

            // We need a serializer reference here - for now use default
            const state = new BuildState(
                direction,
                serializer, // Use default serializer
                ctx,
                optionsSlot,
                registry,
                { namingStrategy },
            );

            return state.build(type, data);
        },
    );
}

/**
 * Create a type guard function for a type.
 */
export function createTypeGuardFunction(
    type: Type,
    serializerToUse?: Serializer,
    withLoose: boolean = true,
): Guard<any> {
    const s = serializerToUse || serializer;
    return s.buildTypeGuard(type, withLoose);
}

/**
 * Get a Partial<T> type for a class or object literal.
 */
export function getPartialType(type: TypeClass | TypeObjectLiteral): TypeObjectLiteral {
    const jitContainer = getTypeJitContainer(type);
    if (jitContainer.partialType) return jitContainer.partialType;

    // Copy type and make all properties optional
    type = copyAndSetParent(type);
    type.types = type.types.map(v => ({ ...v })) as any;

    for (const member of type.types) {
        if (member.kind === ReflectionKind.propertySignature || member.kind === ReflectionKind.property) {
            member.optional = true;
        }
    }

    return (jitContainer.partialType = getTypeObjectLiteralFromTypeClass(type));
}

/**
 * Get a cached serializer for Partial<T>.
 */
export function getPartialSerializeFunction(
    type: TypeClass | TypeObjectLiteral,
    registry: HandlerRegistry,
    namingStrategy: NamingStrategy = new NamingStrategy(),
): SerializeFunction {
    return getSerializeFunction(getPartialType(type), registry, namingStrategy);
}

/**
 * The default JSON serializer instance.
 */
export const serializer = new Serializer('json');
