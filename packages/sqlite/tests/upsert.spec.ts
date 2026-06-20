import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { AutoIncrement, PrimaryKey, entity, integer } from '@deepkit/type';

import { databaseFactory } from './factory.js';

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
