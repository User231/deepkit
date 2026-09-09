import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { DatabaseModel, IndexModel, Table, schemaMigrationRoundTrip } from '@deepkit/sql';
import { AutoIncrement, PrimaryKey, Unique, entity } from '@deepkit/type';

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

/**
 * A unique key exists in two forms and Postgres drops each only its own way. The
 * platform used to emit `DROP CONSTRAINT` for every unique index, which is right
 * for the constraint-backed form and 42704 for a plain `CREATE UNIQUE INDEX` —
 * so a generated migration that removed an index some earlier migration had
 * ADDED failed on its first statement. The parser now records the form it found.
 */
test('getDropIndexDDL drops a constraint-backed unique index through its constraint, a plain one through DROP INDEX', () => {
    const adapter = adapterFromEnv();
    const table = new Table('t');
    table.addColumn('email');

    const plain = new IndexModel(table, 'plain_key', true);
    plain.addColumn('email');
    expect(adapter.platform.getDropIndexDDL(plain)).toBe('DROP INDEX "plain_key"');

    const backed = new IndexModel(table, 'backed_key', true);
    backed.addColumn('email');
    backed.isConstraint = true;
    expect(adapter.platform.getDropIndexDDL(backed)).toBe('ALTER TABLE "t" DROP CONSTRAINT "backed_key"');

    const ordinary = new IndexModel(table, 'lookup', false);
    ordinary.addColumn('email');
    ordinary.isConstraint = true; // never set by the parser for a non-unique index; must not matter
    expect(adapter.platform.getDropIndexDDL(ordinary)).toBe('DROP INDEX "lookup"');
});

test('the parser tells the two forms apart and the drop it generates for each actually runs', async () => {
    const adapter = adapterFromEnv();
    const connection = await adapter.connectionPool.getConnection();
    try {
        await connection.run(`DROP TABLE IF EXISTS drop_unique_probe`);
        await connection.run(`CREATE TABLE drop_unique_probe (
            id serial PRIMARY KEY,
            a text NOT NULL,
            b text NOT NULL,
            CONSTRAINT probe_a_backed UNIQUE (a)
        )`);
        await connection.run(`CREATE UNIQUE INDEX probe_b_plain ON drop_unique_probe (b)`);

        const model = new DatabaseModel([], adapter.getName());
        const parser = new adapter.platform.schemaParserType(connection, adapter.platform);
        await parser.parse(model, ['drop_unique_probe']);
        const table = model.getTable('drop_unique_probe');

        const backed = table.getIndex('probe_a_backed');
        const plain = table.getIndex('probe_b_plain');
        expect(backed.isUnique).toBe(true);
        expect(backed.isConstraint).toBe(true);
        expect(plain.isUnique).toBe(true);
        expect(plain.isConstraint).toBe(false);

        // The statement the migration generator would write for each — executed for real.
        await connection.run(adapter.platform.getDropIndexDDL(backed));
        await connection.run(adapter.platform.getDropIndexDDL(plain));

        const left = await connection.execAndReturnAll(`SELECT indexname FROM pg_indexes WHERE tablename = 'drop_unique_probe' ORDER BY 1`);
        expect(left.map((row: { indexname: string }) => row.indexname)).toEqual(['drop_unique_probe_pkey']);
    } finally {
        await connection.run(`DROP TABLE IF EXISTS drop_unique_probe`);
        connection.release();
        adapter.disconnect();
    }
});

/**
 * The flag is a fact about a LIVE index, not part of an index's identity: an
 * entity-built model (never parsed, `isConstraint` false) and the parsed model
 * of the tables it created (constraint-backed, `isConstraint` true) must still
 * compare equal, or every round trip would report a phantom diff.
 */
test('a parsed constraint-backed unique key does not diff against the entity that declared it', async () => {
    @(entity.name('dropUniqueRoundTrip').collection('drop_unique_round_trip').index(['a', 'b'], { unique: true }))
    class Row {
        id: number & AutoIncrement & PrimaryKey = 0;
        email: string & Unique = '';
        a: string = '';
        b: string = '';
    }
    const adapter = adapterFromEnv();
    try {
        await schemaMigrationRoundTrip([Row], adapter);
    } finally {
        adapter.disconnect();
    }
});
