import { test } from 'node:test';

import { Builder } from '@deepkit/core';
import { expect } from '@deepkit/run/expect';

import {
    BackReference,
    Email,
    JsonBuildContext,
    MongoId,
    Positive,
    PrimaryKey,
    Reference,
    ReflectionKind,
    Serializer,
    Type,
    UUID,
    ValidationError,
    assert,
    integer,
    is,
    registerTypeGuards,
    serializer,
    typeGuard,
    typeOf,
    uint8,
    validate,
} from '../index.js';

// A fast guard answers for ANY value: what does not have the type's shape is `false`, never a
// throw. An object's guard is one `&&` chain behind its own object check — when its members'
// guards are expressions. A member guard that emits STATEMENTS used to have them placed above
// that chain, where they ran before the object check and read `value.<member>` of a `null`.
//
// Which members those are was a prediction, a list kept by hand, and it was wrong for a tuple,
// a `Reference` and a discriminated union (and before that, for a type with validators —
// fast-guard-validators.spec.ts). Nothing is predicted any more: the statements a member's
// build emitted are what decides, and they are placed behind the object check.

/** Values that are no object of any of the types below. */
const notObjects = [null, undefined, 'x', 5, 0, true, false, Symbol.iterator, () => 1];

interface WithTuple {
    id: string;
    pair: [string, number];
}

test('a tuple member: no value makes the guard throw', () => {
    const guard = typeGuard<WithTuple>();
    for (const value of notObjects) expect(guard(value)).toBe(false);
    expect(guard({})).toBe(false);
    expect(guard({ id: 'a' })).toBe(false);
    expect(guard({ id: 'a', pair: null })).toBe(false);
    expect(guard({ id: 'a', pair: ['a'] })).toBe(false);
    expect(guard({ id: 'a', pair: ['a', 'b'] })).toBe(false);
    expect(guard({ id: 'a', pair: ['a', 1, 2] })).toBe(false);
    expect(guard({ id: 'a', pair: ['a', 1] })).toBe(true);
    // The wrong-typed sibling is found whatever `pair` is.
    expect(guard({ id: 1, pair: null })).toBe(false);

    // assert() goes through the fast guard first (the type has no validators), and a Set
    // checks its entries through one: both threw the TypeError too.
    expect(() => assert<WithTuple>(null)).toThrow(ValidationError);
    expect(() => assert<WithTuple[]>([null])).toThrow(ValidationError);
    expect(() => assert<WithTuple>({ id: 'a', pair: ['a', 1] })).not.toThrow();
    expect(validate<Set<WithTuple>>(new Set([null])).map(v => [v.path, v.code])).toEqual([['', 'type']]);
    expect(is<Set<WithTuple>>(new Set([{ id: 'a', pair: ['a', 1] }]))).toBe(true);
});

type Shape = { kind: 'circle'; radius: number } | { kind: 'square'; side: number };
interface WithUnion {
    id: string;
    shape: Shape;
}

test('a discriminated union member', () => {
    const guard = typeGuard<WithUnion>();
    for (const value of notObjects) expect(guard(value)).toBe(false);
    expect(guard({})).toBe(false);
    expect(guard({ id: 'a' })).toBe(false);
    expect(guard({ id: 'a', shape: null })).toBe(false);
    expect(guard({ id: 'a', shape: 'circle' })).toBe(false);
    expect(guard({ id: 'a', shape: { kind: 'circle', side: 1 } })).toBe(false);
    expect(guard({ id: 'a', shape: { kind: 'circle', radius: 1 } })).toBe(true);
    expect(guard({ id: 'a', shape: { kind: 'square', side: 1 } })).toBe(true);
    expect(() => assert<WithUnion>(null)).toThrow(ValidationError);
    expect(() => assert<WithUnion>({ id: 'a' })).toThrow(ValidationError);
});

class User {
    id: number & PrimaryKey = 0;
    name: string = '';
}
class Post {
    id: number & PrimaryKey = 0;
}
interface WithReference {
    id: string;
    owner: User & Reference;
}

test('a reference member', () => {
    const guard = typeGuard<WithReference>();
    for (const value of notObjects) expect(guard(value)).toBe(false);
    expect(guard({})).toBe(false);
    expect(guard({ id: 'a', owner: 'x' })).toBe(false);
    expect(guard({ id: 'a', owner: { id: 'x' } })).toBe(false);
    expect(guard({ id: 'a', owner: 5 })).toBe(true);
    expect(guard({ id: 'a', owner: { id: 5 } })).toBe(true);
    // Not populated: nothing to check (absent-key.spec.ts).
    expect(guard({ id: 'a' })).toBe(true);
    expect(() => assert<WithReference>(null)).toThrow(ValidationError);
});

