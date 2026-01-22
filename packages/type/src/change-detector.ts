/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { Context, Slot, empty, jit, toFastProperties } from '@deepkit/core';

import { Changes, ItemChanges, changeSetSymbol } from './changes.js';
import { ReflectionClass } from './reflection/reflection.js';
import { ReflectionKind, Type, TypeIndexSignature, referenceAnnotation } from './reflection/type.js';
import { getConverterForSnapshot } from './snapshot.js';

function genericEqualArray(a: any[], b: any[]): boolean {
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; i++) {
        if (!genericEqual(a[i], b[i])) return false;
    }

    return true;
}

function genericEqualObject(a: { [name: string]: any }, b: { [name: string]: any }): boolean {
    for (let i in a) {
        if (!a.hasOwnProperty(i)) continue;
        if (!genericEqual(a[i], b[i])) return false;
    }

    //is there a faster way?
    for (let i in b) {
        if (!b.hasOwnProperty(i)) continue;
        if (!genericEqual(a[i], b[i])) return false;
    }

    return true;
}

/**
 * This is a comparator function for the snapshots. They are either string, number, boolean, array, or objects.
 * No date, moment, or custom classes involved here.
 */
export function genericEqual(a: any, b: any): boolean {
    //is array, the fast way
    const aIsArray = a && 'string' !== typeof a && 'function' === a.slice && 'number' === typeof a.length;
    const bIsArray = b && 'string' !== typeof b && 'function' === b.slice && 'number' === typeof b.length;
    if (aIsArray) return bIsArray ? genericEqualArray(a, b) : false;
    if (bIsArray) return aIsArray ? genericEqualArray(a, b) : false;

    const aIsObject = 'object' === typeof a && a !== null;
    const bIsObject = 'object' === typeof b && b !== null;
    if (aIsObject) return bIsObject ? genericEqualObject(a, b) : false;
    if (aIsObject) return bIsObject ? genericEqualObject(a, b) : false;

    return a === b;
}

/**
 * Check if a numeric index signature key
 */
function isNumeric(value: string): boolean {
    return !isNaN(parseFloat(value)) && isFinite(value as any);
}

/**
 * Build state for change detector JIT function generation.
 */
interface ChangeDetectorState {
    /** Map from type to its cached detector function var */
    fnCache: Map<Type, Slot<Function>>;
    /** Types currently being processed (for circular detection) */
    typeStack: Set<Type>;
}

/**
 * Check if a key is already handled by $inc or $unset in the changeSet.
 */
function hasChangeSet(changeSet: any, key: string): boolean {
    return (changeSet.$inc && key in changeSet.$inc) || (changeSet.$unset && key in changeSet.$unset);
}

/**
 * Build comparator code for a specific type.
 */
function buildComparator(
    ctx: Context,
    type: Type,
    last: Slot,
    current: Slot,
    item: Slot,
    changedKey: Slot<string>,
    changesSlot: Slot,
    changeSetSlot: Slot,
    onChanged: () => void,
    state: ChangeDetectorState,
    schema?: ReflectionClass<any>,
): void {
    const hasChangeSetFn = hasChangeSet;

    // Check if this key is already handled by $inc or $unset
    ctx.when(ctx.not(ctx.callExpr<boolean>(hasChangeSetFn, changeSetSlot, changedKey)), () => {
        if (type.kind === ReflectionKind.array) {
            // Array comparison
            buildArrayComparator(
                ctx,
                type,
                last,
                current,
                item,
                changedKey,
                changesSlot,
                changeSetSlot,
                onChanged,
                state,
            );
        } else if (
            (type.kind === ReflectionKind.class || type.kind === ReflectionKind.objectLiteral) &&
            type.types.length
        ) {
            const classSchema = ReflectionClass.from(type);

            if (referenceAnnotation.getFirst(type) !== undefined) {
                // Reference type - compare primary keys
                buildReferenceComparator(
                    ctx,
                    classSchema,
                    last,
                    current,
                    item,
                    changedKey,
                    changesSlot,
                    changeSetSlot,
                    onChanged,
                    state,
                );
            } else {
                // Nested object - use recursive detector
                buildNestedObjectComparator(
                    ctx,
                    classSchema,
                    type,
                    last,
                    current,
                    item,
                    changedKey,
                    changesSlot,
                    changeSetSlot,
                    onChanged,
                    state,
                );
            }
        } else if (
            type.kind === ReflectionKind.any ||
            type.kind === ReflectionKind.never ||
            type.kind === ReflectionKind.union
        ) {
            // Use generic comparison for any/never/union types
            ctx.when(ctx.not(ctx.callExpr<boolean>(genericEqual, last, current)), () => {
                ctx.set(changesSlot, changedKey, ctx.get(item, changedKey));
                onChanged();
            });
        } else {
            // Primitive comparison (number, string, boolean, etc.)
            ctx.when(ctx.neq(last, current), () => {
                ctx.set(changesSlot, changedKey, ctx.get(item, changedKey));
                onChanged();
            });
        }
    });
}

