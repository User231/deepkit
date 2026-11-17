/**
 * The functions the generator builds ON THE SIDE — the slow path of a nested object or of an
 * array's rows (`getExtractedDeserializer`), a recursive type's serializer
 * (`getExtractedSerializer`) — and reaches from plain JavaScript, through a wrapper.
 *
 * They are built while ANOTHER function is being declared. There `fn()` builds no function: it
 * registers a nested function of the one being declared and returns a marker, and a marker called
 * from plain JavaScript ran in the interpreter. So in a process that compiles, every row that
 * took the slow path decoded interpreted: 50 rows with a literal-union property in 580 µs as
 * `{ rows: T[] }` against 11 µs as `T[]`, and a recursive type serialized 80x slower than the
 * same data typed flat. Both are compilation units of their own now (`fnJITTop`), and `core`
 * has closed the construction for everyone: a marker that plain JavaScript calls is compiled,
 * and a nested function nothing in its unit calls is not emitted (`core/tests/jit-differential.spec.ts`).
 *
 * What this file holds is the VALUES, in whichever mode the run is in (the suite runs compiled
 * and with `DEEPKIT_JIT_MODE=interpreted`): every shape that showed the defect decodes to the
 * rows that were encoded — as a top-level array and as an array property, from the bytes our
 * serializer writes (the fast path where there is one) and from bytes whose rows have their
 * fields in another order plus one the type does not know (the slow path, every row). The FIRST
 * decode, which learns the shape, and a repeat, which runs what was learned. The second kind of
 * bytes is what found that a top-level array returned `[row, offset]` for such rows.
 *
 * The timings are held by the two `perf-regression` specs.
 */
import * as bson from 'bson';
import { describe, test } from 'node:test';

import { expect } from '@deepkit/run/expect';

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
// first decode is the one that learns a shape and compiles for it.
const cases: Case[] = buildCases();
const first: unknown[] = cases.map(c => c.decode());

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
