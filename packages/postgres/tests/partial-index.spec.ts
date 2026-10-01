import { test } from 'node:test';

import { DatabaseEntityRegistry } from '@deepkit/orm';
import { expect } from '@deepkit/run/expect';
import { DatabaseComparator, DatabaseModel } from '@deepkit/sql';
import { PrimaryKey, entity } from '@deepkit/type';

import { PostgresDatabaseAdapter } from '../src/postgres-adapter.js';

function adapterFromEnv(): PostgresDatabaseAdapter {
    return new PostgresDatabaseAdapter({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '15432', 10),
        database: process.env.POSTGRES_DB || 'postgres',
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || undefined,
    });
}

@(entity.name('partialIndexProbe').collection('partial_index_probe').index(['kind', 'target'], { unique: true, where: '"alias" = false' }))
class Probe {
    id: string & PrimaryKey = '';
    kind: string = '';
    target: number = 0;
    alias: boolean = false;
}

/**
 * An entity DECLARES a partial index (`IndexOptions.where`): the DDL carries the
 * predicate, the database enforces it only over the rows it selects, and the schema
 * parsed back diffs EMPTY against the declaration — while a plain index under the same
 * name does not (it is another index).
 */
test('a declared partial unique index is created with its predicate and diffs empty', async () => {
    const adapter = adapterFromEnv();
    const connection = await adapter.connectionPool.getConnection();
    const declaredModel = () => {
        const declared = new DatabaseModel([], adapter.getName());
        adapter.platform.createTables(DatabaseEntityRegistry.from([Probe]), declared);
        return declared;
    };
    const diffOf = async () => {
        const live = new DatabaseModel([], adapter.getName());
        const parser = new adapter.platform.schemaParserType(connection, adapter.platform);
        await parser.parse(live, ['partial_index_probe']);
        return DatabaseComparator.computeDiff(live, declaredModel());
    };
    try {
        await connection.run(`DROP TABLE IF EXISTS partial_index_probe`);
        const declared = declaredModel();
        const [index] = declared.getTable('partial_index_probe').indices;
        const ddl = adapter.platform.getAddIndexDDL(index);
        expect(ddl.endsWith(`WHERE "alias" = false`)).toBe(true);
        for (const sql of adapter.platform.getAddTablesDDL(declared)) await connection.run(sql);

        expect(await diffOf()).toBe(undefined);

        // Enforced over the selected rows only.
        await connection.run(`INSERT INTO partial_index_probe (id, kind, target, alias) VALUES ('a', 'k', 1, false)`);
        await connection.run(`INSERT INTO partial_index_probe (id, kind, target, alias) VALUES ('b', 'k', 1, true)`);
        await connection.run(`INSERT INTO partial_index_probe (id, kind, target, alias) VALUES ('c', 'k', 1, true)`);
        let refused = false;
        try {
            await connection.run(`INSERT INTO partial_index_probe (id, kind, target, alias) VALUES ('d', 'k', 1, false)`);
        } catch {
            refused = true;
        }
        expect(refused).toBe(true);

        // The PLAIN index under the declared name is a different index.
        await connection.run(`DELETE FROM partial_index_probe`);
        await connection.run(`DROP INDEX "${index.getName()}"`);
        await connection.run(`CREATE UNIQUE INDEX "${index.getName()}" ON partial_index_probe (kind, target)`);
        const diff = await diffOf();
        expect(diff!.modifiedTables[0].modifiedIndices.length).toBe(1);
    } finally {
        await connection.run(`DROP TABLE IF EXISTS partial_index_probe`);
        connection.release();
        adapter.disconnect();
    }
});
