/*
 * Deepkit Framework
 * Copyright (c) Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { Context, Slot } from '@deepkit/core';

import {
    ReflectionKind,
    Type,
    TypeClass,
    TypeEnum,
    TypeLiteral,
    TypeObjectLiteral,
    TypeUnion,
    getEnumValueIndexMatcher,
    isGlobalTypeClass,
    isPropertyMemberType,
    memberNameToString,
    resolveTypeMembers,
} from '../reflection/type.js';
import type { BuildStateBase, TypeHandler } from './registry.js';

/**
 * Threshold for optimizing unions with literal members.
 * When a union has this many or more literal members, we use Set.has()
 * instead of generating individual if-else statements.
 */
export const UNION_LITERAL_THRESHOLD = 50;

/**
 * Information about a discriminator property in a union.
 */
interface DiscriminatorInfo {
    property: string;
    valueToMember: Map<any, Type>;
}

/**
 * Detect if a union has a discriminator property.
 * A discriminator is a property with distinct literal values for each member.
 */
function detectDiscriminator(type: TypeUnion): DiscriminatorInfo | undefined {
    const candidates = new Map<string, Map<any, Type>>();

    for (const member of type.types) {
        if (member.kind !== ReflectionKind.objectLiteral && member.kind !== ReflectionKind.class) {
            continue;
        }

        for (const prop of resolveTypeMembers(member)) {
            if (!isPropertyMemberType(prop)) continue;
            if (prop.type.kind !== ReflectionKind.literal) continue;

            const name = memberNameToString(prop.name);
            const literal = (prop.type as TypeLiteral).literal;

            if (!candidates.has(name)) {
                candidates.set(name, new Map());
            }
            candidates.get(name)!.set(literal, member);
        }
    }

    // Find property where all members have distinct values
    for (const [prop, valueMap] of candidates) {
        if (valueMap.size === type.types.length) {
            return { property: prop, valueToMember: valueMap };
        }
    }

    return undefined;
}

/**
 * Check if all members of a union are literals.
 */
function isAllLiterals(type: TypeUnion): boolean {
    return type.types.every(t => t.kind === ReflectionKind.literal);
}

/**
 * Build a discriminated union handler (O(1) lookup).
 */
function buildDiscriminatedUnion(
    type: TypeUnion,
    disc: DiscriminatorInfo,
    input: Slot,
    ctx: Context,
    state: BuildStateBase,
): Slot {
    const discValue = input.get(disc.property);
    const result = ctx.var_<any>(undefined);
    const matched = ctx.var_(false);

    const cases: Array<[any, () => void]> = [];

    for (const [literal, memberType] of disc.valueToMember) {
        cases.push([
            literal,
            () => {
                // Build the full object for this member
                const memberResult = state.build(memberType, input);
                ctx.setVar(result, memberResult);
                ctx.setVar(matched, ctx.lit(true));
            },
        ]);
    }

    ctx.switch_(discValue, cases, () => {
        state.throw_(type, input, `Unknown discriminator value for '${disc.property}'`);
    });

    return ctx.getVar(result);
}

/**
 * Build a literal union handler using Set.has() (O(1) lookup).
 */
function buildLiteralSetUnion(type: TypeUnion, input: Slot, ctx: Context, state: BuildStateBase): Slot {
    const literals = type.types.map(t => (t as TypeLiteral).literal);
    const literalSet = new Set(literals);

    // Check if input is in the set
    const hasCheck = ctx.callExpr((set: Set<any>, value: any) => set.has(value), ctx.lit(literalSet), input);

    ctx.when(ctx.not(hasCheck), () => {
        state.throw_(type, input, 'Value not in union');
    });

    return input;
}

/**
 * Check if a type is primitive (not object-like).
 */
function isPrimitive(type: Type): boolean {
    return (
        type.kind === ReflectionKind.string ||
        type.kind === ReflectionKind.number ||
        type.kind === ReflectionKind.boolean ||
        type.kind === ReflectionKind.bigint ||
        type.kind === ReflectionKind.null ||
        type.kind === ReflectionKind.undefined ||
        type.kind === ReflectionKind.literal ||
        type.kind === ReflectionKind.symbol
    );
}

