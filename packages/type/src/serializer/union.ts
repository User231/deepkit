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
    TypeLiteral,
    TypeObjectLiteral,
    TypeUnion,
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
                // Accept numbers and numeric strings
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
            if (loose && typeof lit === 'string') {
                // In loose mode, also accept matching value
                return ctx.eq(input, ctx.lit(lit));
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
    const sortedMembers = [...type.types].sort((a, b) => {
        // Put bigint and number before string (they're more specific for numeric inputs)
        const priority = (m: Type) => {
            if (m.kind === ReflectionKind.bigint) return 0;
            if (m.kind === ReflectionKind.number) return 1;
            if (m.kind === ReflectionKind.boolean) return 2;
            if (m.kind === ReflectionKind.string) return 10; // String is a fallback
            return 5;
        };
        return priority(a) - priority(b);
    });

    // First pass: try exact type matches for all primitives
    for (const member of sortedMembers) {
        if (!isPrimitive(member)) continue;

        ctx.when(ctx.not(ctx.getVar(matched)), () => {
            const checkExpr = getPrimitiveTypeCheck(member, input, ctx, false);
            if (checkExpr) {
                ctx.when(checkExpr, () => {
                    const memberResult = state.build(member, input);
                    ctx.setVar(result, memberResult);
                    ctx.setVar(matched, ctx.lit(true));
                });
            }
        });
    }

    // Second pass: try loose conversions (only if loosely mode is enabled)
    ctx.when(isLoose, () => {
        for (const member of sortedMembers) {
            if (!isPrimitive(member)) continue;

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

    // Third pass: try class/object types
    // For union member selection, we only check basic type compatibility (is it an object?)
    // We don't run full validation here - that happens during actual serialization
    for (const member of sortedMembers) {
        if (isPrimitive(member)) continue;

        ctx.when(ctx.not(ctx.getVar(matched)), () => {
            if (isObjectLike(member)) {
                const isObj = ctx.and(
                    ctx.isType(input, 'object'),
                    ctx.and(ctx.not(ctx.isNull(input)), ctx.not(ctx.callExpr(Array.isArray, input))),
                );

                ctx.when(isObj, () => {
                    const memberResult = state.build(member, input);
                    ctx.setVar(result, memberResult);
                    ctx.setVar(matched, ctx.lit(true));
                });
            } else if (member.kind === ReflectionKind.array) {
                ctx.when(ctx.callExpr(Array.isArray, input), () => {
                    const memberResult = state.build(member, input);
                    ctx.setVar(result, memberResult);
                    ctx.setVar(matched, ctx.lit(true));
                });
            }
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
