/*
 * Deepkit Framework
 * Copyright (c) Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { type Context, type Slot, jit, stringifyValueWithType } from '@deepkit/core';

import { hasCircularReference } from '../reflection/reflection.js';
import { ReflectionKind, Type, stringifyType } from '../reflection/type.js';
import { ValidationError, ValidationErrorItem } from '../validator.js';
import { SerializationError, collapsePath } from './errors.js';
import { NamingStrategy } from './naming.js';
import { HandlerRegistry } from './registry.js';
import type { Serializer } from './serializer.js';

/**
 * Represents a dynamic path segment that contains a Slot for the index value.
 * Used when the path segment is computed at runtime (e.g., array index in a loop).
 */
export class DynamicPathSegment {
    constructor(public slot: Slot<number>) {}
}

/**
 * Options passed at runtime to serialization/deserialization functions.
 */
export interface SerializationOptions {
    /**
     * Which groups to include. If a property is not assigned to
     * a given group, it will be excluded.
     * Use an empty array to include only non-grouped properties.
     */
    groups?: string[];

    /**
     * Which groups to exclude. If a property is assigned to at least
     * one given group, it will be excluded.
     * Use an empty array to exclude only non-grouped properties.
     */
    groupsExclude?: string[];

    /**
     * Enable loose type coercion (default: true).
     * When true, allows string-to-number, string-to-boolean conversions, etc.
     */
    loosely?: boolean;
}

/**
 * Check if a property with given groups should be serialized based on options.
 */
export function isGroupAllowed(options: SerializationOptions, groupNames: string[]): boolean {
    if (!options.groups && !options.groupsExclude) return true;

    if (options.groupsExclude) {
        if (options.groupsExclude.length === 0 && groupNames.length === 0) {
            return false;
        }
        for (const group of options.groupsExclude) {
            if (groupNames.includes(group)) {
                return false;
            }
        }
    }

    if (options.groups) {
        if (options.groups.length === 0 && groupNames.length === 0) {
            return true;
        }
        for (const group of options.groups) {
            if (groupNames.includes(group)) {
                return true;
            }
        }
        return false;
    }

    return true;
}

/**
 * Check if a type is complex (should count toward depth limit).
 */
function isComplexType(type: Type): boolean {
    return (
        type.kind === ReflectionKind.objectLiteral ||
        type.kind === ReflectionKind.class ||
        type.kind === ReflectionKind.array ||
        type.kind === ReflectionKind.tuple
    );
}

/**
 * Build state for JIT function generation.
 *
 * Manages:
 * - Direction (serialize/deserialize/validate)
 * - Type stack for circular reference detection
 * - Function cache for extracted functions
 * - Depth tracking for inlining control
 * - Path tracking for error messages
 * - Validation mode
 */
export class BuildState {
    /** Maximum inline depth before extracting to separate function */
    static readonly DEFAULT_MAX_DEPTH = 3;

    /** Serialization direction */
    readonly direction: 'serialize' | 'deserialize' | 'validate';

    /** The serializer instance */
    readonly serializer: Serializer;

    /** JIT context for code generation */
    readonly ctx: Context;

    /** Slot containing runtime SerializationOptions */
    readonly optionsSlot: Slot<SerializationOptions>;

    /** Validation mode: strict (is()), loose (validation with coercion), or undefined */
    readonly validation: 'strict' | 'loose' | undefined;

    /** Current depth in the type tree */
    readonly depth: number;

    /** Maximum depth before extracting */
    readonly maxDepth: number;

    /** Types currently being processed (for circular detection) */
    readonly typeStack: Set<Type>;

    /** Cache of extracted functions by type */
    readonly fnCache: Map<Type, Slot<Function>>;

    /** Path segments for error messages */
    readonly pathSegments: (string | DynamicPathSegment)[];

    /** The handler registry being used */
    readonly registry: HandlerRegistry;

    /** Naming strategy for property names */
    readonly namingStrategy: NamingStrategy;