/**
 * Check if a type is object-like.
 */
function isObjectLike(type: Type): boolean {
    return (
        type.kind === ReflectionKind.objectLiteral ||
        type.kind === ReflectionKind.class ||
        type.kind === ReflectionKind.array ||
        type.kind === ReflectionKind.tuple
    );
}

/**
 * Get a type check expression for a primitive member.
 */
function getPrimitiveTypeCheck(
    member: Type,
    input: Slot,
    ctx: Context,
    loose: boolean = false,
): Slot<boolean> | undefined {
    switch (member.kind) {
        case ReflectionKind.string:
            if (loose) {
                // In loose mode, accept any primitive that can be converted to string
                // (string, number, boolean, bigint)
                return ctx.or(
                    ctx.isType(input, 'string'),
                    ctx.or(
                        ctx.isType(input, 'number'),
                        ctx.or(ctx.isType(input, 'boolean'), ctx.isType(input, 'bigint')),
                    ),
                );
            }
            return ctx.isType(input, 'string');
        case ReflectionKind.number:
            if (loose) {
                // Accept strings that look like numbers
                return ctx.or(
                    ctx.isType(input, 'number'),
                    ctx.and(
                        ctx.isType(input, 'string'),
                        ctx.callExpr((s: string) => !isNaN(Number(s)), input),
                    ),
                );
            }
            return ctx.isType(input, 'number');
        case ReflectionKind.boolean:
            if (loose) {
                return ctx.or(
                    ctx.isType(input, 'boolean'),
                    ctx.or(
                        ctx.eq(input, ctx.lit(0)),
                        ctx.or(
                            ctx.eq(input, ctx.lit(1)),
                            ctx.or(
                                ctx.eq(input, ctx.lit('0')),
                                ctx.or(
                                    ctx.eq(input, ctx.lit('1')),
                                    ctx.or(ctx.eq(input, ctx.lit('true')), ctx.eq(input, ctx.lit('false'))),
                                ),
                            ),
                        ),
                    ),
                );
            }
            return ctx.isType(input, 'boolean');
        case ReflectionKind.bigint:
            if (loose) {
                // Accept bigint, numbers, and numeric strings
                return ctx.or(
                    ctx.isType(input, 'bigint'),
                    ctx.or(
                        ctx.isType(input, 'number'),
                        ctx.and(
                            ctx.isType(input, 'string'),
                            ctx.callExpr((s: string) => /^-?\d+$/.test(s), input),
                        ),
                    ),
                );
            }
            return ctx.isType(input, 'bigint');
        case ReflectionKind.null:
            // Accept both null and undefined as null (JSON serialization convention)
            return ctx.or(ctx.isNull(input), ctx.eq(input, ctx.lit(undefined)));
        case ReflectionKind.undefined:
            // Accept both undefined and null as undefined (JSON serialization convention)
            return ctx.or(ctx.eq(input, ctx.lit(undefined)), ctx.isNull(input));
        case ReflectionKind.literal:
            const lit = (member as TypeLiteral).literal;
            if (loose) {
                if (typeof lit === 'number') {
                    // In loose mode, accept non-empty strings that convert to the same number
                    // Empty string converts to 0 but shouldn't match number literal 0
                    const isNonEmptyNumericString = ctx.and(
                        ctx.isType(input, 'string'),
                        ctx.and(
                            ctx.neq(input, ctx.lit('')), // Exclude empty string
                            ctx.eq(ctx.callExpr(Number, input), ctx.lit(lit)),
                        ),
                    );
                    return ctx.or(ctx.eq(input, ctx.lit(lit)), isNonEmptyNumericString);
                }
                if (typeof lit === 'string') {
                    // In loose mode, accept numbers that convert to the same string
                    return ctx.or(ctx.eq(input, ctx.lit(lit)), ctx.eq(ctx.callExpr(String, input), ctx.lit(lit)));
                }
            }
            return ctx.eq(input, ctx.lit(lit));
        default:
            return undefined;
    }
}

