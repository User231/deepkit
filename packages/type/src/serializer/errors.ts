/*
 * Deepkit Framework
 * Copyright (c) Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { DeepkitError } from '@deepkit/core';

const MAX_STRING_LENGTH = 50;
const MAX_OBJECT_KEYS = 3;
const MAX_ARRAY_ITEMS = 3;

/**
 * Safely stringify a value with type information for error messages.
 *
 * @example
 * ```typescript
 * stringifyValueWithType(true)           // "boolean true"
 * stringifyValueWithType("hello")        // 'string "hello"'
 * stringifyValueWithType({a:1, b:2})     // "object {a: 1, b: 2}"
 * stringifyValueWithType([1,2,3,4,5,6])  // "array [1, 2, 3, ...] (6 items)"
 * ```
 */
export function stringifyValueWithType(value: unknown, seen: WeakSet<object> = new WeakSet()): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    const type = typeof value;

    switch (type) {
        case 'boolean':
            return `boolean ${value}`;

        case 'number':
            return `number ${value}`;

        case 'bigint':
            return `bigint ${value}n`;

        case 'string': {
            const str = value as string;
            if (str.length > MAX_STRING_LENGTH) {
                return `string "${str.slice(0, MAX_STRING_LENGTH - 3)}..." (truncated)`;
            }
            return `string "${str}"`;
        }

        case 'symbol':
            return `symbol ${String(value)}`;

        case 'function':
            return 'function';

        case 'object': {
            const obj = value as object;

            // Check for circular references
            if (seen.has(obj)) {
                return 'object [circular]';
            }
            seen.add(obj);

            try {
                // Handle special object types
                if (Array.isArray(obj)) {
                    const len = obj.length;
                    if (len === 0) return 'array []';
                    const items = obj.slice(0, MAX_ARRAY_ITEMS).map(item => stringifyPrimitive(item));
                    if (len <= MAX_ARRAY_ITEMS) {
                        return `array [${items.join(', ')}]`;
                    }
                    return `array [${items.join(', ')}, ...] (${len} items)`;
                }

                if (obj instanceof Date) {
                    return `Date ${obj.toISOString()}`;
                }

                if (obj instanceof Set) {
                    return `Set (${obj.size} items)`;
                }

                if (obj instanceof Map) {
                    return `Map (${obj.size} entries)`;
                }

                if (obj instanceof RegExp) {
                    return `RegExp ${obj.toString()}`;
                }

                if (obj instanceof Error) {
                    return `Error ${obj.name}: ${obj.message}`;
                }

                // Handle typed arrays and ArrayBuffer
                if (ArrayBuffer.isView(obj)) {
                    return `${obj.constructor.name} (${(obj as unknown as { length: number }).length || (obj as unknown as { byteLength: number }).byteLength} bytes)`;
                }

                if (obj instanceof ArrayBuffer) {
                    return `ArrayBuffer (${obj.byteLength} bytes)`;
                }

                // Plain object
                const keys = Object.keys(obj);
                if (keys.length === 0) return 'object {}';

                const displayKeys = keys.slice(0, MAX_OBJECT_KEYS);
                const pairs = displayKeys.map(key => {
                    const val = (obj as Record<string, unknown>)[key];
                    return `${key}: ${stringifyPrimitive(val)}`;
                });

                if (keys.length <= MAX_OBJECT_KEYS) {
                    return `object {${pairs.join(', ')}}`;
                }
                const remaining = keys.length - MAX_OBJECT_KEYS;
                return `object {${pairs.join(', ')}, ...} (${remaining} more keys)`;
            } catch {
                // Fallback for any object that throws during inspection
                return 'object [unreadable]';
            }
        }

        default:
            return String(type);
    }
}

/**
 * Stringify a primitive value for inclusion in object/array representations.
 * Keeps output compact - no type prefix.
 */
function stringifyPrimitive(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    const type = typeof value;

    switch (type) {
        case 'boolean':
        case 'number':
            return String(value);
        case 'bigint':
            return `${value}n`;
        case 'string': {
            const str = value as string;
            if (str.length > 20) {
                return `"${str.slice(0, 17)}..."`;
            }
            return `"${str}"`;
        }
        case 'symbol':
            return String(value);
        case 'function':
            return '[function]';
        case 'object':
            if (Array.isArray(value)) return `[...]`;
            if (value instanceof Date) return value.toISOString();
            return '{...}';
        default:
            return String(value);
    }
}

/**
 * Error thrown during serialization/deserialization when type conversion fails.
 *
 * @example
 * ```typescript
 * throw new SerializationError('Expected string, got number', 'type', 'user.name');
 * // Message: "Serialization failed. user.name: Expected string, got number"
 * ```
 */
export class SerializationError extends DeepkitError {
    constructor(
        public originalMessage: string,
        public errorType: string = '',
        public path: string = '',
    ) {
        super(
            'DK-T200',
            `Serialization failed. ${!path ? '' : (path && path.startsWith('.') ? path.slice(1) : path) + ': '}` +
                originalMessage,
        );
    }

    /**
     * Create a SerializationError from a value and expected type.
     */
    static fromValue(value: unknown, expectedType: string, path: string = ''): SerializationError {
        const valueStr = stringifyValueWithType(value);
        return new SerializationError(`Cannot convert ${valueStr} to ${expectedType}`, 'type', path);
    }
}

/**
 * Represents a dynamic code segment in error paths.
 * Used when the path segment is computed at runtime (e.g., array index in a loop).
 */
export class RuntimeCode {
    constructor(public code: string) {}
}

/**
 * Collapse a path array into a string expression.
 * Static segments are quoted, RuntimeCode segments are inlined.
 *
 * @example
 * ```typescript
 * collapsePath(['user', 'addresses', new RuntimeCode('i'), 'street'])
 * // Returns: '"user"+\'.\'+\"addresses\"+\'.\'+i+\'.\'+\"street\"'
 * ```
 */
export function collapsePath(path: (string | RuntimeCode)[], prefix?: string): string {
    return (
        path
            .filter(v => !!v)
            .map(v => (v instanceof RuntimeCode ? v.code : JSON.stringify(v)))
            .join(`+'.'+`) || `''`
    );
}

/**
 * Get a property name as a string expression for error messages.
 */
export function getPropertyNameString(propertyName?: string | RuntimeCode): string {
    return propertyName ? collapsePath([propertyName]) : '';
}
