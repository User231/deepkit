import { test } from 'node:test';

import { Database } from '@deepkit/orm';
import { expect } from '@deepkit/run/expect';
import { AutoIncrement, PrimaryKey, entity, integer } from '@deepkit/type';

import { SQLiteDatabaseAdapter } from '../src/sqlite-adapter.js';
import { databaseFactory } from './factory.js';

/**
 * An isolated in-memory database for tests that must not contend with anything else.
 * The shared `databaseFactory` points every spec at one `/tmp/db.sqlite`, so specs
 * running in parallel intermittently lose the write lock ("database is locked").
 */
async function memoryDatabase(entities: any[]): Promise<Database<SQLiteDatabaseAdapter>> {
    const adapter = new SQLiteDatabaseAdapter(':memory:');
    const database = new Database(adapter);
    database.registerEntity(...entities);
    await adapter.createTables(database.entityRegistry);
    return database;
}

/**
 * SQLite shares Postgres's `ON CONFLICT` upsert syntax (no INSERT alias), so the same
 * `insertOrIgnore` / `insertOrUpdate` query-builder methods work here — proving the dialect
 * SQL is correctly factored into the platform, not hardcoded for Postgres.
 */

test('insertOrIgnore is idempotent on a unique index (DO NOTHING)', async () => {
    @(entity.name('ut_upsert_member').index(['teamId', 'userId'], { unique: true }))
    class Member {
        id: integer & PrimaryKey & AutoIncrement = 0;
        teamId: string = '';
        userId: string = '';
    }

    const database = await databaseFactory([Member]);
    try {
        await database.query(Member).insertOrIgnore({ teamId: '1', userId: '7' }, ['teamId', 'userId']);
        await database.query(Member).insertOrIgnore({ teamId: '1', userId: '7' }, ['teamId', 'userId']);
        expect(await database.query(Member).count()).toBe(1);
    } finally {
        database.disconnect();
    }
});

test('insertOrUpdate with a version guard only moves forward', async () => {
    @entity.name('ut_upsert_user')
    class User {
        id: string & PrimaryKey = '';
        name: string = '';
        version: integer = 0;
    }

    const database = await databaseFactory([User]);
    try {
        await database.query(User).insertOrUpdate({ id: '1', name: 'v2', version: 2 }, { guard: { version: '>' } });
        expect((await database.query(User).filter({ id: '1' }).findOne()).name).toBe('v2');

        // stale (1 <= 2) → guard rejects
        await database.query(User).insertOrUpdate({ id: '1', name: 'stale', version: 1 }, { guard: { version: '>' } });
        expect((await database.query(User).filter({ id: '1' }).findOne()).name).toBe('v2');

        // newer (3 > 2) → applied
        await database.query(User).insertOrUpdate({ id: '1', name: 'v3', version: 3 }, { guard: { version: '>' } });
        expect((await database.query(User).filter({ id: '1' }).findOne()).name).toBe('v3');
        expect(await database.query(User).count()).toBe(1);
    } finally {
        database.disconnect();
    }
});

/**
 * Regression: a row merely LOADED into a session used to be written back on commit
 * because every Date property compared as changed (the snapshot clones dates, and the
 * change detector fell through to a reference comparison). The stale write landed AFTER
 * the raw `ON CONFLICT` upsert, silently reverting the date column while string/number
 * columns kept their new values — the shape that froze projected `updated_at` timestamps
 * at their creation instant.
 */
test('a loaded-but-untouched row does not revert a Date written by insertOrUpdate', async () => {
    @entity.name('ut_upsert_dated')
    class Row {
        id: integer & PrimaryKey = 0;
        label: string = '';
        version: integer = 0;
        updatedAt: Date = new Date(0);
    }

    const t0 = new Date('2026-07-25T10:00:00.000Z');
    const t1 = new Date('2026-07-25T11:30:00.000Z');

    const database = await memoryDatabase([Row]);
    try {
        await database.query(Row).insertOrUpdate({ id: 1, label: 'first', version: 1, updatedAt: t0 });

        await database.transaction(async session => {
            // Read it into the identity map, then write past the unit of work.
            await session.query(Row).filter({ id: 1 }).findOneOrUndefined();
            await session.query(Row).insertOrUpdate({ id: 1, label: 'second', version: 2, updatedAt: t1 }, { guard: { version: '>' } });
        });

        const row = await database.query(Row).filter({ id: 1 }).findOne();
        expect(row.label).toBe('second');
        expect(row.version).toBe(2);
        expect(row.updatedAt.toISOString()).toBe(t1.toISOString());
    } finally {
        database.disconnect();
    }
});

/** The unit of work must still persist a date the caller actually changed. */
test('a genuinely modified Date is still written on commit', async () => {
    @entity.name('ut_upsert_dated_change')
    class Row {
        id: integer & PrimaryKey = 0;
        updatedAt: Date = new Date(0);
    }

    const t0 = new Date('2026-07-25T10:00:00.000Z');
    const t1 = new Date('2026-07-25T11:30:00.000Z');

    const database = await memoryDatabase([Row]);
    try {
        await database.query(Row).insertOrUpdate({ id: 1, updatedAt: t0 });

        await database.transaction(async session => {
            const row = await session.query(Row).filter({ id: 1 }).findOne();
            row.updatedAt = t1;
        });

        const row = await database.query(Row).filter({ id: 1 }).findOne();
        expect(row.updatedAt.toISOString()).toBe(t1.toISOString());
    } finally {
        database.disconnect();
    }
});
