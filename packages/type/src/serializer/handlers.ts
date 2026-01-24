/*
 * Deepkit Framework
 * Copyright (c) Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import type { Context, Slot } from '@deepkit/core';
import type { ClassType } from '@deepkit/core';
import { isInteger, isNumeric, isObject, stringifyValueWithType } from '@deepkit/core';
import { TypeNumberBrand } from '@deepkit/type-spec';

import {
    arrayBufferToBase64,
    base64ToArrayBuffer,
    base64ToTypedArray,
    typedArrayToBase64,
    unpopulatedSymbol,
} from '../core.js';
import { createReference, isReferenceInstance } from '../reference.js';
import { extendTemplateLiteral, isExtendable } from '../reflection/extends.js';
import { resolveRuntimeType } from '../reflection/processor.js';
import { ReflectionClass, hasCircularReference } from '../reflection/reflection.js';
import {
    BinaryBigIntType,
    ReflectionKind,
    Type,
    TypeArray,
    TypeClass,
    TypeEnum,
    TypeFunction,
    TypeIndexSignature,
    TypeLiteral,
    TypeMethod,
    TypeMethodSignature,
    TypeNumber,
    TypeObjectLiteral,
    TypeProperty,
    TypePropertySignature,
    TypeString,
    TypeTemplateLiteral,
    TypeTuple,
    TypeUnion,
    binaryBigIntAnnotation,
    binaryTypes,
    embeddedAnnotation,
    excludedAnnotation,
    getConstructorProperties,
    getDeepConstructorProperties,
    getEnumValueIndexMatcher,
    groupAnnotation,
    hasDefaultValue,
    isBackReferenceType,
    isMongoIdType,
    isNanoIdType,
    isNullable,
    isOptional,
    isPropertyMemberType,
    isReferenceType,
    isUUIDType,
    memberNameToString,
    referenceAnnotation,
    resolveTypeMembers,
    stringifyType,
} from '../reflection/type.js';
import { ValidationErrorItem, ValidatorError } from '../validator.js';
import type { BuildStateBase, HandlerRegistry, TypeGuardRegistry, TypeHandler } from './registry.js';
import type { Serializer } from './serializer.js';
import type { BuildState } from './state.js';
import { isGroupAllowed } from './state.js';
import { UNION_LITERAL_THRESHOLD } from './union.js';

// ============================================================================
// Validation Error Helpers
// ============================================================================

function guardWithError(
    ctx: Context,
    state: BuildStateBase,
    input: Slot,
    condition: Slot<boolean>,
    errorCode: string,
    errorMessage: string,
): Slot<number> {
    const score = ctx.var_(ctx.ternary(condition, ctx.lit(1000), ctx.lit(0)));
    const errorsSlot = state.optionsSlot.get('errors' as any);
    ctx.when(ctx.and(errorsSlot, ctx.eq(ctx.getVar(score), ctx.lit(0))), () => {
        const errorItem = ctx.newExpr(
            ValidationErrorItem,
            state.pathSlot(),
            ctx.lit(errorCode),
            ctx.lit(errorMessage),
            input,
        );
        ctx.push(errorsSlot, errorItem);
    });
    return ctx.getVar(score);
}

/**
 * Create a guard with a "Cannot convert X to Y" style error message.
 * The message format matches what state.throw_() uses.
 */
function guardWithTypeError(
    ctx: Context,
    state: BuildStateBase,
    input: Slot,
    condition: Slot<boolean>,
    expectedType: string,
): Slot<number> {
    const score = ctx.var_(ctx.ternary(condition, ctx.lit(1000), ctx.lit(0)));
    const errorsSlot = state.optionsSlot.get('errors' as any);
    ctx.when(ctx.and(errorsSlot, ctx.eq(ctx.getVar(score), ctx.lit(0))), () => {
        // Generate "Cannot convert <type> <value> to <expected>" message
        const valueStr = ctx.callExpr(stringifyValueWithType, input);
        const errorMsg = ctx.concat(ctx.lit('Cannot convert '), valueStr, ctx.lit(' to '), ctx.lit(expectedType));
        const errorItem = ctx.newExpr(ValidationErrorItem, state.pathSlot(), ctx.lit('type'), errorMsg, input);
        ctx.push(errorsSlot, errorItem);
    });
    return ctx.getVar(score);
}

function isSignedNumericString(value: string): boolean {
    if (!value) return false;
    let candidate = value;
    if (candidate[0] === '-' || candidate[0] === '+') {
        candidate = candidate.slice(1);
        if (!candidate) return false;
    }
    return isNumeric(candidate);
}

function isSignedIntegerString(value: string): boolean {
    if (!value) return false;
    let candidate = value;
    if (candidate[0] === '-' || candidate[0] === '+') {
        candidate = candidate.slice(1);
        if (!candidate) return false;
    }
    if (candidate.includes('.')) return false;
    return isNumeric(candidate);
}

function getBinaryBigIntMode(type: Type): BinaryBigIntType | undefined {
    const annotation = binaryBigIntAnnotation.getFirst(type);
    if (annotation !== undefined) return annotation;
    if (type.typeName === 'BinaryBigInt') return BinaryBigIntType.unsigned;
    if (type.typeName === 'SignedBinaryBigInt') return BinaryBigIntType.signed;
    const originNames = type.originTypes?.map(origin => origin.typeName) || [];
    if (originNames.includes('BinaryBigInt')) return BinaryBigIntType.unsigned;
    if (originNames.includes('SignedBinaryBigInt')) return BinaryBigIntType.signed;
    return undefined;
}

// ============================================================================
// Shared Helper Functions
// ============================================================================

/**
 * Check if a type's guard can use pure expression-only code (no statements).
 * This enables the fast && chaining optimization for object guards.
 *
 * Pure types:
 * - Primitives (string, number, boolean, bigint, null, undefined, symbol)
 * - Literals
 * - Unions of pure types
 * - Objects with only pure property types (recursively checked)
 *
 * Impure types (generate statement code):
 * - Map, Set, WeakMap, WeakSet (loop over entries)
 * - Array with typed elements (loop over elements)
 * - Tuple with rest elements (loop)
 * - Types with custom validators
 */
function isPureTypeGuard(type: Type, visited: Set<Type> = new Set()): boolean {
    if (visited.has(type)) return true; // Circular reference, assume pure
    visited.add(type);

    switch (type.kind) {
        // Primitives are always pure
        case ReflectionKind.string:
        case ReflectionKind.number:
        case ReflectionKind.boolean:
        case ReflectionKind.bigint:
        case ReflectionKind.null:
        case ReflectionKind.undefined:
        case ReflectionKind.symbol:
        case ReflectionKind.literal:
        case ReflectionKind.any:
        case ReflectionKind.unknown:
        case ReflectionKind.never:
        case ReflectionKind.void:
        case ReflectionKind.enum:
        case ReflectionKind.regexp:
            return true;

        // Template literals are pure (regex check)
        case ReflectionKind.templateLiteral:
            return true;

        // Unions are pure if all members are pure
        case ReflectionKind.union:
            return (type as TypeUnion).types.every(t => isPureTypeGuard(t, visited));

        // Object literals are pure if all properties are pure
        case ReflectionKind.objectLiteral: {
            const members = resolveTypeMembers(type as TypeObjectLiteral);
            for (const member of members) {
                // Index signatures are impure (need loop)
                if (member.kind === ReflectionKind.indexSignature) return false;
                if (isPropertyMemberType(member)) {
                    if (!isPureTypeGuard(member.type, visited)) return false;
                }
            }
            return true;
        }

        // Classes can be pure if they have only pure properties and no validation method
        case ReflectionKind.class: {
            const classType = type as TypeClass;

            // Built-in collection classes are impure (use loops for validation)
            const builtinImpure = [
                Map,
                Set,
                WeakMap,
                WeakSet,
                Date,
                RegExp,
                ArrayBuffer,
                DataView,
                Int8Array,
                Uint8Array,
                Uint8ClampedArray,
                Int16Array,
                Uint16Array,
                Int32Array,
                Uint32Array,
                Float32Array,
                Float64Array,
                BigInt64Array,
                BigUint64Array,
            ];
            if (builtinImpure.some(c => classType.classType === c)) return false;

            const reflection = ReflectionClass.from(classType.classType);
            if (reflection.validationMethod) return false;

            const members = resolveTypeMembers(classType);
            for (const member of members) {
                if (member.kind === ReflectionKind.indexSignature) return false;
                if (isPropertyMemberType(member)) {
                    if (!isPureTypeGuard(member.type, visited)) return false;
                }
            }
            return true;
        }

        // Tuples without rest elements are pure if all elements are pure
        case ReflectionKind.tuple: {
            const tupleType = type as TypeTuple;
            for (const elem of tupleType.types) {
                if (elem.type.kind === ReflectionKind.rest) return false; // Rest uses loop
                if (!isPureTypeGuard(elem.type, visited)) return false;
            }
            return true;
        }

        // Arrays are impure (need loop for typed elements)
        case ReflectionKind.array:
            return false;

        // These types are impure (generate loops/statements)
        case ReflectionKind.function:
        case ReflectionKind.method:
        case ReflectionKind.methodSignature:
        case ReflectionKind.promise:
            return false;

        // Intersections - check all types
        case ReflectionKind.intersection: {
            const types = (type as any).types as Type[];
            return types.every(t => isPureTypeGuard(t, visited));
        }

        default:
            // Unknown types, assume impure for safety
            return false;
    }
}

/**
 * Check if input is an object (not null).
 * Used for object/class type guards.
 *
 * Note: We intentionally don't check !Array.isArray() for performance.
 * Arrays with object properties would technically pass, but this is an
 * extremely rare edge case. The property type checks will catch normal arrays.
 */
function isPlainObject(ctx: Context, input: Slot): Slot<boolean> {
    return ctx.and(ctx.isType(input, 'object'), ctx.not(ctx.isNull(input)));
}

/**
 * Collect prefixed property names for embedded types.
 * Used to check if any prefixed properties exist in the input (for optional embedded detection).
 */
function collectPrefixedPropertyNames(embeddedMembers: Type[], prefix: string, state: BuildStateBase): string[] {
    const names: string[] = [];
    for (const m of embeddedMembers) {
        if (!isPropertyMemberType(m)) continue;
        const subPropName = memberNameToString((m as TypeProperty | TypePropertySignature).name);
        const serializedName =
            state.namingStrategy.getPropertyName(m as TypeProperty | TypePropertySignature, state.serializer.name) ||
            subPropName;
        names.push(prefix + serializedName);
    }
    return names;
}

/**
 * Push a type error when a condition is met and error collection is enabled.
 * Consolidates the common pattern of checking errorsSlot and pushing ValidationErrorItem.
 */
function pushTypeErrorWhen(
    ctx: Context,
    state: BuildStateBase,
    input: Slot,
    condition: Slot<boolean>,
    message: string,
): void {
    const errorsSlot = state.optionsSlot.get('errors' as any);
    ctx.when(ctx.and(errorsSlot, condition), () => {
        ctx.push(
            errorsSlot,
            ctx.newExpr(ValidationErrorItem, state.pathSlot(), ctx.lit('type'), ctx.lit(message), input),
        );
    });
}

/**
 * Find the rest element in a tuple type.
 * Returns the index of the rest element and its inner type.
 */
function findTupleRest(tupleType: TypeTuple): { index: number; type?: Type } {
    for (let i = 0; i < tupleType.types.length; i++) {
        if (tupleType.types[i].type.kind === ReflectionKind.rest) {
            return { index: i, type: (tupleType.types[i].type as any).type };
        }
    }
    return { index: -1 };
}

// ============================================================================
// Guard Factories
// ============================================================================

/**
 * Factory for creating primitive type guard pairs (score-based and fast).
 * Consolidates the common pattern for simple type checks.
 */
function createPrimitiveGuardPair(
    check: (ctx: Context, input: Slot) => Slot<boolean>,
    errorMessage: string,
): { score: TypeHandler; fast: TypeHandler } {
    return {
        score: (type, input, ctx, state) => guardWithError(ctx, state, input, check(ctx, input), 'type', errorMessage),
        fast: (type, input, ctx, state) => check(ctx, input),
    };
}

// Primitive guard pairs created via factory
const stringGuards = createPrimitiveGuardPair((ctx, input) => ctx.isType(input, 'string'), 'Not a string');
const booleanGuards = createPrimitiveGuardPair((ctx, input) => ctx.isType(input, 'boolean'), 'Not a boolean');
const bigIntGuards = createPrimitiveGuardPair((ctx, input) => ctx.isType(input, 'bigint'), 'Not a bigint');
const nullGuards = createPrimitiveGuardPair((ctx, input) => ctx.isNull(input), 'Not null');
const undefinedGuards = createPrimitiveGuardPair((ctx, input) => ctx.eq(input, ctx.lit(undefined)), 'Not undefined');

// Any is special: always valid (score=1000 or true)
const anyGuards = {
    score: ((type: Type, input: Slot, ctx: Context, state: BuildStateBase) => ctx.lit(1000)) as TypeHandler,
    fast: ((type: Type, input: Slot, ctx: Context, state: BuildStateBase) => ctx.lit(true)) as TypeHandler,
};

/**
 * Configuration for ID pattern handlers (NanoId, UUID, MongoId).
 */
interface IdPatternConfig {
    /** RegExp pattern for validation */
    pattern?: RegExp;
    /** Exact length requirement */
    length?: number;
    /** Whether empty string is valid */
    allowEmpty?: boolean;
    /** Error message for validation failures */
    errorMessage: string;
}

/**
 * Factory for creating ID type handlers (score guard, fast guard, deserialize).
 * Consolidates NanoId, UUID, MongoId pattern handling.
 */
function createIdPatternHandlers(config: IdPatternConfig): {
    guardScore: TypeHandler;
    guardFast: TypeHandler;
    deserialize: TypeHandler;
} {
    // Build the validation check based on config
    const buildCheck = (ctx: Context, input: Slot): Slot<boolean> => {
        let valid = ctx.isType(input, 'string');

        if (config.length !== undefined) {
            valid = ctx.and(valid, ctx.eq(input.get('length'), ctx.lit(config.length)));
        }

        if (config.pattern) {
            const matchesPattern = ctx.callExpr(
                (pattern: RegExp, value: string) => pattern.test(value),
                ctx.lit(config.pattern),
                input,
            );
            if (config.allowEmpty) {
                const isEmpty = ctx.eq(input, ctx.lit(''));
                valid = ctx.and(valid, ctx.or(isEmpty, matchesPattern));
            } else {
                valid = ctx.and(valid, matchesPattern);
            }
        }

        return valid;
    };

    return {
        guardScore: (type, input, ctx, state) =>
            guardWithError(ctx, state, input, buildCheck(ctx, input), 'type', config.errorMessage),
        guardFast: (type, input, ctx, state) => buildCheck(ctx, input),
        deserialize: (type, input, ctx, state) => {
            ctx.when(ctx.not(buildCheck(ctx, input)), () => {
                state.throw_(type, input, config.errorMessage);
            });
            return input;
        },
    };
}

// ID pattern handlers created via factory
const nanoIdHandlers = createIdPatternHandlers({
    length: 21,
    errorMessage: 'Not a valid NanoId',
});

const uuidHandlers = createIdPatternHandlers({
    pattern: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    errorMessage: 'Not a valid UUID',
});

const mongoIdHandlers = createIdPatternHandlers({
    pattern: /^[0-9a-fA-F]{24}$/,
    allowEmpty: true,
    errorMessage: 'Not a MongoId (ObjectId)',
});

// Primitive Serializers (serialize direction - pass through)
const handleString: TypeHandler = (type, input, ctx, state) => input;
const handleNumber: TypeHandler = (type, input, ctx, state) => input;
const handleBoolean: TypeHandler = (type, input, ctx, state) => input;
const handleBigInt: TypeHandler = (type, input, ctx, state) => ctx.callExpr(String, input);
const handleNull: TypeHandler = (type, input, ctx, state) => ctx.lit(null);
const handleUndefined: TypeHandler = (type, input, ctx, state) => ctx.lit(undefined);
const serializeUndefined: TypeHandler = (type, input, ctx, state) => ctx.lit(null); // JSON has no undefined
const handleAny: TypeHandler = (type, input, ctx, state) => input;
const handleUnknown: TypeHandler = (type, input, ctx, state) => input;

// Primitive Deserializers (deserialize direction - coerce types)
const deserializeString: TypeHandler = (type, input, ctx, state) => {
    const result = ctx.var_(input);
    const isLoose = state.isLoose();

    ctx.when(
        ctx.and(
            isLoose,
            ctx.or(ctx.isType(input, 'number'), ctx.or(ctx.isType(input, 'boolean'), ctx.isType(input, 'bigint'))),
        ),
        () => {
            ctx.setVar(result, ctx.callExpr(String, input));
        },
    );

    return ctx.getVar(result);
};

const deserializeNumber: TypeHandler = (type, input, ctx, state) => {
    const numberType = type as TypeNumber;
    const brand = numberType.brand;
    const isLoose = state.isLoose();

    const canCoerceString = ctx.var_(ctx.lit(false));
    ctx.when(ctx.and(isLoose, ctx.isType(input, 'string')), () => {
        ctx.setVar(canCoerceString, ctx.callExpr(isSignedNumericString, input));
    });
    const canCoerceBoolean = ctx.and(isLoose, ctx.isType(input, 'boolean'));

    const coerced = ctx.ternary(
        ctx.isType(input, 'number'),
        input,
        ctx.ternary(
            canCoerceBoolean,
            ctx.ternary(input, ctx.lit(1), ctx.lit(0)),
            ctx.ternary(ctx.getVar(canCoerceString), ctx.callExpr(Number, input), input),
        ),
    );

    // Apply brand constraints (integer, int8, int16, etc.)
    const isNumber = ctx.isType(coerced, 'number');
    if (brand === TypeNumberBrand.integer) {
        return ctx.ternary(isNumber, ctx.callExpr(Math.trunc, coerced), coerced);
    }
    if (brand === TypeNumberBrand.int8) {
        return ctx.ternary(
            isNumber,
            ctx.callExpr((v: number) => Math.max(-128, Math.min(127, Math.trunc(v))), coerced),
            coerced,
        );
    }
    if (brand === TypeNumberBrand.uint8) {
        return ctx.ternary(
            isNumber,
            ctx.callExpr((v: number) => Math.max(0, Math.min(255, Math.trunc(v))), coerced),
            coerced,
        );
    }
    if (brand === TypeNumberBrand.int16) {
        return ctx.ternary(
            isNumber,
            ctx.callExpr((v: number) => Math.max(-32768, Math.min(32767, Math.trunc(v))), coerced),
            coerced,
        );
    }
    if (brand === TypeNumberBrand.uint16) {
        return ctx.ternary(
            isNumber,
            ctx.callExpr((v: number) => Math.max(0, Math.min(65535, Math.trunc(v))), coerced),
            coerced,
        );
    }
    if (brand === TypeNumberBrand.int32) {
        return ctx.ternary(
            isNumber,
            ctx.callExpr((v: number) => v | 0, coerced),
            coerced,
        );
    }
    if (brand === TypeNumberBrand.uint32) {
        return ctx.ternary(
            isNumber,
            ctx.callExpr((v: number) => v >>> 0, coerced),
            coerced,
        );
    }
    if (brand === TypeNumberBrand.float32) {
        return ctx.ternary(isNumber, ctx.callExpr(Math.fround, coerced), coerced);
    }

    return coerced;
};

