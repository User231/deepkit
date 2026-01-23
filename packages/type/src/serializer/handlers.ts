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
    const result = ctx.var_<any[]>(ctx.arrExpr());
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
    let restIndex = -1;
    let restType: Type | undefined;
    for (let i = 0; i < tupleType.types.length; i++) {
        const member = tupleType.types[i];
        if (member.type.kind === ReflectionKind.rest) {
            restIndex = i;
            restType = (member.type as any).type;
            break;
        }
    }

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
            ): void => {
                const restEnd = inputArr.length - afterCount;
                for (let j = restIdx; j < restEnd; j++) {
                    // Build each rest element - need to serialize at runtime
                    const serializer = (st as any).serializer;
                    const direction = (st as any).direction;
                    const fn =
                        direction === 'serialize' ? serializer.buildSerializer(rt) : serializer.buildDeserializer(rt);
                    resultArr.push(fn(inputArr[j], {}));
                }
            };
            ctx.callExpr(
                processRest,
                input,
                result,
                ctx.lit(restIndex),
                ctx.lit(afterRest),
                ctx.lit(restType),
                ctx.lit(state),
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
        // For multi-property embedded, fall through to normal handling
        // (multi-property embedded uses prefix-based flattening)
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
        ): void => {
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
        };

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
        );
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

    // Track which properties are handled by constructor
    const constructorPropNames = new Set<string>();

    // Collect explicit property names and detect index signature
    const explicitProps = new Set<string>();
    let indexSignature: TypeIndexSignature | undefined;

    for (const member of members) {
        if (member.kind === ReflectionKind.indexSignature) {
            indexSignature = member;
            continue;
        }
        if (isPropertyMemberType(member)) {
            const propName = memberNameToString((member as TypeProperty | TypePropertySignature).name);
            explicitProps.add(propName);
        }
    }

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
        ): void => {
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
        };

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
                const applyDefault = (obj: any, fn: () => any, name: string) => {
                    obj[name] = fn.apply(obj);
                };
                ctx.callExpr(applyDefault, result, ctx.lit(defaultFn), ctx.lit(propNameStr));
            }
        }

        // Set properties from input
        for (const member of members) {
            if (!isPropertyMemberType(member)) continue;
            const memberType = member as TypeProperty | TypePropertySignature;
            const propName = memberNameToString(memberType.name);
            const serializedName = state.namingStrategy.getPropertyName(memberType, state.serializer.name);
            if (!serializedName) continue;
            const excluded = excludedAnnotation.getAnnotations(memberType.type);
            if (excluded.includes('*') || excluded.includes(state.serializer.name)) continue;
            const propType = memberType.type;
            const propInput = input.get(serializedName);
            ctx.when(ctx.has(input, serializedName), () => {
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
            });
        }

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

        // Set non-constructor properties
        for (const member of members) {
            if (!isPropertyMemberType(member)) continue;
            const memberType = member as TypeProperty | TypePropertySignature;
            const propName = memberNameToString(memberType.name);
            if (constructorPropNames.has(propName)) continue;
            const serializedName = state.namingStrategy.getPropertyName(memberType, state.serializer.name);
            if (!serializedName) continue;
            const excluded = excludedAnnotation.getAnnotations(memberType.type);
            if (excluded.includes('*') || excluded.includes(state.serializer.name)) continue;
            const propType = memberType.type;
            const propInput = input.get(serializedName);
            ctx.when(ctx.has(input, serializedName), () => {
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
            });
        }

        // Process index signature properties
        processIndexSignatureOnResult(result);

        return result;
    }

    // No constructor - use simple new classRef()
    const result = ctx.let(ctx.newExpr(classRef));

    // Set all properties
    for (const member of members) {
        if (!isPropertyMemberType(member)) continue;
        const memberType = member as TypeProperty | TypePropertySignature;
        const propName = memberNameToString(memberType.name);
        const serializedName = state.namingStrategy.getPropertyName(memberType, state.serializer.name);
        if (!serializedName) continue;
        const excluded = excludedAnnotation.getAnnotations(memberType.type);
        if (excluded.includes('*') || excluded.includes(state.serializer.name)) continue;
        const propType = memberType.type;
        const propInput = input.get(serializedName);
        ctx.when(ctx.has(input, serializedName), () => {
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
        });
    }

    // Process index signature properties
    processIndexSignatureOnResult(result);

    return result;
};

const serializeDate: TypeHandler = (type, input, ctx, state) => ctx.callExpr((d: Date) => d.toISOString(), input);
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

// Type Guards
const guardStringExact: TypeHandler = (type, input, ctx, state) =>
    guardWithError(ctx, state, input, ctx.isType(input, 'string'), 'type', 'Not a string');

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

