import { test } from 'node:test';

import { InjectorContext, InjectorModule } from '@deepkit/injector';
import { expect } from '@deepkit/run/expect';

import { DatabaseRegistry } from '../src/database-registry.js';
import { Database } from '../src/database.js';
import { MemoryDatabaseAdapter } from '../src/memory-db.js';

class PrimaryDatabase extends Database {
    constructor() {
        super(new MemoryDatabaseAdapter(), []);
    }
}

class SecondaryDatabase extends Database {
    constructor() {
        super(new MemoryDatabaseAdapter(), []);
    }
}

test('one instance under two tokens is one database, not a name collision', () => {
    const module = new InjectorModule([
        PrimaryDatabase,
        // The second token is served by the FIRST token's instance — the shape an
        // app takes while a second pool is configured off.
        { provide: SecondaryDatabase, useFactory: (primary: PrimaryDatabase) => primary },
    ]);
    const context = new InjectorContext(module);
    const registry = new DatabaseRegistry(context, [
        { classType: PrimaryDatabase, module },
        { classType: SecondaryDatabase, module },
    ]);

    registry.init();

    const primary = context.get(PrimaryDatabase);
    expect(registry.getDatabases()).toHaveLength(1);
    expect(registry.getDatabaseByName('default')).toBe(primary);
    expect(registry.getDatabase(SecondaryDatabase)).toBe(primary);
});

test('two instances sharing a name still collide', () => {
    const module = new InjectorModule([PrimaryDatabase, SecondaryDatabase]);
    const context = new InjectorContext(module);
    const registry = new DatabaseRegistry(context, [
        { classType: PrimaryDatabase, module },
        { classType: SecondaryDatabase, module },
    ]);

    expect(() => registry.init()).toThrow(/has a name 'default' that is already registered/);
});