/**
 * Build array comparison.
 */
function buildArrayComparator(
    ctx: Context,
    type: Type & { kind: ReflectionKind.array; type: Type },
    last: Slot,
    current: Slot,
    item: Slot,
    changedKey: Slot<string>,
    changesSlot: Slot,
    changeSetSlot: Slot,
    onChanged: () => void,
    state: ChangeDetectorState,
): void {
    // Both null/undefined - no change
    ctx.when(
        ctx.and(ctx.not(current), ctx.not(last)),
        () => {
            // No change - both are null/undefined
        },
        () => {
            // At least one exists
            ctx.when(
                ctx.or(ctx.and(current, ctx.not(last)), ctx.and(ctx.not(current), last)),
                () => {
                    // One exists, other doesn't - change
                    ctx.set(changesSlot, changedKey, ctx.get(item, changedKey));
                    onChanged();
                },
                () => {
                    // Both exist - compare lengths first, then elements
                    ctx.when(
                        ctx.neq(ctx.len(current), ctx.len(last)),
                        () => {
                            // Different lengths - change
                            ctx.set(changesSlot, changedKey, ctx.get(item, changedKey));
                            onChanged();
                        },
                        () => {
                            // Same length - compare elements
                            const changed = ctx.var_<boolean>(false);

                            ctx.loop(last, (elem, idx) => {
                                ctx.when(ctx.not(ctx.getVar(changed)), () => {
                                    const lastElem = ctx.at(last, idx);
                                    const currentElem = ctx.at(current, idx);

                                    // For array elements, we need to compare them
                                    // Using nested comparator (simplified - using genericEqual for elements)
                                    if (
                                        type.type.kind === ReflectionKind.any ||
                                        type.type.kind === ReflectionKind.never ||
                                        type.type.kind === ReflectionKind.union ||
                                        type.type.kind === ReflectionKind.array ||
                                        type.type.kind === ReflectionKind.class ||
                                        type.type.kind === ReflectionKind.objectLiteral
                                    ) {
                                        ctx.when(
                                            ctx.not(ctx.callExpr<boolean>(genericEqual, lastElem, currentElem)),
                                            () => {
                                                ctx.setVar(changed, ctx.lit(true));
                                            },
                                        );
                                    } else {
                                        ctx.when(ctx.neq(lastElem, currentElem), () => {
                                            ctx.setVar(changed, ctx.lit(true));
                                        });
                                    }
                                });
                            });

                            ctx.when(ctx.getVar(changed), () => {
                                ctx.set(changesSlot, changedKey, ctx.get(item, changedKey));
                                onChanged();
                            });
                        },
                    );
                },
            );
        },
    );
}

/**
 * Build reference type comparison (compare primary keys).
 */
