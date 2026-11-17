import { test } from 'node:test';
import { types } from 'node:util';

import { expect } from '@deepkit/run/expect';

import { getBSONDeserializer } from '../../src/deserializer.js';
import { deserializeBSONWithoutOptimiser } from '../../src/parser.js';
import { getBSONSerializer } from '../../src/serializer.js';

// A BSON DATE decodes to a real `Date`, in every position a type can put one.
//
// Until 2026-11-16 the decoder built a `FastDate` by default: an object with Date's methods that
// deferred the real one. It was cheaper to construct and was not a Date to anything that looks for
// the [[DateValue]] slot — `new Date(value)` parsed its string form and dropped the milliseconds,
// `structuredClone` copied its fields, `Date.prototype.x.call(value)` threw — and it made
// `instanceof Date` true by replacing `Date[Symbol.hasInstance]` for the whole process. The class
// and the switch between the two (`setBSONDateClass`) are gone; these tests hold what replaced them.

const MS = Date.UTC(2026, 6, 3, 12, 34, 56, 789);

function expectRealDate(value: unknown, ms: number): void {
    expect(Object.getPrototypeOf(value)).toBe(Date.prototype);
    expect(types.isDate(value)).toBe(true);
    const date = value as Date;
    expect(date.getTime()).toBe(ms);
    // The slot is there: what reads it directly keeps the milliseconds.
    expect(new Date(date).getTime()).toBe(ms);
    expect(Date.prototype.toISOString.call(date)).toBe(new Date(ms).toISOString());
    expect(structuredClone(date).getTime()).toBe(ms);
}

function roundTrip<T>(serialize: (value: T) => [Uint8Array, number], deserialize: (bytes: Uint8Array) => T, value: T): T {
    const [buffer, size] = serialize(value);
    return deserialize(buffer.slice(0, size));
}

test('a typed document: property, nullable, optional, array, record, nested', () => {
    type Doc = {
        at: Date;
        maybe: Date | null;
        later?: Date;
        rows: { at: Date }[];
        list: Date[];
        byKey: Record<string, Date>;
        nested: { deep: { at: Date } };
    };
    const doc = roundTrip(getBSONSerializer<Doc>(), getBSONDeserializer<Doc>(), {
        at: new Date(MS),
        maybe: new Date(MS + 1),
        later: new Date(MS + 2),
        rows: [{ at: new Date(MS + 3) }, { at: new Date(MS + 4) }],
        list: [new Date(MS + 5), new Date(MS + 6)],
        byKey: { k: new Date(MS + 7) },
        nested: { deep: { at: new Date(MS + 8) } },
    });
    const dates = [doc.at, doc.maybe, doc.later, doc.rows[0].at, doc.rows[1].at, doc.list[0], doc.list[1], doc.byKey.k, doc.nested.deep.at];
    dates.forEach((date, index) => expectRealDate(date, MS + index));
});

test('a class with a Date property', () => {
    class Event {
        at: Date = new Date(0);
        name: string = '';
    }
    const event = roundTrip(getBSONSerializer<Event>(), getBSONDeserializer<Event>(), Object.assign(new Event(), { at: new Date(MS), name: 'e' }));
    expect(event).toBeInstanceOf(Event);
    expectRealDate(event.at, MS);
});

test('a union that holds a Date', () => {
    type Doc = { value: Date | string | number };
    const serialize = getBSONSerializer<Doc>();
    const deserialize = getBSONDeserializer<Doc>();
    expectRealDate(roundTrip(serialize, deserialize, { value: new Date(MS) }).value, MS);
    expect(roundTrip(serialize, deserialize, { value: 'text' }).value).toBe('text');
    expect(roundTrip(serialize, deserialize, { value: 7 }).value).toBe(7);
});

test('a top-level array of documents', () => {
    type Row = { at: Date };
    const rows = roundTrip(getBSONSerializer<Row[]>(), getBSONDeserializer<Row[]>(), [{ at: new Date(MS) }, { at: new Date(MS + 1) }]);
    rows.forEach((row, index) => expectRealDate(row.at, MS + index));
});

test('an untyped position: `any`, and the parser without a type', () => {
    type Doc = { anything: any };
    const serialize = getBSONSerializer<Doc>();
    const doc = roundTrip(serialize, getBSONDeserializer<Doc>(), { anything: { at: new Date(MS), list: [new Date(MS + 1)] } });
    expectRealDate(doc.anything.at, MS);
    expectRealDate(doc.anything.list[0], MS + 1);

    const [buffer, size] = serialize({ anything: new Date(MS) });
    expectRealDate(deserializeBSONWithoutOptimiser(buffer.slice(0, size)).anything, MS);
});

test('loading the decoder leaves `instanceof Date` to the engine', () => {
    // FastDate installed its own Date[Symbol.hasInstance]; nothing may put one back.
    expect(Object.prototype.hasOwnProperty.call(Date, Symbol.hasInstance)).toBe(false);
    expect({ getTime: () => 0 } instanceof Date).toBe(false);
});
