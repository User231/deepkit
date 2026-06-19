import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { AutoIncrement, DatabaseField, PrimaryKey, entity, integer } from '@deepkit/type';

import { databaseFactory } from './factory.js';

/**
 * Tests for the `INSERT ... ON CONFLICT` upsert query-builder methods
 * (`insertOrIgnore` / `insertOrUpdate`) added to the SQL adapter. Postgres.
 */

test('insertOrIgnore is idempotent on a unique index (DO NOTHING)', async () => {
    @(entity.name('upsert_member').index(['teamId', 'userId'], { unique: true }))
    class Member {
        id: integer & PrimaryKey & AutoIncrement = 0;
        teamId: string & DatabaseField<{ name: 'team_id' }> = '';
        userId: string & DatabaseField<{ name: 'user_id' }> = '';
    }

    const database = await databaseFactory([Member]);
    try {
        const first = await database.query(Member).insertOrIgnore({ teamId: '1', userId: '7' }, ['teamId', 'userId']);
        expect(first.modified).toBe(1);

        // Re-delivery: same natural key collides on the unique index → skipped.
        const again = await database.query(Member).insertOrIgnore({ teamId: '1', userId: '7' }, ['teamId', 'userId']);
        expect(again.modified).toBe(0);

        expect(await database.query(Member).count()).toBe(1);
    } finally {
        database.disconnect();
    }
});

test('insertOrUpdate overwrites on PK conflict (default target + columns)', async () => {
    @entity.name('upsert_header')
    class Header {
        id: string & PrimaryKey & DatabaseField<{ name: 'team_id' }> = '';
        name: string = '';
        version: integer = 0;
    }

    const database = await databaseFactory([Header]);
    try {
        await database.query(Header).insertOrUpdate({ id: '1', name: 'Platform', version: 1 });
        await database.query(Header).insertOrUpdate({ id: '1', name: 'Platform (renamed)', version: 2 });

        const row = await database.query(Header).filter({ id: '1' }).findOne();
        expect(row).toMatchObject({ name: 'Platform (renamed)', version: 2 });
        expect(await database.query(Header).count()).toBe(1);
    } finally {
        database.disconnect();
    }
});

test('insertOrUpdate with a version guard only moves forward', async () => {
    @entity.name('upsert_guarded')
    class User {
        id: string & PrimaryKey & DatabaseField<{ name: 'user_id' }> = '';
        name: string = '';
        version: integer = 0;
    }

    const database = await databaseFactory([User]);
    try {
        await database.query(User).insertOrUpdate({ id: '1', name: 'v2', version: 2 }, { guard: { version: '>' } });
        expect(await database.query(User).filter({ id: '1' }).findOne()).toMatchObject({ name: 'v2', version: 2 });

        // Stale redelivery (version 1 <= 2) → guard rejects, row unchanged.
        const stale = await database.query(User).insertOrUpdate({ id: '1', name: 'stale', version: 1 }, { guard: { version: '>' } });
        expect(stale.modified).toBe(0);
        expect(await database.query(User).filter({ id: '1' }).findOne()).toMatchObject({ name: 'v2', version: 2 });

        // Newer (version 3 > 2) → applied.
        await database.query(User).insertOrUpdate({ id: '1', name: 'v3', version: 3 }, { guard: { version: '>' } });
        expect(await database.query(User).filter({ id: '1' }).findOne()).toMatchObject({ name: 'v3', version: 3 });
    } finally {
        database.disconnect();
    }
});

test('bulk multi-row upsert', async () => {
    @entity.name('upsert_kv')
    class KV {
        key: string & PrimaryKey = '';
        value: integer = 0;
    }

    const database = await databaseFactory([KV]);
    try {
        await database.query(KV).insertOrUpdate([
            { key: 'a', value: 1 },
            { key: 'b', value: 2 },
        ]);
        // 'b' updates, 'c' inserts — one statement.
        await database.query(KV).insertOrUpdate([
            { key: 'b', value: 20 },
            { key: 'c', value: 3 },
        ]);

        const rows = await database.query(KV).orderBy('key', 'asc').find();
        expect(rows.map(r => [r.key, r.value])).toEqual([
            ['a', 1],
            ['b', 20],
            ['c', 3],
        ]);
    } finally {
        database.disconnect();
    }
});

test('upsert serializes a jsonb column', async () => {
    interface Sheet {
        sheetId: string;
        name: string;
    }

    @entity.name('upsert_jsonb')
    class Doc {
        id: string & PrimaryKey = '';
        sheets: Sheet[] & DatabaseField<{ type: 'jsonb' }> = [];
        version: integer = 0;
    }

    const database = await databaseFactory([Doc]);
    try {
        await database.query(Doc).insertOrUpdate({ id: '1', sheets: [{ sheetId: 's1', name: 'A' }], version: 1 }, { guard: { version: '>' } });
        const row = await database.query(Doc).filter({ id: '1' }).findOne();
        expect(row.sheets).toEqual([{ sheetId: 's1', name: 'A' }]);

        await database.query(Doc).insertOrUpdate(
            {
                id: '1',
                sheets: [
                    { sheetId: 's1', name: 'A' },
                    { sheetId: 's2', name: 'B' },
                ],
                version: 2,
            },
            { guard: { version: '>' } },
        );
        const row2 = await database.query(Doc).filter({ id: '1' }).findOne();
        expect(row2.sheets.length).toBe(2);
    } finally {
        database.disconnect();
    }
});

test('round-trips a scalar-union (string | number | null) jsonb column', async () => {
    @entity.name('upsert_jsonb_scalar')
    class Cell {
        id: integer & PrimaryKey & AutoIncrement = 0;
        kind: string = '';
        value?: any & DatabaseField<{ type: 'jsonb' }>;
    }

    const database = await databaseFactory([Cell]);
    try {
        await database.query(Cell).insertOrUpdate([
            { kind: 'str', value: 'hello' },
            { kind: 'num', value: 42 },
            { kind: 'numeric-string', value: '42' }, // must stay a STRING, not become 42
            { kind: 'nul', value: null },
        ]);
        const rows = await database.query(Cell).orderBy('kind', 'asc').find();
        const byKind = Object.fromEntries(rows.map(r => [r.kind, r.value]));
        expect(byKind.str).toBe('hello');
        expect(byKind.num).toBe(42);
        expect(byKind.nul).toBeUndefined(); // SQL NULL → absent optional property
        // the scalar/number distinction survives the JSON column round-trip
        expect(byKind['numeric-string']).toBe('42');
        expect(typeof byKind['numeric-string']).toBe('string');
        expect(typeof byKind.num).toBe('number');
    } finally {
        database.disconnect();
    }
});

test('upsert runs on the session transaction (commit + rollback)', async () => {
    @entity.name('upsert_tx')
    class Row {
        id: string & PrimaryKey = '';
        n: integer = 0;
    }

    const database = await databaseFactory([Row]);
    try {
        await database.transaction(async session => {
            await session.query(Row).insertOrUpdate({ id: '1', n: 1 });
            await session.query(Row).insertOrUpdate({ id: '1', n: 2 });
        });
        expect((await database.query(Row).filter({ id: '1' }).findOne()).n).toBe(2);

        await expect(
            database.transaction(async session => {
                await session.query(Row).insertOrUpdate({ id: '2', n: 1 });
                throw new Error('boom');
            }),
        ).rejects.toThrowError('boom');
        expect(await database.query(Row).filter({ id: '2' }).has()).toBe(false);
    } finally {
        database.disconnect();
    }
});
