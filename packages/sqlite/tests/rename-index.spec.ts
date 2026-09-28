import { test } from 'node:test';

import { DatabaseEntityRegistry, MigrateOptions } from '@deepkit/orm';
import { expect } from '@deepkit/run/expect';
import { DatabaseComparator, DatabaseModel } from '@deepkit/sql';
import { AutoIncrement, Index, PrimaryKey, entity } from '@deepkit/type';

import { SQLiteDatabaseAdapter } from '../src/sqlite-adapter.js';

@(entity.name('renameIndexProbe').collection('rename_index_probe').index(['org', 'code'], { unique: true }))
class Probe {
    id: number & AutoIncrement & PrimaryKey = 0;
    status: string & Index = '';
    org: string = '';
    code: string = '';
    tag: string & Index = '';
}

/**
 * SQLite has no in-place index rename, so a rename is the portable drop + create
 * per index — NOT the platform's table rebuild (a full copy of every row, which a
 * rename alone must never cost). The partial index is never taken for the
 * declared plain one: the declared index is created beside it.
 */
async function probe(withPartial: boolean) {
    const adapter = new SQLiteDatabaseAdapter(':memory:');
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
        await connection.run(`CREATE TABLE rename_index_probe (
            id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
            status text NOT NULL DEFAULT '',
            org text NOT NULL DEFAULT '',
            code text NOT NULL DEFAULT '',
            tag text NOT NULL DEFAULT ''
        )`);
        await connection.run(`CREATE INDEX probe_status_idx ON rename_index_probe (status)`);
        await connection.run(`CREATE UNIQUE INDEX probe_org_code ON rename_index_probe (org, code)`);
        if (withPartial) {
            await connection.run(`CREATE INDEX probe_tag_partial ON rename_index_probe (tag) WHERE tag <> ''`);
        } else {
            await connection.run(`CREATE INDEX probe_tag_idx ON rename_index_probe (tag)`);
        }
        await connection.run(`INSERT INTO rename_index_probe (status, org, code, tag) VALUES ('queued', 'o', 'c', 't')`);

        const tableDiff = (await diffOf())!.modifiedTables[0];
        // Indexes only — any column change would force the rebuild on its own.
        expect(tableDiff.modifiedColumns.length + tableDiff.addedColumns.length + tableDiff.removedColumns.length).toBe(0);
        expect(tableDiff.renamedIndices.map(([from]) => from.getName()).sort()).toEqual(withPartial ? ['probe_org_code', 'probe_status_idx'] : ['probe_org_code', 'probe_status_idx', 'probe_tag_idx']);
        expect(tableDiff.addedIndices.map(index => index.columns.map(c => c.name).join(','))).toEqual(withPartial ? ['tag'] : []);

        const ddl = adapter.platform.getModifyDatabaseDDL((await diffOf())!, new MigrateOptions());
        if (!withPartial) {
            expect(ddl.some(sql => /CREATE TABLE|INSERT INTO/.test(sql))).toBe(false);
            expect(ddl.filter(sql => sql.startsWith('DROP INDEX')).length).toBe(3);
        }
        for (const sql of ddl) await connection.run(sql);

        // Compare names — a diff object is a cyclic graph far too large for a matcher's failure message.
        const after = await diffOf();
        const leftover = after?.modifiedTables[0];
        expect(leftover ? leftover.renamedIndices.length + leftover.addedIndices.length : 0).toBe(0);

        const rows = await connection.execAndReturnAll(`SELECT status, org, code, tag FROM rename_index_probe`);
        expect(rows).toEqual([{ status: 'queued', org: 'o', code: 'c', tag: 't' }]);
    } finally {
        connection.release();
        adapter.disconnect();
    }
}

test('renames are a drop + create per index, never a table rebuild; rows intact', () => probe(false));

test('a partial index is not renamed onto the declared plain one; the declared index is created beside it', () => probe(true));
