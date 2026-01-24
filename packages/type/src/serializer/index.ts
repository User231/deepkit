// Initialize the default serializer with handlers
import { registerDefaultHandlers, registerTypeGuards } from './handlers.js';
import { serializer as defaultSerializer } from './serializer.js';
import { registerUnionHandler } from './union.js';
import { registerValidationHook } from './validation.js';

/*
 * Deepkit Framework
 * Copyright (c) Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

// Errors
export { SerializationError, RuntimeCode, collapsePath, getPropertyNameString } from './errors.js';

// Naming
export { NamingStrategy, underscoreNamingStrategy } from './naming.js';

// Registry
export type { TypeHandler, TypeHook, BuildStateBase } from './registry.js';
export { HandlerRegistry, TypeGuardRegistry } from './registry.js';

// State
export type { SerializationOptions } from './state.js';
export { BuildState, DynamicPathSegment, isGroupAllowed } from './state.js';

// Union handling
export { UNION_LITERAL_THRESHOLD, handleUnion, registerUnionHandler } from './union.js';

// Validation
export { validationHook, registerValidationHook, createValidator } from './validation.js';

// Handlers
export {
    registerDefaultHandlers,
    registerTypeGuards,
    // Legacy exports (deprecated, alias to registerTypeGuards)
    registerDefaultTypeGuards,
    registerFastTypeGuards,
    registerStrictTypeGuards,
} from './handlers.js';

// Backward compatibility (deprecated)
export type { TemplateState } from './compat.js';
export { executeTypeArgumentAsArray } from './compat.js';

// Serializer (main export)
export type { SerializeFunction, Guard } from './serializer.js';
export {
    Serializer,
    getSerializeFunction,
    createSerializeFunction,
    createTypeGuardFunction,
    getPartialType,
    getPartialSerializeFunction,
    serializer,
} from './serializer.js';

registerDefaultHandlers(defaultSerializer);
registerTypeGuards(defaultSerializer);
registerUnionHandler(defaultSerializer);
registerValidationHook(defaultSerializer);
