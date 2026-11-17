/**
 * A union with SEVERAL array members: `string[] | number[]`, `Model[] | Tag[]`, two tuples —
 * and a union of objects whose members differ only INSIDE a property they both declare:
 * `{ items: string[] } | { items: number[] }`, `{ rows: Model[] } | { rows: Tag[] }`.
 *
 * The serializer's check of an array member was `Array.isArray`, so the FIRST array member
 * took every array: `string[] | number[]` threw on `[1, 2]`, `Model[] | Tag[]` on an array of
 * tags, and `number[] | string[]` wrote `['a']` as a number with no error. The member is
 * chosen from the elements now (`createArrayMemberPicker`).
 *
 * The deserializer had a dispatch of its own for these unions. It parsed every element as
 * `any` and converted the values to the first member whose element type allowed the BSON
 * types — a BOOLEAN counted as a `number` — chose between arrays of objects by trying their
 * deserializers in declared order (none throws for a foreign document, so an array of the
 * second member came back as rows of the first), and knew no tuple: a union of two tuples
 * threw. It chooses from the elements too (`createArrayUnionChooser`) and reads the array
 * with the chosen member's own reader.
 *
 * As in `object-unions.spec.ts`, every case is checked three ways, in whichever mode the run
 * is in: the bytes are those the official `bson` package writes for the value, they decode to
 * the value, and they decode to it again.
 */
