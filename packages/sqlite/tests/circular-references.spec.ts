import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import {
    AutoIncrement,
    BackReference,
    PrimaryKey,
    Reference,
    entity,
} from '@deepkit/type';

import { databaseFactory } from './factory.js';

/**
 * Regression tests for hydrating entity graphs with circular / self-references.
 *
 * Two bugs were fixed together:
 *  1. orm Formatter.assignJoins read an unpopulated back-reference property through its
 *     throwing getter when a populated back-reference join produced no rows for a given row
 *     (e.g. a leaf node in a self-referencing tree), spuriously throwing
 *     "BackReference X.y was not populated".
 *  2. @deepkit/type snapshot builder recursed forever at JIT-build time when an embedded
 *     (non-reference) object/class transitively cycled back to a class already being expanded,
 *     producing "RangeError: Maximum call stack size exceeded" on persist/change-detection.
 */

@entity.name('tree_node')
class Node {
    id: number & PrimaryKey & AutoIncrement = 0;
    name: string = '';

    parent?: Node & Reference;

    children: Node[] & BackReference = [];

    constructor(name: string, parent?: Node) {
        this.name = name;
        this.parent = parent;
    }
}

test('self-referencing: leaf node with empty back-reference join hydrates to []', async () => {
    const database = await databaseFactory([Node]);

    const root = new Node('root');
    await database.persist(root);

    const nodes = await database.query(Node).joinWith('children').find();
    expect(nodes.length).toBe(1);
    expect(nodes[0].children).toEqual([]);

    database.disconnect();
});

test('self-referencing: back-reference join over a cyclic graph terminates and populates', async () => {
    const database = await databaseFactory([Node]);

    const root = new Node('root');
    await database.persist(root);

    const child1 = new Node('child1', root);
    const child2 = new Node('child2', root);
    await database.persist(child1, child2);

    // The result set contains the root AND its children as top-level rows; children rows have an
    // empty `children` back-reference. Hydration must not stack-overflow nor throw "not populated".
    const nodes = await database.query(Node).joinWith('children').find();

    const r = nodes.find(n => n.name === 'root')!;
    expect(r.children.length).toBe(2);
    expect(r.children.map(c => c.name).sort()).toEqual(['child1', 'child2']);

    // Leaf rows keep an empty back-reference array (no spurious throw).
    const leaf = nodes.find(n => n.name === 'child1')!;
    expect(leaf.children).toEqual([]);

    database.disconnect();
});

// Embedded object literal that transitively cycles back into the owning entity.
// Persisting such an entity builds its snapshot (change-detection), which must not recurse
// forever at JIT-build time.
interface NodeMeta {
    note: string;
    owner?: Owner;
}

@entity.name('cyclic_owner')
class Owner {
    id: number & PrimaryKey & AutoIncrement = 0;

    // Regular (non-reference) embedded object literal that references Owner again -> a build-time cycle.
    meta: NodeMeta = { note: '' };

    constructor(public name: string) {}
}

test('embedded cyclic object literal can be persisted (snapshot build terminates)', async () => {
    const database = await databaseFactory([Owner]);

    const owner = new Owner('root');
    owner.meta = { note: 'hello' };

    // Before the fix this threw "RangeError: Maximum call stack size exceeded" while building the
    // change-detection snapshot.
    await database.persist(owner);

    const loaded = await database.query(Owner).findOne();
    expect(loaded.name).toBe('root');
    expect(loaded.meta.note).toBe('hello');

    database.disconnect();
});
