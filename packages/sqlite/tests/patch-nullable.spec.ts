import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { AutoIncrement, PrimaryKey, entity, integer } from '@deepkit/type';

import { databaseFactory } from './factory.js';

/**
 * `patchMany`/`patchOne` build their SET clause from a Partial<T> serialize — a property absent
 * from the patch must not reach the UPDATE at all. Before the fix, absent NULLABLE members were
 * serialized as `null`, so recording a delivery outcome (`patchMany({status: 'dead', …})`) silently
 * erased the row's unique `dedupeKey` — the outbox's replay-idempotency key.
 *
 * (Deliberately no `DatabaseField<{name}>` renames here: SQLite's patch resolver resolves SET
 * columns by property name and doesn't honour renames — a separate pre-existing dialect gap;
 * Postgres's resolver maps via `entity.fieldMap`.)
 */
test('patchMany leaves untouched nullable columns alone', async () => {
    @(entity.name('ut_patch_nullable_outbox').index(['dedupeKey'], { unique: true }))
    class Row {
        id: integer & PrimaryKey & AutoIncrement = 0;
        status: string = 'pending';
        attempts: integer = 0;
        dedupeKey: string | null = null;
        sentAt: Date | null = null;
    }

    const database = await databaseFactory([Row]);
    try {
        const row = new Row();
        row.dedupeKey = 'key-1';
        await database.persist(row);

        await database.query(Row).filter({ id: row.id }).patchMany({ status: 'dead', attempts: 1 });

        const after = await database.query(Row).filter({ id: row.id }).findOne();
        expect(after.status).toBe('dead');
        expect(after.attempts).toBe(1);
        expect(after.dedupeKey).toBe('key-1'); // untouched — was nulled before the fix
        expect(after.sentAt).toBe(null);

        // Explicitly patching the nullable column still works, both directions.
        await database.query(Row).filter({ id: row.id }).patchMany({ dedupeKey: null });
        expect((await database.query(Row).filter({ id: row.id }).findOne()).dedupeKey).toBe(null);
        await database.query(Row).filter({ id: row.id }).patchMany({ dedupeKey: 'key-2' });
        expect((await database.query(Row).filter({ id: row.id }).findOne()).dedupeKey).toBe('key-2');
    } finally {
        database.disconnect();
    }
});
