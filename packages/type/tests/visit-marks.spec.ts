import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { typeOf, visit } from '../src/reflection/reflection.js';
import { ReflectionKind, Type, stringifyType } from '../src/reflection/type.js';
import { cast } from '../src/serializer-facade.js';
import { serializer } from '../src/serializer/serializer.js';
import { Maximum, Minimum, integer } from '../src/type-annotations.js';
import { assert } from '../src/typeguard.js';
import { ValidationError } from '../src/validator.js';

// A walk over a type keeps what it has met in the walk itself. It used to mark the TYPE
// (`jit.visitStack = {id, depth}`), the id from a module counter — and `visit()` and
// `stringifyType()` each had a counter of their own writing that one field. When the two
// counters met, a mark left by one read as "seen in this walk" to the other.

interface Leaf {
    name: string;
}
interface Tree {
    leaf: Leaf;
}

/** Every kind `visit` reaches in `type`, in order; `circular` = it reported a cycle. */
function walk(type: Type): { kinds: ReflectionKind[]; circular: boolean } {
    const kinds: ReflectionKind[] = [];
    let circular = false;
    visit(
        type,
        t => {
            kinds.push(t.kind);
        },
        () => {
            circular = true;
        },
    );
    return { kinds, circular };
}

test('visit: a type printed by stringifyType is not a cycle to a later walk, whatever the two have counted', () => {
    const tree = typeOf<Tree>();
    const whole = walk(tree);
    expect(whole.circular).toBe(false);
    // Tree → leaf → Leaf → name → string
    expect(whole.kinds).toEqual([ReflectionKind.objectLiteral, ReflectionKind.propertySignature, ReflectionKind.objectLiteral, ReflectionKind.propertySignature, ReflectionKind.string]);

    // `Leaf` sits at depth 2 of the walk; printed on its own, stringifyType meets it at depth 1.
    const leaf = (tree as any).types[0].type as Type;
    expect(leaf.kind).toBe(ReflectionKind.objectLiteral);

    // The two counters start apart. Each round moves them one step relative to each other,
    // first one way, then the other — so whichever was ahead, they meet within the rounds.
    for (let round = 0; round < 400; round++) {
        stringifyType(leaf);
        stringifyType(leaf);
        expect(walk(tree)).toEqual(whole);
    }
    for (let round = 0; round < 1200; round++) {
        walk(tree);
        stringifyType(leaf);
        expect(walk(tree)).toEqual(whole);
    }
});

test('stringifyType: a type a walk has visited is not a recursion to a later print', () => {
    const tree = typeOf<Tree>();
    const printed = stringifyType(tree, { showFullDefinition: true });
    expect(printed).toContain('name: string');
    expect(printed).not.toContain('Recursion');
    for (let round = 0; round < 400; round++) {
        walk(tree);
        walk(tree);
        expect(stringifyType(tree, { showFullDefinition: true })).toBe(printed);
    }
    for (let round = 0; round < 1200; round++) {
        stringifyType(tree, { showFullDefinition: true });
        walk(tree);
        expect(stringifyType(tree, { showFullDefinition: true })).toBe(printed);
    }
});

interface Rates {
    startRate: number & Minimum<1> & Maximum<10>;
    steps: integer & Minimum<1>;
}
interface Payload {
    id: string;
    profile: 'stairs';
    params: Rates;
}

test('assert: the validators of a nested object run however often its types were printed in between', () => {
    const good = { id: '1', profile: 'stairs', params: { startRate: 5, steps: 2 } };
    const bad = { id: '1', profile: 'stairs', params: { startRate: 50, steps: 2 } };
    const params = (typeOf<Payload>() as any).types[2].type as Type;
    for (let round = 0; round < 800; round++) {
        // What an error message does to a type between two validations of it.
        stringifyType(params);
        if (round % 2) stringifyType(params);
        expect(cast<Payload>(good)).toEqual(good);
        expect(() => assert<Payload>(bad)).toThrow(ValidationError);
    }
});

interface Chain {
    // Met first, breadth-first: the cycle ends the walk before `deep` is reached.
    next?: Chain;
    deep: { limits: { rate: number & Minimum<1> } };
}

test('assert: a recursive type still runs the validators that lie past its cycle', () => {
    expect(walk(typeOf<Chain>()).circular).toBe(true);
    assert<Chain>({ deep: { limits: { rate: 1 } } });
    assert<Chain>({ next: { deep: { limits: { rate: 3 } } }, deep: { limits: { rate: 1 } } });
    expect(() => assert<Chain>({ deep: { limits: { rate: 0 } } })).toThrow(ValidationError);
    expect(() => assert<Chain>({ next: { deep: { limits: { rate: 0 } } }, deep: { limits: { rate: 1 } } })).toThrow(ValidationError);
});

test('buildFastTypeGuard: a type with validators compiles, and the validators decide', () => {
    // It has no errors to collect — and used to emit the push anyway, as the statement
    // `{}.errors.push(…)`, which does not parse.
    const flat = serializer.buildFastTypeGuard<Rates>(typeOf<Rates>());
    expect(flat({ startRate: 5, steps: 2 })).toBe(true);
    expect(flat({ startRate: 50, steps: 2 })).toBe(false);
    expect(flat({ startRate: 5, steps: 0 })).toBe(false);
    expect(flat({ startRate: 5, steps: 1.5 })).toBe(false);

    const nested = serializer.buildFastTypeGuard<Payload>(typeOf<Payload>());
    expect(nested({ id: '1', profile: 'stairs', params: { startRate: 5, steps: 2 } })).toBe(true);
    expect(nested({ id: '1', profile: 'stairs', params: { startRate: 0, steps: 2 } })).toBe(false);
    expect(nested({ id: '1', profile: 'other', params: { startRate: 5, steps: 2 } })).toBe(false);
});
