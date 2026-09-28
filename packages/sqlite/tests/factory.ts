import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Database } from '@deepkit/orm';
import { DatabaseFactory } from '@deepkit/orm-integration';

import { SQLiteDatabaseAdapter } from '../src/sqlite-adapter.js';

/**
 * One database file per test PROCESS. `node --test` runs spec files in parallel
 * processes, and they used to share one `/tmp/db.sqlite`: a spec's `createTables`
 * recreated a same-named table under another spec mid-test ("no such column",
 * "database is locked"). Within a file tests run one at a time, so a per-process
 * file is isolation enough — and a file, not `:memory:`, because the pool's
 * connections must all see the same database.
 */
const databasePath = join(tmpdir(), `deepkit-sqlite-test-${process.pid}.sqlite`);
process.once('exit', () => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(databasePath + suffix, { force: true });
});

export const databaseFactory: DatabaseFactory<SQLiteDatabaseAdapter> = async (
    entities,
    plugins,
): Promise<Database<SQLiteDatabaseAdapter>> => {
    const adapter = new SQLiteDatabaseAdapter(databasePath);

    const database = new Database(adapter);
    if (entities) database.registerEntity(...entities);
    if (plugins) database.registerPlugin(...plugins);
    await adapter.createTables(database.entityRegistry);

    return database;
};
