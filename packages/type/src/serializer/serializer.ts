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
import { HandlerRegistry, TypeGuardRegistry } from './registry.js';
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

    /** Registry for type guards at different specificality levels */
    readonly typeGuards = new TypeGuardRegistry();

    /** Registry for validator handlers */
    readonly validators = new HandlerRegistry();

    /** Registry for fast type guards (pure && chain, no error collection) */
    readonly fastTypeGuards = new HandlerRegistry();

    /** Registry for strict type guards (reject unknown keys) */
    readonly strictTypeGuards = new HandlerRegistry();

    constructor(public name: string = 'json') {
        this.registerSerializers();
        this.registerTypeGuards();
        this.registerValidators();
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
     * Register default validators. Override in subclasses to customize.
     */
    protected registerValidators(): void {
        // Validators will be registered via registerDefaultValidators() from validation.ts
    }

    /**
     * Clear all registries.
     */
    clear(): void {
        this.serializeRegistry.clear();
        this.deserializeRegistry.clear();
        this.typeGuards.clear();
        this.validators.clear();
        this.fastTypeGuards.clear();
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

                const guardRegistry = this.typeGuards.getRegistry(1);
                const state = new BuildState('validate', this, ctx, optionsSlot, guardRegistry, {
                    validation: 'strict',
                });

                // For validation, we return a boolean score > 0
                const result = state.build(type, data);

                // Convert score to boolean
                return ctx.gt(result, ctx.lit(0));
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

                const guardRegistry = this.typeGuards.getRegistry(1);
                const state = new BuildState('validate', this, ctx, optionsSlot, guardRegistry, {
                    validation: withLoose ? 'loose' : 'strict',
                });

                const result = state.build(type, data);
                return ctx.gt(result, ctx.lit(0));
            },
        ) as Guard<T>;
    }

    /**
     * Build a fast type guard function (pure && chain, no error collection).
     *
     * Generated code returns a simple boolean without error collection infrastructure.
     * Use this for maximum performance when you only need to know if data matches the type.
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
        return jit.fn(jit.arg<unknown>(), (ctx: Context, data: Slot<unknown>) => {
            const state = new BuildState('validate', this, ctx, ctx.objExpr(), this.fastTypeGuards, {
                validation: 'fast',
            });
            return state.build(type, data);
        }) as (data: unknown) => data is T;
    }

    /**
     * Build a strict type guard function (rejects unknown keys).
     *
     * Similar to buildFastTypeGuard but also checks for extra/unknown properties.
     * This corresponds to "assertStrict" in benchmark terminology.
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
        return jit.fn(jit.arg<unknown>(), (ctx: Context, data: Slot<unknown>) => {
            const state = new BuildState('validate', this, ctx, ctx.objExpr(), this.strictTypeGuards, {
                validation: 'strict',
            });
            return state.build(type, data);
        }) as (data: unknown) => data is T;
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