function buildReferenceComparator(
    ctx: Context,
    classSchema: ReflectionClass<any>,
    last: Slot,
    current: Slot,
    item: Slot,
    changedKey: Slot<string>,
    changesSlot: Slot,
    changeSetSlot: Slot,
    onChanged: () => void,
    state: ChangeDetectorState,
): void {
    // Both null/undefined - no change
    ctx.when(
        ctx.and(ctx.not(current), ctx.not(last)),
        () => {
            // No change
        },
        () => {
            ctx.when(
                ctx.or(ctx.and(current, ctx.not(last)), ctx.and(ctx.not(current), last)),
                () => {
                    // One exists, other doesn't - change
                    ctx.set(changesSlot, changedKey, ctx.get(item, changedKey));
                    onChanged();
                },
                () => {
                    // Both exist - compare primary key fields
                    const changed = ctx.var_<boolean>(false);

                    for (const primaryField of classSchema.getPrimaries()) {
                        const pkName = primaryField.getNameAsString();
                        const lastPk = ctx.get(last, pkName);
                        const currentPk = ctx.get(current, pkName);

                        ctx.when(ctx.not(ctx.getVar(changed)), () => {
                            // Compare primary key values
                            if (
                                primaryField.type.kind === ReflectionKind.any ||
                                primaryField.type.kind === ReflectionKind.never ||
                                primaryField.type.kind === ReflectionKind.union
                            ) {
                                ctx.when(ctx.not(ctx.callExpr<boolean>(genericEqual, lastPk, currentPk)), () => {
                                    ctx.setVar(changed, ctx.lit(true));
                                });
                            } else {
                                ctx.when(ctx.neq(lastPk, currentPk), () => {
                                    ctx.setVar(changed, ctx.lit(true));
                                });
                            }
                        });
                    }

                    ctx.when(ctx.getVar(changed), () => {
                        ctx.set(changesSlot, changedKey, ctx.get(item, changedKey));
                        onChanged();
                    });
                },
            );
        },
    );
}

/**
 * Build nested object comparison using recursive detector.
 */
function buildNestedObjectComparator(
    ctx: Context,
    classSchema: ReflectionClass<any>,
    type: Type,
    last: Slot,
    current: Slot,
    item: Slot,
    changedKey: Slot<string>,
    changesSlot: Slot,
    changeSetSlot: Slot,
    onChanged: () => void,
    state: ChangeDetectorState,
): void {
    // Both null/undefined - no change
    ctx.when(
        ctx.and(ctx.not(current), ctx.not(last)),
        () => {
            // No change
        },
        () => {
            ctx.when(
                ctx.or(ctx.and(current, ctx.not(last)), ctx.and(ctx.not(current), last)),
                () => {
                    // One exists, other doesn't - change
                    ctx.set(changesSlot, changedKey, ctx.get(item, changedKey));
                    onChanged();
                },
                () => {
                    // Both exist - use nested change detector
                    let fnSlot = state.fnCache.get(type);

                    if (!fnSlot) {
                        // Check for circular reference
                        if (state.typeStack.has(type)) {
                            // Circular reference - use lazy initialization
                            fnSlot = ctx.var_<Function>(undefined as any);
                            state.fnCache.set(type, fnSlot);

                            // Build the nested detector lazily
                            const nestedDetector = createJITChangeDetectorForSnapshot(classSchema, state);
                            ctx.setVar(fnSlot, ctx.lit(nestedDetector));
                        } else {
                            // Not circular - build inline
                            state.typeStack.add(type);
                            try {
                                const nestedDetector = createJITChangeDetectorForSnapshot(classSchema, state);
                                fnSlot = ctx.var_<Function>(ctx.lit(nestedDetector));
                                state.fnCache.set(type, fnSlot);
                            } finally {
                                state.typeStack.delete(type);
                            }
                        }
                    }

                    const itemValue = ctx.get(item, changedKey);
                    const thisChanged = ctx.let(
                        ctx.callExpr<ItemChanges<any> | undefined>(
                            (fn: Function, l: any, c: any, i: any) => fn(l, c, i),
                            ctx.getVar(fnSlot),
                            last,
                            current,
                            itemValue,
                        ),
                    );

                    ctx.when(ctx.and(thisChanged, ctx.not(ctx.callExpr<boolean>(empty, thisChanged))), () => {
                        ctx.set(changesSlot, changedKey, itemValue);
                        onChanged();
                    });
                },
            );
        },
    );
}

