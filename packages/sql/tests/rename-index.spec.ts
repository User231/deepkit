import { test } from 'node:test';

import { MigrateOptions } from '@deepkit/orm';
import { expect } from '@deepkit/run/expect';

import { DefaultPlatform } from '../src/platform/default-platform.js';
import { IndexComparator, IndexModel, Table, TableComparator } from '../src/schema/table.js';

/**
 * The same index under another name used to diff as a CREATE of the declared one
 * (while the old lingered — `removedIndices` is only emitted with `drop`), so every
 * generated migration re-emitted a duplicate of each hand-named index. It is a rename.
 */
function tables(): { live: Table; declared: Table } {
    const live = new Table('t');
    const declared = new Table('t');
    for (const table of [live, declared]) {
        table.addColumn('org_id');
        table.addColumn('status');
        table.addColumn('code');
    }
    return { live, declared };
}

function index(table: Table, name: string, columns: string[], unique = false): IndexModel {
    const model = table.addIndex(name, unique);
    for (const column of columns) model.addColumn(column);
    return model;
}

test('an index that differs only by name is a rename, not a create plus a lingering original', () => {
    const { live, declared } = tables();
    index(live, 't_status_idx', ['status']);
    index(declared, '', ['status']);

    const diff = TableComparator.computeDiff(live, declared);
    expect(diff).toBeDefined();
    expect(diff!.addedIndices).toEqual([]);
    expect(diff!.removedIndices).toEqual([]);
    expect(diff!.renamedIndices.map(([from, to]) => [from.getName(), to.getName()])).toEqual([['t_status_idx', declared.indices[0].getName()]]);
});

test('same-named indexes still match by name first — a rename is only for the leftovers', () => {
    const { live, declared } = tables();
    index(live, 't_org_idx', ['org_id']);
    index(declared, 't_org_idx', ['org_id']);
    expect(TableComparator.computeDiff(live, declared)).toBeUndefined();
});

test('uniqueness, column order, a partial predicate, an expression key and the access method each block the rename', () => {
    const cases: [string, (live: IndexModel, declared: IndexModel) => void][] = [
        ['uniqueness', (_, declared) => (declared.isUnique = true)],
        ['partial', live => (live.partial = true)],
        ['expression', live => (live.hasExpressions = true)],
        ['method', live => (live.method = 'gin')],
        ['spatial', (_, declared) => (declared.spatial = true)],
    ];
    for (const [label, mutate] of cases) {
        const { live, declared } = tables();
        const from = index(live, 't_idx', ['org_id', 'status']);
        const to = index(declared, '', ['org_id', 'status']);
        mutate(from, to);
        expect(IndexComparator.isRename(from, to), label).toBe(false);
        const diff = TableComparator.computeDiff(live, declared)!;
        expect(diff.renamedIndices.length, label).toBe(0);
        expect(diff.addedIndices.length, label).toBe(1);
    }

    const { live, declared } = tables();
    const from = index(live, 't_idx', ['status', 'org_id']);
    const to = index(declared, '', ['org_id', 'status']);
    expect(IndexComparator.isRename(from, to)).toBe(false);
});

test('each live index is renamed at most once, onto the first declared index it equals', () => {
    const { live, declared } = tables();
    index(live, 't_a', ['code']);
    index(live, 't_b', ['code']);
    index(declared, '', ['code']);

    const diff = TableComparator.computeDiff(live, declared)!;
    expect(diff.renamedIndices.map(([from]) => from.getName())).toEqual(['t_a']);
    expect(diff.removedIndices.map(index => index.getName())).toEqual(['t_b']);
    expect(diff.addedIndices).toEqual([]);
});

test('the portable DDL is a drop + create; it is emitted under the index option, not under drop', () => {
    const { live, declared } = tables();
    index(live, 't_code_idx', ['code']);
    const to = index(declared, '', ['code']);

    const platform = new DefaultPlatform();
    const diff = TableComparator.computeDiff(live, declared)!;
    const options = new MigrateOptions();
    options.drop = false;
    const ddl = platform.getModifyTableDDL(diff, options);
    expect(ddl).toEqual([`DROP INDEX "t_code_idx"`, platform.getAddIndexDDL(to)]);
});
