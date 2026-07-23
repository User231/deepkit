import { afterEach } from 'node:test';
import { performance } from 'perf_hooks';

import { Database } from '@deepkit/orm';

import { MongoDatabaseAdapter } from '../src/adapter.js';

/**
 * Executes given exec() method 3 times and averages the consumed time.
 */
export async function bench(times: number, title: string, exec: (i: number) => Promise<void> | void) {
    const start = performance.now();

    for (let i = 0; i < times; i++) {
        await exec(i);
    }

    const took = performance.now() - start;

    console.log(times, 'x benchmark', title, took, 'ms', took / times, 'per item');
}

const databases: { database: Database<MongoDatabaseAdapter>; dbName: string }[] = [];

export async function createDatabase(dbName: string = 'testing'): Promise<Database<MongoDatabaseAdapter>> {
    // Namespace per process: node:test runs spec FILES in parallel processes, and several files
    // use the same name (e.g. 'testing') — a shared db races dropDatabase() (below) against
    // another file's createCollection → "database is in the process of being dropped".
    dbName = (dbName + '-' + process.pid).replace(/\s+/g, '-');
    const __port = process.env.MONGO_PORT || '27117';
    const database = new Database(new MongoDatabaseAdapter('mongodb://127.0.0.1:' + __port + '/' + dbName));
    await database.adapter.client.dropDatabase(dbName);
    databases.push({ database, dbName });
    return database;
}

afterEach(async () => {
    for (const { database, dbName } of databases) {
        try {
            await database.adapter.client.dropDatabase(dbName);
        } catch {
            // best-effort cleanup; the db name is process-unique either way
        }
        await database.disconnect(true);
    }
    databases.splice(0, databases.length);
});