const deserializeBoolean: TypeHandler = (type, input, ctx, state) => {
    const isLoose = state.isLoose();
    const result = ctx.var_(input);
    const truthy = ctx.or(
        ctx.eq(input, ctx.lit('true')),
        ctx.or(ctx.eq(input, ctx.lit('1')), ctx.eq(input, ctx.lit(1))),
    );
    const falsy = ctx.or(
        ctx.eq(input, ctx.lit('false')),
        ctx.or(ctx.eq(input, ctx.lit('0')), ctx.eq(input, ctx.lit(0))),
    );

    ctx.when(ctx.isType(input, 'boolean'), () => ctx.setVar(result, input));
    ctx.when(ctx.and(isLoose, ctx.not(ctx.isType(input, 'boolean'))), () => {
        ctx.when(truthy, () => ctx.setVar(result, ctx.lit(true)));
        ctx.when(falsy, () => ctx.setVar(result, ctx.lit(false)));
    });

    return ctx.getVar(result);
};

const deserializeBigInt: TypeHandler = (type, input, ctx, state) => {
    const isLoose = state.isLoose();
    const canCoerceString = ctx.var_(ctx.lit(false));
    ctx.when(ctx.and(isLoose, ctx.isType(input, 'string')), () => {
        ctx.setVar(canCoerceString, ctx.callExpr(isSignedIntegerString, input));
    });
    const canCoerceNumber = ctx.and(isLoose, ctx.isType(input, 'number'));
    const result = ctx.var_(
        ctx.ternary(
            ctx.isType(input, 'bigint'),
            input,
            ctx.ternary(ctx.or(ctx.getVar(canCoerceString), canCoerceNumber), ctx.callExpr(BigInt, input), input),
        ),
    );
    return ctx.getVar(result);
};

const serializeBinaryBigInt: TypeHandler = (type, input, ctx, state) => {
    const annotation = getBinaryBigIntMode(type);
    const result = ctx.var_(input);

    ctx.when(ctx.lit(annotation === BinaryBigIntType.unsigned), () => {
        ctx.when(ctx.lt(ctx.getVar(result), ctx.lit(0n)), () => {
            ctx.setVar(result, ctx.lit(0n));
        });
    });

    return ctx.callExpr(String, ctx.getVar(result));
};

const deserializeBinaryBigInt: TypeHandler = (type, input, ctx, state) => {
    const annotation = getBinaryBigIntMode(type);
    const base = deserializeBigInt(type, input, ctx, state);
    const result = ctx.var_(base);

    ctx.when(
        ctx.and(ctx.lit(annotation === BinaryBigIntType.unsigned), ctx.isType(ctx.getVar(result), 'bigint')),
        () => {
            ctx.when(ctx.lt(ctx.getVar(result), ctx.lit(0n)), () => {
                ctx.setVar(result, ctx.lit(0n));
            });
        },
    );

    return ctx.getVar(result);
};

const handleArray: TypeHandler = (type, input, ctx, state) => {
    const arrType = type as TypeArray;
    const elementType = arrType.type;
    if (elementType.kind === ReflectionKind.any) return input;

    // For serialize direction with pass-through primitive types, return input directly
    // (unpopulatedSymbol is handled at property level in buildObjectLiteralBody)
    const isSerialize = state.direction === 'serialize';
    const isPassThrough =
        isSerialize &&
        (elementType.kind === ReflectionKind.string ||
            elementType.kind === ReflectionKind.number ||
            elementType.kind === ReflectionKind.boolean ||
            elementType.kind === ReflectionKind.unknown);

    if (isPassThrough) {
        // Serialize primitive arrays: return input directly, no checks needed
        return input;
    }

    // For deserialize or non-primitive arrays, need Array.isArray check
    // Initialize to undefined - if input is not an array, return undefined
    // so the type guard can catch it as invalid (don't silently coerce to [])
    const result = ctx.var_<any>(ctx.lit(undefined));
    ctx.when(ctx.callExpr(Array.isArray, input), () => {
        ctx.setVar(
            result,
            ctx.map(input, (elem, idx) => state.build(elementType, elem)),
        );
    });
    return ctx.getVar(result);
};

const handleTuple: TypeHandler = (type, input, ctx, state) => {
    const tupleType = type as TypeTuple;
    const result = ctx.let(ctx.arrExpr());

    // Find rest element position if any
    const rest = findTupleRest(tupleType);
    const restIndex = rest.index;
    const restType = rest.type;

    if (restIndex === -1) {
        // No rest element - simple case
        for (let i = 0; i < tupleType.types.length; i++) {
            const member = tupleType.types[i];
            ctx.push(result, state.build(member.type, input.at(i)));
        }
    } else {
        // Has rest element
        const beforeRest = restIndex;
        const afterRest = tupleType.types.length - restIndex - 1;

        // Elements before rest
        for (let i = 0; i < beforeRest; i++) {
            const member = tupleType.types[i];
            ctx.push(result, state.build(member.type, input.at(i)));
        }

        // Rest elements - iterate from restIndex to (length - afterRest)
        if (restType) {
            const processRest = (
                inputArr: any[],
                resultArr: any[],
                restIdx: number,
                afterCount: number,
                rt: Type,
                st: BuildStateBase,
            ): number => {
                const restEnd = inputArr.length - afterCount;
                for (let j = restIdx; j < restEnd; j++) {
                    // Build each rest element - need to serialize at runtime
                    const serializer = (st as any).serializer;
                    const direction = (st as any).direction;
                    const fn =
                        direction === 'serialize' ? serializer.buildSerializer(rt) : serializer.buildDeserializer(rt);
                    resultArr.push(fn(inputArr[j], {}));
                }
                return 0; // Return value forces the call to be emitted
            };
            // Use ctx.let() to force the call to be emitted in generated code
            ctx.let(
                ctx.callExpr(
                    processRest,
                    input,
                    result,
                    ctx.lit(restIndex),
                    ctx.lit(afterRest),
                    ctx.lit(restType),
                    ctx.lit(state),
                ),
            );
        }

        // Elements after rest (from the end)
        for (let i = 0; i < afterRest; i++) {
            const memberIdx = restIndex + 1 + i;
            const member = tupleType.types[memberIdx];
            // Access from end of array: arr[arr.length - (afterRest - i)]
            const offset = afterRest - i;
            const inputIdx = ctx.callExpr((arr: any[], off: number) => arr.length - off, input, ctx.lit(offset));
            ctx.push(result, state.build(member.type, input.at(inputIdx)));
        }
    }

    return result;
};

const handleObjectLiteral: TypeHandler = (type, input, ctx, state) => {
    const objType = type as TypeObjectLiteral | TypeClass;
    const members = resolveTypeMembers(objType);
    const isDeserialize = state.direction === 'deserialize';

    // Check for embedded annotation
    const embedded = embeddedAnnotation.getFirst(objType);
    if (embedded) {
        // Get properties only (not methods, index signatures, etc.)
        const properties = members.filter(isPropertyMemberType) as (TypeProperty | TypePropertySignature)[];

        if (properties.length === 1) {
            // Single property embedded: serialize to just the value, deserialize from just the value
            // This applies regardless of prefix setting when used directly (not as a property of another type)
            const prop = properties[0];
            const propName = memberNameToString(prop.name);
            const propType = prop.type;

            if (isDeserialize) {
                // Deserialization: accept raw value and create object/class with it
                const result = ctx.var_<any>(undefined);
                const converted = state.forProperty(propName).build(propType, input);

                if (objType.kind === ReflectionKind.class) {
                    // Create class instance
                    ctx.setVar(result, ctx.newExpr(objType.classType, converted));
                } else {
                    // Create object literal
                    const obj = ctx.let(ctx.objExpr());
                    ctx.set(obj, propName, converted);
                    ctx.setVar(result, obj);
                }
                return ctx.getVar(result);
            } else {
                // Serialization: extract the property value
                const propInput = input.get(propName);
                return state.forProperty(propName).build(propType, propInput);
            }
        }

        // Multi-property embedded with non-empty prefix used directly: apply prefix transformation
        if (embedded.prefix !== undefined && embedded.prefix !== '') {
            const prefix = embedded.prefix;

            if (isDeserialize) {
                // Deserialize: read from prefixed input keys, create object with unprefixed keys
                const result = ctx.var_<any>(undefined);

                if (objType.kind === ReflectionKind.class) {
                    const classType = objType as TypeClass;
                    const ctorProps = getDeepConstructorProperties(classType);
                    if (ctorProps.length > 0) {
                        // Constructor takes arguments
                        const args: Slot[] = [];
                        for (const ctorProp of ctorProps) {
                            const subPropName = memberNameToString(ctorProp.name);
                            // Use naming strategy to get serialized name (handles MapName, etc.)
                            const serializedSubName =
                                state.namingStrategy.getPropertyName(ctorProp, state.serializer.name) || subPropName;
                            const prefixedName = prefix + serializedSubName;
                            const propInput = input.get(prefixedName);
                            args.push(state.forProperty(subPropName).build(ctorProp.type, propInput));
                        }
                        ctx.setVar(result, ctx.newExpr(classType.classType, ...args));
                    } else {
                        // No constructor - create instance and assign
                        const instance = ctx.let(ctx.newExpr(classType.classType));
                        for (const prop of properties) {
                            const subPropName = memberNameToString(prop.name);
                            const serializedName =
                                state.namingStrategy.getPropertyName(prop, state.serializer.name) || subPropName;
                            const prefixedName = prefix + serializedName;
                            const propInput = input.get(prefixedName);
                            ctx.set(instance, subPropName, state.forProperty(subPropName).build(prop.type, propInput));
                        }
                        ctx.setVar(result, instance);
                    }
                } else {
                    // Object literal
                    const obj = ctx.let(ctx.objExpr());
                    for (const prop of properties) {
                        const subPropName = memberNameToString(prop.name);
                        const serializedName =
                            state.namingStrategy.getPropertyName(prop, state.serializer.name) || subPropName;
                        const prefixedName = prefix + serializedName;
                        const propInput = input.get(prefixedName);
                        ctx.set(obj, subPropName, state.forProperty(subPropName).build(prop.type, propInput));
                    }
                    ctx.setVar(result, obj);
                }

                return ctx.getVar(result);
            } else {
                // Serialize: read from unprefixed input keys, write to prefixed output keys
                const entries: Record<string, Slot> = {};
                for (const prop of properties) {
                    const subPropName = memberNameToString(prop.name);
                    const serializedName =
                        state.namingStrategy.getPropertyName(prop, state.serializer.name) || subPropName;
                    const prefixedName = prefix + serializedName;
                    const propInput = input.get(subPropName);
                    entries[prefixedName] = state.forProperty(subPropName).build(prop.type, propInput);
                }
                return ctx.objFrom(entries);
            }
        }
        // For multi-property embedded without prefix (or empty prefix) used directly, fall through to normal handling
    }

    // Check for circular references during serialization
    const hasCircular = !isDeserialize && hasCircularReference(objType);

    // For serialize direction, we trust the input is a valid object (TypeScript class instance)
    // For deserialize direction, we need to check if input is actually an object
    if (isDeserialize) {
        // Check if input is an object (not null, not primitive)
        const isObjectCheck = ctx.and(ctx.isType(input, 'object'), ctx.not(ctx.isNull(input)));
        const result = ctx.var_<any>(undefined);

        ctx.when(
            isObjectCheck,
            () => {
                const innerResult = buildObjectLiteralBody(objType, members, input, ctx, state, isDeserialize);
                ctx.setVar(result, innerResult);
            },
            () => {
                // Not an object - throw error
                state.throw_(type, input);
            },
        );

        return ctx.getVar(result);
    } else {
        // Serialize direction - trust input is valid, skip type check
        if (hasCircular) {
            // Runtime circular reference check using _stack in options
            const checkCircular = (data: any, stack: any[] | undefined, opts: any): any[] | undefined => {
                if (data && typeof data === 'object') {
                    if (stack) {
                        if (stack.includes(data)) return undefined; // Already seen - signal to skip
                    } else {
                        stack = [];
                        opts._stack = stack;
                    }
                    stack.push(data);
                }
                return stack;
            };

            const popStack = (stack: any[] | undefined): void => {
                if (stack) stack.pop();
            };

            const result = ctx.var_<any>(undefined);

            // Check and push to stack, returns undefined if circular
            const stackSlot = ctx.callExpr(
                checkCircular,
                input,
                state.optionsSlot.get('_stack' as any),
                state.optionsSlot,
            );

            // If stack is undefined (circular detected), return undefined
            ctx.when(ctx.neq(stackSlot, ctx.lit(undefined)), () => {
                const innerResult = buildObjectLiteralBody(objType, members, input, ctx, state, isDeserialize);
                ctx.callExpr(popStack, stackSlot);
                ctx.setVar(result, innerResult);
            });

            return ctx.getVar(result);
        } else {
            // Simple case - no circular refs, no type check needed
            return buildObjectLiteralBody(objType, members, input, ctx, state, isDeserialize);
        }
    }
};

/**
 * Build the body of object literal serialization/deserialization.
 * Returns the result slot containing the built object.
 *
 * For serialize with simple properties (non-optional, non-nullable, no groups):
 * Uses object literal syntax for performance: `{a:s0.a, b:s0.b}`
 *
 * For properties needing conditionals (optional, nullable, grouped):
 * Uses incremental assignment: `if(...){result.p = ...}`
 */
