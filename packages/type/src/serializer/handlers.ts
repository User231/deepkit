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
import { isInteger, isNumeric, isObject } from '@deepkit/core';
import { TypeNumberBrand } from '@deepkit/type-spec';

import { arrayBufferToBase64, base64ToArrayBuffer, base64ToTypedArray, typedArrayToBase64 } from '../core.js';
import { createReference } from '../reference.js';
import { extendTemplateLiteral, isExtendable } from '../reflection/extends.js';
import { resolveRuntimeType } from '../reflection/processor.js';
import { ReflectionClass } from '../reflection/reflection.js';
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
    excludedAnnotation,
    getConstructorProperties,
    getDeepConstructorProperties,
    groupAnnotation,
    hasDefaultValue,
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
import { ValidationErrorItem } from '../validator.js';
import type { BuildStateBase, HandlerRegistry, TypeGuardRegistry, TypeHandler } from './registry.js';
import type { Serializer } from './serializer.js';
import type { BuildState } from './state.js';

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

// Primitive Serializers
const handleString: TypeHandler = (type, input, ctx, state) => input;
const handleNumber: TypeHandler = (type, input, ctx, state) => input;
const handleBoolean: TypeHandler = (type, input, ctx, state) => input;
const handleBigInt: TypeHandler = (type, input, ctx, state) => input;
const handleNull: TypeHandler = (type, input, ctx, state) => ctx.lit(null);
const handleUndefined: TypeHandler = (type, input, ctx, state) => ctx.lit(undefined);
const handleAny: TypeHandler = (type, input, ctx, state) => input;
const handleUnknown: TypeHandler = (type, input, ctx, state) => input;

const handleArray: TypeHandler = (type, input, ctx, state) => {
    const arrType = type as TypeArray;
    const elementType = arrType.type;
    if (elementType.kind === ReflectionKind.any) return input;
    return ctx.map(input, (elem, idx) => state.build(elementType, elem));
};

const handleTuple: TypeHandler = (type, input, ctx, state) => {
    const tupleType = type as TypeTuple;
    const result = ctx.let(ctx.arrExpr());
    for (let i = 0; i < tupleType.types.length; i++) {
        const member = tupleType.types[i];
        ctx.push(result, state.build(member.type, input.at(i)));
    }
    return result;
};

const handleObjectLiteral: TypeHandler = (type, input, ctx, state) => {
    const objType = type as TypeObjectLiteral | TypeClass;
    const result = ctx.let(ctx.objExpr());
    const members = resolveTypeMembers(objType);
    const isDeserialize = state.direction === 'deserialize';

    // Collect explicit property names for index signature handling
    const explicitProps = new Set<string>();
    let indexSignature: TypeIndexSignature | undefined;

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
        const propType = memberType.type;
        // For serialize: read from propName, write to serializedName
        // For deserialize: read from serializedName, write to propName
        const inputKey = isDeserialize ? serializedName : propName;
        const outputKey = isDeserialize ? propName : serializedName;
        const propInput = input.get(inputKey);
        ctx.when(
            ctx.has(input, inputKey),
            () => {
                ctx.when(
                    ctx.not(ctx.isNullish(propInput)),
                    () => {
                        ctx.set(result, outputKey, state.build(propType, propInput));
                    },
                    () => {
                        // Handle null/undefined values based on direction
                        if (isDeserialize) {
                            // Deserialize: null → undefined for optional, null for nullable
                            if (isNullable(memberType)) {
                                ctx.set(result, outputKey, ctx.lit(null));
                            } else if (isOptional(memberType)) {
                                ctx.set(result, outputKey, ctx.lit(undefined));
                            }
                        } else {
                            // Serialize: undefined → null for optional/nullable
                            if (isNullable(memberType) || isOptional(memberType)) {
                                ctx.set(result, outputKey, ctx.lit(null));
                            }
                        }
                    },
                );
            },
            () => {
                // Handle missing properties - set nullable to null
                if (isNullable(memberType)) {
                    ctx.set(result, outputKey, ctx.lit(null));
                }
            },
        );
    }

    // Handle index signature (e.g., Record<string, T> or { [key: string]: T })
    if (indexSignature) {
        const valueType = indexSignature.type;
        const valueAllowsNull = isNullable(indexSignature) || isOptional(indexSignature);

        // Iterate over all keys in input that aren't explicit properties
        const processIndexSignature = (
            inputObj: any,
            resultObj: any,
            explicitKeys: Set<string>,
            valueTypeArg: Type,
            stateArg: BuildStateBase,
            valueAllowsNullArg: boolean,
        ): void => {
            for (const key of Object.keys(inputObj)) {
                if (explicitKeys.has(key)) continue;
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
        );
    }

    return result;
};