const guardNumberBranded: TypeHandler = (type, input, ctx, state) => {
    const numType = type as TypeNumber;
    const errorsSlot = state.optionsSlot.get('errors' as any);
    const brandName =
        numType.brand !== undefined && numType.brand < TypeNumberBrand.float
            ? TypeNumberBrand[numType.brand]
            : numType.brand === TypeNumberBrand.float32
              ? 'float32'
              : 'number';
    const score = ctx.var_(ctx.lit(0));

    // Helper to push error with "Cannot convert X to Y" format (consistent with objects)
    const pushTypeError = () => {
        ctx.when(errorsSlot, () => {
            const valueStr = ctx.callExpr(stringifyValueWithType, input);
            const errorMsg = ctx.concat(ctx.lit('Cannot convert '), valueStr, ctx.lit(' to ' + brandName));
            ctx.push(errorsSlot, ctx.newExpr(ValidationErrorItem, state.pathSlot(), ctx.lit('type'), errorMsg, input));
        });
    };

    ctx.when(ctx.not(ctx.isType(input, 'number')), pushTypeError, () => {
        const isNan = ctx.callExpr(Number.isNaN, input);
        ctx.when(isNan, pushTypeError, () => {
            if (numType.brand !== undefined && numType.brand < TypeNumberBrand.float) {
                // Integer brands: check integer and range
                const range = integerRanges[numType.brand];
                const isInt = ctx.callExpr(Number.isInteger, input);
                if (range) {
                    const [min, max] = range;
                    const inRange = ctx.and(ctx.gte(input, ctx.lit(min)), ctx.lte(input, ctx.lit(max)));
                    ctx.when(ctx.not(ctx.and(isInt, inRange)), pushTypeError, () => ctx.setVar(score, ctx.lit(1000)));
                } else {
                    // Generic integer (no specific range)
                    ctx.when(ctx.not(isInt), pushTypeError, () => ctx.setVar(score, ctx.lit(1000)));
                }
            } else if (numType.brand === TypeNumberBrand.float32) {
                // float32: check range
                const inRange = ctx.and(ctx.gte(input, ctx.lit(-float32Max)), ctx.lte(input, ctx.lit(float32Max)));
                ctx.when(ctx.not(inRange), pushTypeError, () => ctx.setVar(score, ctx.lit(1000)));
            } else {
                ctx.setVar(score, ctx.lit(1000));
            }
        });
    });
    return ctx.getVar(score);
};

const guardBooleanExact: TypeHandler = (type, input, ctx, state) =>
    guardWithError(ctx, state, input, ctx.isType(input, 'boolean'), 'type', 'Not a boolean');
const guardBigIntExact: TypeHandler = (type, input, ctx, state) =>
    guardWithError(ctx, state, input, ctx.isType(input, 'bigint'), 'type', 'Not a bigint');
const guardNull: TypeHandler = (type, input, ctx, state) =>
    guardWithError(ctx, state, input, ctx.isNull(input), 'type', 'Not null');
const guardUndefined: TypeHandler = (type, input, ctx, state) =>
    guardWithError(ctx, state, input, ctx.eq(input, ctx.lit(undefined)), 'type', 'Not undefined');
const guardAny: TypeHandler = (type, input, ctx, state) => ctx.lit(1000);
const guardArray: TypeHandler = (type, input, ctx, state) =>
    guardWithError(ctx, state, input, ctx.callExpr(Array.isArray, input), 'type', 'Not an array');

const guardArrayTyped: TypeHandler = (type, input, ctx, state) => {
    const arrType = type as TypeArray;
    const elementType = arrType.type;
    const errorsSlot = state.optionsSlot.get('errors' as any);
    if (elementType.kind === ReflectionKind.any)
        return guardWithError(ctx, state, input, ctx.callExpr(Array.isArray, input), 'type', 'Not an array');
    const score = ctx.var_(ctx.lit(1000));
    ctx.when(
        ctx.not(ctx.callExpr(Array.isArray, input)),
        () => {
            ctx.setVar(score, ctx.lit(0));
            ctx.when(errorsSlot, () =>
                ctx.push(
                    errorsSlot,
                    ctx.newExpr(ValidationErrorItem, state.pathSlot(), ctx.lit('type'), ctx.lit('Not an array'), input),
                ),
            );
        },
        () => {
            ctx.map(input, (elem, idx) => {
                const childState = state.forIndex(idx);
                const elemScore = childState.build(elementType, elem);
                ctx.when(ctx.eq(elemScore, ctx.lit(0)), () => ctx.setVar(score, ctx.lit(0)));
                return elem;
            });
        },
    );
    return ctx.getVar(score);
};

const guardLiteral: TypeHandler = (type, input, ctx, state) =>
    guardWithError(ctx, state, input, ctx.eq(input, ctx.lit((type as TypeLiteral).literal)), 'type', 'Invalid literal');

const guardEnum: TypeHandler = (type, input, ctx, state) => {
    const enumType = type as TypeEnum;
    const valuesSet = new Set(enumType.values);
    return guardWithError(
        ctx,
        state,
        input,
        ctx.callExpr((set: Set<any>, v: any) => set.has(v), ctx.lit(valuesSet), input),
        'type',
        'Invalid enum member',
    );
};

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

