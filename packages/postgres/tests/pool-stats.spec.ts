import { test } from 'node:test';

import { Logger } from '@deepkit/logger';
import { expect } from '@deepkit/run/expect';

import { PostgresConnectionPool } from '../src/postgres-adapter.js';

/** A stand-in for the driver's pool: one client, handed out to one caller at a time. */
function fakePool() {
    const queue: Array<(client: { release(): void }) => void> = [];
    let busy = false;
    const client = {
        release() {
            const next = queue.shift();
            if (next) next(client);
            else busy = false;
        },
    };
    return {
        get totalCount() {
            return 1;
        },
        get idleCount() {
            return busy ? 0 : 1;
        },
        get waitingCount() {
            return queue.length;
        },
        connect(): Promise<{ release(): void }> {
            if (!busy) {
                busy = true;
                return Promise.resolve(client);
            }
            return new Promise(resolve => queue.push(resolve));
        },
    };
}

test('pool stats: the driver counts now, checkouts and their wait as running totals', async () => {
    const pool = new PostgresConnectionPool(fakePool() as any, new Logger());
    expect(pool.getStats()).toEqual({ total: 1, idle: 1, waiting: 0, acquired: 0, acquireWaitMs: 0 });

    const first = await pool.getConnection();
    expect(pool.getStats().idle).toBe(0);
    expect(pool.getStats().acquired).toBe(1);

    // The second caller queues behind the first: `waiting` shows it while it lasts ...
    const pending = pool.getConnection();
    expect(pool.getStats().waiting).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 30));
    first.release();
    const second = await pending;

    // ... and the wait is still on the record after the queue has drained.
    const after = pool.getStats();
    expect(after.waiting).toBe(0);
    expect(after.acquired).toBe(2);
    expect(after.acquireWaitMs).toBeGreaterThan(20);
    second.release();
    expect(pool.getStats().idle).toBe(1);
});