function buildObjectLiteralBody(
    objType: TypeObjectLiteral | TypeClass,
    members: Type[],
    input: Slot,
    ctx: Context,
    state: BuildStateBase,
    isDeserialize: boolean,
): Slot {
    // Collect explicit property names for index signature handling
    const explicitProps = new Set<string>();
    let indexSignature: TypeIndexSignature | undefined;

    // Categorize properties for optimal code generation
    interface LiteralProp {
        outputKey: string;
        valueSlot: Slot;
    }
    interface IncrementalProp {
        memberType: TypeProperty | TypePropertySignature;
        propType: Type;
        inputKey: string;
        outputKey: string;
        propInput: Slot;
        propGroups: string[];
    }

    const literalProps: LiteralProp[] = [];
    const incrementalProps: IncrementalProp[] = [];

    // Properties that need embedded prefix flattening
    interface EmbeddedProp {
        memberType: TypeProperty | TypePropertySignature;
        propName: string;
        embeddedType: TypeClass | TypeObjectLiteral;
        prefix: string;
        propGroups: string[];
        isUnion: boolean; // True if embedded is part of a union (needs runtime type check for serialize)
        originalType: Type; // Original property type (needed for fallback handling in unions)
    }
    const embeddedProps: EmbeddedProp[] = [];

    // First pass: categorize all properties
    for (const member of members) {
        if (member.kind === ReflectionKind.indexSignature) {
            indexSignature = member;
            continue;
        }
        if (!isPropertyMemberType(member)) continue;
        const memberType = member as TypeProperty | TypePropertySignature;
        const propName = memberNameToString(memberType.name);
        explicitProps.add(propName);
        const serializedName = state.namingStrategy.getPropertyName(memberType, state.serializer.name);
        if (!serializedName) continue;
        const excluded = excludedAnnotation.getAnnotations(memberType.type);
        if (excluded.includes('*') || excluded.includes(state.serializer.name)) continue;

        const propGroups = groupAnnotation.getAnnotations(memberType.type) || [];
        const propType = memberType.type;

        // Check if this property has an embedded type (directly or in a union)
        let embedded = embeddedAnnotation.getFirst(propType);
        let embeddedType: TypeClass | TypeObjectLiteral | undefined;
        let isUnion = false;

        if (embedded && (propType.kind === ReflectionKind.class || propType.kind === ReflectionKind.objectLiteral)) {
            embeddedType = propType as TypeClass | TypeObjectLiteral;
        } else if (propType.kind === ReflectionKind.union) {
            // Check union members for embedded types
            const unionType = propType as TypeUnion;
            for (const member of unionType.types) {
                const memberEmbedded = embeddedAnnotation.getFirst(member);
                if (
                    memberEmbedded &&
                    (member.kind === ReflectionKind.class || member.kind === ReflectionKind.objectLiteral)
                ) {
                    embedded = memberEmbedded;
                    embeddedType = member as TypeClass | TypeObjectLiteral;
                    isUnion = true;
                    break;
                }
            }
        }

        if (embedded && embeddedType) {
            const embeddedMembers = resolveTypeMembers(embeddedType);
            const embeddedProperties = embeddedMembers.filter(isPropertyMemberType) as (
                | TypeProperty
                | TypePropertySignature
            )[];

            // Determine if this is a multi-property embedded or has explicit prefix
            const isSingleProp = embeddedProperties.length === 1;
            const hasExplicitPrefix = embedded.prefix !== undefined;

            // Flattening rules:
            // - Single-property with no prefix: normal handling (not flattened)
            // - Single-property with prefix: flatten with explicit prefix
            // - Multi-property with no prefix: flatten with property name + '_' as default prefix
            // - Multi-property with prefix: flatten with explicit prefix
            if (hasExplicitPrefix || !isSingleProp) {
                // Use explicit prefix or default to property name + '_'
                const prefix = embedded.prefix !== undefined ? embedded.prefix : propName + '_';
                embeddedProps.push({
                    memberType,
                    propName,
                    embeddedType,
                    prefix,
                    propGroups,
                    isUnion,
                    originalType: propType,
                });
                continue;
            }
        }

        const inputKey = isDeserialize ? serializedName : propName;
        const outputKey = isDeserialize ? propName : serializedName;
        const propInput = input.get(inputKey);

        // Determine if this property can use object literal syntax (fast path)
        // Requirements for literal:
        // For deserialize: can use literal path for non-optional, non-nullable, non-grouped properties
        // For serialize: must use incremental path to support runtime group filtering
        //   (even properties without groups need runtime check when options.groups is specified)
        // Note: Classes use deserializeClass handler which creates instances, not handleObjectLiteral
        const canUseLiteral =
            isDeserialize &&
            !isOptional(memberType) &&
            !isNullable(memberType) &&
            propGroups.length === 0 &&
            !(propType.kind === ReflectionKind.array && isBackReferenceType(memberType));

        if (canUseLiteral) {
            // Simple property - can use object literal
            literalProps.push({
                outputKey,
                valueSlot: state.build(propType, propInput),
            });
        } else {
            // Complex property - needs conditional handling
            incrementalProps.push({
                memberType,
                propType,
                inputKey,
                outputKey,
                propInput,
                propGroups,
            });
        }
    }

    // Create result object
    let result: Slot;

    // Fast path: if all properties are simple (no incremental, no index signature),
    // return object literal directly without variable assignment (25% faster in V8)
    // Note: For deserialize, handleObjectLiteral is only called for TypeObjectLiteral, not TypeClass
    // (TypeClass uses deserializeClass handler which creates class instances)
    if (literalProps.length > 0 && incrementalProps.length === 0 && !indexSignature) {
        const entries: Record<string, Slot> = {};
        for (const prop of literalProps) {
            entries[prop.outputKey] = prop.valueSlot;
        }
        return ctx.objFrom(entries); // Direct return - avoids variable assignment overhead
    }

    if (literalProps.length > 0) {
        // Use object literal for simple properties, but need variable for incremental adds
        const entries: Record<string, Slot> = {};
        for (const prop of literalProps) {
            entries[prop.outputKey] = prop.valueSlot;
        }
        result = ctx.let(ctx.objFrom(entries));
    } else {
        // Start with empty object (no simple properties)
        result = ctx.let(ctx.objExpr());
    }

    // Handle incremental properties (optional, nullable, grouped, etc.)
    for (const prop of incrementalProps) {
        const { memberType, propType, inputKey, outputKey, propInput, propGroups } = prop;

        const buildPropBody = () => {
            // For deserialize: always need `in` check since input is unknown
            // For serialize: need `in` check only for optional properties
            const needsHasCheck = isDeserialize || isOptional(memberType);

            if (needsHasCheck) {
                ctx.when(
                    ctx.has(input, inputKey),
                    () => {
                        if (isDeserialize) {
                            // Deserialize: need to check for null/undefined and transform
                            ctx.when(
                                ctx.not(ctx.isNullish(propInput)),
                                () => {
                                    ctx.set(result, outputKey, state.build(propType, propInput));
                                },
                                () => {
                                    // Deserialize: null → undefined for optional, null for nullable
                                    if (isNullable(memberType)) {
                                        ctx.set(result, outputKey, ctx.lit(null));
                                    } else if (isOptional(memberType)) {
                                        ctx.set(result, outputKey, ctx.lit(undefined));
                                    }
                                },
                            );
                        } else {
                            // Serialize optional: check if primitive pass-through type
                            const isPrimitivePassThrough =
                                propType.kind === ReflectionKind.string ||
                                propType.kind === ReflectionKind.number ||
                                propType.kind === ReflectionKind.boolean;

                            if (isPrimitivePassThrough) {
                                // Primitive: use nullish coalescing directly
                                ctx.set(result, outputKey, ctx.nullishCoalesce(propInput, ctx.lit(null)));
                            } else {
                                // Non-primitive: need transformation
                                ctx.when(
                                    ctx.not(ctx.isNullish(propInput)),
                                    () => {
                                        ctx.set(result, outputKey, state.build(propType, propInput));
                                    },
                                    () => {
                                        if (isNullable(memberType) || isOptional(memberType)) {
                                            ctx.set(result, outputKey, ctx.lit(null));
                                        }
                                    },
                                );
                            }
                        }
                    },
                    () => {
                        // Handle missing properties - set nullable to null
                        if (isNullable(memberType)) {
                            ctx.set(result, outputKey, ctx.lit(null));
                        }
                    },
                );
            } else {
                // Required property that needs special handling
                if (isNullable(memberType)) {
                    // Nullable property: check for null to convert undefined → null
                    ctx.when(
                        ctx.not(ctx.isNullish(propInput)),
                        () => {
                            ctx.set(result, outputKey, state.build(propType, propInput));
                        },
                        () => {
                            ctx.set(result, outputKey, ctx.lit(null));
                        },
                    );
                } else if (propType.kind === ReflectionKind.array && isBackReferenceType(memberType)) {
                    // BackReference array: check for unpopulatedSymbol
                    ctx.when(
                        ctx.eq(propInput, ctx.lit(unpopulatedSymbol)),
                        () => {
                            ctx.set(result, outputKey, ctx.arrExpr());
                        },
                        () => {
                            ctx.set(result, outputKey, state.build(propType, propInput));
                        },
                    );
                } else {
                    // Should not reach here for serialize (these go to literalProps)
                    // But handle for deserialize
                    ctx.set(result, outputKey, state.build(propType, propInput));
                }
            }
        };

        // Always check groups at runtime - properties without groups should be excluded
        // when options.groups is specified (isGroupAllowed handles this correctly)
        const groupCheck = ctx.callExpr(isGroupAllowed, state.optionsSlot, ctx.lit(propGroups));
        ctx.when(groupCheck, buildPropBody);
    }

    // Handle index signature (e.g., Record<string, T> or { [key: string]: T })
    if (indexSignature) {
        const valueType = indexSignature.type;
        const valueAllowsNull = isNullable(indexSignature) || isOptional(indexSignature);
        const indexType = indexSignature.index;

        // Iterate over all keys in input that aren't explicit properties
        const processIndexSignature = (
            inputObj: any,
            resultObj: any,
            explicitKeys: Set<string>,
            valueTypeArg: Type,
            stateArg: BuildStateBase,
            valueAllowsNullArg: boolean,
            indexTypeArg: Type,
            reflectionKind: typeof ReflectionKind,
            extendTemplateLiteralFn: typeof extendTemplateLiteral,
        ): number => {
            for (const key of Object.keys(inputObj)) {
                if (explicitKeys.has(key)) continue;

                // Check if key matches the index signature pattern
                if (indexTypeArg.kind === reflectionKind.templateLiteral) {
                    // For template literal index signatures, check if key matches the pattern
                    const keyLiteral = { kind: reflectionKind.literal, literal: key } as any;
                    if (!extendTemplateLiteralFn(keyLiteral, indexTypeArg as any)) {
                        // Key doesn't match template pattern - set to undefined
                        resultObj[key] = undefined;
                        continue;
                    }
                } else if (indexTypeArg.kind === reflectionKind.number) {
                    // For number index signatures, check if key is numeric
                    const numKey = Number(key);
                    if (isNaN(numKey) || key === '') {
                        // Key is not numeric - set to undefined
                        resultObj[key] = undefined;
                        continue;
                    }
                }
                // For string index signatures, all keys match

                const value = inputObj[key];
                if (value === undefined) {
                    if (valueAllowsNullArg) {
                        resultObj[key] = null;
                    }
                    // If type doesn't allow undefined, skip undefined values
                } else {
                    // Build the value using the serializer
                    const serializer = (stateArg as any).serializer;
                    const direction = (stateArg as any).direction;
                    const fn =
                        direction === 'serialize'
                            ? serializer.buildSerializer(valueTypeArg)
                            : serializer.buildDeserializer(valueTypeArg);
                    resultObj[key] = fn(value, {});
                }
            }
            return 0; // Return value forces the call to be emitted
        };

        // Use ctx.let() to force the call to be emitted in generated code
        ctx.let(
            ctx.callExpr(
                processIndexSignature,
                input,
                result,
                ctx.lit(explicitProps),
                ctx.lit(valueType),
                ctx.lit(state),
                ctx.lit(valueAllowsNull),
                ctx.lit(indexType),
                ctx.lit(ReflectionKind),
                ctx.lit(extendTemplateLiteral),
            ),
        );
    }

    // Handle embedded properties with prefix (flatten into parent)
    for (const embeddedProp of embeddedProps) {
        const { memberType, propName, embeddedType, prefix, propGroups, isUnion, originalType } = embeddedProp;
        const embeddedMembers = resolveTypeMembers(embeddedType);
        const isOpt = isOptional(memberType);

        const buildEmbeddedBody = () => {
            if (isDeserialize) {
                // Deserialize: read prefixed properties from input and create embedded object
                const embeddedResult = ctx.var_<any>(undefined);

                // Check if all required prefixed properties exist
                const requiredKeys: string[] = [];
                for (const member of embeddedMembers) {
                    if (!isPropertyMemberType(member)) continue;
                    const memberProp = member as TypeProperty | TypePropertySignature;
                    const subPropName = memberNameToString(memberProp.name);
                    const serializedSubName =
                        state.namingStrategy.getPropertyName(memberProp, state.serializer.name) || subPropName;
                    const prefixedName = prefix + serializedSubName;
                    if (!isOptional(memberProp)) {
                        requiredKeys.push(prefixedName);
                    }
                }

                // Build the embedded object from prefixed properties
                const buildEmbedded = () => {
                    if (embeddedType.kind === ReflectionKind.class) {
                        // Create class instance
                        const ctorProps = getDeepConstructorProperties(embeddedType);
                        if (ctorProps.length > 0) {
                            // Class with constructor - pass constructor args
                            const args: Slot[] = [];
                            for (const ctorProp of ctorProps) {
                                const subPropName = memberNameToString(ctorProp.name);
                                const serializedSubName =
                                    state.namingStrategy.getPropertyName(ctorProp, state.serializer.name) ||
                                    subPropName;
                                const prefixedName = prefix + serializedSubName;
                                const propInput = input.get(prefixedName);
                                args.push(state.forProperty(prefixedName).build(ctorProp.type, propInput));
                            }
                            ctx.setVar(embeddedResult, ctx.newExpr(embeddedType.classType, ...args));
                        } else {
                            // Class without constructor - create and assign
                            const instance = ctx.let(ctx.newExpr(embeddedType.classType));
                            for (const member of embeddedMembers) {
                                if (!isPropertyMemberType(member)) continue;
                                const memberProp = member as TypeProperty | TypePropertySignature;
                                const subPropName = memberNameToString(memberProp.name);
                                const serializedSubName =
                                    state.namingStrategy.getPropertyName(memberProp, state.serializer.name) ||
                                    subPropName;
                                const prefixedName = prefix + serializedSubName;
                                const propInput = input.get(prefixedName);
                                ctx.set(
                                    instance,
                                    subPropName,
                                    state.forProperty(prefixedName).build(memberProp.type, propInput),
                                );
                            }
                            ctx.setVar(embeddedResult, instance);
                        }
                    } else {
                        // Object literal
                        const obj = ctx.let(ctx.objExpr());
                        for (const member of embeddedMembers) {
                            if (!isPropertyMemberType(member)) continue;
                            const memberProp = member as TypeProperty | TypePropertySignature;
                            const subPropName = memberNameToString(memberProp.name);
                            const serializedSubName =
                                state.namingStrategy.getPropertyName(memberProp, state.serializer.name) || subPropName;
                            const prefixedName = prefix + serializedSubName;
                            const propInput = input.get(prefixedName);
                            ctx.set(
                                obj,
                                subPropName,
                                state.forProperty(prefixedName).build(memberProp.type, propInput),
                            );
                        }
                        ctx.setVar(embeddedResult, obj);
                    }
                };

                // Collect all prefixed keys (not just required) for union detection
                const allPrefixedKeys = collectPrefixedPropertyNames(embeddedMembers, prefix, state);

                const deserializeFallback = () => {
                    // For unions, deserialize from the original property name
                    const serializedName = state.namingStrategy.getPropertyName(memberType, state.serializer.name);
                    const fallbackInput = input.get(serializedName || propName);
                    ctx.when(ctx.has(input, serializedName || propName), () => {
                        ctx.setVar(embeddedResult, state.build(originalType, fallbackInput));
                    });
                };

                if (isUnion) {
                    // For unions, check if any prefixed keys exist
                    const hasPrefixed = ctx.callExpr(
                        (obj: any, keys: string[]) => keys.some(k => k in obj && obj[k] !== undefined),
                        input,
                        ctx.lit(allPrefixedKeys),
                    );
                    ctx.when(hasPrefixed, buildEmbedded, deserializeFallback);
                } else if (isOpt && requiredKeys.length > 0) {
                    // Optional embedded with required properties - only build if at least one has a defined value
                    // (explicit undefined should not trigger object creation)
                    const hasAny = ctx.callExpr(
                        (obj: any, keys: string[]) => keys.some(k => k in obj && obj[k] !== undefined),
                        input,
                        ctx.lit(requiredKeys),
                    );
                    ctx.when(hasAny, buildEmbedded);
                } else {
                    buildEmbedded();
                }

                ctx.set(result, propName, ctx.getVar(embeddedResult));
            } else {
                // Serialize: read embedded object and flatten its properties with prefix
                const embeddedInput = input.get(propName);

                const serializeEmbedded = () => {
                    for (const member of embeddedMembers) {
                        if (!isPropertyMemberType(member)) continue;
                        const memberProp = member as TypeProperty | TypePropertySignature;
                        const subPropName = memberNameToString(memberProp.name);
                        // Use naming strategy to get serialized name (handles MapName, etc.)
                        const serializedSubName =
                            state.namingStrategy.getPropertyName(memberProp, state.serializer.name) || subPropName;
                        const prefixedName = prefix + serializedSubName;
                        const subPropInput = embeddedInput.get(subPropName);

                        // For optional/nullable embedded properties, convert undefined to null
                        const isOptOrNull = isOptional(memberProp) || isNullable(memberProp);
                        if (isOptOrNull) {
                            ctx.when(
                                ctx.isNullish(subPropInput),
                                () => {
                                    ctx.set(result, prefixedName, ctx.lit(null));
                                },
                                () => {
                                    ctx.set(
                                        result,
                                        prefixedName,
                                        state.forProperty(prefixedName).build(memberProp.type, subPropInput),
                                    );
                                },
                            );
                        } else {
                            ctx.set(
                                result,
                                prefixedName,
                                state.forProperty(prefixedName).build(memberProp.type, subPropInput),
                            );
                        }
                    }
                };

                const serializeFallback = () => {
                    // For unions, serialize as regular property when value is not the embedded type
                    const serializedName = state.namingStrategy.getPropertyName(memberType, state.serializer.name);
                    ctx.set(result, serializedName || propName, state.build(originalType, embeddedInput));
                };

                if (isUnion) {
                    // For unions, check at runtime if the value is an instance of the embedded class
                    const classRef =
                        embeddedType.kind === ReflectionKind.class ? (embeddedType as TypeClass).classType : Object; // For object literals, check if it's an object

                    const isEmbeddedInstance = ctx.callExpr(
                        (val: any, cls: any) => val instanceof cls,
                        embeddedInput,
                        ctx.lit(classRef),
                    );

                    ctx.when(isEmbeddedInstance, serializeEmbedded, serializeFallback);
                } else if (isOpt) {
                    ctx.when(ctx.not(ctx.isNullish(embeddedInput)), serializeEmbedded);
                } else {
                    serializeEmbedded();
                }
            }
        };

        // Check groups
        const groupCheck = ctx.callExpr(isGroupAllowed, state.optionsSlot, ctx.lit(propGroups));
        ctx.when(groupCheck, buildEmbeddedBody);
    }

    return result;
}

const handleLiteral: TypeHandler = (type, input, ctx, state) => ctx.lit((type as TypeLiteral).literal);
const handleEnum: TypeHandler = (type, input, ctx, state) => input;
const deserializeEnum: TypeHandler = (type, input, ctx, state) => {
    const enumType = type as TypeEnum;
    const matcher = getEnumValueIndexMatcher(enumType);
    return ctx.callExpr(
        (value: any, match: (v: any) => number, values: Array<any>) => {
            const idx = match(value);
            return idx === -1 ? value : values[idx];
        },
        input,
        ctx.lit(matcher),
        ctx.lit(enumType.values),
    );
};
const handlePromise: TypeHandler = (type, input, ctx, state) => state.build((type as any).type, input);

/**
 * Deserialize class types - creates actual class instances.
 */
