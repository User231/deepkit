/**
 * The functions the generator builds ON THE SIDE — the slow path of a nested object or of an
 * array's rows (`getExtractedDeserializer`), a recursive type's serializer
 * (`getExtractedSerializer`) — and reaches from plain JavaScript, through a wrapper.
 *
 * They are built while ANOTHER function is being declared. There `fn()` builds no function: it
 * registers a nested function of the one being declared and returns a marker, and a marker called
 * from plain JavaScript runs in the interpreter. So in a process that compiles, every row that
 * took the slow path decoded interpreted: 50 rows with a literal-union property in 580 µs as
 * `{ rows: T[] }` against 11 µs as `T[]`, and a recursive type serialized 80x slower than the
 * same data typed flat. Both are compilation units of their own now (`fnJITTop`).
 *
 * What this file holds:
 *
 *   1. VALUES, in whichever mode the run is in (the suite runs compiled and with
 *      `DEEPKIT_JIT_MODE=interpreted`): every shape that showed the defect decodes to the rows
 *      that were encoded — as a top-level array and as an array property, from the bytes our
 *      serializer writes (the fast path where there is one) and from bytes whose rows have their
 *      fields in another order plus one the type does not know (the slow path, every row). The
 *      FIRST decode, which learns the shape, and a repeat, which runs what was learned.
 *
 *   2. THE TEXT, where the run compiles: no compilation unit declares a nested function that
 *      nothing in it calls. That is what the defect looks like in the generated source — the
 *      definition sits in the enclosing unit as dead code while its marker is called from
 *      outside — and unlike a timing it does not depend on the machine.
 *
 * The timings are held by the two `perf-regression` specs.
 */
import * as bson from 'bson';
import { describe, test } from 'node:test';

import { compilesFunctions } from '@deepkit/core';
import { expect } from '@deepkit/run/expect';

import { type Compilation, compilationsOf } from '../../core/tests/support/generated-source.js';
import { getBSONDeserializer, getBSONSerializer } from '../index.js';

// ── The rows ─────────────────────────────────────────────────────────────────

interface Tag {
    id: number;
    label: string;
}
interface Full {
    id: number;
    name: string;
    active: boolean;
    score?: number;
    created: Date;
    tags: Tag[];
    meta: Record<string, string | number>;
    kind: 'a' | 'b' | 'c';
}
type WithoutKind = Omit<Full, 'kind'>;
type WithoutMeta = Omit<Full, 'meta'>;
type WithoutBoth = Omit<Full, 'meta' | 'kind'>;
interface KindUnion {
    id: number;
    kind: 'a' | 'b' | 'c';
}
interface KindString {
    id: number;
    kind: string;
}
interface MetaRecord {
    id: number;
    meta: Record<string, string>;
}
interface Plain {
    id: number;
    name: string;
    active: boolean;
}
/** A type that names itself: its nested decoder and serializer are always the extracted ones. */
interface TreeNode {
    id: number;
    name: string;
    children: TreeNode[];
}

const KINDS = ['a', 'b', 'c'] as const;
const ROW_COUNT = 7;

const FULL: Full[] = Array.from({ length: ROW_COUNT }, (_, i) => ({
    id: i,
    name: `row ${i}`,
    active: i % 2 === 0,
    // Optional: every third row has none, so the rows are not all one shape.
    ...(i % 3 === 0 ? {} : { score: i + 0.5 }),
    created: new Date(1705314600000 + i),
    tags: [
        { id: 1, label: 'x' },
        { id: 2, label: `y${i}` },
    ],
    meta: { a: 'b', c: i, d: 'e' },
    kind: KINDS[i % 3],
}));

function without<T extends object, K extends keyof T>(row: T, ...keys: K[]): Omit<T, K> {
    const copy: Partial<T> = { ...row };
    for (const key of keys) delete copy[key];
    return copy as Omit<T, K>;
}

const TREE: TreeNode = {
    id: 0,
    name: 'root',
    children: [
        { id: 1, name: 'left', children: [{ id: 3, name: 'leaf', children: [] }] },
        { id: 2, name: 'right', children: [] },
    ],
};