/**
 * Sort index signatures: literals first, then numbers, then strings.
 */
function sortSignatures(signatures: TypeIndexSignature[]): void {
    signatures.sort((a, b) => {
        const aIsLiteral =
            a.index.kind === ReflectionKind.literal ||
            (a.index.kind === ReflectionKind.union && a.index.types.some(v => v.kind === ReflectionKind.literal));
        const bIsLiteral =
            b.index.kind === ReflectionKind.literal ||
            (b.index.kind === ReflectionKind.union && b.index.types.some(v => v.kind === ReflectionKind.literal));
        const aIsNumber =
            a.index.kind === ReflectionKind.number ||
            (a.index.kind === ReflectionKind.union && a.index.types.some(v => v.kind === ReflectionKind.number));

        if (aIsLiteral) return -1;
        if (aIsNumber && !bIsLiteral) return -1;
        return +1;
    });
}

/**
 * Build index check for index signature key.
 */
function buildIndexCheck(ctx: Context, keySlot: Slot<string>, indexType: Type): Slot<boolean> {
    if (indexType.kind === ReflectionKind.number) {
        return ctx.callExpr<boolean>(isNumeric, keySlot);
    } else if (indexType.kind === ReflectionKind.string || indexType.kind === ReflectionKind.any) {
        return ctx.eq(ctx.typeof_(keySlot), ctx.lit('string'));
    } else if (indexType.kind === ReflectionKind.symbol) {
        return ctx.eq(ctx.typeof_(keySlot), ctx.lit('symbol'));
    } else if (indexType.kind === ReflectionKind.union) {
        // OR of all member checks
        let result: Slot<boolean> | undefined;
        for (const member of indexType.types) {
            const check = buildIndexCheck(ctx, keySlot, member);
            result = result ? ctx.or(result, check) : check;
        }
        return result || ctx.lit(false);
    }
    return ctx.lit(true);
}