const guardObject: TypeHandler = (type, input, ctx, state) => {
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
    const isObj = ctx.and(
        ctx.isType(input, 'object'),
        ctx.and(ctx.not(ctx.isNull(input)), ctx.not(ctx.callExpr(Array.isArray, input))),
    );
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
            // Handle explicit properties
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

            // For object literals, validate method signature properties as functions
            // (For class types, methods are on the prototype, but for object literals they should be on the data)
            if (objType.kind === ReflectionKind.objectLiteral) {
                for (const member of methodMembers) {
                    const methodName = memberNameToString(member.name);
                    const methodInput = input.get(methodName);
                    const hasMethod = ctx.has(input, methodName);

                    // Convert method signature to function type for validation
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

            // Handle index signatures (e.g., { [key: string]: SomeType; [key: number]: OtherType })
            if (indexSignatures.length > 0) {
                // Runtime function to validate keys against multiple index signatures
                const validateMultipleIndexSignatures = (
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
                                // Number index signature matches numeric keys
                                if (isNumericKey) {
                                    matchingSig = sig;
                                    break; // Number signature takes precedence for numeric keys
                                }
                            } else if (sig.index.kind === reflectionKind.templateLiteral) {
                                // Template literal signature (e.g., `a${number}`)
                                // Check if the key matches the template pattern
                                const keyLiteral = { kind: reflectionKind.literal, literal: key } as any;
                                if (extendTemplateLiteralFn(keyLiteral, sig.index as any)) {
                                    matchingSig = sig;
                                    break; // Template literal match takes precedence over string
                                }
                            } else if (sig.index.kind === reflectionKind.string) {
                                // String index signature matches all keys (fallback)
                                if (!matchingSig) matchingSig = sig;
                            }
                        }

                        if (!matchingSig) {
                            // No matching signature for this key - the key type doesn't match any index signature
                            // If the value is undefined, silently skip (this is expected from deserialization)
                            if (obj[key] === undefined) {
                                continue;
                            }
                            valid = false;
                            if (errors)
                                errors.push(
                                    new ValidationErrorItem(
                                        path,
                                        'type',
                                        'Key does not match any index signature',
                                        key,
                                    ),
                                );
                            continue;
                        }

                        // Validate value type against the matching signature
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
                };
                const indexScore = ctx.callExpr(
                    validateMultipleIndexSignatures,
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

            // For class types, check if there's a class-level validator method
            if (objType.kind === ReflectionKind.class) {
                const reflection = ReflectionClass.from((objType as TypeClass).classType);
                if (reflection.validationMethod) {
                    const methodName = reflection.validationMethod;
                    // Call the validator method on the instance
                    const callClassValidator = (
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
                                errors.push(new validationErrorItemClass(basePath, result.code, result.message));
                            }
                        }
                    };
                    ctx.callExpr(
                        callClassValidator,
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
};
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

const guardUnion: TypeHandler = (type, input, ctx, state) => {
    const unionType = type as TypeUnion;
    const errorsSlot = state.optionsSlot.get('errors' as any);
    const typeStr = stringifyType(type);

    // Helper to get type name for error prefixing
    const getTypeName = (t: Type): string => {
        if (t.kind === ReflectionKind.objectLiteral && t.typeName) return t.typeName;
        if (t.kind === ReflectionKind.class && t.classType) return t.classType.name;
        return '';
    };

    // Use runtime function for proper union validation with constraint-specific errors (#577)
    const validateUnion = (
        value: any,
        members: Type[],
        serializer: any,
        errors: ValidationErrorItem[] | undefined,
        path: string,
        typeDescription: string,
        getBaseTypeKindFn: (type: Type) => ReflectionKind,
        valueMatchesBaseTypeFn: (value: any, type: Type) => boolean,
        reflectionKind: typeof ReflectionKind,
        getTypeNameFn: (t: Type) => string,
    ): number => {
        // First pass: try to find a member that fully validates
        for (const member of members) {
            const validator = serializer.buildTypeGuard(member, false);
            if (validator(value, {})) return 1000;
        }

        // Second pass: find members whose base type matches and collect all errors
        const matchingMemberErrors: ValidationErrorItem[] = [];
        let hasConstraintErrors = false;

        for (const member of members) {
            if (valueMatchesBaseTypeFn(value, member)) {
                // This member's base type matches - run full validation and collect errors
                const memberErrors: ValidationErrorItem[] = [];
                const validator = serializer.buildTypeGuard(member, false);
                validator(value, { errors: memberErrors });

                const typeName = getTypeNameFn(member);

                for (const err of memberErrors) {
                    // Include constraint errors (non-type errors)
                    if (err.code !== 'type') {
                        hasConstraintErrors = true;
                        const fullPath = path && err.path ? path + '.' + err.path : path || err.path;
                        matchingMemberErrors.push(new ValidationErrorItem(fullPath, err.code, err.message, err.value));
                    }
                    // Include type errors with specific paths (e.g., missing required fields)
                    else if (err.path && err.path.length > 0) {
                        // Prefix with type name to indicate which member the error is from
                        const prefixedPath = typeName ? typeName + '.' + err.path : err.path;
                        const fullPath = path && prefixedPath ? path + '.' + prefixedPath : path || prefixedPath;
                        matchingMemberErrors.push(new ValidationErrorItem(fullPath, err.code, err.message, err.value));
                    }
                }
            }
        }

        // If we have constraint errors, prioritize those
        if (hasConstraintErrors && errors) {
            for (const err of matchingMemberErrors) {
                if (err.code !== 'type') {
                    errors.push(err);
                }
            }
            return 0;
        }

        // If we have type errors from specific fields, use those
        if (matchingMemberErrors.length > 0 && errors) {
            for (const err of matchingMemberErrors) {
                errors.push(err);
            }
            return 0;
        }

        // No base type matched - show generic union error
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
        return 0;
    };

    return ctx.callExpr(
        validateUnion,
        input,
        ctx.lit(unionType.types),
        ctx.lit(state.serializer),
        errorsSlot,
        state.pathSlot(),
        ctx.lit(typeStr),
        ctx.lit(getBaseTypeKind),
        ctx.lit(valueMatchesBaseType),
        ctx.lit(ReflectionKind),
        ctx.lit(getTypeName),
    );
};
const guardTuple: TypeHandler = (type, input, ctx, state) => {
    const tupleType = type as TypeTuple;
    const score = ctx.var_(ctx.lit(1000));
    const errorsSlot = state.optionsSlot.get('errors' as any);

    // Find rest element position if any
    let restIndex = -1;
    let restType: Type | undefined;
    for (let i = 0; i < tupleType.types.length; i++) {
        const member = tupleType.types[i];
        if (member.type.kind === ReflectionKind.rest) {
            restIndex = i;
            restType = (member.type as any).type;
            break;
        }
    }

    ctx.when(
        ctx.not(ctx.callExpr(Array.isArray, input)),
        () => {
            ctx.setVar(score, ctx.lit(0));
            ctx.when(errorsSlot, () =>
                ctx.push(
                    errorsSlot,
                    ctx.newExpr(ValidationErrorItem, state.pathSlot(), ctx.lit('type'), ctx.lit('Not an array'), input),
                ),
            );
        },
        () => {
            if (restIndex === -1) {
                // No rest element - simple case
                for (let i = 0; i < tupleType.types.length; i++) {
                    const member = tupleType.types[i];
                    const elemName = member.name || String(i);
                    ctx.when(ctx.eq(ctx.getVar(score), ctx.lit(1000)), () => {
                        const childState = state.forProperty(String(elemName));
                        const elemScore = childState.build(member.type, input.at(i));
                        ctx.when(ctx.eq(elemScore, ctx.lit(0)), () => ctx.setVar(score, ctx.lit(0)));
                    });
                }
            } else {
                // Has rest element - need to handle variable length
                const beforeRest = restIndex;
                const afterRest = tupleType.types.length - restIndex - 1;

                // Validate elements before rest
                for (let i = 0; i < beforeRest; i++) {
                    const member = tupleType.types[i];
                    const elemName = member.name || String(i);
                    ctx.when(ctx.eq(ctx.getVar(score), ctx.lit(1000)), () => {
                        const childState = state.forProperty(String(elemName));
                        const elemScore = childState.build(member.type, input.at(i));
                        ctx.when(ctx.eq(elemScore, ctx.lit(0)), () => ctx.setVar(score, ctx.lit(0)));
                    });
                }

                // Validate rest elements at runtime
                if (restType) {
                    const validateRest = (
                        inputArr: any[],
                        restIdx: number,
                        afterCount: number,
                        rt: Type,
                        st: BuildStateBase,
                        errorsArr: ValidationErrorItem[] | undefined,
                    ): boolean => {
                        const restEnd = inputArr.length - afterCount;
                        for (let j = restIdx; j < restEnd; j++) {
                            const serializer = (st as any).serializer;
                            const guardFn = serializer.buildTypeGuard(rt, true);
                            const errors: ValidationErrorItem[] = [];
                            if (!guardFn(inputArr[j], { errors })) {
                                if (errorsArr) {
                                    for (const err of errors) {
                                        errorsArr.push(
                                            new ValidationErrorItem(String(j), err.code, err.message, err.value),
                                        );
                                    }
                                }
                                return false;
                            }
                        }
                        return true;
                    };
                    ctx.when(ctx.eq(ctx.getVar(score), ctx.lit(1000)), () => {
                        const restValid = ctx.callExpr(
                            validateRest,
                            input,
                            ctx.lit(restIndex),
                            ctx.lit(afterRest),
                            ctx.lit(restType),
                            ctx.lit(state),
                            errorsSlot,
                        );
                        ctx.when(ctx.not(restValid), () => ctx.setVar(score, ctx.lit(0)));
                    });
                }

                // Validate elements after rest (from the end)
                for (let i = 0; i < afterRest; i++) {
                    const memberIdx = restIndex + 1 + i;
                    const member = tupleType.types[memberIdx];
                    const offset = afterRest - i;
                    ctx.when(ctx.eq(ctx.getVar(score), ctx.lit(1000)), () => {
                        const inputIdx = ctx.callExpr(
                            (arr: any[], off: number) => arr.length - off,
                            input,
                            ctx.lit(offset),
                        );
                        const childState = state.forIndex(inputIdx);
                        const elemScore = childState.build(member.type, input.at(inputIdx));
                        ctx.when(ctx.eq(elemScore, ctx.lit(0)), () => ctx.setVar(score, ctx.lit(0)));
                    });
                }
            }
        },
    );
    return ctx.getVar(score);
};

const guardDateExact: TypeHandler = (type, input, ctx, state) =>
    guardWithError(ctx, state, input, ctx.isInstance(input, Date), 'type', 'Not a Date');

const guardRegExp: TypeHandler = (type, input, ctx, state) =>
    guardWithError(ctx, state, input, ctx.isInstance(input, RegExp), 'type', 'Not a RegExp');

const guardFunction: TypeHandler = (type, input, ctx, state) => {
    const funcType = type as TypeFunction;
    const errorsSlot = state.optionsSlot.get('errors' as any);

    // Runtime validator that checks function type compatibility
    const validateFunction = (
        fn: any,
        expectedType: TypeFunction,
        errors: ValidationErrorItem[] | undefined,
        path: string,
        isExtendableFn: typeof isExtendable,
        resolveRuntimeTypeFn: typeof resolveRuntimeType,
        reflectionKind: typeof ReflectionKind,
    ): number => {
        if (typeof fn !== 'function') {
            if (errors) errors.push(new ValidationErrorItem(path, 'type', 'Not a function', fn));
            return 0;
        }

        // If the value function has __type, validate against the expected type
        if ('__type' in fn) {
            const actualType = resolveRuntimeTypeFn(fn);
            if (actualType && actualType.kind === reflectionKind.function) {
                // Use isExtendable to check if actual function type extends expected type
                if (!isExtendableFn(actualType, expectedType)) {
                    if (errors) errors.push(new ValidationErrorItem(path, 'type', 'Function type mismatch', fn));
                    return 0;
                }
            }
        }
        // Functions without __type are treated as any => any, which passes
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
};

const guardTemplateLiteral: TypeHandler = (type, input, ctx, state) => {
    const validateTemplateLiteral = (v: any, t: Type): number => {
        if (typeof v !== 'string') return 0;
        try {
            return extendTemplateLiteral({ kind: ReflectionKind.literal, literal: v }, t as TypeTemplateLiteral)
                ? 1000
                : 0;
        } catch {
            return 0;
        }
    };
    return ctx.callExpr(validateTemplateLiteral, input, ctx.lit(type));
};
const guardSet: TypeHandler = (type, input, ctx, state) => {
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
                    ctx.newExpr(ValidationErrorItem, state.pathSlot(), ctx.lit('type'), ctx.lit('Not a Set'), input),
                ),
            );
        },
        () => {
            // Validate element types if not any
            if (elementType.kind !== ReflectionKind.any) {
                const validateSetElements = (
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
                };
                const elemScore = ctx.callExpr(
                    validateSetElements,
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
};

const guardMap: TypeHandler = (type, input, ctx, state) => {
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
                    ctx.newExpr(ValidationErrorItem, state.pathSlot(), ctx.lit('type'), ctx.lit('Not a Map'), input),
                ),
            );
        },
        () => {
            // Validate key and value types if not any
            if (keyType.kind !== ReflectionKind.any || valueType.kind !== ReflectionKind.any) {
                const validateMapEntries = (
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
                        // Validate key
                        if (kType.kind !== ReflectionKind.any) {
                            const keyValidator = serializer.buildTypeGuard(kType, false);
                            const keyErrors: ValidationErrorItem[] = [];
                            const keyValid = keyValidator(key, { errors: keyErrors });
                            if (!keyValid) {
                                for (const err of keyErrors) {
                                    const newErr = new ValidationErrorItem(
                                        path + '.key',
                                        err.code,
                                        err.message,
                                        err.value,
                                    );
                                    if (errors) errors.push(newErr);
                                }
                                return 0;
                            }
                        }
                        // Validate value
                        if (vType.kind !== ReflectionKind.any) {
                            const valueValidator = serializer.buildTypeGuard(vType, false);
                            const valueErrors: ValidationErrorItem[] = [];
                            const valueValid = valueValidator(value, { errors: valueErrors });
                            if (!valueValid) {
                                for (const err of valueErrors) {
                                    const newErr = new ValidationErrorItem(
                                        path + '.value',
                                        err.code,
                                        err.message,
                                        err.value,
                                    );
                                    if (errors) errors.push(newErr);
                                }
                                return 0;
                            }
                        }
                        idx++;
                    }
                    return 1000;
                };
                const mapScore = ctx.callExpr(
                    validateMapEntries,
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
};

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
    const isObj = ctx.and(
        ctx.isType(input, 'object'),
        ctx.and(ctx.not(ctx.isNull(input)), ctx.not(ctx.callExpr(Array.isArray, input))),
    );

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
 * Type guard for Reference types.
 * Accepts either a full object or the primary key type.
 */
const guardReference: TypeHandler = (type, input, ctx, state) => {
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
    const isObj = ctx.and(
        ctx.isType(input, 'object'),
        ctx.and(ctx.not(ctx.isNull(input)), ctx.not(ctx.callExpr(Array.isArray, input))),
    );

    ctx.when(
        isObj,
        () => {
            // Check if it's a reference instance (created by createReference)
            // OR an object with only the primary key property (like { id: 34 })
            // Reference instances throw when accessing non-PK properties, so we only validate the PK
            const isRef = ctx.callExpr(isReferenceInstance, input);
            // Check if object has only the primary key property (reference shorthand)
            const isPkOnlyObj = ctx.callExpr(
                (obj: any, pkProperty: string) => {
                    const keys = Object.keys(obj);
                    return keys.length === 1 && keys[0] === pkProperty;
                },
                input,
                ctx.lit(pkName),
            );
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
};

/**
 * Type guard for NanoId.
 * NanoId must be exactly 21 characters using URL-safe alphabet.
 */
const guardNanoId: TypeHandler = (type, input, ctx, state) => {
    const isString = ctx.isType(input, 'string');
    const hasCorrectLength = ctx.eq(input.get('length'), ctx.lit(21));
    const isValid = ctx.and(isString, hasCorrectLength);

    return guardWithError(ctx, state, input, isValid, 'type', 'Not a valid NanoId');
};

/**
 * Type guard for UUID.
 * UUID must match the standard UUID format (8-4-4-4-12 hex chars).
 */
const guardUUID: TypeHandler = (type, input, ctx, state) => {
    const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    const isString = ctx.isType(input, 'string');
    const matchesPattern = ctx.callExpr(
        (pattern: RegExp, value: string) => pattern.test(value),
        ctx.lit(uuidPattern),
        input,
    );
    const isValid = ctx.and(isString, matchesPattern);

    return guardWithError(ctx, state, input, isValid, 'type', 'Not a valid UUID');
};

/**
 * Type guard for MongoId (ObjectId).
 * MongoId must be exactly 24 hex characters or empty string.
 */
const guardMongoId: TypeHandler = (type, input, ctx, state) => {
    const mongoIdPattern = /^[0-9a-fA-F]{24}$/;
    const isString = ctx.isType(input, 'string');
    const isEmpty = ctx.eq(input, ctx.lit(''));
    const matchesPattern = ctx.callExpr(
        (pattern: RegExp, value: string) => pattern.test(value),
        ctx.lit(mongoIdPattern),
        input,
    );
    const isValid = ctx.and(isString, ctx.or(isEmpty, matchesPattern));

    return guardWithError(ctx, state, input, isValid, 'type', 'Not a MongoId (ObjectId)');
};

/**
 * Deserialize decorator for NanoId.
 * Throws SerializationError if input is not a valid NanoId.
 */
const deserializeNanoId: TypeHandler = (type, input, ctx, state) => {
    // Throw if string doesn't have correct length
    ctx.when(ctx.neq(input.get('length'), ctx.lit(21)), () => {
        state.throw_(type, input, 'Not a valid NanoId');
    });
    return input;
};

/**
 * Deserialize decorator for UUID.
 * Throws SerializationError if input is not a valid UUID.
 */
const deserializeUUID: TypeHandler = (type, input, ctx, state) => {
    const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    const matchesPattern = ctx.callExpr(
        (pattern: RegExp, value: string) => pattern.test(value),
        ctx.lit(uuidPattern),
        input,
    );
    ctx.when(ctx.not(matchesPattern), () => {
        state.throw_(type, input, 'Not a valid UUID');
    });
    return input;
};

/**
 * Deserialize decorator for MongoId (ObjectId).
 * Throws SerializationError if input is not a valid MongoId.
 */
const deserializeMongoId: TypeHandler = (type, input, ctx, state) => {
    const isValidLength = ctx.or(ctx.eq(input.get('length'), ctx.lit(24)), ctx.eq(input.get('length'), ctx.lit(0)));
    ctx.when(ctx.not(isValidLength), () => {
        state.throw_(type, input, 'Not a MongoId (ObjectId)');
    });
    return input;
};

// ============================================================================
// Fast Type Guards (Pure && chain, no error collection)
// ============================================================================
// These guards return boolean directly without score calculation or error collection.
// Used by buildFastTypeGuard() for maximum performance type checking.

/**
 * Fast string type guard - returns boolean directly.
 */
const guardStringFast: TypeHandler = (type, input, ctx, state) => ctx.isType(input, 'string');

/**
 * Fast number type guard - checks typeof and not NaN.
 */
const guardNumberFast: TypeHandler = (type, input, ctx, state) =>
    ctx.and(ctx.isType(input, 'number'), ctx.not(ctx.callExpr(Number.isNaN, input)));

/**
 * Fast boolean type guard.
 */
const guardBooleanFast: TypeHandler = (type, input, ctx, state) => ctx.isType(input, 'boolean');

/**
 * Fast bigint type guard.
 */
const guardBigIntFast: TypeHandler = (type, input, ctx, state) => ctx.isType(input, 'bigint');

/**
 * Fast null type guard.
 */
const guardNullFast: TypeHandler = (type, input, ctx, state) => ctx.isNull(input);

/**
 * Fast undefined type guard.
 */
const guardUndefinedFast: TypeHandler = (type, input, ctx, state) => ctx.eq(input, ctx.lit(undefined));

/**
 * Fast any type guard - always returns true.
 */
const guardAnyFast: TypeHandler = (type, input, ctx, state) => ctx.lit(true);

/**
 * Fast literal type guard - checks exact value equality.
 */
const guardLiteralFast: TypeHandler = (type, input, ctx, state) => {
    const literalType = type as TypeLiteral;
    return ctx.eq(input, ctx.lit(literalType.literal));
};

/**
 * Fast array type guard - checks Array.isArray and element types.
 */
const guardArrayFast: TypeHandler = (type, input, ctx, state) => {
    const arrType = type as TypeArray;
    const elementType = arrType.type;

    const isArray = ctx.callExpr(Array.isArray, input);

    // For any[] just check Array.isArray
    if (elementType.kind === ReflectionKind.any) {
        return isArray;
    }

    // For typed arrays: Array.isArray(x) && x.every(elem => check(elem))
    // Build element checker using nested fast type guard
    const elemChecker = state.serializer.buildFastTypeGuard(elementType);

    const allValid = ctx.callExpr(
        (arr: any[], checker: (e: any) => boolean) => arr.every(checker),
        input,
        ctx.lit(elemChecker),
    );

    return ctx.and(isArray, allValid);
};

/**
 * Fast union type guard - builds || chain for all members.
 */
const guardUnionFast: TypeHandler = (type, input, ctx, state) => {
    const unionType = type as TypeUnion;

    // Build || chain: member1Check || member2Check || ...
    let result: Slot<boolean> = ctx.lit(false);
    for (const member of unionType.types) {
        const memberCheck = state.build(member, input) as Slot<boolean>;
        result = ctx.or(result, memberCheck);
    }
    return result;
};

/**
 * Fast object type guard - builds && chain for all properties.
 */
const guardObjectFast: TypeHandler = (type, input, ctx, state) => {
    const objType = type as TypeObjectLiteral | TypeClass;
    const members = resolveTypeMembers(objType);

    // Object type check: typeof x === 'object' && x !== null && !Array.isArray(x)
    const isObject = ctx.and(
        ctx.isType(input, 'object'),
        ctx.and(ctx.not(ctx.isNull(input)), ctx.not(ctx.callExpr(Array.isArray, input))),
    );

    // For class types, check if it's a Reference instance
    // Reference proxies throw when accessing properties, so we just check instanceof
    if (objType.kind === ReflectionKind.class && objType.classType) {
        // Wrap all property checks in object type guard to avoid 'in' on primitives in unions
        const classResult = ctx.var_<boolean>(ctx.lit(false));
        ctx.when(isObject, () => {
            const isRef = ctx.callExpr(isReferenceInstance, input);
            const isInstance = ctx.callExpr((v: any, cls: any) => v instanceof cls, input, ctx.lit(objType.classType));
            // If it's a Reference, just check instanceof; otherwise check properties
            ctx.when(
                isRef,
                () => {
                    ctx.setVar(classResult, isInstance);
                },
                () => {
                    // Full property checking for non-reference instances
                    let propResult: Slot<boolean> = ctx.lit(true);
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
                            propResult = ctx.and(propResult, ctx.and(hasProp, propCheck));
                        } else {
                            // Optional: value must be undefined OR match type
                            const propIsUndefined = ctx.eq(propInput, ctx.lit(undefined));
                            const childState = state.forProperty(propName);
                            const propCheck = childState.build(propType, propInput) as Slot<boolean>;
                            propResult = ctx.and(propResult, ctx.or(propIsUndefined, propCheck));
                        }
                    }
                    ctx.setVar(classResult, propResult);
                },
            );
        });
        return ctx.getVar(classResult);
    }

    // For object literals, start with object check
    let result = isObject;

    // For object literals, check all properties
    for (const member of members) {
        if (!isPropertyMemberType(member)) continue;

        const propName = memberNameToString(member.name);
        const propType = member.type;
        const isOpt = isOptional(member);
        const propInput = input.get(propName);

        if (!isOpt) {
            // Required: property must exist and match type
            const hasProp = ctx.has(input, propName);
            const childState = state.forProperty(propName);
            const propCheck = childState.build(propType, propInput) as Slot<boolean>;
            result = ctx.and(result, ctx.and(hasProp, propCheck));
        } else {
            // Optional: value must be undefined OR match type
            // This handles both missing properties and explicit undefined values
            const propIsUndefined = ctx.eq(propInput, ctx.lit(undefined));
            const childState = state.forProperty(propName);
            const propCheck = childState.build(propType, propInput) as Slot<boolean>;
            result = ctx.and(result, ctx.or(propIsUndefined, propCheck));
        }
    }

    return result;
};

/**
 * Strict array type guard - checks Array.isArray and element types using strict checking.
 * This ensures nested objects in arrays also reject unknown keys.
 */
const guardArrayStrict: TypeHandler = (type, input, ctx, state) => {
    const arrType = type as TypeArray;
    const elementType = arrType.type;

    const isArray = ctx.callExpr(Array.isArray, input);

    // For any[] just check Array.isArray
    if (elementType.kind === ReflectionKind.any) {
        return isArray;
    }

    // For typed arrays: Array.isArray(x) && x.every(elem => strictCheck(elem))
    // Use buildStrictTypeGuard for element checking to preserve strict semantics
    const elemChecker = state.serializer.buildStrictTypeGuard(elementType);

    const allValid = ctx.callExpr(
        (arr: any[], checker: (e: any) => boolean) => arr.every(checker),
        input,
        ctx.lit(elemChecker),
    );

    return ctx.and(isArray, allValid);
};

/**
 * Strict tuple type guard - checks array length and element types using strict checking.
 */
const guardTupleStrict: TypeHandler = (type, input, ctx, state) => {
    const tupleType = type as TypeTuple;

    // Must be an array
    let result: Slot<boolean> = ctx.callExpr(Array.isArray, input);

    // Check length (for non-rest tuples)
    const hasRest = tupleType.types.some(t => t.type.kind === ReflectionKind.rest);
    if (!hasRest) {
        result = ctx.and(result, ctx.eq(ctx.len(input), ctx.lit(tupleType.types.length)));
    }

    // Check each element type using strict type guard
    for (let i = 0; i < tupleType.types.length; i++) {
        const elemType = tupleType.types[i];
        if (elemType.type.kind === ReflectionKind.rest) {
            // Rest elements - use strict checker for rest type
            const restChecker = state.serializer.buildStrictTypeGuard((elemType.type as any).type);
            const restValid = ctx.callExpr(
                (arr: any[], startIdx: number, checker: (e: any) => boolean) => {
                    for (let j = startIdx; j < arr.length; j++) {
                        if (!checker(arr[j])) return false;
                    }
                    return true;
                },
                input,
                ctx.lit(i),
                ctx.lit(restChecker),
            );
            result = ctx.and(result, restValid);
            continue;
        }
        const elemChecker = state.serializer.buildStrictTypeGuard(elemType.type);
        const elemInput = ctx.at(input, i);
        const elemCheck = ctx.callExpr(
            (v: any, checker: (e: any) => boolean) => checker(v),
            elemInput,
            ctx.lit(elemChecker),
        );
        result = ctx.and(result, elemCheck);
    }

    return result;
};

/**
 * Strict Object type guard - validates properties AND rejects unknown keys.
 * Used for isStrict<T>() / assertStrict.
 *
 * Optimization: For objects without optional properties, we use a simple
 * Object.keys().length check which is O(1). For objects with optional properties,
 * we fall back to iteration.
 */
const guardObjectStrict: TypeHandler = (type, input, ctx, state) => {
    const objType = type as TypeObjectLiteral | TypeClass;
    const members = resolveTypeMembers(objType);

    // Collect property info
    const propNames: string[] = [];
    let hasOptional = false;
    for (const member of members) {
        if (!isPropertyMemberType(member)) continue;
        propNames.push(memberNameToString(member.name));
        if (isOptional(member)) hasOptional = true;
    }

    // Start with basic object check
    let result: Slot<boolean> = ctx.and(
        ctx.isType(input, 'object'),
        ctx.and(ctx.not(ctx.isNull(input)), ctx.not(ctx.callExpr(Array.isArray, input))),
    );

    // Check all known properties (same as guardObjectFast)
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
            result = ctx.and(result, ctx.and(hasProp, propCheck));
        } else {
            // Optional: value must be undefined OR match type
            const propIsUndefined = ctx.eq(propInput, ctx.lit(undefined));
            const childState = state.forProperty(propName);
            const propCheck = childState.build(propType, propInput) as Slot<boolean>;
            result = ctx.and(result, ctx.or(propIsUndefined, propCheck));
        }
    }

    // Check for unknown keys
    if (!hasOptional) {
        // Fast path: no optional properties, just check key count
        // Object.keys(obj).length === expectedCount
        const keysLength = ctx.callExpr((obj: any) => Object.keys(obj).length, input);
        result = ctx.and(result, ctx.eq(keysLength, ctx.lit(propNames.length)));
    } else {
        // Slow path: has optional properties, need to iterate
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
        result = ctx.and(result, checkUnknownKeys);
    }

    return result;
};

/**
 * Fast Date type guard - checks instanceof Date.
 */
const guardDateFast: TypeHandler = (type, input, ctx, state) => ctx.callExpr((v: any) => v instanceof Date, input);

/**
 * Fast Set type guard - checks instanceof Set.
 */
const guardSetFast: TypeHandler = (type, input, ctx, state) => ctx.callExpr((v: any) => v instanceof Set, input);

/**
 * Fast Map type guard - checks instanceof Map.
 */
const guardMapFast: TypeHandler = (type, input, ctx, state) => ctx.callExpr((v: any) => v instanceof Map, input);

/**
 * Fast RegExp type guard - checks instanceof RegExp.
 */
const guardRegExpFast: TypeHandler = (type, input, ctx, state) => ctx.callExpr((v: any) => v instanceof RegExp, input);

/**
 * Fast function type guard - checks typeof === 'function'.
 */
const guardFunctionFast: TypeHandler = (type, input, ctx, state) => ctx.isType(input, 'function');

/**
 * Fast enum type guard - checks if value is in enum values.
 */
const guardEnumFast: TypeHandler = (type, input, ctx, state) => {
    const enumType = type as TypeEnum;
    const values = enumType.enum ? Object.values(enumType.enum) : [];

    if (values.length === 0) {
        return ctx.lit(false);
    }

    // Build || chain for all enum values
    let result: Slot<boolean> = ctx.eq(input, ctx.lit(values[0]));
    for (let i = 1; i < values.length; i++) {
        result = ctx.or(result, ctx.eq(input, ctx.lit(values[i])));
    }
    return result;
};

/**
 * Fast tuple type guard - checks array length and element types.
 */
const guardTupleFast: TypeHandler = (type, input, ctx, state) => {
    const tupleType = type as TypeTuple;

    // Must be an array
    let result: Slot<boolean> = ctx.callExpr(Array.isArray, input);

    // Check length (for non-rest tuples)
    const hasRest = tupleType.types.some(t => t.type.kind === ReflectionKind.rest);
    if (!hasRest) {
        result = ctx.and(result, ctx.eq(ctx.len(input), ctx.lit(tupleType.types.length)));
    }

    // Check each element type
    for (let i = 0; i < tupleType.types.length; i++) {
        const elemType = tupleType.types[i];
        if (elemType.type.kind === ReflectionKind.rest) {
            // Rest elements - skip detailed check for now
            continue;
        }
        const elemInput = ctx.at(input, i);
        const elemCheck = state.build(elemType.type, elemInput) as Slot<boolean>;
        result = ctx.and(result, elemCheck);
    }

    return result;
};

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

export function registerDefaultTypeGuards(serializer: Serializer): void {
    const typeGuards = serializer.typeGuards;
    typeGuards.register(1, ReflectionKind.string, guardStringExact);
    typeGuards.register(1, ReflectionKind.number, guardNumberBranded);
    typeGuards.register(1, ReflectionKind.boolean, guardBooleanExact);
    typeGuards.register(1, ReflectionKind.bigint, guardBigIntExact);
    typeGuards.register(1, ReflectionKind.null, guardNull);
    typeGuards.register(1, ReflectionKind.undefined, guardUndefined);
    typeGuards.register(1, ReflectionKind.any, guardAny);
    typeGuards.register(20, ReflectionKind.any, guardAny);
    typeGuards.register(1, ReflectionKind.literal, guardLiteral);
    typeGuards.register(1, ReflectionKind.enum, guardEnum);
    typeGuards.register(1, ReflectionKind.array, guardArrayTyped);
    typeGuards.register(1, ReflectionKind.tuple, guardTuple);
    typeGuards.register(1, ReflectionKind.objectLiteral, guardObject);
    typeGuards.register(1, ReflectionKind.class, guardObject);
    typeGuards.register(1, ReflectionKind.union, guardUnion);
    typeGuards.register(1, ReflectionKind.function, guardFunction);
    typeGuards.register(1, ReflectionKind.templateLiteral, guardTemplateLiteral);
    typeGuards.registerClass(1, Date, guardDateExact);
    typeGuards.registerClass(1, Set, guardSet);
    typeGuards.registerClass(1, Map, guardMap);
    // RegExp has its own ReflectionKind.regexp, not ReflectionKind.class
    typeGuards.register(1, ReflectionKind.regexp, guardRegExp);

    // Binary type guards
    typeGuards.registerBinary(1, guardTypedArray);
    typeGuards.registerBinary(10, guardTypedArrayLoose);

    // Reference type guard - decorator handler
    typeGuards.addDecorator(1, isReferenceType, guardReference);

    // Special string type guards (NanoId, UUID, MongoId)
    typeGuards.addDecorator(1, isNanoIdType, guardNanoId);
    typeGuards.addDecorator(1, isUUIDType, guardUUID);
    typeGuards.addDecorator(1, isMongoIdType, guardMongoId);
}

/**
 * Register fast type guards for the serializer.
 * Fast guards return booleans directly without error collection.
 */
export function registerFastTypeGuards(serializer: Serializer): void {
    const reg = serializer.fastTypeGuards;

    // Primitives
    reg.register(ReflectionKind.string, guardStringFast);
    reg.register(ReflectionKind.number, guardNumberFast);
    reg.register(ReflectionKind.boolean, guardBooleanFast);
    reg.register(ReflectionKind.bigint, guardBigIntFast);
    reg.register(ReflectionKind.null, guardNullFast);
    reg.register(ReflectionKind.undefined, guardUndefinedFast);
    reg.register(ReflectionKind.any, guardAnyFast);
    reg.register(ReflectionKind.literal, guardLiteralFast);

    // Compound types
    reg.register(ReflectionKind.array, guardArrayFast);
    reg.register(ReflectionKind.union, guardUnionFast);
    reg.register(ReflectionKind.objectLiteral, guardObjectFast);
    reg.register(ReflectionKind.class, guardObjectFast);
    reg.register(ReflectionKind.enum, guardEnumFast);
    reg.register(ReflectionKind.tuple, guardTupleFast);
    reg.register(ReflectionKind.function, guardFunctionFast);
    reg.register(ReflectionKind.regexp, guardRegExpFast);

    // Class types
    reg.registerClass(Date, guardDateFast);
    reg.registerClass(Set, guardSetFast);
    reg.registerClass(Map, guardMapFast);
}

/**
 * Register strict type guard handlers (reject unknown keys).
 * Used for isStrict<T>() / assertStrict.
 */
export function registerStrictTypeGuards(serializer: Serializer): void {
    const reg = serializer.strictTypeGuards;

    // Primitives - same as fast (no unknown keys concept)
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
    reg.register(ReflectionKind.regexp, guardRegExpFast);

    // Class types
    reg.registerClass(Date, guardDateFast);
    reg.registerClass(Set, guardSetFast);
    reg.registerClass(Map, guardMapFast);
}
