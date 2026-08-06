import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { AutoIncrement, DatabaseField, PrimaryKey, entity, integer } from '@deepkit/type';

import { databaseFactory } from './factory.js';

/**
 * `patchMany`/`patchOne` build their SET clause from a Partial<T> serialize — a property absent
 * from the patch must not reach the UPDATE at all. Before the fix, absent NULLABLE members were
 * serialized as `null`, so recording a delivery outcome (`patchMany({status: 'dead', …})`) silently
 * erased the row's unique `dedupeKey` — the outbox's replay-idempotency key.
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

/**
 * The patch resolver must resolve `DatabaseField<{name}>`-renamed properties to their REAL column
 * names, like the Postgres resolver does via `entity.fieldMap` — it used to build SET/select
 * clauses from property names, so patching any renamed column failed with
 * "no such column: <propertyName>". Covers $set (renamed PK-adjacent column), $inc, and
 * `patchOne` returning over a renamed column.
 */
test('patch resolves DatabaseField-renamed columns to their real names', async () => {
    @(entity.name('ut_patch_renamed_outbox').index(['dedupeKey'], { unique: true }))
    class Row {
        id: integer & PrimaryKey & AutoIncrement = 0;
        status: string = 'pending';
        attempts: integer & DatabaseField<{ name: 'attempt_count' }> = 0;
        dedupeKey: (string & DatabaseField<{ name: 'dedupe_key' }>) | null = null;
        lastError: string & DatabaseField<{ name: 'last_error' }> = '';
    }

    const database = await databaseFactory([Row]);
    try {
        const row = new Row();
        row.dedupeKey = 'key-1';
        await database.persist(row);

        // $set over renamed columns (this used to throw "no such column: dedupeKey").
        await database.query(Row).filter({ id: row.id }).patchMany({ dedupeKey: 'key-2', lastError: 'boom' });
        let after = await database.query(Row).filter({ id: row.id }).findOne();
        expect(after.dedupeKey).toBe('key-2');
        expect(after.lastError).toBe('boom');

        // $set on a plain column must leave renamed nullable columns alone (both bugs at once).
        await database.query(Row).filter({ id: row.id }).patchMany({ status: 'dead' });
        after = await database.query(Row).filter({ id: row.id }).findOne();
        expect(after.status).toBe('dead');
        expect(after.dedupeKey).toBe('key-2');

        // $inc reads the renamed column ($inc'd fields auto-return their new value).
        const incremented = await database
            .query(Row)
            .filter({ id: row.id })
            .patchOne({ $inc: { attempts: 2 } });
        expect(incremented.returning.attempts).toEqual([2]);
        after = await database.query(Row).filter({ id: row.id }).findOne();
        expect(after.attempts).toBe(2);

        // Explicit `returning()` reads a renamed column alongside a plain $set.
        const patched = await database.query(Row).filter({ id: row.id }).returning('lastError').patchOne({ status: 'retried' });
        expect(patched.returning.lastError).toEqual(['boom']);
    } finally {
        database.disconnect();
    }
});