enum Level {
    low,
    high,
}

test('every kind of member, one level down: missing, null and wrong-typed on the way', () => {
    // Not a list of the kinds that emit statements — a list of kinds, as long as it gets. A
    // kind that starts to emit statements, or a new one that does, fails here if its statements
    // are ever placed above the object check again.
    const guards: { [kind: string]: (value: unknown) => boolean } = {
        string: typeGuard<{ o: { m: string } }>(),
        number: typeGuard<{ o: { m: number } }>(),
        bigint: typeGuard<{ o: { m: bigint } }>(),
        literal: typeGuard<{ o: { m: 'a' } }>(),
        literalUnion: typeGuard<{ o: { m: 'a' | 'b' } }>(),
        primitiveUnion: typeGuard<{ o: { m: string | number | null } }>(),
        objectUnion: typeGuard<{ o: { m: { a: string } | { b: number } } }>(),
        discriminatedUnion: typeGuard<{ o: { m: Shape } }>(),
        objectOrPrimitive: typeGuard<{ o: { m: { a: string } | string } }>(),
        enum: typeGuard<{ o: { m: Level } }>(),
        templateLiteral: typeGuard<{ o: { m: `a${number}` } }>(),
        regexp: typeGuard<{ o: { m: RegExp } }>(),
        uuid: typeGuard<{ o: { m: UUID } }>(),
        mongoId: typeGuard<{ o: { m: MongoId } }>(),
        email: typeGuard<{ o: { m: Email } }>(),
        integer: typeGuard<{ o: { m: integer } }>(),
        uint8: typeGuard<{ o: { m: uint8 } }>(),
        positive: typeGuard<{ o: { m: Positive } }>(),
        tuple: typeGuard<{ o: { m: [string, number] } }>(),
        optionalTuple: typeGuard<{ o: { m?: [string, number] } }>(),
        restTuple: typeGuard<{ o: { m: [string, ...number[]] } }>(),
        tupleOfObjects: typeGuard<{ o: { m: [{ a: string }, { b: [number] }] } }>(),
        array: typeGuard<{ o: { m: string[] } }>(),
        arrayOfTuples: typeGuard<{ o: { m: [string, number][] } }>(),
        object: typeGuard<{ o: { m: { a: string } } }>(),
        indexSignature: typeGuard<{ o: { m: { [key: string]: number } } }>(),
        class: typeGuard<{ o: { m: User } }>(),
        reference: typeGuard<{ o: { m: User & Reference } }>(),
        backReference: typeGuard<{ o: { m: Post[] & BackReference } }>(),
        date: typeGuard<{ o: { m: Date } }>(),
        set: typeGuard<{ o: { m: Set<[string, number]> } }>(),
        map: typeGuard<{ o: { m: Map<string, Shape> } }>(),
        typedArray: typeGuard<{ o: { m: Uint8Array } }>(),
        method: typeGuard<{ o: { m(): void } }>(),
        function: typeGuard<{ o: { m: () => void } }>(),
        unknown: typeGuard<{ o: { m: unknown } }>(),
        any: typeGuard<{ o: { m: any } }>(),
    };

    const threw: string[] = [];
    const accepted: string[] = [];
    const values: [string, unknown][] = [
        ['{}', {}],
        ['{o:null}', { o: null }],
        ['{o:undefined}', { o: undefined }],
        ['{o:5}', { o: 5 }],
        ['{o:"x"}', { o: 'x' }],
    ];
    for (const value of notObjects) values.push([String(value), value]);

    for (const [kind, guard] of Object.entries(guards)) {
        for (const [label, value] of values) {
            try {
                if (guard(value)) accepted.push(`${kind} ${label}`);
            } catch {
                threw.push(`${kind} ${label}`);
            }
        }
    }
    expect(threw).toEqual([]);
    expect(accepted).toEqual([]);
});

/** `Tree` comes up again under `meta`, next to a tuple, and under `next`. */
interface Tree {
    meta?: { parent?: Tree; span: [number, number] };
    next?: Tree;
}
/** ...and inside a tuple. */
interface Linked {
    name: string;
    link?: [string, Linked | null];
    next?: Linked;
}