import * as bson from 'bson';
import { describe, test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { ReceiveType, resolveReceiveType } from '@deepkit/type';

import { getBSONDeserializer, getBSONSerializer } from '../index.js';

interface Tag {
    id: number;
    label: string;
}

interface Model {
    id: number;
    name: string;
    active: boolean;
}

interface Texted {
    id: number;
    value: string;
}

interface Numbered {
    id: number;
    value: number;
}

const tag: Tag = { id: 1, label: 'x' };
const model: Model = { id: 2, name: 'n', active: true };
const texted: Texted = { id: 3, value: 'x' };
const numbered: Numbered = { id: 4, value: 5 };

/**
 * Serialize `value` as `T`, expect the official package's bytes for it, and expect them to
 * decode to `value` — twice.
 */
function expectRoundTrip<T>(value: T, type?: ReceiveType<T>): T {
    const resolved = resolveReceiveType(type);
    const [buffer, size] = getBSONSerializer(resolved)(value);
    const bytes = buffer.slice(0, size);
    expect(Buffer.from(bytes)).toEqual(Buffer.from(bson.serialize(value as any)));

    const deserialize = getBSONDeserializer<T>(resolved);
    const first = deserialize(bytes);
    expect(first).toEqual(value);
    expect(deserialize(bytes)).toEqual(value);
    return first;
}

describe('a union of arrays of primitives', () => {
    test('string[] | number[]', () => {
        expectRoundTrip<{ v: string[] | number[] }>({ v: [1, 2.5, 3] });
        expectRoundTrip<{ v: string[] | number[] }>({ v: ['a', 'b'] });
    });

    test('number[] | string[] — a string is not written as a number', () => {
        // Was no error at all: `['a']` went through `number[]`.
        expectRoundTrip<{ v: number[] | string[] }>({ v: ['a'] });
        expectRoundTrip<{ v: number[] | string[] }>({ v: [1, 2] });
    });

    test('an empty array is the first member', () => {
        expectRoundTrip<{ v: string[] | number[] }>({ v: [] });
        expectRoundTrip<{ v: number[] | string[] }>({ v: [] });
    });

    test('three members', () => {
        type T = { v: boolean[] | number[] | string[] };
        expectRoundTrip<T>({ v: ['a'] });
        expectRoundTrip<T>({ v: [1] });
        expectRoundTrip<T>({ v: [true, false] });
    });

    test('a boolean is not a number', () => {
        // The deserializer read `[true]` as `[1]`: the first member took it.
        expectRoundTrip<{ v: (string | number)[] | boolean[] }>({ v: [true] });
        expectRoundTrip<{ v: (string | number)[] | boolean[] }>({ v: [1, 'a'] });
    });

    test('an element type that is a union', () => {
        expectRoundTrip<{ v: number[] | (string | number)[] }>({ v: [1, 'a'] });
        expectRoundTrip<{ v: number[] | (string | number)[] }>({ v: [1, 2] });
        expectRoundTrip<{ v: (string | null)[] | number[] }>({ v: ['a', null] });
        expectRoundTrip<{ v: (string | null)[] | number[] }>({ v: [1] });
    });

    test('Date[] | string[] and bigint[] | number[]', () => {
        const at = new Date('2026-11-17T10:00:00.000Z');
        expectRoundTrip<{ v: Date[] | string[] }>({ v: ['a'] });
        expectRoundTrip<{ v: Date[] | string[] }>({ v: [at] });
        expectRoundTrip<{ v: bigint[] | number[] }>({ v: [1, 2] });
        expectRoundTrip<{ v: bigint[] | number[] }>({ v: [1n, 2n] });
        expectRoundTrip<{ v: number[] | bigint[] }>({ v: [1n, 2n] });
    });

    test('arrays of arrays', () => {
        expectRoundTrip<{ v: string[][] | number[][] }>({ v: [[1], [2, 3]] });
        expectRoundTrip<{ v: string[][] | number[][] }>({ v: [['a'], []] });
        expectRoundTrip<{ v: number[][] | string[][] }>({ v: [[], ['a']] });
    });
});

describe('a union of arrays of objects', () => {
    test('Model[] | Tag[]', () => {
        expectRoundTrip<{ v: Model[] | Tag[] }>({ v: [tag, { id: 7, label: 'y' }] });
        expectRoundTrip<{ v: Model[] | Tag[] }>({ v: [model] });
    });

    test('Tag[] | Model[]', () => {
        expectRoundTrip<{ v: Tag[] | Model[] }>({ v: [model, model] });
        expectRoundTrip<{ v: Tag[] | Model[] }>({ v: [tag] });
    });

    test('the same property name with another type', () => {
        expectRoundTrip<{ v: Texted[] | Numbered[] }>({ v: [numbered] });
        expectRoundTrip<{ v: Texted[] | Numbered[] }>({ v: [texted] });
        expectRoundTrip<{ v: Numbered[] | Texted[] }>({ v: [texted] });
        expectRoundTrip<{ v: Numbered[] | Texted[] }>({ v: [numbered] });
    });

    test('one element type declares a subset of the other', () => {
        interface Small {
            a: number;
        }
        interface Large {
            a: number;
            b: number;
        }
        expectRoundTrip<{ v: Small[] | Large[] }>({ v: [{ a: 1, b: 2 }] });
        expectRoundTrip<{ v: Small[] | Large[] }>({ v: [{ a: 1 }] });
        expectRoundTrip<{ v: Large[] | Small[] }>({ v: [{ a: 1 }, { a: 2 }] });
        expectRoundTrip<{ v: Large[] | Small[] }>({ v: [{ a: 1, b: 2 }] });
    });

    test('arrays of objects beside arrays of primitives', () => {
        expectRoundTrip<{ v: Model[] | string[] }>({ v: ['a'] });
        expectRoundTrip<{ v: Model[] | string[] }>({ v: [model] });
        expectRoundTrip<{ v: string[] | Model[] | Tag[] }>({ v: [tag] });
        expectRoundTrip<{ v: string[] | Model[] | Tag[] }>({ v: [model] });
        expectRoundTrip<{ v: string[] | Model[] | Tag[] }>({ v: ['a'] });
    });

    test('an element type that is a union of objects', () => {
        expectRoundTrip<{ v: (Model | Tag)[] | string[] }>({ v: [tag, model] });
        expectRoundTrip<{ v: (Model | Tag)[] | string[] }>({ v: ['a'] });
    });

    test('classes come back as instances of the class of their array', () => {
        class TagClass {
            id: number = 0;
            label: string = '';
        }
        class ModelClass {
            id: number = 0;
            name: string = '';
            active: boolean = false;
        }
        type T = { v: ModelClass[] | TagClass[] };

        const tags = expectRoundTrip<T>({ v: [Object.assign(new TagClass(), tag)] });
        expect(tags.v[0]).toBeInstanceOf(TagClass);
        const models = expectRoundTrip<T>({ v: [Object.assign(new ModelClass(), model)] });
        expect(models.v[0]).toBeInstanceOf(ModelClass);

        // Plain objects are written by the member whose properties they have
        const [buffer, size] = getBSONSerializer<T>()({ v: [tag as any] });
        const bytes = buffer.slice(0, size);
        expect(bson.deserialize(bytes)).toEqual({ v: [tag] });
        expect(getBSONDeserializer<T>()(bytes).v[0]).toBeInstanceOf(TagClass);
    });

    test('fields in another order, and one no member declares', () => {
        const deserialize = getBSONDeserializer<{ v: Model[] | Tag[] }>();
        const reordered = bson.serialize({ v: [{ label: 'x', unknown: 1, id: 1 }] });
        expect(deserialize(reordered)).toEqual({ v: [tag] });
        expect(deserialize(reordered)).toEqual({ v: [tag] });
        const reorderedModel = bson.serialize({ v: [{ active: true, unknown: 1, name: 'n', id: 2 }] });
        expect(deserialize(reorderedModel)).toEqual({ v: [model] });
    });
});

describe('a union of tuples', () => {
    test('[string, number] | [number, string]', () => {
        // The deserializer threw `No union member matched` for both.
        expectRoundTrip<{ v: [string, number] | [number, string] }>({ v: [1, 'a'] });
        expectRoundTrip<{ v: [string, number] | [number, string] }>({ v: ['a', 1] });
    });

    test('tuples of different lengths', () => {
        expectRoundTrip<{ v: [number] | [number, number] }>({ v: [1, 2] });
        expectRoundTrip<{ v: [number] | [number, number] }>({ v: [1] });
        expectRoundTrip<{ v: [number, number] | [number] }>({ v: [1] });
    });

    test('a tuple and an array', () => {
        expectRoundTrip<{ v: [string, number] | number[] }>({ v: [1, 2, 3] });
        expectRoundTrip<{ v: [string, number] | number[] }>({ v: ['a', 1] });
        expectRoundTrip<{ v: number[] | [string, number] }>({ v: ['a', 1] });
        expectRoundTrip<{ v: number[] | [string, number] }>({ v: [1, 2] });
    });

    test('rest elements', () => {
        type T = { v: [string, ...number[]] | [number, ...string[]] };
        expectRoundTrip<T>({ v: [1, 'a', 'b'] });
        expectRoundTrip<T>({ v: ['a', 1, 2] });
        expectRoundTrip<T>({ v: ['a'] });
    });

    test('tuples of objects', () => {
        expectRoundTrip<{ v: [Model, Tag] | [Tag, Model] }>({ v: [tag, model] });
        expectRoundTrip<{ v: [Model, Tag] | [Tag, Model] }>({ v: [model, tag] });
    });
});

describe('a union of arrays, wherever it stands', () => {
    test('nullable, and beside an object and a primitive', () => {
        type T = { v: string[] | number[] | Model | boolean | null };
        expectRoundTrip<T>({ v: [1] });
        expectRoundTrip<T>({ v: ['a'] });
        expectRoundTrip<T>({ v: model });
        expectRoundTrip<T>({ v: true });
        expectRoundTrip<T>({ v: null });
    });

    test('beside several object members', () => {
        type T = { v: Model | Tag | Model[] | Tag[] };
        expectRoundTrip<T>({ v: tag });
        expectRoundTrip<T>({ v: model });
        expectRoundTrip<T>({ v: [tag] });
        expectRoundTrip<T>({ v: [model] });
    });

    test('as an element and in a record', () => {
        expectRoundTrip<{ e: (string[] | number[])[] }>({ e: [[1], ['a'], [2, 3], []] });
        expectRoundTrip<{ r: Record<string, string[] | number[]> }>({ r: { a: [1], b: ['x'] } });
        expectRoundTrip<{ r: Record<string, Model[] | Tag[]> }>({ r: { a: [tag], b: [model] } });
    });

    test('one serializer, both members in turn', () => {
        const serialize = getBSONSerializer<{ v: Model[] | Tag[] }>();
        const deserialize = getBSONDeserializer<{ v: Model[] | Tag[] }>();
        for (const v of [[tag], [model], [model, model], [tag, tag], []]) {
            const [buffer, size] = serialize({ v });
            expect(deserialize(buffer.slice(0, size))).toEqual({ v });
        }
    });
});

describe('objects that differ inside a property they both declare', () => {
    test('{ items: string[] } | { items: number[] }', () => {
        type T = { v: { items: string[] } | { items: number[] } };
        expectRoundTrip<T>({ v: { items: [1, 2] } });
        expectRoundTrip<T>({ v: { items: ['a'] } });
        type Reversed = { v: { items: number[] } | { items: string[] } };
        expectRoundTrip<Reversed>({ v: { items: ['a'] } });
        expectRoundTrip<Reversed>({ v: { items: [1, 2] } });
    });

    test('{ data: Model } | { data: Tag }', () => {
        expectRoundTrip<{ v: { data: Model } | { data: Tag } }>({ v: { data: tag } });
        expectRoundTrip<{ v: { data: Model } | { data: Tag } }>({ v: { data: model } });
        expectRoundTrip<{ v: { data: Tag } | { data: Model } }>({ v: { data: model } });
        expectRoundTrip<{ v: { data: Tag } | { data: Model } }>({ v: { data: tag } });
    });

    test('{ rows: Model[] } | { rows: Tag[] }', () => {
        type T = { v: { rows: Model[] } | { rows: Tag[] } };
        expectRoundTrip<T>({ v: { rows: [tag, tag] } });
        expectRoundTrip<T>({ v: { rows: [model] } });
        type Reversed = { v: { rows: Tag[] } | { rows: Model[] } };
        expectRoundTrip<Reversed>({ v: { rows: [model] } });
        expectRoundTrip<Reversed>({ v: { rows: [tag] } });
    });

    test('in an array and at the top level', () => {
        expectRoundTrip<{ e: ({ data: Model } | { data: Tag })[] }>({ e: [{ data: tag }, { data: model }] });
        expectRoundTrip<{ items: string[] } | { items: number[] }>({ items: [1] });
        expectRoundTrip<{ rows: Model[] } | { rows: Tag[] }>({ rows: [tag] });
    });

    test('a property only one member declares is not looked into', () => {
        // Nothing competes for `rows`: what is wrong inside it is said by its serializer, with
        // the path — the value is not handed to the other member, which would drop the rows.
        const serialize = getBSONSerializer<{ v: { rows: Model[] } | { error?: string } }>();
        expect(() => serialize({ v: { rows: [{ id: 1, name: 5, active: true }] } as any })).toThrow('Cannot convert 5 to string at v.rows.[i].name');
    });
});

describe('an array that is no member', () => {
    test('is refused by the serializer of the first member, with the path', () => {
        const serialize = getBSONSerializer<{ v: string[] | number[] }>();
        expect(() => serialize({ v: [1, 'a'] as any })).toThrow('Cannot convert 1 to string at v.[i]');
        expect(() => serialize({ v: [true] as any })).toThrow('Cannot convert true to string at v.[i]');
    });

    test('is refused by the deserializer', () => {
        const deserialize = getBSONDeserializer<{ v: string[] | number[] }>();
        expect(() => deserialize(bson.serialize({ v: [1, 'a'] }))).toThrow('No union member matched');
        expect(() => deserialize(bson.serialize({ v: [true] }))).toThrow('No union member matched');
        const rows = getBSONDeserializer<{ v: Model[] | Tag[] }>();
        expect(() => rows(bson.serialize({ v: [{ nope: 1 }] }))).toThrow('No union member matched');
        expect(() => rows(bson.serialize({ v: [tag, model] }))).toThrow('No union member matched');
    });
});