const deserializeClass: TypeHandler = (type, input, ctx, state) => {
    const classType = type as TypeClass;
    const classRef = classType.classType;
    const clazz = ReflectionClass.from(classRef);
    const members = resolveTypeMembers(classType);

    // Check for embedded annotation
    const embedded = embeddedAnnotation.getFirst(classType);
    if (embedded) {
        const properties = members.filter(isPropertyMemberType) as (TypeProperty | TypePropertySignature)[];

        // Single-property embedded (regardless of prefix) used directly: accept raw value
        // The prefix setting only matters when embedded as property of another type
        if (properties.length === 1) {
            const prop = properties[0];
            const propName = memberNameToString(prop.name);
            const propType = prop.type;

            // Convert the input value to the property type
            const converted = state.forProperty(propName).build(propType, input);

            // Create class instance with the converted value
            const ctorProps = getDeepConstructorProperties(classType);
            if (ctorProps.length > 0 && ctorProps.some(p => memberNameToString(p.name) === propName)) {
                // Constructor takes the property as argument
                return ctx.newExpr(classRef, converted);
            } else {
                // Create instance and set property
                const instance = ctx.let(ctx.newExpr(classRef));
                ctx.set(instance, propName, converted);
                return instance;
            }
        }

        if (embedded.prefix !== undefined && embedded.prefix !== '') {
            // Multi-property embedded with non-empty prefix: read from prefixed input keys
            const prefix = embedded.prefix;
            const result = ctx.var_<any>(undefined);

            const ctorProps = getDeepConstructorProperties(classType);
            if (ctorProps.length > 0) {
                // Constructor takes arguments
                const args: Slot[] = [];
                for (const ctorProp of ctorProps) {
                    const subPropName = memberNameToString(ctorProp.name);
                    const serializedSubName =
                        state.namingStrategy.getPropertyName(ctorProp, state.serializer.name) || subPropName;
                    const prefixedName = prefix + serializedSubName;
                    const propInput = input.get(prefixedName);
                    args.push(state.forProperty(subPropName).build(ctorProp.type, propInput));
                }
                ctx.setVar(result, ctx.newExpr(classRef, ...args));
            } else {
                // No constructor - create instance and assign
                const instance = ctx.let(ctx.newExpr(classRef));
                for (const prop of properties) {
                    const subPropName = memberNameToString(prop.name);
                    const serializedSubName =
                        state.namingStrategy.getPropertyName(prop, state.serializer.name) || subPropName;
                    const prefixedName = prefix + serializedSubName;
                    const propInput = input.get(prefixedName);
                    ctx.set(instance, subPropName, state.forProperty(subPropName).build(prop.type, propInput));
                }
                ctx.setVar(result, instance);
            }

            return ctx.getVar(result);
        }
    }

    // Track which properties are handled by constructor
    const constructorPropNames = new Set<string>();

    // Collect explicit property names and detect index signature
    const explicitProps = new Set<string>();
    let indexSignature: TypeIndexSignature | undefined;

    // Collect embedded properties with prefix for special handling
    interface EmbeddedPropInfo {
        memberType: TypeProperty | TypePropertySignature;
        propName: string;
        embeddedType: TypeClass | TypeObjectLiteral;
        prefix: string;
    }
    const embeddedProps: EmbeddedPropInfo[] = [];
    const embeddedPropNames = new Set<string>();

    for (const member of members) {
        if (member.kind === ReflectionKind.indexSignature) {
            indexSignature = member;
            continue;
        }
        if (isPropertyMemberType(member)) {
            const propName = memberNameToString((member as TypeProperty | TypePropertySignature).name);
            explicitProps.add(propName);

            // Check for embedded type
            const memberType = member as TypeProperty | TypePropertySignature;
            const propType = memberType.type;
            const embeddedInfo = embeddedAnnotation.getFirst(propType);
            if (
                embeddedInfo &&
                (propType.kind === ReflectionKind.class || propType.kind === ReflectionKind.objectLiteral)
            ) {
                const embeddedType = propType as TypeClass | TypeObjectLiteral;
                const embeddedMembers = resolveTypeMembers(embeddedType);
                const embeddedProperties = embeddedMembers.filter(isPropertyMemberType) as (
                    | TypeProperty
                    | TypePropertySignature
                )[];

                // Flattening rules:
                // - Single-property with no prefix: normal handling (not flattened)
                // - Single-property with prefix: flatten with explicit prefix
                // - Multi-property with no prefix: flatten with property name + '_' as default prefix
                // - Multi-property with prefix: flatten with explicit prefix
                const isSingleProp = embeddedProperties.length === 1;
                const hasExplicitPrefix = embeddedInfo.prefix !== undefined;

                if (hasExplicitPrefix || !isSingleProp) {
                    const prefix = embeddedInfo.prefix !== undefined ? embeddedInfo.prefix : propName + '_';
                    embeddedProps.push({
                        memberType,
                        propName,
                        embeddedType,
                        prefix,
                    });
                    embeddedPropNames.add(propName);
                }
            }
        }
    }

    // Helper function to process embedded properties with prefix on a result object
    const processEmbeddedProps = (result: Slot<any>): void => {
        for (const embProp of embeddedProps) {
            const { memberType, propName, embeddedType, prefix } = embProp;
            const embeddedMembers = resolveTypeMembers(embeddedType);
            const isOpt = isOptional(memberType);

            // Collect all prefixed property names that need to be read
            const prefixedNames = collectPrefixedPropertyNames(embeddedMembers, prefix, state);

            const buildEmbedded = () => {
                if (embeddedType.kind === ReflectionKind.class) {
                    const ctorProps = getDeepConstructorProperties(embeddedType);
                    if (ctorProps.length > 0) {
                        // Constructor takes arguments
                        const args: Slot[] = [];
                        for (const ctorProp of ctorProps) {
                            const subPropName = memberNameToString(ctorProp.name);
                            const serializedName =
                                state.namingStrategy.getPropertyName(ctorProp, state.serializer.name) || subPropName;
                            const prefixedName = prefix + serializedName;
                            const propInput = input.get(prefixedName);
                            args.push(state.forProperty(subPropName).build(ctorProp.type, propInput));
                        }
                        ctx.set(result, propName, ctx.newExpr(embeddedType.classType, ...args));
                    } else {
                        // No constructor - create instance and assign
                        const instance = ctx.let(ctx.newExpr(embeddedType.classType));
                        for (const m of embeddedMembers) {
                            if (!isPropertyMemberType(m)) continue;
                            const mProp = m as TypeProperty | TypePropertySignature;
                            const subPropName = memberNameToString(mProp.name);
                            const serializedName =
                                state.namingStrategy.getPropertyName(mProp, state.serializer.name) || subPropName;
                            const prefixedName = prefix + serializedName;
                            const propInput = input.get(prefixedName);
                            ctx.set(instance, subPropName, state.forProperty(subPropName).build(mProp.type, propInput));
                        }
                        ctx.set(result, propName, instance);
                    }
                } else {
                    // Object literal
                    const obj = ctx.let(ctx.objExpr());
                    for (const m of embeddedMembers) {
                        if (!isPropertyMemberType(m)) continue;
                        const mProp = m as TypeProperty | TypePropertySignature;
                        const subPropName = memberNameToString(mProp.name);
                        const serializedName =
                            state.namingStrategy.getPropertyName(mProp, state.serializer.name) || subPropName;
                        const prefixedName = prefix + serializedName;
                        const propInput = input.get(prefixedName);
                        ctx.set(obj, subPropName, state.forProperty(subPropName).build(mProp.type, propInput));
                    }
                    ctx.set(result, propName, obj);
                }
            };

            if (isOpt && prefixedNames.length > 0) {
                // Optional embedded - only build if at least one prefixed key has a defined value
                const hasAny = ctx.callExpr(
                    (obj: any, keys: string[]) => keys.some(k => k in obj && obj[k] !== undefined),
                    input,
                    ctx.lit(prefixedNames),
                );
                ctx.when(hasAny, buildEmbedded);
            } else {
                buildEmbedded();
            }
        }
    };

    // Helper function to process index signature properties on a result object
    const processIndexSignatureOnResult = (result: Slot<any>): void => {
        if (!indexSignature) return;

        const valueType = indexSignature.type;
        const valueAllowsNull = isNullable(indexSignature) || isOptional(indexSignature);
        const indexType = indexSignature.index;

        const processIndexSignature = (
            inputObj: any,
            resultObj: any,
            explicitKeys: Set<string>,
            valueTypeArg: Type,
            stateArg: BuildStateBase,
            valueAllowsNullArg: boolean,
            indexTypeArg: Type,
            reflectionKind: typeof ReflectionKind,
            extendTemplateLiteralFn: typeof extendTemplateLiteral,
        ): number => {
            for (const key of Object.keys(inputObj)) {
                if (explicitKeys.has(key)) continue;

                // Check if key matches the index signature pattern
                if (indexTypeArg.kind === reflectionKind.templateLiteral) {
                    // For template literal index signatures, check if key matches the pattern
                    const keyLiteral = { kind: reflectionKind.literal, literal: key } as any;
                    if (!extendTemplateLiteralFn(keyLiteral, indexTypeArg as any)) {
                        // Key doesn't match template pattern - set to undefined
                        resultObj[key] = undefined;
                        continue;
                    }
                } else if (indexTypeArg.kind === reflectionKind.number) {
                    // For number index signatures, check if key is numeric
                    const numKey = Number(key);
                    if (isNaN(numKey) || key === '') {
                        // Key is not numeric - set to undefined
                        resultObj[key] = undefined;
                        continue;
                    }
                }
                // For string index signatures, all keys match

                const value = inputObj[key];
                if (value === undefined) {
                    if (valueAllowsNullArg) {
                        resultObj[key] = null;
                    }
                } else if (value !== null || valueAllowsNullArg) {
                    const serializer = (stateArg as any).serializer;
                    const fn = serializer.buildDeserializer(valueTypeArg);
                    resultObj[key] = fn(value, {});
                }
            }
            return 0; // Return value forces the call to be emitted
        };

        // Use ctx.let() to force the call to be emitted in generated code
        ctx.let(
            ctx.callExpr(
                processIndexSignature,
                input,
                result,
                ctx.lit(explicitProps),
                ctx.lit(valueType),
                ctx.lit(state),
                ctx.lit(valueAllowsNull),
                ctx.lit(indexType),
                ctx.lit(ReflectionKind),
                ctx.lit(extendTemplateLiteral),
            ),
        );
    };

    // Check if constructor should be disabled
    if (clazz.disableConstructor) {
        // Use Object.create() to bypass constructor
        const createInstance = (cls: { prototype: any }) => Object.create(cls.prototype);
        const result = ctx.let(ctx.callExpr(createInstance, ctx.lit(classRef)));

        // Apply default values for properties with defaults
        for (const property of clazz.getProperties()) {
            const prop = property.property;
            if (prop.kind === ReflectionKind.property && prop.default !== undefined) {
                const defaultFn = prop.default;
                const propNameStr = property.getName();
                const applyDefault = (obj: any, fn: () => any, name: string): number => {
                    obj[name] = fn.apply(obj);
                    return 0;
                };
                // Use ctx.let() to force the call to be emitted in generated code
                ctx.let(ctx.callExpr(applyDefault, result, ctx.lit(defaultFn), ctx.lit(propNameStr)));
            }
        }

        // Set properties from input (skip embedded props with prefix)
        for (const member of members) {
            if (!isPropertyMemberType(member)) continue;
            const memberType = member as TypeProperty | TypePropertySignature;
            const propName = memberNameToString(memberType.name);
            if (embeddedPropNames.has(propName)) continue; // Skip embedded with prefix
            const serializedName = state.namingStrategy.getPropertyName(memberType, state.serializer.name);
            if (!serializedName) continue;
            const excluded = excludedAnnotation.getAnnotations(memberType.type);
            if (excluded.includes('*') || excluded.includes(state.serializer.name)) continue;
            const propType = memberType.type;
            const propInput = input.get(serializedName);
            ctx.when(
                ctx.has(input, serializedName),
                () => {
                    ctx.when(
                        ctx.not(ctx.isNullish(propInput)),
                        () => {
                            ctx.set(result, propName, state.build(propType, propInput));
                        },
                        () => {
                            // When deserializing null, set the appropriate "no value" representation
                            if (isNullable(memberType)) {
                                ctx.set(result, propName, ctx.lit(null));
                            } else if (isOptional(memberType)) {
                                ctx.set(result, propName, ctx.lit(undefined));
                            }
                        },
                    );
                },
                () => {
                    // Handle missing properties - set nullable to null (overrides class default)
                    if (isNullable(memberType)) {
                        ctx.set(result, propName, ctx.lit(null));
                    }
                },
            );
        }

        // Process embedded properties with prefix
        processEmbeddedProps(result);

        // Process index signature properties
        processIndexSignatureOnResult(result);

        return result;
    }

    // Get constructor properties
    const constructorInfo = clazz.getConstructorOrUndefined();

    if (constructorInfo) {
        // Build constructor arguments
        const constructorArgs: Slot<any>[] = [];
        const parameters = constructorInfo.getParameters();
        const deepConstructorProps = getDeepConstructorProperties(classType);
        for (const prop of deepConstructorProps) {
            constructorPropNames.add(String(prop.name));
        }

        for (const param of parameters) {
            if (!param.isProperty()) {
                constructorArgs.push(ctx.lit(undefined));
                continue;
            }

            const property = clazz.getPropertyOrUndefined(param.getName());
            if (!property) {
                constructorArgs.push(ctx.lit(undefined));
                continue;
            }

            if (property.isSerializerExcluded(state.serializer.name)) {
                constructorArgs.push(ctx.lit(undefined));
                continue;
            }

            // Check if this constructor parameter is an embedded type with prefix
            const paramEmbedded = embeddedAnnotation.getFirst(property.type);
            const propType = property.type;
            if (
                paramEmbedded &&
                (propType.kind === ReflectionKind.class || propType.kind === ReflectionKind.objectLiteral)
            ) {
                const embeddedType = propType as TypeClass | TypeObjectLiteral;
                const embeddedMembers = resolveTypeMembers(embeddedType);
                const embeddedProperties = embeddedMembers.filter(isPropertyMemberType) as (
                    | TypeProperty
                    | TypePropertySignature
                )[];

                // Flattening rules:
                // - Single-property with no prefix: normal handling (not flattened)
                // - Single-property with prefix: flatten with explicit prefix
                // - Multi-property with no prefix: flatten with property name + '_' as default prefix
                // - Multi-property with prefix: flatten with explicit prefix
                const isSingleProp = embeddedProperties.length === 1;
                const hasExplicitPrefix = paramEmbedded.prefix !== undefined;

                if (hasExplicitPrefix || !isSingleProp) {
                    const prefix = paramEmbedded.prefix !== undefined ? paramEmbedded.prefix : param.getName() + '_';

                    // Collect prefixed keys for optional check
                    const prefixedKeys = collectPrefixedPropertyNames(embeddedMembers, prefix, state);

                    const argValue = ctx.var_<any>(ctx.lit(undefined));

                    const buildEmbeddedArg = () => {
                        if (propType.kind === ReflectionKind.class) {
                            const embClass = propType as TypeClass;
                            const ctorProps = getDeepConstructorProperties(embClass);
                            if (ctorProps.length > 0) {
                                const args: Slot[] = [];
                                for (const ctorProp of ctorProps) {
                                    const subPropName = memberNameToString(ctorProp.name);
                                    const serializedName =
                                        state.namingStrategy.getPropertyName(ctorProp, state.serializer.name) ||
                                        subPropName;
                                    const prefixedName = prefix + serializedName;
                                    const propInput = input.get(prefixedName);
                                    args.push(state.forProperty(subPropName).build(ctorProp.type, propInput));
                                }
                                ctx.setVar(argValue, ctx.newExpr(embClass.classType, ...args));
                            } else {
                                const instance = ctx.let(ctx.newExpr(embClass.classType));
                                for (const m of embeddedMembers) {
                                    if (!isPropertyMemberType(m)) continue;
                                    const mProp = m as TypeProperty | TypePropertySignature;
                                    const subPropName = memberNameToString(mProp.name);
                                    const serializedName =
                                        state.namingStrategy.getPropertyName(mProp, state.serializer.name) ||
                                        subPropName;
                                    const prefixedName = prefix + serializedName;
                                    const propInput = input.get(prefixedName);
                                    ctx.set(
                                        instance,
                                        subPropName,
                                        state.forProperty(subPropName).build(mProp.type, propInput),
                                    );
                                }
                                ctx.setVar(argValue, instance);
                            }
                        } else {
                            const obj = ctx.let(ctx.objExpr());
                            for (const m of embeddedMembers) {
                                if (!isPropertyMemberType(m)) continue;
                                const mProp = m as TypeProperty | TypePropertySignature;
                                const subPropName = memberNameToString(mProp.name);
                                const serializedName =
                                    state.namingStrategy.getPropertyName(mProp, state.serializer.name) || subPropName;
                                const prefixedName = prefix + serializedName;
                                const propInput = input.get(prefixedName);
                                ctx.set(obj, subPropName, state.forProperty(subPropName).build(mProp.type, propInput));
                            }
                            ctx.setVar(argValue, obj);
                        }
                    };

                    const isOpt = isOptional(property.property);
                    if (isOpt && prefixedKeys.length > 0) {
                        const hasAny = ctx.callExpr(
                            (obj: any, keys: string[]) => keys.some(k => k in obj && obj[k] !== undefined),
                            input,
                            ctx.lit(prefixedKeys),
                        );
                        ctx.when(hasAny, buildEmbeddedArg);
                    } else {
                        buildEmbeddedArg();
                    }

                    constructorArgs.push(ctx.getVar(argValue));
                    continue;
                }
            }

            const serializedName = state.namingStrategy.getPropertyName(property.property, state.serializer.name);
            const inputKey = serializedName || param.getName();
            const propInput = input.get(inputKey);

            // Build the argument value using a mutable cell
            const argValue = ctx.var_(ctx.lit(undefined));
            ctx.when(ctx.has(input, inputKey), () => {
                ctx.when(
                    ctx.not(ctx.isNullish(propInput)),
                    () => {
                        ctx.setVar(argValue, state.build(property.type, propInput));
                    },
                    () => {
                        if (isNullable(property.property)) {
                            ctx.setVar(argValue, ctx.lit(null));
                        }
                    },
                );
            });

            constructorArgs.push(ctx.getVar(argValue));
        }

        // Create instance using constructor
        const result = ctx.let(ctx.newExpr(classRef, ...constructorArgs));

        // Set non-constructor properties (skip embedded props with prefix)
        for (const member of members) {
            if (!isPropertyMemberType(member)) continue;
            const memberType = member as TypeProperty | TypePropertySignature;
            const propName = memberNameToString(memberType.name);
            if (constructorPropNames.has(propName)) continue;
            if (embeddedPropNames.has(propName)) continue; // Skip embedded with prefix
            const serializedName = state.namingStrategy.getPropertyName(memberType, state.serializer.name);
            if (!serializedName) continue;
            const excluded = excludedAnnotation.getAnnotations(memberType.type);
            if (excluded.includes('*') || excluded.includes(state.serializer.name)) continue;
            const propType = memberType.type;
            const propInput = input.get(serializedName);
            ctx.when(
                ctx.has(input, serializedName),
                () => {
                    ctx.when(
                        ctx.not(ctx.isNullish(propInput)),
                        () => {
                            ctx.set(result, propName, state.build(propType, propInput));
                        },
                        () => {
                            // When deserializing null, set the appropriate "no value" representation
                            if (isNullable(memberType)) {
                                ctx.set(result, propName, ctx.lit(null));
                            } else if (isOptional(memberType)) {
                                ctx.set(result, propName, ctx.lit(undefined));
                            }
                        },
                    );
                },
                () => {
                    // Handle missing properties - set nullable to null (overrides class default)
                    if (isNullable(memberType)) {
                        ctx.set(result, propName, ctx.lit(null));
                    }
                },
            );
        }

        // Process embedded properties with prefix
        processEmbeddedProps(result);

        // Process index signature properties
        processIndexSignatureOnResult(result);

        return result;
    }

    // No constructor - use simple new classRef()
    const result = ctx.let(ctx.newExpr(classRef));

    // Set all properties (skip embedded props with prefix)
    for (const member of members) {
        if (!isPropertyMemberType(member)) continue;
        const memberType = member as TypeProperty | TypePropertySignature;
        const propName = memberNameToString(memberType.name);
        if (embeddedPropNames.has(propName)) continue; // Skip embedded with prefix
        const serializedName = state.namingStrategy.getPropertyName(memberType, state.serializer.name);
        if (!serializedName) continue;
        const excluded = excludedAnnotation.getAnnotations(memberType.type);
        if (excluded.includes('*') || excluded.includes(state.serializer.name)) continue;
        const propType = memberType.type;
        const propInput = input.get(serializedName);
        ctx.when(
            ctx.has(input, serializedName),
            () => {
                ctx.when(
                    ctx.not(ctx.isNullish(propInput)),
                    () => {
                        ctx.set(result, propName, state.build(propType, propInput));
                    },
                    () => {
                        // When deserializing null, set the appropriate "no value" representation
                        if (isNullable(memberType)) {
                            ctx.set(result, propName, ctx.lit(null));
                        } else if (isOptional(memberType)) {
                            ctx.set(result, propName, ctx.lit(undefined));
                        }
                    },
                );
            },
            () => {
                // Handle missing properties - set nullable to null (overrides class default)
                if (isNullable(memberType)) {
                    ctx.set(result, propName, ctx.lit(null));
                }
            },
        );
    }

    // Process embedded properties with prefix
    processEmbeddedProps(result);

    // Process index signature properties
    processIndexSignatureOnResult(result);

    return result;
};

const serializeDate: TypeHandler = (type, input, ctx, state) => {
    // Handle undefined/null values - return as-is
    return ctx.ternary(
        ctx.or(ctx.eq(input, ctx.lit(undefined)), ctx.isNull(input)),
        input,
        ctx.callExpr((d: Date) => d.toISOString(), input),
    );
};
const deserializeDate: TypeHandler = (type, input, ctx, state) => ctx.newExpr(Date, input);

// RegExp serialization - use literal string form (e.g. "/abc/i")
const serializeRegExp: TypeHandler = (type, input, ctx, state) => ctx.callExpr((r: RegExp) => r.toString(), input);

const deserializeRegExp: TypeHandler = (type, input, ctx, state) =>
    ctx.callExpr((v: any) => {
        if (v instanceof RegExp) return v;
        if (v && typeof v === 'object' && '$regex' in v) {
            return new RegExp(v.$regex, v.$options || '');
        }
        if (typeof v === 'string') {
            if (v.startsWith('/') && v.length > 1) {
                const lastSlash = v.lastIndexOf('/');
                if (lastSlash > 0) {
                    const pattern = v.slice(1, lastSlash);
                    const flags = v.slice(lastSlash + 1);
                    return new RegExp(pattern, flags);
                }
            }
            return new RegExp(v);
        }
        return v;
    }, input);

const serializeSet: TypeHandler = (type, input, ctx, state) => {
    const classType = type as TypeClass;
    const elementType = classType.arguments?.[0] || { kind: ReflectionKind.any };
    const arr = ctx.callExpr((s: Set<any>) => [...s], input);
    if (elementType.kind === ReflectionKind.any) return arr;
    return ctx.map(arr, (elem, idx) => state.build(elementType, elem));
};

const deserializeSet: TypeHandler = (type, input, ctx, state) => {
    const classType = type as TypeClass;
    const elementType = classType.arguments?.[0] || { kind: ReflectionKind.any };
    if (elementType.kind === ReflectionKind.any) return ctx.newExpr(Set, input);
    const deserializedArr = ctx.map(input, (elem, idx) => state.build(elementType, elem));
    return ctx.newExpr(Set, deserializedArr);
};

const serializeMap: TypeHandler = (type, input, ctx, state) => {
    const classType = type as TypeClass;
    const keyType = classType.arguments?.[0] || { kind: ReflectionKind.any };
    const valueType = classType.arguments?.[1] || { kind: ReflectionKind.any };
    const entries = ctx.callExpr((m: Map<any, any>) => [...m.entries()], input);
    if (keyType.kind === ReflectionKind.any && valueType.kind === ReflectionKind.any) return entries;
    return ctx.map(entries, (entry, idx) => {
        const key = entry.at(0);
        const value = entry.at(1);
        const serializedKey = keyType.kind === ReflectionKind.any ? key : state.build(keyType, key);
        const serializedValue = valueType.kind === ReflectionKind.any ? value : state.build(valueType, value);
        return ctx.callExpr((k: any, v: any) => [k, v], serializedKey, serializedValue);
    });
};

const deserializeMap: TypeHandler = (type, input, ctx, state) => {
    const classType = type as TypeClass;
    const keyType = classType.arguments?.[0] || { kind: ReflectionKind.any };
    const valueType = classType.arguments?.[1] || { kind: ReflectionKind.any };
    if (keyType.kind === ReflectionKind.any && valueType.kind === ReflectionKind.any) return ctx.newExpr(Map, input);
    const deserializedEntries = ctx.map(input, (entry, idx) => {
        const key = entry.at(0);
        const value = entry.at(1);
        const deserializedKey = keyType.kind === ReflectionKind.any ? key : state.build(keyType, key);
        const deserializedValue = valueType.kind === ReflectionKind.any ? value : state.build(valueType, value);
        return ctx.callExpr((k: any, v: any) => [k, v], deserializedKey, deserializedValue);
    });
    return ctx.newExpr(Map, deserializedEntries);
};

