/**
 * Golden files for the source the JIT generates for REAL types: what `@deepkit/type` and
 * `@deepkit/bson` build for three models — serialize, deserialize, the type guard, the validator,
 * the BSON serializer and the BSON decoder.
 *
 * `core/tests/jit-differential.spec.ts` holds the text of every expression and statement kind in
 * isolation; these hold whole functions, which is where a change in how kinds are put together
 * (an operand's parentheses, a helper's name, the order of nested functions) shows. A refactor of
 * the generator that is meant to change nothing leaves every file byte-identical. A change to a
 * serializer template changes them on purpose: rerun with `UPDATE_GOLDEN=1` and review the diff.
 *
 * Each function is built once per process and cached per type, so every model here is a type of
 * its own and every operation runs in a fixed order.
 */
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { compilesFunctions } from '@deepkit/core';
import { expect } from '@deepkit/run/expect';
import { type ReceiveType, type Type, deserialize, is, resolveReceiveType, serialize, validate } from '@deepkit/type';

import { expectGolden, generatedSource } from '../../core/tests/support/generated-source.js';
import { getBSONDeserializer, getBSONSerializer } from '../index.js';

// ── The models ───────────────────────────────────────────────────────────────

/** Primitives only: the shape of most request and response rows. */
interface Flat {
    id: number;
    name: string;
    active: boolean;
    note?: string;
    score: number | null;
}

interface Tag {
    id: number;
    label: string;
}
type Shape = { kind: 'circle'; r: number } | { kind: 'rect'; w: number; h: number };
/** Containers and unions: arrays of objects, a record, a literal union, a discriminated union, a nested object. */
interface Nested {
    id: number;
    tags: Tag[];
    meta: Record<string, string | number>;
    state: 'draft' | 'live' | 'gone';
    shape: Shape;
    owner: { id: number; names: string[] };
}

/** A class with the non-JSON values: Date, bigint, bytes, a default, an optional. */
class Event {
    id: number = 0;
    at: Date = new Date(0);
    big: bigint = 0n;
    bytes: Uint8Array = new Uint8Array();
    title: string = 'untitled';
    until?: Date;
}

const FLAT: Flat = { id: 1, name: 'n', active: true, note: 'x', score: null };
const NESTED: Nested = {
    id: 1,
    tags: [{ id: 1, label: 'x' }],
    meta: { a: 'b', c: 2 },
    state: 'live',
    shape: { kind: 'rect', w: 1, h: 2 },
    owner: { id: 2, names: ['a'] },
};
const EVENT: Event = Object.assign(new Event(), { id: 1, at: new Date(1705314600123), big: 12n, bytes: new Uint8Array([1, 2, 3]), until: new Date(1705314700000) });

// ── The operations ───────────────────────────────────────────────────────────

/** One operation: what to call so the function is built (and run once), in the order they run. */
function operations<T>(value: T, receiveType?: ReceiveType<T>): Record<string, () => void> {
    const type: Type = resolveReceiveType(receiveType);
    let json: unknown;
    let bytes = new Uint8Array();
    return {
        serialize: () => {
            json = serialize(value, undefined, undefined, undefined, type);
        },
        deserialize: () => {
            deserialize(json, undefined, undefined, undefined, type);
        },
        guard: () => {
            is(value, type);
        },
        validate: () => {
            validate(value, type);
        },
        'bson-serialize': () => {
            const [buffer, size] = getBSONSerializer<T>(type)(value);
            bytes = buffer.slice(0, size);
        },
        'bson-deserialize': () => {
            getBSONDeserializer<T>(type)(bytes);
        },
    };
}

function golden<T>(model: string, value: T, receiveType?: ReceiveType<T>): void {
    const type = resolveReceiveType(receiveType);
    describe(`generated source: ${model}`, { skip: compilesFunctions() ? false : 'nothing is compiled in this run' }, () => {
        for (const [operation, run] of Object.entries(operations<T>(value, type))) {
            test(operation, () => {
                const text = generatedSource(run);
                // An operation that compiled nothing was served from a cache: its file would hold nothing.
                expect(text.length).toBeGreaterThan(0);
                expectGolden(join(__dirname, 'golden', `${model}.${operation}.js`), text);
            });
        }
    });
}

golden<Flat>('flat', FLAT);
golden<Nested>('nested', NESTED);
golden<Event>('event', EVENT);