function createJITChangeDetectorForSnapshot(
    schema: ReflectionClass<any>,
    parentState?: ChangeDetectorState,
): (lastSnapshot: any, currentSnapshot: any, item: any) => ItemChanges<any> | undefined {
    const state: ChangeDetectorState = {
        fnCache: parentState?.fnCache ?? new Map(),
        typeStack: parentState?.typeStack ?? new Set(),
    };

    return jit.fn(
        jit.arg<any>(), // last snapshot
        jit.arg<any>(), // current snapshot
        jit.arg<any>(), // item
        (ctx: Context, last: Slot<any>, current: Slot<any>, item: Slot<any>) => {
            // Get or create changeSet from item
            const changeSetFromItem = ctx.callExpr<ItemChanges<any> | undefined>((i: any) => i[changeSetSymbol], item);
            const changeSet = ctx.let(
                ctx.ternary(changeSetFromItem, changeSetFromItem, ctx.newExpr(ItemChanges, ctx.lit(undefined), item)),
            );

            // Create changes object to collect detected changes
            const changes = ctx.let(ctx.objExpr<Record<string, any>>());

            // Track existing property names for index signature exclusion
            const existingNames: string[] = [];

            // Process each property
            for (const property of schema.getProperties()) {
                if (property.isBackReference()) continue;

                const name = property.getNameAsString();
                existingNames.push(name);

                const nameSlot = ctx.lit(name);
                const lastProp = ctx.get(last, name);
                const currentProp = ctx.get(current, name);

                buildComparator(
                    ctx,
                    property.type,
                    lastProp,
                    currentProp,
                    item,
                    nameSlot,
                    changes,
                    changeSet,
                    () => {
                        /* no break needed at top level */
                    },
                    state,
                    schema,
                );
            }

            // Process index signatures
            const signatures = (schema.type.types as Type[]).filter(
                v => v.kind === ReflectionKind.indexSignature,
            ) as TypeIndexSignature[];

            if (signatures.length) {
                sortSignatures(signatures);

                // Process current keys not in existing properties
                ctx.forIn(current, (key, _value) => {
                    // Skip if key is in existing property names
                    let skipCondition: Slot<boolean> | undefined;
                    for (const name of existingNames) {
                        const check = ctx.eq(key, ctx.lit(name));
                        skipCondition = skipCondition ? ctx.or(skipCondition, check) : check;
                    }

                    if (skipCondition) {
                        ctx.when(
                            skipCondition,
                            () => {
                                // Skip - already handled
                            },
                            () => {
                                buildIndexSignatureComparison(
                                    ctx,
                                    signatures,
                                    key,
                                    last,
                                    current,
                                    item,
                                    changes,
                                    changeSet,
                                    state,
                                );
                            },
                        );
                    } else {
                        buildIndexSignatureComparison(
                            ctx,
                            signatures,
                            key,
                            last,
                            current,
                            item,
                            changes,
                            changeSet,
                            state,
                        );
                    }
                });

                // Check for keys in last but not in current (deleted)
                ctx.forIn(last, (key, _value) => {
                    ctx.when(ctx.not(ctx.has(current, key)), () => {
                        ctx.set(changes, key, ctx.get(item, key));
                    });
                });
            }

            // Merge detected changes into changeSet
            ctx.callExpr<void>((cs: ItemChanges<any>, c: Record<string, any>) => cs.mergeSet(c), changeSet, changes);

            // Return changeSet if not empty, undefined otherwise
            return ctx.ternary(ctx.get<boolean>(changeSet, 'empty'), ctx.lit(undefined), changeSet);
        },
    );
}

/**
 * Build index signature comparison for a dynamic key.
 */
function buildIndexSignatureComparison(
    ctx: Context,
    signatures: TypeIndexSignature[],
    key: Slot<string>,
    last: Slot,
    current: Slot,
    item: Slot,
    changes: Slot,
    changeSet: Slot,
    state: ChangeDetectorState,
): void {
    // Build condition chain for signatures
    const cases: Array<[Slot<boolean>, () => void]> = [];

    for (const signature of signatures) {
        const check = buildIndexCheck(ctx, key, signature.index);
        cases.push([
            check,
            () => {
                const lastValue = ctx.get(last, key);
                const currentValue = ctx.get(current, key);

                buildComparator(
                    ctx,
                    signature.type,
                    lastValue,
                    currentValue,
                    item,
                    key,
                    changes,
                    changeSet,
                    () => {
                        /* no break needed */
                    },
                    state,
                );
            },
        ]);
    }

    if (cases.length > 0) {
        ctx.cond(cases);
    }
}

const changeDetectorSymbol = Symbol('changeDetector');

export function getChangeDetector<T extends object>(
    classSchema: ReflectionClass<T>,
): (last: any, current: any, item: T) => ItemChanges<T> | undefined {
    const jitContainer = classSchema.getJitContainer();
    if (jitContainer[changeDetectorSymbol]) return jitContainer[changeDetectorSymbol];

    jitContainer[changeDetectorSymbol] = createJITChangeDetectorForSnapshot(classSchema);
    toFastProperties(jitContainer);

    return jitContainer[changeDetectorSymbol];
}

export function buildChanges<T extends object>(
    classSchema: ReflectionClass<T>,
    lastSnapshot: any,
    item: T,
): Changes<T> {
    const currentSnapshot = getConverterForSnapshot(classSchema)(item);
    const detector = getChangeDetector(classSchema);
    return (detector(lastSnapshot, currentSnapshot, item) as Changes<T>) || new Changes<T>();
}