// Binary type handlers (TypedArray and ArrayBuffer)
const serializeTypedArray: TypeHandler = (type, input, ctx, state) => {
    // Convert TypedArray to Base64 string
    return ctx.callExpr(typedArrayToBase64, input);
};

const serializeArrayBuffer: TypeHandler = (type, input, ctx, state) => {
    // Convert ArrayBuffer to Base64 string
    return ctx.callExpr(arrayBufferToBase64, input);
};

const deserializeTypedArray: TypeHandler = (type, input, ctx, state) => {
    const classType = (type as TypeClass).classType;
    // If already the correct type, return as-is; otherwise convert from Base64
    const result = ctx.var_<any>(undefined);
    ctx.when(
        ctx.isInstance(input, classType),
        () => ctx.setVar(result, input),
        () => ctx.setVar(result, ctx.callExpr(base64ToTypedArray, input, ctx.lit(classType))),
    );
    return ctx.getVar(result);
};

const deserializeArrayBuffer: TypeHandler = (type, input, ctx, state) => {
    // If already ArrayBuffer, return as-is; otherwise convert from Base64
    const result = ctx.var_<any>(undefined);
    ctx.when(
        ctx.isInstance(input, ArrayBuffer),
        () => ctx.setVar(result, input),
        () => ctx.setVar(result, ctx.callExpr(base64ToArrayBuffer, input)),
    );
    return ctx.getVar(result);
};

// Type Guards for binary types
const guardTypedArray: TypeHandler = (type, input, ctx, state) => {
    const classType = (type as TypeClass).classType;
    return guardWithError(ctx, state, input, ctx.isInstance(input, classType), 'type', 'Not a ' + classType.name);
};

const guardTypedArrayLoose: TypeHandler = (type, input, ctx, state) => {
    // Accept string (Base64) for loose mode
    return guardWithError(ctx, state, input, ctx.isType(input, 'string'), 'type', 'Not a string');
};

// Type Guards (using factory-generated pairs where applicable)
const guardStringExact = stringGuards.score;

/**
 * Range limits for integer number brands.
 */
const integerRanges: Record<number, [number, number]> = {
    [TypeNumberBrand.int8]: [-128, 127],
    [TypeNumberBrand.int16]: [-32768, 32767],
    [TypeNumberBrand.int32]: [-2147483648, 2147483647],
    [TypeNumberBrand.uint8]: [0, 255],
    [TypeNumberBrand.uint16]: [0, 65535],
    [TypeNumberBrand.uint32]: [0, 4294967295],
};

/**
 * Range limits for float number brands.
 * Note: Using 3.40282347e38 to match JS precision quirks in tests.
 */
const float32Max = 3.40282347e38;

const guardBooleanExact = booleanGuards.score;
const guardBigIntExact = bigIntGuards.score;
const guardNull = nullGuards.score;
const guardUndefined = undefinedGuards.score;
const guardAny = anyGuards.score;

const guardLiteral: TypeHandler = (type, input, ctx, state) =>
    guardWithError(ctx, state, input, ctx.eq(input, ctx.lit((type as TypeLiteral).literal)), 'type', 'Invalid literal');

// Unified enum guard - returns score for type guards, used by both score and fast variants
const enumGuards = {
    score: ((type: Type, input: Slot, ctx: Context, state: BuildStateBase) => {
        const enumType = type as TypeEnum;
        const valuesSet = new Set(enumType.values);
        const isValid = ctx.callExpr((set: Set<any>, v: any) => set.has(v), ctx.lit(valuesSet), input);
        return guardWithError(ctx, state, input, isValid, 'type', 'Invalid enum member');
    }) as TypeHandler,
    fast: ((type: Type, input: Slot, ctx: Context, state: BuildStateBase) => {
        const enumType = type as TypeEnum;
        const valuesSet = new Set(enumType.values);
        return ctx.callExpr((set: Set<any>, v: any) => set.has(v), ctx.lit(valuesSet), input);
    }) as TypeHandler,
};

const guardEnum = enumGuards.score;

function getTypeMismatchMessage(type: Type): string {
    switch (type.kind) {
        case ReflectionKind.string:
            return 'Not a string';
        case ReflectionKind.number:
            return 'Not a number';
        case ReflectionKind.boolean:
            return 'Not a boolean';
        case ReflectionKind.bigint:
            return 'Not a bigint';
        case ReflectionKind.null:
            return 'Not null';
        case ReflectionKind.undefined:
            return 'Not undefined';
        case ReflectionKind.array:
            return 'Not an array';
        case ReflectionKind.objectLiteral:
        case ReflectionKind.class:
            return 'Not an object';
        default:
            return 'Type mismatch';
    }
}

/**
 * Unified Object guards - score-based and fast (boolean) variants.
 * Used for objectLiteral and class type guards.
 */
const objectGuards = {
    /**
     * Runtime function to validate index signatures for score-based validation.
     */
    validateMultipleIndexSignatures: (
        obj: any,
        signatures: TypeIndexSignature[],
        serializer: any,
        errors: ValidationErrorItem[] | undefined,
        basePath: string,
        reflectionKind: typeof ReflectionKind,
        extendTemplateLiteralFn: typeof extendTemplateLiteral,
    ): number => {
        let valid = true;
        for (const key of Object.keys(obj)) {
            const path = basePath ? basePath + '.' + key : key;
            const numKey = Number(key);
            const isNumericKey = !isNaN(numKey) && key !== '';

            // Find the matching index signature for this key
            // Priority: 1) number (for numeric keys), 2) template literal, 3) string (fallback)
            let matchingSig: TypeIndexSignature | undefined;

            for (const sig of signatures) {
                if (sig.index.kind === reflectionKind.number) {
                    if (isNumericKey) {
                        matchingSig = sig;
                        break;
                    }
                } else if (sig.index.kind === reflectionKind.templateLiteral) {
                    const keyLiteral = { kind: reflectionKind.literal, literal: key } as any;
                    if (extendTemplateLiteralFn(keyLiteral, sig.index as any)) {
                        matchingSig = sig;
                        break;
                    }
                } else if (sig.index.kind === reflectionKind.string) {
                    if (!matchingSig) matchingSig = sig;
                }
            }

            if (!matchingSig) {
                if (obj[key] === undefined) continue;
                valid = false;
                if (errors)
                    errors.push(new ValidationErrorItem(path, 'type', 'Key does not match any index signature', key));
                continue;
            }

            const validator = serializer.buildTypeGuard(matchingSig.type, false);
            const childErrors: ValidationErrorItem[] = [];
            const isValid = validator(obj[key], { errors: childErrors });
            if (!isValid) {
                valid = false;
                for (const err of childErrors) {
                    const newErr = new ValidationErrorItem(
                        err.path ? path + '.' + err.path : path,
                        err.code,
                        err.message,
                        err.value,
                    );
                    if (errors) errors.push(newErr);
                }
            }
        }
        return valid ? 1000 : 0;
    },

    /**
     * Runtime function to call class-level validator method.
     */
    callClassValidator: (
        obj: any,
        validatorMethod: string | symbol | number,
        errors: ValidationErrorItem[] | undefined,
        basePath: string,
        validatorErrorClass: typeof ValidatorError,
        validationErrorItemClass: typeof ValidationErrorItem,
    ): void => {
        if (!obj || typeof obj[validatorMethod] !== 'function') return;
        const result = obj[validatorMethod]();
        if (result instanceof validatorErrorClass) {
            if (errors) {
                errors.push(new validationErrorItemClass(basePath, result.code, result.message, obj));
            }
        }
    },

    /**
     * Runtime function to validate index signature values with error collection.
     */
    validateIndexSignatureValue: (
        obj: any,
        key: string,
        value: any,
        signatures: TypeIndexSignature[],
        explicit: Set<string>,
        serializer: any,
        basePath: string,
        errors: ValidationErrorItem[] | undefined,
        kind: typeof ReflectionKind,
        ValidationErrorItemClass: typeof ValidationErrorItem,
        extendTemplateLiteralFn: typeof extendTemplateLiteral,
    ): boolean => {
        if (explicit.has(key)) return true;
        if (value === undefined) return true;

        const numKey = Number(key);
        const isNumericKey = !isNaN(numKey) && key !== '';

        let matchedSignature: TypeIndexSignature | undefined;
        let stringSignature: TypeIndexSignature | undefined;
        for (const sig of signatures) {
            if (sig.index.kind === kind.number && isNumericKey) {
                matchedSignature = sig;
                break;
            } else if (sig.index.kind === kind.templateLiteral) {
                const keyLiteral = { kind: kind.literal, literal: key } as any;
                if (extendTemplateLiteralFn(keyLiteral, sig.index as any)) {
                    matchedSignature = sig;
                    break;
                }
            } else if (sig.index.kind === kind.string) {
                stringSignature = sig;
            }
        }
        if (!matchedSignature) matchedSignature = stringSignature;
        if (!matchedSignature) return false;

        const valuePath = basePath ? `${basePath}.${key}` : key;
        const typeGuard = serializer.buildTypeGuard(matchedSignature.type, true);
        if (errors) {
            const tempErrors: ValidationErrorItem[] = [];
            const isValid = typeGuard(value, { errors: tempErrors });
            for (const err of tempErrors) {
                const fullPath = err.path ? `${valuePath}.${err.path}` : valuePath;
                errors.push(new ValidationErrorItemClass(fullPath, err.code, err.message, err.value));
            }
            return isValid;
        } else {
            return typeGuard(value, {});
        }
    },

    /**
     * Score-based object guard - returns 0 or 1000.
     * Used by guardReference for scoring.
     */
    score: ((type, input, ctx, state) => {
        const objType = type as TypeObjectLiteral | TypeClass;
        const members = resolveTypeMembers(objType);
        const propertyMembers: (TypeProperty | TypePropertySignature)[] = [];
        const methodMembers: (TypeMethod | TypeMethodSignature)[] = [];
        const indexSignatures: TypeIndexSignature[] = [];
        for (const member of members) {
            if (isPropertyMemberType(member)) {
                propertyMembers.push(member as TypeProperty | TypePropertySignature);
            } else if (member.kind === ReflectionKind.indexSignature) {
                indexSignatures.push(member);
            } else if (member.kind === ReflectionKind.method || member.kind === ReflectionKind.methodSignature) {
                methodMembers.push(member as TypeMethod | TypeMethodSignature);
            }
        }
        const score = ctx.var_(ctx.lit(1000));
        const errorsSlot = state.optionsSlot.get('errors' as any);
        const isObj = isPlainObject(ctx, input);
        ctx.when(
            ctx.not(isObj),
            () => {
                ctx.setVar(score, ctx.lit(0));
                ctx.when(errorsSlot, () =>
                    ctx.push(
                        errorsSlot,
                        ctx.newExpr(
                            ValidationErrorItem,
                            state.pathSlot(),
                            ctx.lit('type'),
                            ctx.lit('Not an object'),
                            input,
                        ),
                    ),
                );
            },
            () => {
                for (const member of propertyMembers) {
                    const propName = memberNameToString(member.name);
                    const propType = member.type;
                    const isOpt = isOptional(member);
                    const propInput = input.get(propName);
                    const hasProp = ctx.has(input, propName);
                    ctx.when(
                        ctx.not(hasProp),
                        () => {
                            if (!isOpt) {
                                ctx.setVar(score, ctx.lit(0));
                                ctx.when(errorsSlot, () =>
                                    ctx.push(
                                        errorsSlot,
                                        ctx.newExpr(
                                            ValidationErrorItem,
                                            state.forProperty(propName).pathSlot(),
                                            ctx.lit('type'),
                                            ctx.lit(getTypeMismatchMessage(propType)),
                                            ctx.lit(undefined),
                                        ),
                                    ),
                                );
                            }
                        },
                        () => {
                            ctx.when(
                                ctx.isNullish(propInput),
                                () => {
                                    if (!isNullable(member) && !isOpt) {
                                        ctx.setVar(score, ctx.lit(0));
                                        ctx.when(errorsSlot, () =>
                                            ctx.push(
                                                errorsSlot,
                                                ctx.newExpr(
                                                    ValidationErrorItem,
                                                    state.forProperty(propName).pathSlot(),
                                                    ctx.lit('type'),
                                                    ctx.lit(getTypeMismatchMessage(propType)),
                                                    propInput,
                                                ),
                                            ),
                                        );
                                    }
                                },
                                () => {
                                    const childState = state.forProperty(propName);
                                    const propScore = childState.build(propType, propInput);
                                    ctx.when(ctx.eq(propScore, ctx.lit(0)), () => ctx.setVar(score, ctx.lit(0)));
                                },
                            );
                        },
                    );
                }

                if (objType.kind === ReflectionKind.objectLiteral) {
                    for (const member of methodMembers) {
                        const methodName = memberNameToString(member.name);
                        const methodInput = input.get(methodName);
                        const hasMethod = ctx.has(input, methodName);

                        const funcType: TypeFunction = {
                            kind: ReflectionKind.function,
                            name: member.name,
                            parameters: member.parameters || [],
                            return: member.return || { kind: ReflectionKind.void },
                        };

                        ctx.when(hasMethod, () => {
                            const childState = state.forProperty(methodName);
                            const methodScore = childState.build(funcType, methodInput);
                            ctx.when(ctx.eq(methodScore, ctx.lit(0)), () => ctx.setVar(score, ctx.lit(0)));
                        });
                    }
                }

                if (indexSignatures.length > 0) {
                    const indexScore = ctx.callExpr(
                        objectGuards.validateMultipleIndexSignatures,
                        input,
                        ctx.lit(indexSignatures),
                        ctx.lit(state.serializer),
                        errorsSlot,
                        state.pathSlot(),
                        ctx.lit(ReflectionKind),
                        ctx.lit(extendTemplateLiteral),
                    );
                    ctx.when(ctx.eq(indexScore, ctx.lit(0)), () => ctx.setVar(score, ctx.lit(0)));
                }

                if (objType.kind === ReflectionKind.class) {
                    const reflection = ReflectionClass.from((objType as TypeClass).classType);
                    if (reflection.validationMethod) {
                        const methodName = reflection.validationMethod;
                        ctx.callExpr(
                            objectGuards.callClassValidator,
                            input,
                            ctx.lit(methodName),
                            errorsSlot,
                            state.pathSlot(),
                            ctx.lit(ValidatorError),
                            ctx.lit(ValidationErrorItem),
                        );
                    }
                }
            },
        );
        return ctx.getVar(score);
    }) as TypeHandler,

    /**
     * Fast (boolean) object guard - validates properties AND rejects unknown keys.
     * Used for isStrict<T>() / assertStrict.
     */
    fast: ((type, input, ctx, state) => {
        const objType = type as TypeObjectLiteral | TypeClass;
        const members = resolveTypeMembers(objType);

        const propNames: string[] = [];
        const explicitProps = new Set<string>();
        let hasOptional = false;
        const indexSignatures: TypeIndexSignature[] = [];
        const methods: (TypeMethod | TypeMethodSignature)[] = [];
        for (const member of members) {
            if (member.kind === ReflectionKind.indexSignature) {
                indexSignatures.push(member);
            } else if (isPropertyMemberType(member)) {
                const propName = memberNameToString(member.name);
                propNames.push(propName);
                explicitProps.add(propName);
                if (isOptional(member)) hasOptional = true;
            } else if (member.kind === ReflectionKind.method || member.kind === ReflectionKind.methodSignature) {
                methods.push(member as TypeMethod | TypeMethodSignature);
                const methodName = memberNameToString(member.name);
                propNames.push(methodName);
                explicitProps.add(methodName);
            }
        }

        const isObject = isPlainObject(ctx, input);

        // Check if we need class validation method
        let hasClassValidator = false;
        if (objType.kind === ReflectionKind.class) {
            const reflection = ReflectionClass.from((objType as TypeClass).classType);
            hasClassValidator = !!reflection.validationMethod;
        }

        // Fast path: if the type is "pure" (all properties have expression-only guards),
        // we can use direct && chaining without ctx.when() wrapper.
        // This enables V8 to better optimize the generated code.
        const canUsePurePath =
            !state.collectErrors &&
            indexSignatures.length === 0 &&
            !state.rejectUnknownKeys &&
            !hasClassValidator &&
            isPureTypeGuard(type);

        if (canUsePurePath) {
            // Build property checks with direct && chaining (pure expressions only)
            // In pure fast path: skip redundant "in" checks for required properties.
            // For primitives, typeof undefined !== "type" is false, so missing properties are caught.
            // The "in" check is only needed for error collection (to distinguish missing vs wrong type).
            let propertyCheck: Slot<boolean> = ctx.lit(true);

            for (const member of members) {
                if (!isPropertyMemberType(member)) continue;

                const propName = memberNameToString(member.name);
                const propType = member.type;
                const isOpt = isOptional(member);
                const propInput = input.get(propName);

                if (!isOpt) {
                    // Skip "in" check - type check catches missing properties
                    const childState = state.forProperty(propName);
                    const propCheck = childState.build(propType, propInput) as Slot<boolean>;
                    propertyCheck = ctx.and(propertyCheck, propCheck);
                } else {
                    // Optimized: use ctx.or() instead of var/when/setVar pattern
                    const propIsNullOrUndefined = ctx.or(ctx.eq(propInput, ctx.lit(undefined)), ctx.isNull(propInput));
                    const childState = state.forProperty(propName);
                    const propCheck = childState.build(propType, propInput) as Slot<boolean>;
                    propertyCheck = ctx.and(propertyCheck, ctx.or(propIsNullOrUndefined, propCheck));
                }
            }

            // Handle methods for object literals
            if (objType.kind === ReflectionKind.objectLiteral) {
                for (const method of methods) {
                    const methodName = memberNameToString(method.name);
                    const methodInput = input.get(methodName);
                    const isOpt = isOptional(method);

                    if (!isOpt) {
                        // Skip "in" check - type check catches missing properties
                        const childState = state.forProperty(methodName);
                        const methodCheck = childState.build(method, methodInput) as Slot<boolean>;
                        propertyCheck = ctx.and(propertyCheck, methodCheck);
                    } else {
                        const methodIsNullOrUndefined = ctx.or(
                            ctx.eq(methodInput, ctx.lit(undefined)),
                            ctx.isNull(methodInput),
                        );
                        const childState = state.forProperty(methodName);
                        const methodCheck = childState.build(method, methodInput) as Slot<boolean>;
                        propertyCheck = ctx.and(propertyCheck, ctx.or(methodIsNullOrUndefined, methodCheck));
                    }
                }
            }

            // Direct return without intermediate variable
            return ctx.and(isObject, propertyCheck);
        }

        // Standard path: uses result variable and ctx.when() for guarded property access.
        // This is needed when:
        // - collectErrors is true (need to track errors)
        // - indexSignatures exist (need post-validation loop)
        // - rejectUnknownKeys is true (need post-validation check)
        // - hasClassValidator is true (need post-validation call)
        // - Type is not pure (nested types generate statement code)
        const result = ctx.var_<boolean>(ctx.lit(false));

        if (state.collectErrors) {
            pushTypeErrorWhen(ctx, state, input, ctx.not(isObject), 'Not an object');
        }

        ctx.when(isObject, () => {
            let propertyCheck: Slot<boolean> = ctx.lit(true);

            if (state.collectErrors) {
                const propResults: Slot<boolean>[] = [];

                for (const member of members) {
                    if (!isPropertyMemberType(member)) continue;

                    const propName = memberNameToString(member.name);
                    const propType = member.type;
                    const isOpt = isOptional(member);
                    const propInput = input.get(propName);

                    if (!isOpt) {
                        const hasProp = ctx.has(input, propName);
                        const childState = state.forProperty(propName);
                        const propCheck = childState.build(propType, propInput) as Slot<boolean>;
                        const propValid = ctx.var_(ctx.and(hasProp, propCheck));
                        propResults.push(ctx.getVar(propValid));
                    } else {
                        const propIsNullOrUndefined = ctx.or(
                            ctx.eq(propInput, ctx.lit(undefined)),
                            ctx.isNull(propInput),
                        );
                        const propValid = ctx.var_<boolean>(ctx.lit(true));
                        ctx.when(ctx.not(propIsNullOrUndefined), () => {
                            const childState = state.forProperty(propName);
                            const propCheck = childState.build(propType, propInput) as Slot<boolean>;
                            ctx.setVar(propValid, propCheck);
                        });
                        propResults.push(ctx.getVar(propValid));
                    }
                }

                for (const propResult of propResults) {
                    propertyCheck = ctx.and(propertyCheck, propResult);
                }
            } else {
                for (const member of members) {
                    if (!isPropertyMemberType(member)) continue;

                    const propName = memberNameToString(member.name);
                    const propType = member.type;
                    const isOpt = isOptional(member);
                    const propInput = input.get(propName);

                    if (!isOpt) {
                        const hasProp = ctx.has(input, propName);
                        const childState = state.forProperty(propName);
                        const propCheck = childState.build(propType, propInput) as Slot<boolean>;
                        propertyCheck = ctx.and(propertyCheck, ctx.and(hasProp, propCheck));
                    } else {
                        // Optimized: use ctx.or() instead of var/when/setVar pattern
                        const propIsNullOrUndefined = ctx.or(
                            ctx.eq(propInput, ctx.lit(undefined)),
                            ctx.isNull(propInput),
                        );
                        const childState = state.forProperty(propName);
                        const propCheck = childState.build(propType, propInput) as Slot<boolean>;
                        propertyCheck = ctx.and(propertyCheck, ctx.or(propIsNullOrUndefined, propCheck));
                    }
                }
            }

            if (objType.kind === ReflectionKind.objectLiteral) {
                for (const method of methods) {
                    const methodName = memberNameToString(method.name);
                    const methodInput = input.get(methodName);
                    const isOpt = isOptional(method);

                    if (!isOpt) {
                        const hasMethod = ctx.has(input, methodName);
                        const childState = state.forProperty(methodName);
                        const methodCheck = childState.build(method, methodInput) as Slot<boolean>;
                        propertyCheck = ctx.and(propertyCheck, ctx.and(hasMethod, methodCheck));
                    } else {
                        const methodIsNullOrUndefined = ctx.or(
                            ctx.eq(methodInput, ctx.lit(undefined)),
                            ctx.isNull(methodInput),
                        );
                        const childState = state.forProperty(methodName);
                        const methodCheck = childState.build(method, methodInput) as Slot<boolean>;
                        propertyCheck = ctx.and(propertyCheck, ctx.or(methodIsNullOrUndefined, methodCheck));
                    }
                }
            }

            ctx.setVar(result, propertyCheck);
        });

        if (indexSignatures.length > 0) {
            const indexValid = ctx.var_<boolean>(ctx.lit(true));

            ctx.when(ctx.getVar(result), () => {
                const errorsSlot = state.optionsSlot.get('errors' as any);

                ctx.forIn(input, (key, value) => {
                    const keyValid = ctx.callExpr(
                        objectGuards.validateIndexSignatureValue,
                        input,
                        key,
                        value,
                        ctx.lit(indexSignatures),
                        ctx.lit(explicitProps),
                        ctx.lit(state.serializer),
                        state.pathSlot(),
                        errorsSlot,
                        ctx.lit(ReflectionKind),
                        ctx.lit(ValidationErrorItem),
                        ctx.lit(extendTemplateLiteral),
                    );
                    ctx.when(ctx.not(keyValid), () => {
                        ctx.setVar(indexValid, ctx.lit(false));
                    });
                });

                ctx.when(ctx.not(ctx.getVar(indexValid)), () => {
                    ctx.setVar(result, ctx.lit(false));
                });
            });
        }

        if (state.rejectUnknownKeys && indexSignatures.length === 0) {
            ctx.when(ctx.getVar(result), () => {
                if (!hasOptional) {
                    const keysLength = ctx.callExpr((obj: any) => Object.keys(obj).length, input);
                    ctx.when(ctx.neq(keysLength, ctx.lit(propNames.length)), () => {
                        ctx.setVar(result, ctx.lit(false));
                    });
                } else {
                    const allowedKeys = new Set(propNames);
                    const checkUnknownKeys = ctx.callExpr(
                        (obj: any, allowed: Set<string>) => {
                            for (const key of Object.keys(obj)) {
                                if (!allowed.has(key)) return false;
                            }
                            return true;
                        },
                        input,
                        ctx.lit(allowedKeys),
                    );
                    ctx.when(ctx.not(checkUnknownKeys), () => {
                        ctx.setVar(result, ctx.lit(false));
                    });
                }
            });
        }

        if (state.collectErrors && objType.kind === ReflectionKind.class && hasClassValidator) {
            const reflection = ReflectionClass.from((objType as TypeClass).classType);
            const methodName = reflection.validationMethod!;
            const errorsSlot = state.optionsSlot.get('errors' as any);
            ctx.let(
                ctx.callExpr(
                    objectGuards.callClassValidator,
                    input,
                    ctx.lit(methodName),
                    errorsSlot,
                    state.pathSlot(),
                    ctx.lit(ValidatorError),
                    ctx.lit(ValidationErrorItem),
                ),
            );
        }

        return ctx.getVar(result);
    }) as TypeHandler,
};