/**
 * Build a scored union handler (O(n) with validation fallthrough).
 *
 * Order of matching:
 * 1. Exact type matches (bigint for bigint, string for non-convertible strings)
 * 2. More specific conversions (numeric strings to bigint/number if available)
 * 3. Less specific matches (string fallback for any value that can be stringified)
 * 4. Object/class type matching
 */
function buildScoredUnion(type: TypeUnion, input: Slot, ctx: Context, state: BuildStateBase): Slot {
    const result = ctx.var_<any>(undefined);
    const matched = ctx.var_(false);

    // Get the guard registry and check loose mode
    const guardRegistry = state.serializer.typeGuards.getRegistry(1);
    const isLoose = ctx.neq(state.optionsSlot.get('loosely'), ctx.lit(false));

    // Sort members: put more specific types first (bigint/number before string)
    // For literals, priority matches their base type (number literal = number, string literal = string)
    const sortedMembers = [...type.types].sort((a, b) => {
        const priority = (m: Type): number => {
            if (m.kind === ReflectionKind.bigint) return 0;
            if (m.kind === ReflectionKind.number) return 1;
            if (m.kind === ReflectionKind.boolean) return 2;
            if (m.kind === ReflectionKind.string) return 10; // String is a fallback
            // For literals, use the type of the literal value
            if (m.kind === ReflectionKind.literal) {
                const lit = (m as TypeLiteral).literal;
                if (typeof lit === 'bigint') return 0;
                if (typeof lit === 'number') return 1;
                if (typeof lit === 'boolean') return 2;
                if (typeof lit === 'string') return 10;
            }
            return 5;
        };
        return priority(a) - priority(b);
    });

    // Loose mode only applies to deserialization, not serialization
    const isDeserialize = state.direction === 'deserialize';
    const canUseLoose = isDeserialize ? isLoose : ctx.lit(false);

    // Pre-pass: Handle Date members specially before primitives
    // Date should match before string for ISO date strings
    const dateMembers = sortedMembers.filter(
        m => m.kind === ReflectionKind.class && (m as TypeClass).classType === Date,
    );
    if (dateMembers.length > 0) {
        const dateMember = dateMembers[0];
        ctx.when(ctx.not(ctx.getVar(matched)), () => {
            // Check for Date instance first
            ctx.when(ctx.isInstance(input, Date), () => {
                const memberResult = state.build(dateMember, input);
                ctx.setVar(result, memberResult);
                ctx.setVar(matched, ctx.lit(true));
            });
        });
        // Check for ISO date string (e.g. '2021-11-24T16:21:13.425Z')
        // ISO dates have 'T' in them and end with 'Z' or have timezone offset
        const isISODateString = (s: string) => {
            if (typeof s !== 'string') return false;
            // Quick check for ISO format: must contain 'T' and be a valid date
            if (!s.includes('T')) return false;
            const d = new Date(s);
            return !isNaN(d.getTime());
        };
        ctx.when(ctx.not(ctx.getVar(matched)), () => {
            ctx.when(ctx.isType(input, 'string'), () => {
                ctx.when(ctx.callExpr(isISODateString, input), () => {
                    const memberResult = state.build(dateMember, input);
                    ctx.setVar(result, memberResult);
                    ctx.setVar(matched, ctx.lit(true));
                });
            });
        });
        // Check for numeric timestamp
        ctx.when(ctx.not(ctx.getVar(matched)), () => {
            ctx.when(ctx.isType(input, 'number'), () => {
                const memberResult = state.build(dateMember, input);
                ctx.setVar(result, memberResult);
                ctx.setVar(matched, ctx.lit(true));
            });
        });
    }

    // Pre-pass: Handle RegExp members specially before string
    // RegExp strings look like "/pattern/flags" - we need to match these before string
    const regexpMembersPrepass = sortedMembers.filter(m => m.kind === ReflectionKind.regexp);
    const hasString = sortedMembers.some(m => m.kind === ReflectionKind.string);
    if (regexpMembersPrepass.length > 0 && hasString && isDeserialize) {
        const regexpMember = regexpMembersPrepass[0];
        ctx.when(ctx.not(ctx.getVar(matched)), () => {
            // Check for RegExp instance first
            ctx.when(ctx.isInstance(input, RegExp), () => {
                const memberResult = state.build(regexpMember, input);
                ctx.setVar(result, memberResult);
                ctx.setVar(matched, ctx.lit(true));
            });
        });
        // Check for serialized RegExp string (e.g. '/pattern/flags')
        const isRegExpString = (s: string) => {
            if (typeof s !== 'string') return false;
            if (!s.startsWith('/') || s.length < 2) return false;
            // Find the last '/' that has only valid flags after it (or nothing)
            const lastSlash = s.lastIndexOf('/');
            if (lastSlash <= 0) return false;
            const flags = s.slice(lastSlash + 1);
            return /^[gimsuy]*$/.test(flags);
        };
        ctx.when(ctx.not(ctx.getVar(matched)), () => {
            ctx.when(ctx.isType(input, 'string'), () => {
                ctx.when(ctx.callExpr(isRegExpString, input), () => {
                    const memberResult = state.build(regexpMember, input);
                    ctx.setVar(result, memberResult);
                    ctx.setVar(matched, ctx.lit(true));
                });
            });
        });
    }

    // Check if union contains both bigint and number (special case)
    const hasBigint = sortedMembers.some(m => m.kind === ReflectionKind.bigint);
    const hasNumber = sortedMembers.some(m => m.kind === ReflectionKind.number);
    const hasBigintAndNumber = hasBigint && hasNumber;

    // First pass: try exact type matches for all primitives
    // For numeric and boolean types in loose deserialize mode, use loose matching
    // EXCEPT: when union has both bigint and number, use exact match for bigint
    // This ensures numeric strings like '3' match number, and 'true'/'1' match boolean, before matching string
    for (const member of sortedMembers) {
        if (!isPrimitive(member)) continue;

        ctx.when(ctx.not(ctx.getVar(matched)), () => {
            // Check if this is a numeric type, numeric literal, or boolean
            const isNumericOrBooleanType =
                member.kind === ReflectionKind.number ||
                member.kind === ReflectionKind.bigint ||
                member.kind === ReflectionKind.boolean ||
                (member.kind === ReflectionKind.literal &&
                    (typeof (member as TypeLiteral).literal === 'number' ||
                        typeof (member as TypeLiteral).literal === 'bigint' ||
                        typeof (member as TypeLiteral).literal === 'boolean'));

            // Special case: when union has both bigint and number, bigint should accept
            // bigint and numeric strings, but NOT numbers (let number handle those)
            if (hasBigintAndNumber && member.kind === ReflectionKind.bigint && isDeserialize) {
                // Custom check: bigint or numeric string (not number)
                const bigintOrStringCheck = ctx.or(
                    ctx.isType(input, 'bigint'),
                    ctx.and(
                        ctx.isType(input, 'string'),
                        ctx.callExpr((s: string) => /^-?\d+$/.test(s), input),
                    ),
                );
                const checkExpr = ctx.ternary(canUseLoose, bigintOrStringCheck, ctx.isType(input, 'bigint'));
                ctx.when(checkExpr, () => {
                    const memberResult = state.build(member, input);
                    ctx.setVar(result, memberResult);
                    ctx.setVar(matched, ctx.lit(true));
                });
            } else if (isNumericOrBooleanType && isDeserialize) {
                // In loose mode, use loose check; in strict mode, use exact check
                const looseCheck = getPrimitiveTypeCheck(member, input, ctx, true);
                const exactCheck = getPrimitiveTypeCheck(member, input, ctx, false);
                if (looseCheck && exactCheck) {
                    const checkExpr = ctx.ternary(canUseLoose, looseCheck, exactCheck);
                    ctx.when(checkExpr, () => {
                        const memberResult = state.build(member, input);
                        ctx.setVar(result, memberResult);
                        ctx.setVar(matched, ctx.lit(true));
                    });
                }
            } else {
                const checkExpr = getPrimitiveTypeCheck(member, input, ctx, false);
                if (checkExpr) {
                    ctx.when(checkExpr, () => {
                        const memberResult = state.build(member, input);
                        ctx.setVar(result, memberResult);
                        ctx.setVar(matched, ctx.lit(true));
                    });
                }
            }
        });
    }

    // Second pass: try loose conversions for string type (only if loosely mode is enabled and deserializing)
    ctx.when(canUseLoose, () => {
        for (const member of sortedMembers) {
            if (!isPrimitive(member)) continue;

            // Skip numeric and boolean types - they were already handled with loose matching in first pass
            const isNumericOrBooleanType =
                member.kind === ReflectionKind.number ||
                member.kind === ReflectionKind.bigint ||
                member.kind === ReflectionKind.boolean ||
                (member.kind === ReflectionKind.literal &&
                    (typeof (member as TypeLiteral).literal === 'number' ||
                        typeof (member as TypeLiteral).literal === 'bigint' ||
                        typeof (member as TypeLiteral).literal === 'boolean'));
            if (isNumericOrBooleanType) continue;

            ctx.when(ctx.not(ctx.getVar(matched)), () => {
                const checkExpr = getPrimitiveTypeCheck(member, input, ctx, true);
                if (checkExpr) {
                    ctx.when(checkExpr, () => {
                        const memberResult = state.build(member, input);
                        ctx.setVar(result, memberResult);
                        ctx.setVar(matched, ctx.lit(true));
                    });
                }
            });
        }
    });

    // Third pass: try built-in class types (RegExp, Date, etc.) using instanceof checks
    // These don't use property scoring since they have special serialization handling
    // Also handle ReflectionKind.regexp which has its own kind (not ReflectionKind.class)
    const regexpMembers = sortedMembers.filter(m => m.kind === ReflectionKind.regexp);
    for (const member of regexpMembers) {
        ctx.when(ctx.not(ctx.getVar(matched)), () => {
            // Check for RegExp instance OR serialized format { $regex: string, $options?: string }
            const isRegExpInstance = ctx.isInstance(input, RegExp);
            const isSerializedRegExp = ctx.and(
                ctx.isType(input, 'object'),
                ctx.and(ctx.not(ctx.isNull(input)), ctx.has(input, '$regex')),
            );
            const isRegExpLike = ctx.or(isRegExpInstance, isSerializedRegExp);
            ctx.when(isRegExpLike, () => {
                const memberResult = state.build(member, input);
                ctx.setVar(result, memberResult);
                ctx.setVar(matched, ctx.lit(true));
            });
        });
    }

    const globalClassMembers = sortedMembers.filter(isGlobalTypeClass);

    for (const member of globalClassMembers) {
        const classType = (member as TypeClass).classType;

        ctx.when(ctx.not(ctx.getVar(matched)), () => {
            ctx.when(ctx.isInstance(input, classType), () => {
                const memberResult = state.build(member, input);
                ctx.setVar(result, memberResult);
                ctx.setVar(matched, ctx.lit(true));
            });
        });
    }

    // Handle enum members - check if input is a valid enum value
    // Use getEnumValueIndexMatcher for case-insensitive matching of enum names
    const enumMembers = sortedMembers.filter(m => m.kind === ReflectionKind.enum);
    for (const member of enumMembers) {
        const enumType = member as TypeEnum;
        const matcher = getEnumValueIndexMatcher(enumType);
        ctx.when(ctx.not(ctx.getVar(matched)), () => {
            // matcher returns -1 if no match, otherwise the index in enumType.values
            ctx.when(ctx.neq(ctx.callExpr(matcher, input), ctx.lit(-1)), () => {
                const memberResult = state.build(member, input);
                ctx.setVar(result, memberResult);
                ctx.setVar(matched, ctx.lit(true));
            });
        });
    }

    // Fourth pass: try class/object types
    // For better union member selection, we score object members by property match
    // Exclude arrays and tuples which are handled separately
    const objectMembers = sortedMembers.filter(
        m => m.kind === ReflectionKind.objectLiteral || m.kind === ReflectionKind.class,
    );
    const arrayMembers = sortedMembers.filter(m => m.kind === ReflectionKind.array || m.kind === ReflectionKind.tuple);

    // Handle object-like members with property-based scoring
    if (objectMembers.length > 0) {
        ctx.when(ctx.not(ctx.getVar(matched)), () => {
            const isObj = ctx.and(
                ctx.isType(input, 'object'),
                ctx.and(ctx.not(ctx.isNull(input)), ctx.not(ctx.callExpr(Array.isArray, input))),
            );

            ctx.when(isObj, () => {
                // Score function: count matching properties for each member
                // Also checks nested literal values for better discriminator support
                const scoreMember = (inputObj: any, memberType: TypeObjectLiteral | TypeClass): number => {
                    // Safety check: only process types that have .types array
                    if (memberType.kind !== ReflectionKind.objectLiteral && memberType.kind !== ReflectionKind.class) {
                        return 0;
                    }
                    const members = resolveTypeMembers(memberType);
                    if (!members || !Array.isArray(members)) return 0;
                    let score = 0;
                    const inputKeys = Object.keys(inputObj);

                    for (const m of members) {
                        if (!isPropertyMemberType(m)) continue;
                        const propName = memberNameToString(m.name);
                        if (inputKeys.includes(propName)) {
                            score += 100; // Property present in input

                            // Check if the member property has a literal type - give bonus for value match
                            if (m.type.kind === ReflectionKind.literal) {
                                const expectedLiteral = (m.type as TypeLiteral).literal;
                                if (inputObj[propName] === expectedLiteral) {
                                    score += 1000; // Strong bonus for literal match
                                } else {
                                    score -= 500; // Penalty for literal mismatch
                                }
                            }

                            // Check nested object literals for discriminator values
                            if (
                                (m.type.kind === ReflectionKind.objectLiteral ||
                                    m.type.kind === ReflectionKind.class) &&
                                typeof inputObj[propName] === 'object' &&
                                inputObj[propName] !== null
                            ) {
                                const nestedMembers = resolveTypeMembers(m.type as TypeObjectLiteral | TypeClass);
                                for (const nm of nestedMembers) {
                                    if (!isPropertyMemberType(nm)) continue;
                                    const nestedPropName = memberNameToString(nm.name);
                                    if (nm.type.kind === ReflectionKind.literal) {
                                        const expectedLiteral = (nm.type as TypeLiteral).literal;
                                        if (inputObj[propName][nestedPropName] === expectedLiteral) {
                                            score += 1000; // Strong bonus for nested literal match
                                        } else if (nestedPropName in inputObj[propName]) {
                                            score -= 500; // Penalty for nested literal mismatch
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Penalize members that don't have properties the input has
                    const memberKeys = members
                        .filter(m => isPropertyMemberType(m))
                        .map(m => memberNameToString((m as any).name));
                    for (const key of inputKeys) {
                        if (!memberKeys.includes(key)) {
                            score -= 10; // Extra property in input not in member
                        }
                    }

                    return score;
                };

                // Find best matching member at runtime
                const findBestMember = (
                    inputObj: any,
                    memberTypes: Type[],
                    scoreFn: typeof scoreMember,
                ): Type | undefined => {
                    let bestMember: Type | undefined;
                    let bestScore = -Infinity;
                    for (const memberType of memberTypes) {
                        const memberScore = scoreFn(inputObj, memberType as TypeObjectLiteral | TypeClass);
                        if (memberScore > bestScore) {
                            bestScore = memberScore;
                            bestMember = memberType;
                        }
                    }
                    return bestMember;
                };

                // Get the best matching member at runtime and build it
                const buildBestMember = (
                    inputObj: any,
                    memberTypes: Type[],
                    scoreFn: typeof scoreMember,
                    st: BuildStateBase,
                ): any => {
                    const bestMember = findBestMember(inputObj, memberTypes, scoreFn);
                    if (!bestMember) return undefined;
                    const serializer = (st as any).serializer;
                    const direction = (st as any).direction;
                    const fn =
                        direction === 'serialize'
                            ? serializer.buildSerializer(bestMember)
                            : serializer.buildDeserializer(bestMember);
                    return fn(inputObj, {});
                };

                const builtResult = ctx.callExpr(
                    buildBestMember,
                    input,
                    ctx.lit(objectMembers),
                    ctx.lit(scoreMember),
                    ctx.lit(state),
                );
                ctx.when(ctx.neq(builtResult, ctx.lit(undefined)), () => {
                    ctx.setVar(result, builtResult);
                    ctx.setVar(matched, ctx.lit(true));
                });
            });
        });
    }

    // Handle special class types (Map, Set) that serialize to arrays
    // These need special handling because their serialized form is an array
    const specialClassMembers = objectMembers.filter(
        m =>
            m.kind === ReflectionKind.class &&
            (m as TypeClass).classType &&
            ((m as TypeClass).classType === Map || (m as TypeClass).classType === Set),
    );

    if (specialClassMembers.length > 0) {
        ctx.when(ctx.not(ctx.getVar(matched)), () => {
            ctx.when(ctx.callExpr(Array.isArray, input), () => {
                // For arrays, try special class types first (Map/Set serialize to arrays)
                const trySpecialTypes = (inputArr: any, members: Type[], st: BuildStateBase): any => {
                    for (const member of members) {
                        if (member.kind !== ReflectionKind.class) continue;
                        const classType = (member as TypeClass).classType;
                        if (classType === Map || classType === Set) {
                            // Try to deserialize as Map or Set
                            try {
                                const serializer = (st as any).serializer;
                                const fn = serializer.buildDeserializer(member);
                                return fn(inputArr, {});
                            } catch {
                                // If deserialization fails, continue to next
                            }
                        }
                    }
                    return undefined;
                };

                const specialResult = ctx.callExpr(
                    trySpecialTypes,
                    input,
                    ctx.lit(specialClassMembers),
                    ctx.lit(state),
                );
                ctx.when(ctx.neq(specialResult, ctx.lit(undefined)), () => {
                    ctx.setVar(result, specialResult);
                    ctx.setVar(matched, ctx.lit(true));
                });
            });
        });
    }

    // Handle array members
    for (const member of arrayMembers) {
        ctx.when(ctx.not(ctx.getVar(matched)), () => {
            ctx.when(ctx.callExpr(Array.isArray, input), () => {
                const memberResult = state.build(member, input);
                ctx.setVar(result, memberResult);
                ctx.setVar(matched, ctx.lit(true));
            });
        });
    }

    // If no match, throw error
    ctx.when(ctx.not(ctx.getVar(matched)), () => {
        state.throw_(type, input, 'No union member matches');
    });

    return ctx.getVar(result);
}

/**
 * Main union handler that selects the appropriate strategy.
 */
export const handleUnion: TypeHandler<TypeUnion> = (type, input, ctx, state) => {
    // === PHASE 1: Discriminator Detection (O(1)) ===
    const disc = detectDiscriminator(type);
    if (disc) {
        return buildDiscriminatedUnion(type, disc, input, ctx, state);
    }

    // === PHASE 2: Literal Set Optimization (O(1)) ===
    if (isAllLiterals(type) && type.types.length >= UNION_LITERAL_THRESHOLD) {
        return buildLiteralSetUnion(type, input, ctx, state);
    }

    // === PHASE 3: Scored Resolution ===
    return buildScoredUnion(type, input, ctx, state);
};

/**
 * Register union handler on a serializer.
 */
export function registerUnionHandler(serializer: { serializeRegistry: any; deserializeRegistry: any }): void {
    serializer.serializeRegistry.register(ReflectionKind.union, handleUnion);
    serializer.deserializeRegistry.register(ReflectionKind.union, handleUnion);
}
