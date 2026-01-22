/*
 * Deepkit Framework
 * Copyright (c) Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

/**
 * Backward compatibility layer for the old serializer API.
 *
 * @deprecated The old API using TemplateState and string-based code generation
 * has been replaced by the new jit.fn() architecture. Please migrate to the
 * new BuildState and TypeHandler APIs.
 */
import type { Context, Slot } from '@deepkit/core';

import { ReflectionKind, TypeArray, TypeClass } from '../reflection/type.js';
import { NamingStrategy } from './naming.js';
import { HandlerRegistry } from './registry.js';
import { BuildState } from './state.js';

/**
 * @deprecated Use BuildState instead.
 *
 * This is a minimal compatibility shim. The old TemplateState API used
 * string-based code generation (accessor, setter, template strings).
 * The new BuildState uses jit.fn() with Context/Slot primitives.
 *
 * For custom type handlers, migrate to the new TypeHandler signature:
 * ```typescript
 * const handler: TypeHandler = (type, input, ctx, state) => {
 *   // Use ctx methods instead of string templates
 *   return ctx.callExpr(myTransform, input);
 * };
 * serializer.deserializeRegistry.registerClass(MyClass, handler);
 * ```
 */
export type TemplateState = BuildState & {
    /** @deprecated Use state.namingStrategy instead */
    readonly path: string;

    /** @deprecated Use state.registry instead */
    readonly registry: HandlerRegistry;

    /**
     * @deprecated The old convert() API is not supported in the new architecture.
     * Migrate to returning a Slot from your TypeHandler instead.
     */
    convert(fn: (value: any) => any): void;
};

/**
 * @deprecated This function is not supported in the new serializer architecture.
 *
 * The old implementation used string-based code generation to execute templates
 * for a type argument as an array. The new architecture uses jit.fn() with
 * Context/Slot primitives.
 *
 * To achieve similar functionality in the new architecture:
 * ```typescript
 * serializer.deserializeRegistry.registerClass(MyClass, (type, input, ctx, state) => {
 *   const typeArg = type.arguments?.[0];
 *   if (!typeArg) throw new Error('Missing type argument');
 *
 *   // Create array type from the type argument
 *   const arrayType: TypeArray = { kind: ReflectionKind.array, type: typeArg };
 *
 *   // Build the array deserializer
 *   const items = state.build(arrayType, input);
 *
 *   // Transform to your class
 *   return ctx.callExpr((arr) => new MyClass(arr), items);
 * });
 * ```
 */
export function executeTypeArgumentAsArray(type: TypeClass, typeIndex: number, state: TemplateState): void {
    throw new Error(
        'executeTypeArgumentAsArray is not supported in the new serializer architecture. ' +
            'Please migrate to the new TypeHandler API. See the deprecation notice for migration guide.',
    );
}