/**
 * Score-based object guard (alias for objectGuards.score).
 * Used by guardReference for scoring.
 */
const guardObject = objectGuards.score;
/**
 * Get the base type kind for a type (unwrapping intersections/annotations).
 * This is used to determine if a value's runtime type matches a union member's expected base type.
 */
function getBaseTypeKind(type: Type): ReflectionKind {
    // For intersection types, find the non-annotation base type
    if (type.kind === ReflectionKind.intersection) {
        for (const t of (type as any).types) {
            const kind = getBaseTypeKind(t);
            if (kind !== ReflectionKind.never) return kind;
        }
        return ReflectionKind.never;
    }
    return type.kind;
}

/**
 * Check if a value's runtime type matches a type's expected base type.
 */
function valueMatchesBaseType(value: any, type: Type): boolean {
    const baseKind = getBaseTypeKind(type);

    switch (baseKind) {
        case ReflectionKind.string:
            return typeof value === 'string';
        case ReflectionKind.number:
            return typeof value === 'number';
        case ReflectionKind.boolean:
            return typeof value === 'boolean';
        case ReflectionKind.bigint:
            return typeof value === 'bigint';
        case ReflectionKind.null:
            return value === null;
        case ReflectionKind.undefined:
            return value === undefined;
        case ReflectionKind.array:
            return Array.isArray(value);
        case ReflectionKind.objectLiteral:
        case ReflectionKind.class:
            return typeof value === 'object' && value !== null && !Array.isArray(value);
        case ReflectionKind.literal:
            return value === (type as TypeLiteral).literal;
        default:
            return true; // For complex types, let the full validator handle it
    }
}

const guardDateExact: TypeHandler = (type, input, ctx, state) =>
    guardWithError(ctx, state, input, ctx.isInstance(input, Date), 'type', 'Not a Date');

const guardRegExp: TypeHandler = (type, input, ctx, state) =>
    guardWithError(ctx, state, input, ctx.isInstance(input, RegExp), 'type', 'Not a RegExp');

// Unified function guard - shared validation logic
const functionGuards = {
    // Core validation function (returns boolean)
    check: (
        fn: any,
        expectedType: TypeFunction,
        isExtendableFn: typeof isExtendable,
        resolveRuntimeTypeFn: typeof resolveRuntimeType,
        reflectionKind: typeof ReflectionKind,
    ): boolean => {
        if (typeof fn !== 'function') return false;

        // If the value function has __type, validate against the expected type
        if ('__type' in fn) {
            const actualType = resolveRuntimeTypeFn(fn);
            if (actualType && actualType.kind === reflectionKind.function) {
                // Use isExtendable to check if actual function type extends expected type
                if (!isExtendableFn(actualType, expectedType)) {
                    return false;
                }
            }
        }
        // Functions without __type are treated as any => any, which passes
        return true;
    },
    // Validation with error message (returns { valid, errorMsg })
    checkWithError: (
        fn: any,
        expectedType: TypeFunction,
        isExtendableFn: typeof isExtendable,
        resolveRuntimeTypeFn: typeof resolveRuntimeType,
        reflectionKind: typeof ReflectionKind,
    ): { valid: boolean; errorMsg?: string } => {
        if (typeof fn !== 'function') return { valid: false, errorMsg: 'Not a function' };

        if ('__type' in fn) {
            const actualType = resolveRuntimeTypeFn(fn);
            if (actualType && actualType.kind === reflectionKind.function) {
                if (!isExtendableFn(actualType, expectedType)) {
                    return { valid: false, errorMsg: 'Function type mismatch' };
                }
            }
        }
        return { valid: true };
    },
    score: ((type: Type, input: Slot, ctx: Context, state: BuildStateBase) => {
        const funcType = type as TypeFunction;
        const errorsSlot = state.optionsSlot.get('errors' as any);

        // Runtime validator with error collection
        const validateFunction = (
            fn: any,
            expectedType: TypeFunction,
            errors: ValidationErrorItem[] | undefined,
            path: string,
            isExtendableFn: typeof isExtendable,
            resolveRuntimeTypeFn: typeof resolveRuntimeType,
            reflectionKind: typeof ReflectionKind,
        ): number => {
            const result = functionGuards.checkWithError(
                fn,
                expectedType,
                isExtendableFn,
                resolveRuntimeTypeFn,
                reflectionKind,
            );
            if (!result.valid) {
                if (errors) errors.push(new ValidationErrorItem(path, 'type', result.errorMsg!, fn));
                return 0;
            }
            return 1000;
        };

        return ctx.callExpr(
            validateFunction,
            input,
            ctx.lit(funcType),
            errorsSlot,
            state.pathSlot(),
            ctx.lit(isExtendable),
            ctx.lit(resolveRuntimeType),
            ctx.lit(ReflectionKind),
        );
    }) as TypeHandler,
    fast: ((type: Type, input: Slot, ctx: Context, state: BuildStateBase) => {
        const funcType = type as TypeFunction;
        return ctx.callExpr(
            functionGuards.check,
            input,
            ctx.lit(funcType),
            ctx.lit(isExtendable),
            ctx.lit(resolveRuntimeType),
            ctx.lit(ReflectionKind),
        );
    }) as TypeHandler,
};

const guardFunction = functionGuards.score;

// Unified template literal guard
const templateLiteralGuards = {
    // Shared validation function
    check: (v: any, t: Type): boolean => {
        if (typeof v !== 'string') return false;
        try {
            return extendTemplateLiteral({ kind: ReflectionKind.literal, literal: v }, t as TypeTemplateLiteral);
        } catch {
            return false;
        }
    },
    score: ((type: Type, input: Slot, ctx: Context, state: BuildStateBase) => {
        const isValid = ctx.callExpr(templateLiteralGuards.check, input, ctx.lit(type));
        return ctx.ternary(isValid, ctx.lit(1000), ctx.lit(0));
    }) as TypeHandler,
    fast: ((type: Type, input: Slot, ctx: Context, state: BuildStateBase) => {
        return ctx.callExpr(templateLiteralGuards.check, input, ctx.lit(type));
    }) as TypeHandler,
};

const guardTemplateLiteral = templateLiteralGuards.score;

// Unified Set guards
const setGuards = {
    // Fast validation (no error collection)
    validateFast: (set: Set<any>, elemType: Type, serializer: any): boolean => {
        for (const elem of set) {
            const validator = serializer.buildFastTypeGuard(elemType);
            if (!validator(elem)) return false;
        }
        return true;
    },
    // Score validation (with error collection)
    validateScore: (
        set: Set<any>,
        elemType: Type,
        serializer: any,
        errors: ValidationErrorItem[] | undefined,
        basePath: string,
    ): number => {
        let idx = 0;
        for (const elem of set) {
            const validator = serializer.buildTypeGuard(elemType, false);
            const childErrors: ValidationErrorItem[] = [];
            const isValid = validator(elem, { errors: childErrors });
            if (!isValid) {
                const path = basePath ? basePath + '.' + idx : String(idx);
                for (const err of childErrors) {
                    const newErr = new ValidationErrorItem(
                        err.path ? path + '.' + err.path : path,
                        err.code,
                        err.message,
                        err.value,
                    );
                    if (errors) errors.push(newErr);
                }
                return 0;
            }
            idx++;
        }
        return 1000;
    },
    score: ((type: Type, input: Slot, ctx: Context, state: BuildStateBase) => {
        const classType = type as TypeClass;
        const elementType = classType.arguments?.[0] || { kind: ReflectionKind.any };
        const errorsSlot = state.optionsSlot.get('errors' as any);
        const score = ctx.var_(ctx.lit(1000));

        ctx.when(
            ctx.not(ctx.isInstance(input, Set)),
            () => {
                ctx.setVar(score, ctx.lit(0));
                ctx.when(errorsSlot, () =>
                    ctx.push(
                        errorsSlot,
                        ctx.newExpr(
                            ValidationErrorItem,
                            state.pathSlot(),
                            ctx.lit('type'),
                            ctx.lit('Not a Set'),
                            input,
                        ),
                    ),
                );
            },
            () => {
                if (elementType.kind !== ReflectionKind.any) {
                    const elemScore = ctx.callExpr(
                        setGuards.validateScore,
                        input,
                        ctx.lit(elementType),
                        ctx.lit(state.serializer),
                        errorsSlot,
                        state.pathSlot(),
                    );
                    ctx.when(ctx.eq(elemScore, ctx.lit(0)), () => ctx.setVar(score, ctx.lit(0)));
                }
            },
        );
        return ctx.getVar(score);
    }) as TypeHandler,
    fast: ((type: Type, input: Slot, ctx: Context, state: BuildStateBase) => {
        const classType = type as TypeClass;
        const elementType = classType.arguments?.[0] || { kind: ReflectionKind.any };
        const isSet = ctx.callExpr((v: any) => v instanceof Set, input);

        if (elementType.kind === ReflectionKind.any) {
            return isSet;
        }

        const result = ctx.var_<boolean>(ctx.lit(false));
        ctx.when(isSet, () => {
            const elementsValid = ctx.callExpr(
                setGuards.validateFast,
                input,
                ctx.lit(elementType),
                ctx.lit(state.serializer),
            );
            ctx.setVar(result, elementsValid);
        });
        return ctx.getVar(result);
    }) as TypeHandler,
};

const guardSet = setGuards.score;

// Unified Map guards
const mapGuards = {
    // Fast validation (no error collection)
    validateFast: (map: Map<any, any>, kType: Type, vType: Type, serializer: any): boolean => {
        for (const [key, value] of map) {
            if (kType.kind !== ReflectionKind.any) {
                const keyValidator = serializer.buildFastTypeGuard(kType);
                if (!keyValidator(key)) return false;
            }
            if (vType.kind !== ReflectionKind.any) {
                const valueValidator = serializer.buildFastTypeGuard(vType);
                if (!valueValidator(value)) return false;
            }
        }
        return true;
    },
    // Score validation (with error collection)
    validateScore: (
        map: Map<any, any>,
        kType: Type,
        vType: Type,
        serializer: any,
        errors: ValidationErrorItem[] | undefined,
        basePath: string,
    ): number => {
        let idx = 0;
        for (const [key, value] of map) {
            const path = basePath ? basePath + '.' + idx : String(idx);
            if (kType.kind !== ReflectionKind.any) {
                const keyValidator = serializer.buildTypeGuard(kType, false);
                const keyErrors: ValidationErrorItem[] = [];
                const keyValid = keyValidator(key, { errors: keyErrors });
                if (!keyValid) {
                    for (const err of keyErrors) {
                        const newErr = new ValidationErrorItem(path + '.key', err.code, err.message, err.value);
                        if (errors) errors.push(newErr);
                    }
                    return 0;
                }
            }
            if (vType.kind !== ReflectionKind.any) {
                const valueValidator = serializer.buildTypeGuard(vType, false);
                const valueErrors: ValidationErrorItem[] = [];
                const valueValid = valueValidator(value, { errors: valueErrors });
                if (!valueValid) {
                    for (const err of valueErrors) {
                        const newErr = new ValidationErrorItem(path + '.value', err.code, err.message, err.value);
                        if (errors) errors.push(newErr);
                    }
                    return 0;
                }
            }
            idx++;
        }
        return 1000;
    },
    score: ((type: Type, input: Slot, ctx: Context, state: BuildStateBase) => {
        const classType = type as TypeClass;
        const keyType = classType.arguments?.[0] || { kind: ReflectionKind.any };
        const valueType = classType.arguments?.[1] || { kind: ReflectionKind.any };
        const errorsSlot = state.optionsSlot.get('errors' as any);
        const score = ctx.var_(ctx.lit(1000));

        ctx.when(
            ctx.not(ctx.isInstance(input, Map)),
            () => {
                ctx.setVar(score, ctx.lit(0));
                ctx.when(errorsSlot, () =>
                    ctx.push(
                        errorsSlot,
                        ctx.newExpr(
                            ValidationErrorItem,
                            state.pathSlot(),
                            ctx.lit('type'),
                            ctx.lit('Not a Map'),
                            input,
                        ),
                    ),
                );
            },
            () => {
                if (keyType.kind !== ReflectionKind.any || valueType.kind !== ReflectionKind.any) {
                    const mapScore = ctx.callExpr(
                        mapGuards.validateScore,
                        input,
                        ctx.lit(keyType),
                        ctx.lit(valueType),
                        ctx.lit(state.serializer),
                        errorsSlot,
                        state.pathSlot(),
                    );
                    ctx.when(ctx.eq(mapScore, ctx.lit(0)), () => ctx.setVar(score, ctx.lit(0)));
                }
            },
        );
        return ctx.getVar(score);
    }) as TypeHandler,
    fast: ((type: Type, input: Slot, ctx: Context, state: BuildStateBase) => {
        const classType = type as TypeClass;
        const keyType = classType.arguments?.[0] || { kind: ReflectionKind.any };
        const valueType = classType.arguments?.[1] || { kind: ReflectionKind.any };
        const isMap = ctx.callExpr((v: any) => v instanceof Map, input);

        if (keyType.kind === ReflectionKind.any && valueType.kind === ReflectionKind.any) {
            return isMap;
        }

        const result = ctx.var_<boolean>(ctx.lit(false));
        ctx.when(isMap, () => {
            const entriesValid = ctx.callExpr(
                mapGuards.validateFast,
                input,
                ctx.lit(keyType),
                ctx.lit(valueType),
                ctx.lit(state.serializer),
            );
            ctx.setVar(result, entriesValid);
        });
        return ctx.getVar(result);
    }) as TypeHandler,
};

const guardMap = mapGuards.score;

/**
 * Serialize Reference types.
 * Outputs only the primary key value, regardless of whether the input is a full object.
 */
