import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { FrameCategory, FrameType, Stopwatch, StopwatchStore } from '@deepkit/stopwatch';
import type { FrameData, FrameEnd, FrameStart } from '@deepkit/stopwatch';
import { AutoIncrement, PrimaryKey, entity, integer } from '@deepkit/type';

import { databaseFactory } from './factory.js';

/**
 * `database.stopwatch = x` only ever reached the SESSIONS. The per-query frames
 * (FrameCategory.databaseQuery, the ones carrying the SQL) are started by the
 * adapter's CONNECTIONS, which read the stopwatch the connection POOL captured
 * at construction — and nothing propagated it there, so those frames could
 * never fire for any adapter. `Database.setStopwatch()` is the propagating
 * setter; this pins that a query actually reports.
 */
class RecordingStore extends StopwatchStore {
    frames: (FrameStart | FrameEnd)[] = [];
    payloads: FrameData[] = [];

    add(frame: FrameStart | FrameEnd) {
        this.frames.push(frame);
    }

    data(data: FrameData) {
        this.payloads.push(data);
    }

    getZone() {
        // The adapter starts query frames inside whatever context it is called
        // from; a non-zero context id is what keeps `start()` from no-op'ing.
        return { stopwatchContextId: 1 };
    }

    async run<T>(data: { [name: string]: any }, cb: () => Promise<T>): Promise<T> {
        return cb();
    }
}

test('setStopwatch propagates to the adapter, so queries emit databaseQuery frames', async () => {
    @entity.name('ut_stopwatch_row')
    class Row {
        id: integer & PrimaryKey & AutoIncrement = 0;
        name: string = '';
    }

    const store = new RecordingStore();
    const stopwatch = new Stopwatch(store);
    stopwatch.enable();

    const database = await databaseFactory([Row]);
    try {
        database.setStopwatch(stopwatch);

        const row = new Row();
        row.name = 'a';
        await database.persist(row);
        await database.query(Row).find();

        const queryFrames = store.frames.filter((frame): frame is FrameStart => frame.type === FrameType.start && frame.category === FrameCategory.databaseQuery);
        expect(queryFrames.length).toBeGreaterThan(0);

        const sql = store.payloads.map(payload => (payload.data as { sql?: string }).sql).filter(Boolean);
        expect(sql.some(statement => String(statement).includes('ut_stopwatch_row'))).toBe(true);

        // Detaching stops the reporting again.
        const before = store.frames.length;
        database.setStopwatch(undefined);
        await database.query(Row).find();
        expect(store.frames.length).toBe(before);
    } finally {
        database.disconnect();
    }
});