test('a recursive type with such a member: valid data is true, the rest false', () => {
    const tree = typeGuard<Tree>();
    for (const value of notObjects) expect(tree(value)).toBe(false);
    // Threw on VALID data: the statements of `span` read `meta.span` of a `meta` that is absent.
    expect(tree({})).toBe(true);
    expect(tree({ next: { next: {} } })).toBe(true);
    expect(tree({ meta: { span: [1, 2] }, next: { meta: { parent: {}, span: [3, 4] } } })).toBe(true);
    expect(tree({ meta: { span: [1] } })).toBe(false);
    expect(tree({ meta: null })).toBe(true);
    expect(tree({ meta: 5 })).toBe(false);
    expect(tree({ next: { meta: { parent: { next: 5 }, span: [1, 2] } } })).toBe(false);

    const linked = typeGuard<Linked>();
    for (const value of notObjects) expect(linked(value)).toBe(false);
    expect(linked({ name: 'a' })).toBe(true);
    expect(linked({ name: 'a', next: { name: 'b' } })).toBe(true);
    expect(linked({ name: 'a', link: ['x', null], next: { name: 'b', link: ['y', { name: 'c' }] } })).toBe(true);
    expect(linked({ name: 'a', link: ['x', { name: 5 }] })).toBe(false);
    expect(linked({ name: 'a', next: { name: 'b', link: [1, null] } })).toBe(false);
});

/** The statements and the expression a fast guard of `type` is built from. */
function build(type: Type, guards: Serializer = serializer) {
    const b = new Builder(1);
    const state = new JsonBuildContext('validate', guards, b, b.emptyObj(), guards.typeGuards, {
        validation: 'fast',
        collectErrors: false,
        rejectUnknownKeys: false,
    });
    const expression = state.build(type, b.input(0));
    return { statements: b.build().stmts, expression };
}

test('members that are expressions: the guard is one expression, with no statement', () => {
    interface Flat {
        name: string;
        age?: number;
        a: { b: string; c: number; d: 'x' | 'y'; e: Level; f(): void };
    }
    interface Chain {
        name: string;
        next?: Chain;
    }

    expect(build(typeOf<Flat>()).statements).toEqual([]);
    // A recursive type calls the function extracted for it: an expression too.
    expect(build(typeOf<Chain>()).statements).toEqual([]);
    expect(typeGuard<Chain>()({ name: 'a', next: { name: 'b', next: { name: 'c' } } })).toBe(true);
    expect(typeGuard<Chain>()({ name: 'a', next: { name: 'b', next: { name: 5 } } })).toBe(false);
});

test('members that emit statements: nothing reads the value above the object check', () => {
    for (const type of [typeOf<WithTuple>(), typeOf<WithUnion>(), typeOf<WithReference>(), typeOf<{ o: WithTuple }>()]) {
        const { statements } = build(type);
        // The result, declared `false`, and the object check with everything else inside it.
        expect(statements.map(v => v.kind)).toEqual(['let', 'if']);
        expect(statements[0]).toMatchObject({ kind: 'let', expr: { kind: 'lit', value: false } });
    }
});

test('a guard registered by somebody else, emitting statements, is placed the same way', () => {
    const custom = new Serializer('custom-guard');
    registerTypeGuards(custom);
    // Every `bigint` is guarded by a handler this package has never heard of. It keeps its
    // verdict in a variable — two statements, the first of which reads its input.
    custom.typeGuards.addDecorator(
        type => type.kind === ReflectionKind.bigint,
        (type, input, b) => {
            const verdict = b.var_(b.isType(input, 'bigint'));
            b.if_(b.eq(input, b.lit('many')), () => b.setVar(verdict, b.lit(true)));
            return b.getVar(verdict);
        },
    );

    interface Counted {
        id: string;
        inner: { count: bigint };
    }
    const guard = custom.buildFastTypeGuard<Counted>(typeOf<Counted>());
    for (const value of notObjects) expect(guard(value)).toBe(false);
    expect(guard({})).toBe(false);
    expect(guard({ id: 'a' })).toBe(false);
    expect(guard({ id: 'a', inner: null })).toBe(false);
    expect(guard({ id: 'a', inner: {} })).toBe(false);
    expect(guard({ id: 'a', inner: { count: 1 } })).toBe(false);
    expect(guard({ id: 'a', inner: { count: 1n } })).toBe(true);
    expect(guard({ id: 'a', inner: { count: 'many' } })).toBe(true);

    expect(build(typeOf<Counted>(), custom).statements.map(v => v.kind)).toEqual(['let', 'if']);
});