const serializeReference: TypeHandler = (type, input, ctx, state) => {
    const classType = type as TypeClass;
    const reflection = ReflectionClass.from(classType);
    const primaryKeyProperty = reflection.getPrimary();

    if (!primaryKeyProperty) {
        // No primary key - just serialize as normal class
        return handleObjectLiteral(type, input, ctx, state);
    }

    const pkName = String(primaryKeyProperty.getName());
    const pkType = primaryKeyProperty.type;

    // Get the primary key value from the input
    const pkValue = input.get(pkName);

    // Serialize the primary key value
    return state.build(pkType, pkValue);
};

/**
 * Deserialize Reference types.
 * When a type has Reference annotation, it can accept either:
 * - A full object (deserialize as normal class)
 * - A primary key value (create a reference instance)
 */
const deserializeReference: TypeHandler = (type, input, ctx, state) => {
    const classType = type as TypeClass;
    const reflection = ReflectionClass.from(classType);
    const primaryKeyProperty = reflection.getPrimary();

    if (!primaryKeyProperty) {
        // No primary key - just deserialize as normal class
        return deserializeClass(type, input, ctx, state);
    }

    const pkName = primaryKeyProperty.getName();
    const pkType = primaryKeyProperty.type;

    // Check if input is an object or a primitive (primary key)
    const isObj = isPlainObject(ctx, input);

    // Runtime function to create reference from primary key
    const createReferenceFromPk = (
        pkValue: any,
        classRef: any,
        pkPropertyName: string,
        createReferenceFn: typeof createReference,
    ): any => {
        return createReferenceFn(classRef, { [pkPropertyName]: pkValue });
    };

    // Use ctx.when for lazy evaluation - deserializeClass contains checks like 'id' in input
    // which would fail if input is a primitive
    const result = ctx.var_<any>(undefined);

    ctx.when(
        isObj,
        () => {
            // Check if the object has only the primary key (reference shorthand like { id: 34 })
            const isPkOnlyObj = ctx.callExpr(
                (obj: any, pkProperty: string) => {
                    const keys = Object.keys(obj);
                    return keys.length === 1 && keys[0] === pkProperty;
                },
                input,
                ctx.lit(pkName),
            );
            ctx.when(
                isPkOnlyObj,
                () => {
                    // Create reference from the PK-only object
                    const pkValue = input.get(pkName);
                    ctx.setVar(
                        result,
                        ctx.callExpr(
                            createReferenceFromPk,
                            state.build(pkType, pkValue),
                            ctx.lit(classType.classType),
                            ctx.lit(pkName),
                            ctx.lit(createReference),
                        ),
                    );
                },
                () => {
                    // Deserialize as full class
                    ctx.setVar(result, deserializeClass(type, input, ctx, state));
                },
            );
        },
        () => {
            // Create reference from primitive primary key
            ctx.setVar(
                result,
                ctx.callExpr(
                    createReferenceFromPk,
                    state.build(pkType, input), // Deserialize the PK value
                    ctx.lit(classType.classType),
                    ctx.lit(pkName),
                    ctx.lit(createReference),
                ),
            );
        },
    );

    return ctx.getVar(result);
};

/**
 * Unified Reference type guards.
 * Accepts either a full object or the primary key type.
 * For reference instances (lazy-loaded) or PK-only objects like { id: 34 },
 * only validates the primary key.
 */
const referenceGuards = {
    /**
     * Runtime function to check if an object has only the primary key property.
     * Used to identify reference shorthand like { id: 34 }.
     */
    isPkOnlyObject: (obj: any, pkProperty: string): boolean => {
        const keys = Object.keys(obj);
        return keys.length === 1 && keys[0] === pkProperty;
    },

    /**
     * Score-based type guard for Reference types.
     */
    score: ((type, input, ctx, state) => {
        const classType = type as TypeClass;
        const reflection = ReflectionClass.from(classType);
        const errorsSlot = state.optionsSlot.get('errors' as any);

        // Check if the class has a primary key
        if (!reflection.getPrimaries().length) {
            // No primary key - validate as normal object
            return guardObject(type, input, ctx, state);
        }

        const primaryKeyProperty = reflection.getPrimary();
        const pkName = String(primaryKeyProperty.getName());
        const pkType = primaryKeyProperty.type;
        const score = ctx.var_(ctx.lit(0));

        // Check if input is an object
        const isObj = isPlainObject(ctx, input);

        ctx.when(
            isObj,
            () => {
                // Check if it's a reference instance (created by createReference)
                // OR an object with only the primary key property (like { id: 34 })
                // Reference instances throw when accessing non-PK properties, so we only validate the PK
                const isRef = ctx.callExpr(isReferenceInstance, input);
                // Check if object has only the primary key property (reference shorthand)
                const isPkOnlyObj = ctx.callExpr(referenceGuards.isPkOnlyObject, input, ctx.lit(pkName));
                const shouldValidatePkOnly = ctx.or(isRef, isPkOnlyObj);
                ctx.when(
                    shouldValidatePkOnly,
                    () => {
                        // For reference instances or PK-only objects, only validate the primary key
                        const pkValue = input.get(pkName);
                        const pkScore = state.build(pkType, pkValue);
                        ctx.when(
                            ctx.gt(pkScore, ctx.lit(0)),
                            () => {
                                ctx.setVar(score, ctx.lit(1000));
                            },
                            () => {
                                ctx.when(errorsSlot, () => {
                                    ctx.push(
                                        errorsSlot,
                                        ctx.newExpr(
                                            ValidationErrorItem,
                                            state.pathSlot(),
                                            ctx.lit('type'),
                                            ctx.lit('Reference has invalid primary key'),
                                            input,
                                        ),
                                    );
                                });
                            },
                        );
                    },
                    () => {
                        // If it's a regular object with more properties, validate as the class type
                        const objScore = guardObject(type, input, ctx, state);
                        ctx.setVar(score, objScore);
                    },
                );
            },
            () => {
                // Otherwise, check if it matches the primary key type
                const pkScore = state.build(pkType, input);
                ctx.when(
                    ctx.gt(pkScore, ctx.lit(0)),
                    () => {
                        ctx.setVar(score, ctx.lit(1000));
                    },
                    () => {
                        ctx.when(errorsSlot, () => {
                            ctx.push(
                                errorsSlot,
                                ctx.newExpr(
                                    ValidationErrorItem,
                                    state.pathSlot(),
                                    ctx.lit('type'),
                                    ctx.lit('Not a valid reference (expected object or primary key)'),
                                    input,
                                ),
                            );
                        });
                    },
                );
            },
        );

        return ctx.getVar(score);
    }) as TypeHandler,

    /**
     * Fast (boolean) type guard for Reference types.
     * Returns boolean directly without score calculation or error collection.
     */
    fast: ((type, input, ctx, state) => {
        const classType = type as TypeClass;
        const reflection = ReflectionClass.from(classType);

        // Check if the class has a primary key
        if (!reflection.getPrimaries().length) {
            // No primary key - validate as normal object
            return guardObjectStrict(type, input, ctx, state);
        }

        const primaryKeyProperty = reflection.getPrimary();
        const pkName = String(primaryKeyProperty.getName());
        const pkType = primaryKeyProperty.type;
        const result = ctx.var_<boolean>(ctx.lit(false));

        // Check if input is an object
        const isObj = isPlainObject(ctx, input);

        ctx.when(
            isObj,
            () => {
                // Check if it's a reference instance (lazy-loaded proxy)
                // OR an object with only the primary key property (like { id: 34 })
                // Reference instances throw when accessing non-PK properties, so only validate PK
                const isRef = ctx.callExpr(isReferenceInstance, input);
                // Check if object has only the primary key property (reference shorthand)
                const isPkOnlyObj = ctx.callExpr(referenceGuards.isPkOnlyObject, input, ctx.lit(pkName));
                const shouldValidatePkOnly = ctx.or(isRef, isPkOnlyObj);
                ctx.when(
                    shouldValidatePkOnly,
                    () => {
                        // Reference instance or PK-only object - only validate the primary key
                        const pkInput = input.get(pkName);
                        const pkCheck = state.forProperty(pkName).build(pkType, pkInput) as Slot<boolean>;
                        ctx.setVar(result, pkCheck);
                    },
                    () => {
                        // Full object - validate all properties with guardObjectStrict
                        ctx.setVar(result, guardObjectStrict(type, input, ctx, state) as Slot<boolean>);
                    },
                );
            },
            () => {
                // Not an object - check if it matches the primary key type
                const pkCheck = state.build(pkType, input) as Slot<boolean>;
                ctx.setVar(result, pkCheck);
            },
        );

        return ctx.getVar(result);
    }) as TypeHandler,
};

// Backward-compatible aliases
const guardReference = referenceGuards.score;

/**
 * Type guard for NanoId (using factory).
 */
const guardNanoId = nanoIdHandlers.guardScore;

/**
 * Type guard for UUID (using factory).
 */
const guardUUID = uuidHandlers.guardScore;

/**
 * Type guard for MongoId (using factory).
 */
const guardMongoId = mongoIdHandlers.guardScore;

/**
 * Deserialize decorator for NanoId (using factory).
 */
const deserializeNanoId = nanoIdHandlers.deserialize;

/**
 * Deserialize decorator for UUID (using factory).
 */
const deserializeUUID = uuidHandlers.deserialize;

/**
 * Deserialize decorator for MongoId (using factory).
 */
const deserializeMongoId = mongoIdHandlers.deserialize;

// ============================================================================
// Fast Type Guards (Pure && chain, no error collection)
// ============================================================================
// These guards return boolean directly without score calculation or error collection.
// Used by buildFastTypeGuard() for maximum performance type checking.

/**
 * Fast template literal type guard - uses unified template literal guard.
 */
const guardTemplateLiteralFast = templateLiteralGuards.fast;

/**
 * Fast typed array type guard - returns boolean.
 */
const guardTypedArrayFast: TypeHandler = (type, input, ctx, state) => {
    const classType = (type as TypeClass).classType;
    return ctx.isInstance(input, classType);
};

/**
 * Fast NanoId type guard (using factory).
 */
const guardNanoIdFast = nanoIdHandlers.guardFast;

/**
 * Fast UUID type guard (using factory).
 */
const guardUUIDFast = uuidHandlers.guardFast;

/**
 * Fast MongoId type guard (using factory).
 */
const guardMongoIdFast = mongoIdHandlers.guardFast;

/**
 * Fast Reference type guard - alias to referenceGuards.fast.
 */
const guardReferenceFast = referenceGuards.fast;

/**
 * Fast string type guard - returns boolean directly.
 */
const guardStringFast = stringGuards.fast;

/**
 * Unified number type guards.
 * Handles both plain numbers and branded numbers (integer, int8, float32, etc.)
 */
const numberGuards = {
    /**
     * Check if a type is a branded number (integer, int8, float32, etc.)
     */
    isBranded: (type: Type): boolean => {
        return type.kind === ReflectionKind.number && (type as TypeNumber).brand !== undefined;
    },

    /**
     * Fast number type guard - checks typeof and not NaN.
     */
    fast: ((type, input, ctx, state) =>
        ctx.and(ctx.isType(input, 'number'), ctx.not(ctx.callExpr(Number.isNaN, input)))) as TypeHandler,

    /**
     * Fast branded number type guard - checks integer constraints and range limits.
     */
    branded: ((type, input, ctx, state) => {
        const numType = type as TypeNumber;
        const brand = numType.brand;

        // Base check: must be a number and not NaN
        const isNum = ctx.and(ctx.isType(input, 'number'), ctx.not(ctx.callExpr(Number.isNaN, input)));

        if (brand === undefined) {
            return isNum;
        }

        // Integer brands: check integer and range
        if (brand < TypeNumberBrand.float) {
            const range = integerRanges[brand];
            const isInt = ctx.callExpr(Number.isInteger, input);
            if (range) {
                const [min, max] = range;
                const inRange = ctx.and(ctx.gte(input, ctx.lit(min)), ctx.lte(input, ctx.lit(max)));
                return ctx.and(isNum, ctx.and(isInt, inRange));
            } else {
                // Generic integer (no specific range)
                return ctx.and(isNum, isInt);
            }
        }

        // float32: check range
        if (brand === TypeNumberBrand.float32) {
            const inRange = ctx.and(ctx.gte(input, ctx.lit(-float32Max)), ctx.lte(input, ctx.lit(float32Max)));
            return ctx.and(isNum, inRange);
        }

        // Other float brands: just check is number
        return isNum;
    }) as TypeHandler,
};

// Backward-compatible aliases
const guardNumberFast = numberGuards.fast;
const isBrandedNumber = numberGuards.isBranded;
const guardNumberBrandedFast = numberGuards.branded;

/**
 * Fast boolean type guard.
 */
const guardBooleanFast = booleanGuards.fast;

/**
 * Fast bigint type guard.
 */
const guardBigIntFast = bigIntGuards.fast;

/**
 * Fast null type guard.
 */
const guardNullFast = nullGuards.fast;

/**
 * Fast undefined type guard.
 */
const guardUndefinedFast = undefinedGuards.fast;

/**
 * Fast any type guard - always returns true.
 */
const guardAnyFast = anyGuards.fast;

/**
 * Fast literal type guard - checks exact value equality.
 */
const guardLiteralFast: TypeHandler = (type, input, ctx, state) => {
    const literalType = type as TypeLiteral;
    return ctx.eq(input, ctx.lit(literalType.literal));
};

/**
 * Unified Union guards - fast (boolean) variant with constraint-specific error support (#577).
 * For large literal unions (>= UNION_LITERAL_THRESHOLD), uses Set.has() for O(1) lookup.
 */
const unionGuards = {
    /**
     * Runtime validation function for unions that collects specific constraint errors (#577).
     * Tries fast validation first, then collects errors from base-type-matching members.
     */
    validateUnion: (
        value: any,
        members: Type[],
        serializer: Serializer,
        errors: ValidationErrorItem[] | undefined,
        path: string,
        typeDescription: string,
        getBaseTypeKindFn: (type: Type) => ReflectionKind,
        valueMatchesBaseTypeFn: (value: any, type: Type) => boolean,
        reflectionKind: typeof ReflectionKind,
        getTypeNameFn: (t: Type) => string,
    ): boolean => {
        // First pass: try to find a member that fully validates (fast path)
        for (const member of members) {
            try {
                const validator = serializer.buildTypeGuard(member, false);
                if (validator(value, {})) return true;
            } catch {
                // Validation threw (e.g., accessing property on undefined), treat as non-match
            }
        }

        // Second pass: find members whose base type matches and collect all errors
        const matchingMemberErrors: ValidationErrorItem[] = [];
        let hasConstraintErrors = false;

        for (const member of members) {
            if (valueMatchesBaseTypeFn(value, member)) {
                const memberErrors: ValidationErrorItem[] = [];
                try {
                    const validator = serializer.buildTypeGuard(member, false);
                    validator(value, { errors: memberErrors });
                } catch {
                    continue;
                }

                const typeName = getTypeNameFn(member);

                for (const err of memberErrors) {
                    if (err.code !== 'type') {
                        hasConstraintErrors = true;
                        const fullPath = path && err.path ? path + '.' + err.path : path || err.path;
                        matchingMemberErrors.push(new ValidationErrorItem(fullPath, err.code, err.message, err.value));
                    } else if (err.path && err.path.length > 0) {
                        const prefixedPath = typeName ? typeName + '.' + err.path : err.path;
                        const fullPath = path && prefixedPath ? path + '.' + prefixedPath : path || prefixedPath;
                        matchingMemberErrors.push(new ValidationErrorItem(fullPath, err.code, err.message, err.value));
                    }
                }
            }
        }

        if (hasConstraintErrors && errors) {
            for (const err of matchingMemberErrors) {
                if (err.code !== 'type') {
                    errors.push(err);
                }
            }
            return false;
        }

        if (matchingMemberErrors.length > 0 && errors) {
            for (const err of matchingMemberErrors) {
                errors.push(err);
            }
            return false;
        }

        if (errors) {
            errors.push(
                new ValidationErrorItem(
                    path,
                    'type',
                    `Cannot convert ${stringifyValueWithType(value)} to ${typeDescription}`,
                    value,
                ),
            );
        }
        return false;
    },

    /**
     * Helper to get type name for error prefixing.
     */
    getTypeName: (t: Type): string => {
        if (t.kind === ReflectionKind.objectLiteral && (t as TypeObjectLiteral).typeName)
            return (t as TypeObjectLiteral).typeName!;
        if (t.kind === ReflectionKind.class && (t as TypeClass).classType) return (t as TypeClass).classType.name;
        return '';
    },

    /**
     * Fast (boolean) union guard - builds || chain for all members.
     * Has 3 code paths:
     * 1. Large literal union: Set.has() for O(1) lookup
     * 2. Error-collecting: uses validateUnion runtime function with constraint errors (#577)
     * 3. Non-error-collecting: builds || chain
     */
    fast: ((type, input, ctx, state) => {
        const unionType = type as TypeUnion;

        // Path 1: Large literal union optimization using Set.has()
        const isAllLiterals = unionType.types.every(t => t.kind === ReflectionKind.literal);
        if (isAllLiterals && unionType.types.length >= UNION_LITERAL_THRESHOLD) {
            const literals = unionType.types.map(t => (t as TypeLiteral).literal);
            const literalSet = new Set(literals);

            const hasCheck = ctx.callExpr((set: Set<any>, value: any) => set.has(value), ctx.lit(literalSet), input);

            if (state.collectErrors && !state.inUnionContext) {
                const errorsSlot = state.optionsSlot.get('errors' as any);
                const resultVar = ctx.var_(hasCheck);
                ctx.when(ctx.and(errorsSlot, ctx.not(ctx.getVar(resultVar))), () => {
                    const expectedType = stringifyType(type).replace(/\n/g, '').replace(/\s+/g, ' ').trim();
                    const valueStr = ctx.callExpr(stringifyValueWithType, input);
                    const errorMsg = ctx.concat(
                        ctx.lit('Cannot convert '),
                        valueStr,
                        ctx.lit(' to '),
                        ctx.lit(expectedType),
                    );
                    const errorItem = ctx.newExpr(
                        ValidationErrorItem,
                        state.pathSlot(),
                        ctx.lit('type'),
                        errorMsg,
                        input,
                    );
                    ctx.push(errorsSlot, errorItem);
                });
                return ctx.getVar(resultVar);
            }

            return hasCheck;
        }

        // Path 2: Error-collecting validation with constraint-specific errors (#577)
        if (state.collectErrors && !state.inUnionContext) {
            const errorsSlot = state.optionsSlot.get('errors' as any);
            const typeStr = stringifyType(type).replace(/\n/g, '').replace(/\s+/g, ' ').trim();

            const result = ctx.callExpr(
                unionGuards.validateUnion,
                input,
                ctx.lit(unionType.types),
                ctx.lit(state.serializer),
                errorsSlot,
                state.pathSlot(),
                ctx.lit(typeStr),
                ctx.lit(getBaseTypeKind),
                ctx.lit(valueMatchesBaseType),
                ctx.lit(ReflectionKind),
                ctx.lit(unionGuards.getTypeName),
            );

            return result;
        }

        // Path 3: Non-error-collecting fast validation - just build || chain
        const memberState = state.forUnionMember();

        let result: Slot<boolean> = ctx.lit(false);
        for (const member of unionType.types) {
            const memberCheck = memberState.build(member, input) as Slot<boolean>;
            result = ctx.or(result, memberCheck);
        }

        return result;
    }) as TypeHandler,
};

/**
 * Fast union type guard (alias for unionGuards.fast).
 */
const guardUnionFast = unionGuards.fast;

/**
 * Unified Array guards - fast (boolean) variant.
 * Checks Array.isArray and element types with proper error path tracking.
 */
