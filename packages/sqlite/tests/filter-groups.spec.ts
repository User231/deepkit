import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { AutoIncrement, PrimaryKey, entity, integer } from '@deepkit/type';

import { databaseFactory } from './factory.js';

/**
 * Live regression for the `$or`/`$and`/`$not`-drops-siblings filter bug: the
 * filter builder early-returned on a group operator, discarding sibling
 * conditions whose parameters were already bound. Depending on the dialect
 * that produced either an unreferenced-placeholder error (postgres
 * `could not determine data type of parameter $1`) or — far worse — a
 * silently UN-SCOPED statement (`{tenantId, $or: [...]}` losing the tenant
 * guard), which for deleteMany means deleting other tenants' rows.
 */

@entity.name('ut_filter_cell')
class Cell {
    id: integer & PrimaryKey & AutoIncrement = 0;
    tableId: string = '';
    itemId: string = '';
    parameterId: string = '';
}

function cell(tableId: string, itemId: string, parameterId: string): Cell {
    const c = new Cell();
    c.tableId = tableId;
    c.itemId = itemId;
    c.parameterId = parameterId;
    return c;
}

test('scalar sibling + $or pairs: find stays scoped', async () => {
    const database = await databaseFactory([Cell]);
    try {
        await database.persist(
            cell('t1', 'i1', 'p1'),
            cell('t1', 'i1', 'p2'),
            cell('t1', 'i2', 'p1'),
            cell('t2', 'i1', 'p1'), // other table, same natural key
        );

        const found = await database
            .query(Cell)
            .filter({
                tableId: 't1',
                $or: [
                    { itemId: 'i1', parameterId: 'p1' },
                    { itemId: 'i2', parameterId: 'p1' },
                ],
            })
            .find();
        expect(found.map(c => `${c.tableId}:${c.itemId}:${c.parameterId}`).sort()).toEqual(['t1:i1:p1', 't1:i2:p1']);
    } finally {
        database.disconnect();
    }
});

test('scalar sibling + $or pairs: deleteMany deletes ONLY the scoped rows', async () => {
    const database = await databaseFactory([Cell]);
    try {
        await database.persist(
            cell('t1', 'i1', 'p1'),
            cell('t1', 'i1', 'p2'),
            cell('t1', 'i2', 'p1'),
            cell('t2', 'i1', 'p1'),
            cell('t2', 'i2', 'p1'), // other table, same natural keys
        );

        await database
            .query(Cell)
            .filter({
                tableId: 't1',
                $or: [
                    { itemId: 'i1', parameterId: 'p1' },
                    { itemId: 'i2', parameterId: 'p1' },
                ],
            })
            .deleteMany();

        const left = await database.query(Cell).find();
        expect(left.map(c => `${c.tableId}:${c.itemId}:${c.parameterId}`).sort()).toEqual([
            't1:i1:p2', // same table, unmatched pair — survives
            't2:i1:p1', // other table — must NEVER be touched
            't2:i2:p1',
        ]);
    } finally {
        database.disconnect();
    }
});