const handleLiteral: TypeHandler = (type, input, ctx, state) => ctx.lit((type as TypeLiteral).literal);
const handleEnum: TypeHandler = (type, input, ctx, state) => input;
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

        const processIndexSignature = (
            inputObj: any,
            resultObj: any,
            explicitKeys: Set<string>,
            valueTypeArg: Type,
            stateArg: BuildStateBase,
            valueAllowsNullArg: boolean,
        ): void => {
            for (const key of Object.keys(inputObj)) {
                if (explicitKeys.has(key)) continue;
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
    ctx.when(
        ctx.not(ctx.isType(input, 'number')),
        () => {
            ctx.when(errorsSlot, () => {
                ctx.push(
                    errorsSlot,
                    ctx.newExpr(
                        ValidationErrorItem,
                        state.pathSlot(),
                        ctx.lit('type'),
                        ctx.lit('Not a ' + brandName),
                        input,
                    ),
                );
            });
        },
        () => {
            if (numType.brand !== undefined && numType.brand < TypeNumberBrand.float) {
                // Integer brands: check integer and range
                const range = integerRanges[numType.brand];
                const isInt = ctx.callExpr(Number.isInteger, input);
                if (range) {
                    const [min, max] = range;
                    const inRange = ctx.and(ctx.gte(input, ctx.lit(min)), ctx.lte(input, ctx.lit(max)));
                    ctx.when(
                        ctx.not(ctx.and(isInt, inRange)),
                        () => {
                            ctx.when(errorsSlot, () => {
                                ctx.push(
                                    errorsSlot,
                                    ctx.newExpr(
                                        ValidationErrorItem,
                                        state.pathSlot(),
                                        ctx.lit('type'),
                                        ctx.lit('Not a ' + brandName),
                                        input,
                                    ),
                                );
                            });
                        },
                        () => ctx.setVar(score, ctx.lit(1000)),
                    );
                } else {
                    // Generic integer (no specific range)
                    ctx.when(
                        ctx.not(isInt),
                        () => {
                            ctx.when(errorsSlot, () => {
                                ctx.push(
                                    errorsSlot,
                                    ctx.newExpr(
                                        ValidationErrorItem,
                                        state.pathSlot(),
                                        ctx.lit('type'),
                                        ctx.lit('Not a ' + brandName),
                                        input,
                                    ),
                                );
                            });
                        },
                        () => ctx.setVar(score, ctx.lit(1000)),
                    );
                }
            } else if (numType.brand === TypeNumberBrand.float32) {
                // float32: check range
                const inRange = ctx.and(ctx.gte(input, ctx.lit(-float32Max)), ctx.lte(input, ctx.lit(float32Max)));
                ctx.when(
                    ctx.not(inRange),
                    () => {
                        ctx.when(errorsSlot, () => {
                            ctx.push(
                                errorsSlot,
                                ctx.newExpr(
                                    ValidationErrorItem,
                                    state.pathSlot(),
                                    ctx.lit('type'),
                                    ctx.lit('Not a float32'),
                                    input,
                                ),
                            );
                        });
                    },
                    () => ctx.setVar(score, ctx.lit(1000)),
                );
            } else {
                ctx.setVar(score, ctx.lit(1000));
            }
        },
    );
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

            // Handle methods - check that each method member is a function with matching signature
            for (const member of methodMembers) {
                const methodName = memberNameToString(member.name);
                const methodInput = input.get(methodName);
                const hasMethod = ctx.has(input, methodName);

                // Create a TypeFunction from the method signature for comparison
                const methodAsFunction: TypeFunction = {
                    kind: ReflectionKind.function,
                    parameters: member.parameters,
                    return: member.return,
                };

                // Runtime validator for method signatures
                const validateMethod = (
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

                    // If the function has __type, validate against expected method signature
                    if ('__type' in fn) {
                        const actualType = resolveRuntimeTypeFn(fn);
                        if (actualType && actualType.kind === reflectionKind.function) {
                            if (!isExtendableFn(actualType, expectedType)) {
                                if (errors)
                                    errors.push(new ValidationErrorItem(path, 'type', 'Method signature mismatch', fn));
                                return 0;
                            }
                        }
                    }
                    // Functions without __type pass (treated as any => any)
                    return 1000;
                };

                ctx.when(
                    ctx.not(hasMethod),
                    () => {
                        // Methods are not optional by default
                        ctx.setVar(score, ctx.lit(0));
                        ctx.when(errorsSlot, () =>
                            ctx.push(
                                errorsSlot,
                                ctx.newExpr(
                                    ValidationErrorItem,
                                    state.forProperty(methodName).pathSlot(),
                                    ctx.lit('type'),
                                    ctx.lit('Not a function'),
                                    ctx.lit(undefined),
                                ),
                            ),
                        );
                    },
                    () => {
                        // Validate the method using runtime check
                        const methodScore = ctx.callExpr(
                            validateMethod,
                            methodInput,
                            ctx.lit(methodAsFunction),
                            errorsSlot,
                            state.forProperty(methodName).pathSlot(),
                            ctx.lit(isExtendable),
                            ctx.lit(resolveRuntimeType),
                            ctx.lit(ReflectionKind),
                        );
                        ctx.when(ctx.eq(methodScore, ctx.lit(0)), () => ctx.setVar(score, ctx.lit(0)));
                    },
                );
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
                ): number => {
                    let valid = true;
                    for (const key of Object.keys(obj)) {
                        const path = basePath ? basePath + '.' + key : key;
                        const numKey = Number(key);
                        const isNumericKey = !isNaN(numKey) && key !== '';

                        // Find the matching index signature for this key
                        // Numeric keys use number index signature if available, otherwise string
                        // String (non-numeric) keys use string index signature
                        let matchingSig: TypeIndexSignature | undefined;

                        for (const sig of signatures) {
                            if (sig.index.kind === reflectionKind.number) {
                                // Number index signature matches numeric keys
                                if (isNumericKey) {
                                    matchingSig = sig;
                                    break; // Number signature takes precedence for numeric keys
                                }
                            } else if (sig.index.kind === reflectionKind.string) {
                                // String index signature matches all keys (fallback)
                                if (!matchingSig) matchingSig = sig;
                            }
                        }

                        if (!matchingSig) {
                            // No matching signature for this key - the key type doesn't match any index signature
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
                );
                ctx.when(ctx.eq(indexScore, ctx.lit(0)), () => ctx.setVar(score, ctx.lit(0)));
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
    ): number => {
        // First pass: try to find a member that fully validates
        for (const member of members) {
            const validator = serializer.buildTypeGuard(member, false);
            if (validator(value, {})) return 1000;
        }

        // Second pass: find members whose base type matches and collect constraint errors
        const matchingMemberErrors: ValidationErrorItem[] = [];

        for (const member of members) {
            if (valueMatchesBaseTypeFn(value, member)) {
                // This member's base type matches - run full validation and collect errors
                const memberErrors: ValidationErrorItem[] = [];
                const validator = serializer.buildTypeGuard(member, false);
                validator(value, { errors: memberErrors });

                // If we got constraint-specific errors (not just type errors), use them
                for (const err of memberErrors) {
                    if (err.code !== 'type') {
                        // Prefix the error path with the current path
                        const fullPath = path && err.path ? path + '.' + err.path : path || err.path;
                        matchingMemberErrors.push(new ValidationErrorItem(fullPath, err.code, err.message, err.value));
                    }
                }
            }
        }

        // If we have constraint-specific errors from matching base types, use those
        if (matchingMemberErrors.length > 0 && errors) {
            for (const err of matchingMemberErrors) {
                errors.push(err);
            }
            return 0;
        }

        // No base type matched or only type errors - show generic union error
        if (errors) errors.push(new ValidationErrorItem(path, 'type', 'Cannot convert to ' + typeDescription, value));
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
    );
};
const guardTuple: TypeHandler = (type, input, ctx, state) => {
    const tupleType = type as TypeTuple;
    const score = ctx.var_(ctx.lit(1000));
    const errorsSlot = state.optionsSlot.get('errors' as any);
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
            for (let i = 0; i < tupleType.types.length; i++) {
                const member = tupleType.types[i];
                const elemName = member.name || String(i);
                ctx.when(ctx.eq(ctx.getVar(score), ctx.lit(1000)), () => {
                    const childState = state.forProperty(String(elemName));
                    const elemScore = childState.build(member.type, input.at(i));
                    ctx.when(ctx.eq(elemScore, ctx.lit(0)), () => ctx.setVar(score, ctx.lit(0)));
                });
            }
        },
    );
    return ctx.getVar(score);
};