    constructor(
        direction: 'serialize' | 'deserialize' | 'validate',
        serializer: Serializer,
        ctx: Context,
        optionsSlot: Slot<SerializationOptions>,
        registry: HandlerRegistry,
        options: {
            validation?: 'strict' | 'loose';
            depth?: number;
            maxDepth?: number;
            typeStack?: Set<Type>;
            fnCache?: Map<Type, Slot<Function>>;
            pathSegments?: (string | DynamicPathSegment)[];
            namingStrategy?: NamingStrategy;
        } = {},
    ) {
        this.direction = direction;
        this.serializer = serializer;
        this.ctx = ctx;
        this.optionsSlot = optionsSlot;
        this.registry = registry;
        this.validation = options.validation;
        this.depth = options.depth ?? 0;
        this.maxDepth = options.maxDepth ?? BuildState.DEFAULT_MAX_DEPTH;
        this.typeStack = options.typeStack ?? new Set();
        this.fnCache = options.fnCache ?? new Map();
        this.pathSegments = options.pathSegments ?? [];
        this.namingStrategy = options.namingStrategy ?? new NamingStrategy();
    }

    /**
     * Check if loose mode is enabled (options.loosely !== false).
     */
    isLoose(): Slot<boolean> {
        return this.ctx.neq(this.optionsSlot.get('loosely'), this.ctx.lit(false));
    }

    /**
     * Check if in strict validation mode.
     */
    isStrictValidation(): boolean {
        return this.validation === 'strict';
    }

    /**
     * Check if in validation mode at all.
     */
    isValidation(): boolean {
        return this.validation !== undefined;
    }

    /**
     * Check if type can have circular data at runtime.
     */
    hasCircularReference(type: Type): boolean {
        return hasCircularReference(type);
    }

    /**
     * Get the current path as a string expression.
     */
    pathSlot(): Slot<string> {
        if (this.pathSegments.length === 0) {
            return this.ctx.lit('');
        }
        // Build path expression by concatenating segments
        const parts: Slot<string>[] = [];
        for (let i = 0; i < this.pathSegments.length; i++) {
            if (i > 0) {
                parts.push(this.ctx.lit('.'));
            }
            const segment = this.pathSegments[i];
            if (segment instanceof DynamicPathSegment) {
                // Dynamic segment - convert the number slot to string
                parts.push(this.ctx.callExpr(String, segment.slot) as Slot<string>);
            } else {
                parts.push(this.ctx.lit(segment));
            }
        }
        return parts.length === 1 ? parts[0] : this.ctx.concat(...parts);
    }

    /**
     * Throw a serialization error.
     */
    throw_(type: Type, value: Slot, message?: string): void {
        const typeStr = stringifyType(type).replace(/\n/g, '').replace(/\s+/g, ' ').trim();
        const pathExpr = this.pathSlot();

        // Create error message with stringified value (format: "type value" e.g., 'string "hello"')
        const valueStr = this.ctx.callExpr(stringifyValueWithType, value);
        const errorMsg = this.ctx.concat(
            this.ctx.lit('Cannot convert '),
            valueStr,
            this.ctx.lit(' to '),
            this.ctx.lit(typeStr),
            message ? this.ctx.lit('. ' + message) : this.ctx.lit(''),
        );

        // Create and throw ValidationError
        const errorItem = this.ctx.objFrom({
            code: this.ctx.lit('type'),
            path: pathExpr,
            message: errorMsg,
        });

        const errorArray = this.ctx.let(this.ctx.arrExpr());
        this.ctx.push(errorArray, errorItem);

        const validationErrorCreate = (items: ValidationErrorItem[]) => ValidationError.from(items);
        const error = this.ctx.callExpr(validationErrorCreate, errorArray);
        this.ctx.throw_(error);
    }

    /**
     * Add a validation error to the error collection (soft error mode).
     */
    addValidationError(code: string, message: string, value: Slot): void {
        const errorsSlot = this.optionsSlot.get('errors' as any);
        const pathExpr = this.pathSlot();

        this.ctx.when(errorsSlot, () => {
            const errorItem = this.ctx.newExpr(
                ValidationErrorItem,
                pathExpr,
                this.ctx.lit(code),
                this.ctx.lit(message),
                value,
            );
            this.ctx.push(errorsSlot, errorItem);
        });
    }

    /**
     * Store an external value for use in generated code.
     */
    extern<T>(value: T): Slot<T> {
        return this.ctx.lit(value);
    }

    /**
     * Fork state for a property.
     */
    forProperty(name: string): BuildState {
        return new BuildState(this.direction, this.serializer, this.ctx, this.optionsSlot, this.registry, {
            validation: this.validation,
            depth: this.depth + 1,
            maxDepth: this.maxDepth,
            typeStack: this.typeStack,
            fnCache: this.fnCache,
            pathSegments: [...this.pathSegments, name],
            namingStrategy: this.namingStrategy,
        });
    }