// ── The cases ────────────────────────────────────────────────────────────────

interface Case {
    name: string;
    expected: unknown;
    decode: () => unknown;
}

function bytesOf<T>(serialize: (value: T) => [Uint8Array, number], value: T): Uint8Array {
    const [buffer, size] = serialize(value);
    return buffer.slice(0, size);
}

/** The same rows with their fields in the reverse order and one field no type here declares. */
function shuffled(rows: readonly object[]): object[] {
    return rows.map(row => Object.fromEntries([...Object.entries(row).reverse(), ['_unknown', 1]]));
}

/**
 * One shape: decoded as a top-level array and as an array property, from two encodings each.
 * The functions are passed in built — a generic function cannot build them, it has no runtime
 * type to give them.
 */
function shape<T extends object>(
    name: string,
    rows: T[],
    top: { serialize: (value: T[]) => [Uint8Array, number]; deserialize: (bytes: Uint8Array) => unknown },
    property: { serialize: (value: { rows: T[] }) => [Uint8Array, number]; deserialize: (bytes: Uint8Array) => unknown },
): Case[] {
    const topBytes = bytesOf(top.serialize, rows);
    const propertyBytes = bytesOf(property.serialize, { rows });
    // bson-js frames a root array like any document: keys "0", "1", …
    const topShuffled = bson.serialize(Object.fromEntries(shuffled(rows).entries()));
    const propertyShuffled = bson.serialize({ rows: shuffled(rows) });
    return [
        { name: `${name}[]`, expected: rows, decode: () => top.deserialize(topBytes) },
        { name: `{ rows: ${name}[] }`, expected: { rows }, decode: () => property.deserialize(propertyBytes) },
        { name: `${name}[], fields reordered + an unknown one`, expected: rows, decode: () => top.deserialize(topShuffled) },
        {
            name: `{ rows: ${name}[] }, fields reordered + an unknown one`,
            expected: { rows },
            decode: () => property.deserialize(propertyShuffled),
        },
    ];
}

function buildCases(): Case[] {
    const serializeTree = getBSONSerializer<TreeNode>();
    const deserializeTree = getBSONDeserializer<TreeNode>();
    const treeBytes = bytesOf(serializeTree, TREE);
    return [
        ...shape<Full>('Full', FULL, { serialize: getBSONSerializer<Full[]>(), deserialize: getBSONDeserializer<Full[]>() }, { serialize: getBSONSerializer<{ rows: Full[] }>(), deserialize: getBSONDeserializer<{ rows: Full[] }>() }),
        ...shape<WithoutKind>(
            "Omit<Full, 'kind'>",
            FULL.map(row => without(row, 'kind')),
            { serialize: getBSONSerializer<WithoutKind[]>(), deserialize: getBSONDeserializer<WithoutKind[]>() },
            { serialize: getBSONSerializer<{ rows: WithoutKind[] }>(), deserialize: getBSONDeserializer<{ rows: WithoutKind[] }>() },
        ),
        ...shape<WithoutMeta>(
            "Omit<Full, 'meta'>",
            FULL.map(row => without(row, 'meta')),
            { serialize: getBSONSerializer<WithoutMeta[]>(), deserialize: getBSONDeserializer<WithoutMeta[]>() },
            { serialize: getBSONSerializer<{ rows: WithoutMeta[] }>(), deserialize: getBSONDeserializer<{ rows: WithoutMeta[] }>() },
        ),
        ...shape<WithoutBoth>(
            "Omit<Full, 'meta' | 'kind'>",
            FULL.map(row => without(row, 'meta', 'kind')),
            { serialize: getBSONSerializer<WithoutBoth[]>(), deserialize: getBSONDeserializer<WithoutBoth[]>() },
            { serialize: getBSONSerializer<{ rows: WithoutBoth[] }>(), deserialize: getBSONDeserializer<{ rows: WithoutBoth[] }>() },
        ),
        ...shape<KindUnion>(
            "{ id; kind: 'a' | 'b' | 'c' }",
            FULL.map(row => ({ id: row.id, kind: row.kind })),
            { serialize: getBSONSerializer<KindUnion[]>(), deserialize: getBSONDeserializer<KindUnion[]>() },
            { serialize: getBSONSerializer<{ rows: KindUnion[] }>(), deserialize: getBSONDeserializer<{ rows: KindUnion[] }>() },
        ),
        ...shape<KindString>(
            '{ id; kind: string }',
            FULL.map(row => ({ id: row.id, kind: row.kind })),
            { serialize: getBSONSerializer<KindString[]>(), deserialize: getBSONDeserializer<KindString[]>() },
            { serialize: getBSONSerializer<{ rows: KindString[] }>(), deserialize: getBSONDeserializer<{ rows: KindString[] }>() },
        ),
        ...shape<MetaRecord>(
            '{ id; meta: Record<string, string> }',
            FULL.map(row => ({ id: row.id, meta: { a: 'b', d: `e${row.id}` } })),
            { serialize: getBSONSerializer<MetaRecord[]>(), deserialize: getBSONDeserializer<MetaRecord[]>() },
            { serialize: getBSONSerializer<{ rows: MetaRecord[] }>(), deserialize: getBSONDeserializer<{ rows: MetaRecord[] }>() },
        ),
        ...shape<Plain>(
            '{ id; name; active }',
            FULL.map(row => ({ id: row.id, name: row.name, active: row.active })),
            { serialize: getBSONSerializer<Plain[]>(), deserialize: getBSONDeserializer<Plain[]>() },
            { serialize: getBSONSerializer<{ rows: Plain[] }>(), deserialize: getBSONDeserializer<{ rows: Plain[] }>() },
        ),
        { name: 'a recursive type, decoded', expected: TREE, decode: () => deserializeTree(treeBytes) },
        // What our serializer wrote for it, read by the reference implementation.
        { name: 'a recursive type, serialized (read back by bson-js)', expected: TREE, decode: () => bson.deserialize(bytesOf(serializeTree, TREE)) },
    ];
}