const guardDateExact: TypeHandler = (type, input, ctx, state) =>
    guardWithError(ctx, state, input, ctx.isInstance(input, Date), 'type', 'Not a Date');

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

    // If object, deserialize as class; otherwise create reference from primary key
    return ctx.ternary(
        isObj,
        // Deserialize as full class using deserializeClass directly to avoid recursion
        deserializeClass(type, input, ctx, state),
        // Create reference from primary key
        ctx.callExpr(
            createReferenceFromPk,
            state.build(pkType, input), // Deserialize the PK value
            ctx.lit(classType.classType),
            ctx.lit(pkName),
            ctx.lit(createReference),
        ),
    );
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
            // If it's an object, validate as the class type (using guardObject directly to avoid recursion)
            const objScore = guardObject(type, input, ctx, state);
            ctx.setVar(score, objScore);
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

// Registration
export function registerDefaultHandlers(serializer: Serializer): void {
    const serializeRegistry = serializer.serializeRegistry;
    const deserializeRegistry = serializer.deserializeRegistry;
    serializeRegistry.register(ReflectionKind.string, handleString);
    deserializeRegistry.register(ReflectionKind.string, handleString);
    serializeRegistry.register(ReflectionKind.number, handleNumber);
    deserializeRegistry.register(ReflectionKind.number, handleNumber);
    serializeRegistry.register(ReflectionKind.boolean, handleBoolean);
    deserializeRegistry.register(ReflectionKind.boolean, handleBoolean);
    serializeRegistry.register(ReflectionKind.bigint, handleBigInt);
    deserializeRegistry.register(ReflectionKind.bigint, handleBigInt);
    serializeRegistry.register(ReflectionKind.null, handleNull);
    deserializeRegistry.register(ReflectionKind.null, handleNull);
    serializeRegistry.register(ReflectionKind.undefined, handleUndefined);
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
    deserializeRegistry.register(ReflectionKind.enum, handleEnum);
    serializeRegistry.register(ReflectionKind.promise, handlePromise);
    deserializeRegistry.register(ReflectionKind.promise, handlePromise);
    serializeRegistry.registerClass(Date, serializeDate);
    deserializeRegistry.registerClass(Date, deserializeDate);
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
    deserializeRegistry.addDecorator(isReferenceType, deserializeReference);

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