    /**
     * Fork state for an array/tuple index.
     */
    forIndex(index: Slot<number>): BuildState {
        return new BuildState(this.direction, this.serializer, this.ctx, this.optionsSlot, this.registry, {
            validation: this.validation,
            depth: this.depth + 1,
            maxDepth: this.maxDepth,
            typeStack: this.typeStack,
            fnCache: this.fnCache,
            // Use DynamicPathSegment with the actual index slot
            pathSegments: [...this.pathSegments, new DynamicPathSegment(index)],
            namingStrategy: this.namingStrategy,
        });
    }

    /**
     * Fork state for a different registry.
     */
    forRegistry(registry: HandlerRegistry): BuildState {
        return new BuildState(this.direction, this.serializer, this.ctx, this.optionsSlot, registry, {
            validation: this.validation,
            depth: this.depth,
            maxDepth: this.maxDepth,
            typeStack: this.typeStack,
            fnCache: this.fnCache,
            pathSegments: this.pathSegments,
            namingStrategy: this.namingStrategy,
        });
    }

    /**
     * Build a type, deciding whether to inline or extract.
     *
     * Decision tree:
     * 1. typeStack.has(type)? → Extract (circular in current path)
     * 2. fnCache.has(type)? → Reuse (already built)
     * 3. depth >= maxDepth && isComplex? → Extract (size control)
     * 4. Default → Inline
     */
    build(type: Type, input: Slot): Slot {
        // 1. CIRCULAR: Already building this type in current path?
        if (this.typeStack.has(type)) {
            return this.buildExtractedCall(type, input);
        }

        // 2. CACHED: Already built and extracted this type?
        const cached = this.fnCache.get(type);
        if (cached) {
            return this.ctx.callExpr(
                (fn: Function, data: any, opts: any, path: string) => fn(data, opts, path),
                this.ctx.getVar(cached),
                input,
                this.optionsSlot,
                this.pathSlot(),
            );
        }

        // 3. DEPTH: Too deep? Extract to keep function size manageable
        if (this.depth >= this.maxDepth && isComplexType(type)) {
            return this.buildExtractedCall(type, input);
        }

        // 4. INLINE: Default - embed type handling directly
        return this.buildInline(type, input);
    }

    /**
     * Build a type inline (no extraction).
     */
    private buildInline(type: Type, input: Slot): Slot {
        this.typeStack.add(type);
        try {
            return this.registry.build(type, input, this.ctx, this);
        } finally {
            this.typeStack.delete(type);
        }
    }

    /**
     * Build an extracted function call for a type.
     */
    private buildExtractedCall(type: Type, input: Slot): Slot {
        // Check if already being prepared (handles mutual recursion)
        let fnSlot = this.fnCache.get(type);

        if (!fnSlot) {
            // Create placeholder slot - will be filled after function is built
            fnSlot = this.ctx.var_<Function>(undefined as any);
            this.fnCache.set(type, fnSlot);

            // Build the extracted function
            // We need to create a new jit.fn() for this type
            const self = this;
            const extractedFn = jit.fn(
                jit.arg<any>(), // data
                jit.arg<any>(), // options
                jit.arg<string>(), // path
                (ctx: Context, data: Slot<any>, opts: Slot<any>, path: Slot<string>) => {
                    // Create a fresh state for the extracted function
                    const childState = new BuildState(self.direction, self.serializer, ctx, opts, self.registry, {
                        validation: self.validation,
                        depth: 0, // Reset depth
                        maxDepth: self.maxDepth,
                        typeStack: new Set(), // Fresh stack
                        fnCache: self.fnCache, // Share cache
                        pathSegments: [], // Path will come from argument
                        namingStrategy: self.namingStrategy,
                    });
                    return childState.buildInline(type, data);
                },
            );

            // Fill the placeholder with the built function
            this.ctx.setVar(fnSlot, this.ctx.lit(extractedFn));
        }

        // Emit call to the extracted function
        return this.ctx.callExpr(
            (fn: Function, data: any, opts: any, path: string) => fn(data, opts, path),
            this.ctx.getVar(fnSlot),
            input,
            this.optionsSlot,
            this.pathSlot(),
        );
    }
}