// Everything is built, and decoded once, at load: a function is built once per process, and the
// first decode is the one that learns a shape and compiles for it. Where the run compiles, the
// source of every unit that takes is kept for the last test.
let cases: Case[] = [];
let first: unknown[] = [];
const buildAndDecodeOnce = () => {
    cases = buildCases();
    first = cases.map(c => c.decode());
};
let compilations: Compilation[] = [];
if (compilesFunctions()) compilations = compilationsOf(buildAndDecodeOnce);
else buildAndDecodeOnce();

// ── Tests ────────────────────────────────────────────────────────────────────

describe('rows that take the extracted functions decode to what was encoded', () => {
    cases.forEach((c, i) => {
        test(c.name, () => {
            expect(first[i]).toEqual(c.expected);
            // Twice more: what the first decode learned and compiled is what runs now.
            expect(c.decode()).toEqual(c.expected);
            expect(c.decode()).toEqual(c.expected);
        });
    });
});

describe('the generated source of those functions', { skip: compilesFunctions() ? false : 'nothing is compiled in this run' }, () => {
    test('no unit declares a nested function that nothing in it calls', () => {
        // The premise: the cases above did compile, and did declare nested functions.
        expect(compilations.length).toBeGreaterThan(20);
        let declared = 0;
        const dead: string[] = [];
        compilations.forEach((unit, index) => {
            for (const match of unit.source.matchAll(/^function (_nfn_\d+)\(/gm)) {
                declared++;
                const uses = unit.source.match(new RegExp(`(?<![\\w$])${match[1]}\\b`, 'g'))?.length ?? 0;
                // One use is the declaration itself.
                if (uses < 2) dead.push(`unit ${index} (externals: ${unit.externals.join(', ')}): ${match[1]}`);
            }
        });
        expect(declared).toBeGreaterThan(0);
        // A nested function its unit never calls is a function built with fn() inside another
        // function's declaration and then called from plain JavaScript — where it is interpreted.
        // Build such a function with fnJITTop.
        expect(dead).toEqual([]);
    });
});