const arrayGuards = {
    /**
     * Fast (boolean) array guard - checks Array.isArray and element types.
     * Uses state.forIndex() to include array index in error paths.
     */
    fast: ((type, input, ctx, state) => {
        const arrType = type as TypeArray;
        const elementType = arrType.type;

        const isArray = ctx.callExpr(Array.isArray, input);

        // Add error when input is not an array and collectErrors is enabled
        if (state.collectErrors) {
            pushTypeErrorWhen(ctx, state, input, ctx.not(isArray), 'Not an array');
        }

        // For any[] just check Array.isArray
        if (elementType.kind === ReflectionKind.any) {
            return isArray;
        }

        // For typed arrays: Array.isArray(x) && all elements match type
        // Use inline loop with state.forIndex() to include array index in error paths
        const allValid = ctx.var_<boolean>(ctx.lit(true));
        ctx.when(isArray, () => {
            ctx.loop(input, (elem, idx) => {
                const elemState = state.forIndex(idx);
                const elemCheck = elemState.build(elementType, elem) as Slot<boolean>;
                // If any element fails, set allValid to false
                ctx.when(ctx.not(elemCheck), () => {
                    ctx.setVar(allValid, ctx.lit(false));
                });
            });
        });

        return ctx.and(isArray, ctx.getVar(allValid));
    }) as TypeHandler,
};

/**
 * Strict array type guard (alias for arrayGuards.fast).
 */
const guardArrayStrict = arrayGuards.fast;

/**
 * Unified Tuple guards - fast (boolean) variant.
 * Used for tuple type guards with variable length support via rest elements.
 */
const tupleGuards = {
    /**
     * Fast (boolean) tuple guard - checks array length and element types.
     * Handles rest elements with proper index range checking.
     */
    fast: ((type, input, ctx, state) => {
        const tupleType = type as TypeTuple;

        // Must be an array
        let result: Slot<boolean> = ctx.callExpr(Array.isArray, input);

        // Find rest element position if any
        const rest = findTupleRest(tupleType);
        const restIndex = rest.index;
        const restType = rest.type;

        if (restIndex === -1) {
            // No rest element - simple case
            // Use inline state.forIndex() or forProperty() to include tuple index/name in error paths
            result = ctx.and(result, ctx.eq(ctx.len(input), ctx.lit(tupleType.types.length)));
            for (let i = 0; i < tupleType.types.length; i++) {
                const elemType = tupleType.types[i];
                const elemInput = ctx.at(input, i);
                // Use named path if element has a name, otherwise use numeric index
                const elemState = elemType.name ? state.forProperty(elemType.name) : state.forIndex(ctx.lit(i));
                const elemCheck = elemState.build(elemType.type, elemInput) as Slot<boolean>;
                result = ctx.and(result, elemCheck);
            }
        } else {
            // Has rest element - need to handle variable length
            const beforeRest = restIndex;
            const afterRest = tupleType.types.length - restIndex - 1;

            // Check minimum length
            const minLength = beforeRest + afterRest;
            result = ctx.and(result, ctx.gte(ctx.len(input), ctx.lit(minLength)));

            // Check elements before rest using inline state.build()
            for (let i = 0; i < beforeRest; i++) {
                const elemType = tupleType.types[i];
                const elemInput = ctx.at(input, i);
                const elemCheck = state.build(elemType.type, elemInput) as Slot<boolean>;
                result = ctx.and(result, elemCheck);
            }

            // Check rest elements using inline loop with state.build() for circular reference detection
            if (restType) {
                const restValid = ctx.var_<boolean>(ctx.lit(true));
                // Loop from restIndex to (arr.length - afterRest)
                ctx.loop(input, (elem, idx) => {
                    // Check if index is in rest range: idx >= restIndex && idx < arr.length - afterRest
                    const inRestRange = ctx.and(
                        ctx.gte(idx, ctx.lit(restIndex)),
                        ctx.lt(
                            idx,
                            ctx.callExpr((arr: any[], off: number) => arr.length - off, input, ctx.lit(afterRest)),
                        ),
                    );
                    ctx.when(inRestRange, () => {
                        const elemCheck = state.build(restType, elem) as Slot<boolean>;
                        ctx.when(ctx.not(elemCheck), () => {
                            ctx.setVar(restValid, ctx.lit(false));
                        });
                    });
                });
                result = ctx.and(result, ctx.getVar(restValid));
            }

            // Check elements after rest (from the end) using inline state.build()
            for (let i = 0; i < afterRest; i++) {
                const memberIdx = restIndex + 1 + i;
                const elemType = tupleType.types[memberIdx];
                // Access from end of array: arr[arr.length - (afterRest - i)]
                const offset = afterRest - i;
                const inputIdx = ctx.callExpr((arr: any[], off: number) => arr.length - off, input, ctx.lit(offset));
                const elemCheck = state.build(elemType.type, ctx.at(input, inputIdx)) as Slot<boolean>;
                result = ctx.and(result, elemCheck);
            }
        }

        return result;
    }) as TypeHandler,
};

/**
 * Strict tuple type guard (alias for tupleGuards.fast).
 */
const guardTupleStrict = tupleGuards.fast;

/**
 * Strict Object type guard (alias for objectGuards.fast).
 * Validates properties AND rejects unknown keys when state.rejectUnknownKeys is true.
 * Used for isStrict<T>() / assertStrict.
 */
const guardObjectStrict = objectGuards.fast;

/**
 * Fast Date type guard - checks instanceof Date.
 */
const guardDateFast: TypeHandler = (type, input, ctx, state) => ctx.callExpr((v: any) => v instanceof Date, input);

/**
 * Fast Set type guard - uses unified Set guards.
 */
const guardSetFast = setGuards.fast;

/**
 * Fast Map type guard - uses unified Map guards.
 */
const guardMapFast = mapGuards.fast;

/**
 * Fast RegExp type guard - checks instanceof RegExp.
 */
const guardRegExpFast: TypeHandler = (type, input, ctx, state) => ctx.callExpr((v: any) => v instanceof RegExp, input);

/**
 * Fast function type guard - uses unified function guard.
 */
const guardFunctionFast = functionGuards.fast;

/**
 * Fast enum type guard - uses unified enum guard (Set-based check).
 */
const guardEnumFast = enumGuards.fast;

/**
 * Fast tuple type guard (alias for tupleGuards.fast).
 */
const guardTupleFast = tupleGuards.fast;

// Registration
export function registerDefaultHandlers(serializer: Serializer): void {
    const serializeRegistry = serializer.serializeRegistry;
    const deserializeRegistry = serializer.deserializeRegistry;
    serializeRegistry.register(ReflectionKind.string, handleString);
    deserializeRegistry.register(ReflectionKind.string, deserializeString);
    serializeRegistry.register(ReflectionKind.number, handleNumber);
    deserializeRegistry.register(ReflectionKind.number, deserializeNumber);
    serializeRegistry.register(ReflectionKind.boolean, handleBoolean);
    deserializeRegistry.register(ReflectionKind.boolean, deserializeBoolean);
    serializeRegistry.register(ReflectionKind.bigint, handleBigInt);
    deserializeRegistry.register(ReflectionKind.bigint, deserializeBigInt);
    serializeRegistry.register(ReflectionKind.null, handleNull);
    deserializeRegistry.register(ReflectionKind.null, handleNull);
    serializeRegistry.register(ReflectionKind.undefined, serializeUndefined);
    deserializeRegistry.register(ReflectionKind.undefined, handleUndefined);
    serializeRegistry.register(ReflectionKind.any, handleAny);
    deserializeRegistry.register(ReflectionKind.any, handleAny);
    serializeRegistry.register(ReflectionKind.unknown, handleUnknown);
    deserializeRegistry.register(ReflectionKind.unknown, handleUnknown);
    serializeRegistry.register(ReflectionKind.array, handleArray);
    deserializeRegistry.register(ReflectionKind.array, handleArray);
    serializeRegistry.register(ReflectionKind.tuple, handleTuple);
    deserializeRegistry.register(ReflectionKind.tuple, handleTuple);
    serializeRegistry.register(ReflectionKind.objectLiteral, handleObjectLiteral);
    deserializeRegistry.register(ReflectionKind.objectLiteral, handleObjectLiteral);
    serializeRegistry.register(ReflectionKind.class, handleObjectLiteral);
    deserializeRegistry.register(ReflectionKind.class, deserializeClass);
    serializeRegistry.register(ReflectionKind.literal, handleLiteral);
    deserializeRegistry.register(ReflectionKind.literal, handleLiteral);
    // Note: Union handlers are registered separately via registerUnionHandler() from union.ts
    serializeRegistry.register(ReflectionKind.enum, handleEnum);
    deserializeRegistry.register(ReflectionKind.enum, deserializeEnum);
    serializeRegistry.register(ReflectionKind.promise, handlePromise);
    deserializeRegistry.register(ReflectionKind.promise, handlePromise);
    serializeRegistry.registerClass(Date, serializeDate);
    deserializeRegistry.registerClass(Date, deserializeDate);
    // RegExp has its own ReflectionKind.regexp, not ReflectionKind.class
    serializeRegistry.register(ReflectionKind.regexp, serializeRegExp);
    deserializeRegistry.register(ReflectionKind.regexp, deserializeRegExp);
    serializeRegistry.registerClass(Set, serializeSet);
    deserializeRegistry.registerClass(Set, deserializeSet);
    serializeRegistry.registerClass(Map, serializeMap);
    deserializeRegistry.registerClass(Map, deserializeMap);

    // Binary types (TypedArray and ArrayBuffer)
    // Register ArrayBuffer separately since it needs different handling
    serializeRegistry.registerClass(ArrayBuffer, serializeArrayBuffer);
    deserializeRegistry.registerClass(ArrayBuffer, deserializeArrayBuffer);

    // Register all TypedArray types (excluding ArrayBuffer which is handled above)
    for (const binaryType of binaryTypes) {
        if (binaryType === ArrayBuffer) continue;
        serializeRegistry.registerClass(binaryType, serializeTypedArray);
        deserializeRegistry.registerClass(binaryType, deserializeTypedArray);
    }

    // Reference types - decorator handler for types with Reference annotation
    serializeRegistry.addDecorator(isReferenceType, serializeReference);
    deserializeRegistry.addDecorator(isReferenceType, deserializeReference);

    // Binary BigInt types (unsigned/signed)
    serializeRegistry.addDecorator(type => getBinaryBigIntMode(type) !== undefined, serializeBinaryBigInt);
    deserializeRegistry.addDecorator(type => getBinaryBigIntMode(type) !== undefined, deserializeBinaryBigInt);

    // Special string type decorators (NanoId, UUID, MongoId)
    deserializeRegistry.addDecorator(isNanoIdType, deserializeNanoId);
    deserializeRegistry.addDecorator(isUUIDType, deserializeUUID);
    deserializeRegistry.addDecorator(isMongoIdType, deserializeMongoId);
}

/**
 * Register unified type guards for the serializer.
 * Behavior is controlled by state.collectErrors and state.rejectUnknownKeys flags.
 */
export function registerTypeGuards(serializer: Serializer): void {
    const reg = serializer.typeGuards;

    // Primitives
    reg.register(ReflectionKind.string, guardStringFast);
    reg.register(ReflectionKind.number, guardNumberFast);
    reg.register(ReflectionKind.boolean, guardBooleanFast);
    reg.register(ReflectionKind.bigint, guardBigIntFast);
    reg.register(ReflectionKind.null, guardNullFast);
    reg.register(ReflectionKind.undefined, guardUndefinedFast);
    reg.register(ReflectionKind.any, guardAnyFast);
    reg.register(ReflectionKind.literal, guardLiteralFast);

    // Compound types - use strict for objects and arrays
    reg.register(ReflectionKind.array, guardArrayStrict);
    reg.register(ReflectionKind.union, guardUnionFast);
    reg.register(ReflectionKind.objectLiteral, guardObjectStrict);
    reg.register(ReflectionKind.class, guardObjectStrict);
    reg.register(ReflectionKind.enum, guardEnumFast);
    reg.register(ReflectionKind.tuple, guardTupleStrict);
    reg.register(ReflectionKind.function, guardFunctionFast);
    reg.register(ReflectionKind.method, guardFunctionFast);
    reg.register(ReflectionKind.methodSignature, guardFunctionFast);
    reg.register(ReflectionKind.regexp, guardRegExpFast);
    reg.register(ReflectionKind.templateLiteral, guardTemplateLiteralFast);

    // Class types
    reg.registerClass(Date, guardDateFast);
    reg.registerClass(Set, guardSetFast);
    reg.registerClass(Map, guardMapFast);

    // Binary type guards
    reg.registerBinary(guardTypedArrayFast);

    // Reference type guard - decorator handler
    reg.addDecorator(isReferenceType, guardReferenceFast);

    // Branded number type guard (integer, int8, int16, etc.)
    reg.addDecorator(isBrandedNumber, guardNumberBrandedFast);

    // Special string type guards (NanoId, UUID, MongoId)
    reg.addDecorator(isNanoIdType, guardNanoIdFast);
    reg.addDecorator(isUUIDType, guardUUIDFast);
    reg.addDecorator(isMongoIdType, guardMongoIdFast);

    // Post-hook to add error messages when collectErrors is true
    reg.addPostHook((type, input, ctx, state, next) => {
        // If not collecting errors, just run the handler
        if (!state.collectErrors) {
            return next();
        }

        // If inside a union context, skip error adding - the union handler will add ONE error
        // BUT if collectUnionMemberErrors is true (#577), we need to collect errors for filtering
        if (state.inUnionContext && !state.collectUnionMemberErrors) {
            return next();
        }

        // Skip compound types that handle their own error collection:
        // - Union: handled above (adds error when all members fail)
        // - Array/Tuple: errors come from element checks with path info
        // - Object/Class (with properties): errors come from property checks with path info
        // But NOT built-in classes like Date, Set, Map which have simple type guards
        if (
            type.kind === ReflectionKind.union ||
            type.kind === ReflectionKind.array ||
            type.kind === ReflectionKind.tuple ||
            type.kind === ReflectionKind.objectLiteral
        ) {
            return next();
        }

        // For class types, only skip user-defined classes (with properties)
        // Built-in classes (Date, Set, Map, typed arrays) use simple guards that need the post-hook
        if (type.kind === ReflectionKind.class) {
            const classType = (type as TypeClass).classType;
            // Built-in classes that have simple guards and need post-hook error handling
            const builtinClasses = [Date, Set, Map, RegExp, ArrayBuffer, ...binaryTypes];
            const isBuiltinClass = builtinClasses.includes(classType);
            if (!isBuiltinClass) {
                return next();
            }
        }

        // Track error count before running the handler
        const errorsSlot = state.optionsSlot.get('errors' as any);
        const errorCountBefore = ctx.var_(ctx.ternary(errorsSlot, errorsSlot.get('length' as any), ctx.lit(0)));

        // Run the handler
        const result = next() as Slot<boolean>;

        // Only add error if:
        // 1. Validation failed (result is false)
        // 2. No errors were added by child handlers (error count unchanged)
        // This prevents duplicate errors from compound types
        ctx.when(ctx.and(errorsSlot, ctx.not(result)), () => {
            const errorCountAfter = errorsSlot.get('length' as any);
            ctx.when(ctx.eq(ctx.getVar(errorCountBefore), errorCountAfter), () => {
                // Special types with custom messages
                if (isNanoIdType(type)) {
                    const errorMsg = ctx.lit('Not a valid NanoId');
                    const errorItem = ctx.newExpr(
                        ValidationErrorItem,
                        state.pathSlot(),
                        ctx.lit('type'),
                        errorMsg,
                        input,
                    );
                    ctx.push(errorsSlot, errorItem);
                    return;
                }
                if (isUUIDType(type)) {
                    const errorMsg = ctx.lit('Not a valid UUID');
                    const errorItem = ctx.newExpr(
                        ValidationErrorItem,
                        state.pathSlot(),
                        ctx.lit('type'),
                        errorMsg,
                        input,
                    );
                    ctx.push(errorsSlot, errorItem);
                    return;
                }
                if (isMongoIdType(type)) {
                    const errorMsg = ctx.lit('Not a valid MongoId');
                    const errorItem = ctx.newExpr(
                        ValidationErrorItem,
                        state.pathSlot(),
                        ctx.lit('type'),
                        errorMsg,
                        input,
                    );
                    ctx.push(errorsSlot, errorItem);
                    return;
                }

                const expectedType = stringifyType(type).replace(/\n/g, '').replace(/\s+/g, ' ').trim();
                // Error message format depends on type:
                // - string, boolean, bigint, Date: always "Not a X"
                // - number: "Cannot convert X to number" for non-undefined values
                // - others: "Not a X" for undefined, "Cannot convert" otherwise
                const isDateType = type.kind === ReflectionKind.class && (type as TypeClass).classType === Date;
                const useSimpleMessage =
                    type.kind === ReflectionKind.string ||
                    type.kind === ReflectionKind.boolean ||
                    type.kind === ReflectionKind.bigint ||
                    isDateType;

                if (useSimpleMessage) {
                    const errorMsg = ctx.lit(`Not a ${expectedType}`);
                    const errorItem = ctx.newExpr(
                        ValidationErrorItem,
                        state.pathSlot(),
                        ctx.lit('type'),
                        errorMsg,
                        input,
                    );
                    ctx.push(errorsSlot, errorItem);
                } else if (type.kind === ReflectionKind.number) {
                    // Numbers: "Not a number" for undefined, "Cannot convert" otherwise
                    ctx.when(
                        ctx.eq(input, ctx.lit(undefined)),
                        () => {
                            const errorMsg = ctx.lit(`Not a ${expectedType}`);
                            const errorItem = ctx.newExpr(
                                ValidationErrorItem,
                                state.pathSlot(),
                                ctx.lit('type'),
                                errorMsg,
                                input,
                            );
                            ctx.push(errorsSlot, errorItem);
                        },
                        () => {
                            const valueStr = ctx.callExpr(stringifyValueWithType, input);
                            const errorMsg = ctx.concat(
                                ctx.lit('Cannot convert '),
                                valueStr,
                                ctx.lit(' to '),
                                ctx.lit(expectedType),
                            );
                            const errorItem = ctx.newExpr(
                                ValidationErrorItem,
                                state.pathSlot(),
                                ctx.lit('type'),
                                errorMsg,
                                input,
                            );
                            ctx.push(errorsSlot, errorItem);
                        },
                    );
                } else {
                    // Other types: "Not a X" for undefined, "Cannot convert" otherwise
                    ctx.when(
                        ctx.eq(input, ctx.lit(undefined)),
                        () => {
                            const errorMsg = ctx.lit(`Not a ${expectedType}`);
                            const errorItem = ctx.newExpr(
                                ValidationErrorItem,
                                state.pathSlot(),
                                ctx.lit('type'),
                                errorMsg,
                                input,
                            );
                            ctx.push(errorsSlot, errorItem);
                        },
                        () => {
                            const valueStr = ctx.callExpr(stringifyValueWithType, input);
                            const errorMsg = ctx.concat(
                                ctx.lit('Cannot convert '),
                                valueStr,
                                ctx.lit(' to '),
                                ctx.lit(expectedType),
                            );
                            const errorItem = ctx.newExpr(
                                ValidationErrorItem,
                                state.pathSlot(),
                                ctx.lit('type'),
                                errorMsg,
                                input,
                            );
                            ctx.push(errorsSlot, errorItem);
                        },
                    );
                }
            });
        });

        return result;
    });
}

// Legacy exports (deprecated, alias to registerTypeGuards)
/** @deprecated Use registerTypeGuards instead */
export const registerDefaultTypeGuards = registerTypeGuards;
/** @deprecated Use registerTypeGuards instead */
export const registerFastTypeGuards = registerTypeGuards;
/** @deprecated Use registerTypeGuards instead */
export const registerStrictTypeGuards = registerTypeGuards;
