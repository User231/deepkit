import { rmSync } from 'fs';
import { test } from 'node:test';
import { tmpdir } from 'os';
import { join } from 'path';

import { Database } from '@deepkit/orm';
import { expect } from '@deepkit/run/expect';
import { Migration, SqlMigrationHandler, unappliedMigrations } from '@deepkit/sql';

import { SQLiteDatabaseAdapter } from '../src/sqlite-adapter.js';

const databasePath = join(tmpdir(), `deepkit-sqlite-migration-ledger-${process.pid}.sqlite`);
process.once('exit', () => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(databasePath + suffix, { force: true });
});

function migration(version: number): Migration {
    return { databaseName: 'default', version, name: `m${version}`, up: () => [], down: () => [] };
}

test('pending is what the ledger does not hold, not what is newer than its latest version', async () => {
    const database = new Database(new SQLiteDatabaseAdapter(databasePath));
    try {
        const handler = new SqlMigrationHandler(database);

        // No ledger yet: the first read creates it and answers none.
        expect(await handler.getAppliedMigrationVersions()).toEqual([]);
        expect(await handler.getLatestMigrationVersion()).toBe(0);

        // Two branches shipped 100 and 300; 200 was written between them and merges last.
        await handler.setLatestMigrationVersion(100);
        await handler.setLatestMigrationVersion(300);
        expect(await handler.getAppliedMigrationVersions()).toEqual([100, 300]);
        expect(await handler.getLatestMigrationVersion()).toBe(300);

        const history = [migration(400), migration(100), migration(300), migration(200)];
        const pending = unappliedMigrations(history, await handler.getAppliedMigrationVersions());
        expect(pending.map(m => m.version)).toEqual([200, 400]);

        // Applying the late one records it without moving the latest version.
        await handler.setLatestMigrationVersion(200);
        expect(await handler.getAppliedMigrationVersions()).toEqual([100, 200, 300]);
        expect(await handler.getLatestMigrationVersion()).toBe(300);
        expect(unappliedMigrations(history, await handler.getAppliedMigrationVersions()).map(m => m.version)).toEqual([400]);

        await handler.removeMigrationVersion(300);
        expect(await handler.getLatestMigrationVersion()).toBe(200);
    } finally {
        database.disconnect();
    }
});

test('a ledger row the history no longer carries is ignored', () => {
    // A folded history keeps one version of an older chain; the chain's other rows stay in the ledger.
    expect(unappliedMigrations([migration(100), migration(500)], [100, 120, 140]).map(m => m.version)).toEqual([500]);
});
