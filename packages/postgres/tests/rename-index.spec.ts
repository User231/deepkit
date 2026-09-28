import { test } from 'node:test';

import { DatabaseEntityRegistry, MigrateOptions } from '@deepkit/orm';
import { expect } from '@deepkit/run/expect';
import { DatabaseComparator, DatabaseModel } from '@deepkit/sql';
import { AutoIncrement, Index, PrimaryKey, entity } from '@deepkit/type';

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

@(entity.name('renameIndexProbe').collection('rename_index_probe').index(['org', 'code'], { unique: true }))
class Probe {
    id: number & AutoIncrement & PrimaryKey = 0;
    status: string & Index = '';
    org: string = '';
    code: string = '';
    tag: string & Index = '';
    body: string & Index = '';
}

/**
 * A live schema whose indexes carry hand-picked names (what hand-written migrations
 * did) diffs against the entity as RENAMES — `ALTER INDEX … RENAME TO …`, run for
 * real — after which the diff is empty. The two indexes the model cannot fully see
 * (a partial one, a GIN one) are never renamed onto a declared index: the declared
 * one is created beside them.
 */
test('hand-named indexes are renamed in place to the declared names, and nothing is left to create or rename', async () => {
    const adapter = adapterFromEnv();
    const connection = await adapter.connectionPool.getConnection();
    const diffOf = async () => {
        const declared = new DatabaseModel([], adapter.getName());
        adapter.platform.createTables(DatabaseEntityRegistry.from([Probe]), declared);
        const live = new DatabaseModel([], adapter.getName());
        const parser = new adapter.platform.schemaParserType(connection, adapter.platform);
        await parser.parse(live, ['rename_index_probe']);
        return DatabaseComparator.computeDiff(live, declared);
    };
    try {
        await connection.run(`DROP TABLE IF EXISTS rename_index_probe`);
        await connection.run(`CREATE TABLE rename_index_probe (
            id serial PRIMARY KEY,
            status text NOT NULL DEFAULT '',
            org text NOT NULL DEFAULT '',
            code text NOT NULL DEFAULT '',
            tag text NOT NULL DEFAULT '',
            body text NOT NULL DEFAULT '',
            CONSTRAINT probe_org_code_backed UNIQUE (org, code)
        )`);
        await connection.run(`CREATE INDEX probe_status_idx ON rename_index_probe (status)`);
        await connection.run(`CREATE INDEX probe_tag_partial ON rename_index_probe (tag) WHERE tag <> ''`);
        await connection.run(`CREATE INDEX probe_body_gin ON rename_index_probe USING gin (to_tsvector('simple', body))`);

        const diff = await diffOf();
        const tableDiff = diff!.modifiedTables[0];
        expect(tableDiff.renamedIndices.map(([from]) => from.getName()).sort()).toEqual(['probe_org_code_backed', 'probe_status_idx']);
        expect(tableDiff.addedIndices.map(index => index.columns.map(c => c.name).join(',')).sort()).toEqual(['body', 'tag']);

        const options = new MigrateOptions();
        const ddl = adapter.platform.getModifyDatabaseDDL(diff!, options);
        expect(ddl.filter(sql => sql.startsWith('ALTER INDEX')).length).toBe(2);
        for (const sql of ddl) await connection.run(sql);

        // Nothing left to create or rename; the two extra indexes are only "removed"
        // (and without `drop` never dropped). Compare names — a diff object is a cyclic
        // graph far too large for a matcher's failure message.
        const after = (await diffOf())!.modifiedTables[0];
        expect(after.renamedIndices.length + after.addedIndices.length + after.modifiedIndices.length).toBe(0);
        expect(after.removedIndices.map(index => index.getName()).sort()).toEqual(['probe_body_gin', 'probe_tag_partial']);
        expect(adapter.platform.getModifyDatabaseDDL((await diffOf())!, options)).toEqual([]);

        // The constraint followed its index — Postgres renames both.
        const constraints = await connection.execAndReturnAll(`SELECT conname FROM pg_constraint WHERE conrelid = 'rename_index_probe'::regclass AND contype = 'u'`);
        const [renamed] = tableDiff.renamedIndices.filter(([from]) => from.getName() === 'probe_org_code_backed');
        expect(constraints.map((row: { conname: string }) => row.conname)).toEqual([renamed[1].getName()]);

        // The partial and the GIN index are still there, untouched.
        const names = await connection.execAndReturnAll(`SELECT indexname FROM pg_indexes WHERE tablename = 'rename_index_probe' ORDER BY 1`);
        const listed = names.map((row: { indexname: string }) => row.indexname);
        expect(listed.includes('probe_tag_partial')).toBe(true);
        expect(listed.includes('probe_body_gin')).toBe(true);
    } finally {
        await connection.run(`DROP TABLE IF EXISTS rename_index_probe`);
        connection.release();
        adapter.disconnect();
    }
});
