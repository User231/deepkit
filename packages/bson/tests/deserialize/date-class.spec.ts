import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { FastDate } from '@deepkit/type';

import { getBSONDateClass, getBSONDeserializer, setBSONDateClass } from '../../src/deserializer.js';
import { getBSONSerializer } from '../../src/serializer.js';

// BSON DATE values materialize as `FastDate` by default (the deferred, Date-compatible object the
// ORM's hot path wants). A consumer whose Dates reach code that only a REAL Date satisfies asks
// for the native class. Decoders are cached per type, so each mode gets its own type here.

const MS = Date.UTC(2026, 6, 3, 12, 34, 56, 789);

test('default: BSON dates are FastDate — Date-compatible, but not a Date to `new Date(value)`', () => {
    type Doc = { at: Date; rows: { at: Date }[]; byKey: Record<string, Date> };
    const [buffer, size] = getBSONSerializer<Doc>()({ at: new Date(MS), rows: [{ at: new Date(MS) }], byKey: { k: new Date(MS) } });
    const doc = getBSONDeserializer<Doc>()(buffer.slice(0, size));
    expect(getBSONDateClass()).toBe(FastDate);
    expect(doc.at).toBeInstanceOf(FastDate);
    expect(doc.at).toBeInstanceOf(Date); // the Symbol.hasInstance patch
    expect(doc.at.getTime()).toBe(MS);
    expect(doc.at.toISOString()).toBe(new Date(MS).toISOString());
    // The observable gap that motivates the switch: no [[DateValue]] slot → string parse → whole seconds.
    expect(new Date(doc.at).getTime()).toBe(MS - 789);
    expect(Object.getPrototypeOf(doc.at)).not.toBe(Date.prototype);
});

test('setBSONDateClass(Date): every BSON date is a real Date, in every position', () => {
    const before = getBSONDateClass();
    setBSONDateClass(Date);
    try {
        type NativeDoc = { at: Date; maybe: Date | null; rows: { at: Date }[]; byKey: Record<string, Date>; nested: { deep: { at: Date } } };
        const value: NativeDoc = {
            at: new Date(MS),
            maybe: new Date(MS + 1),
            rows: [{ at: new Date(MS + 2) }, { at: new Date(MS + 3) }],
            byKey: { k: new Date(MS + 4) },
            nested: { deep: { at: new Date(MS + 5) } },
        };
        const [buffer, size] = getBSONSerializer<NativeDoc>()(value);
        const doc = getBSONDeserializer<NativeDoc>()(buffer.slice(0, size));
        const dates = [doc.at, doc.maybe!, doc.rows[0].at, doc.rows[1].at, doc.byKey.k, doc.nested.deep.at];
        for (const d of dates) {
            expect(Object.getPrototypeOf(d)).toBe(Date.prototype);
            expect(d).not.toBeInstanceOf(FastDate);
        }
        expect(dates.map(d => d.getTime())).toEqual([MS, MS + 1, MS + 2, MS + 3, MS + 4, MS + 5]);
        expect(new Date(doc.at).getTime()).toBe(MS); // the slot is there: milliseconds survive
        expect(Date.prototype.toISOString.call(doc.at)).toBe(new Date(MS).toISOString());
    } finally {
        setBSONDateClass(before);
    }
});
