import { Database } from '@d7/orm';
import { ClassType } from '@d7/core';
import { SQLDatabaseAdapter } from '../src/sql-adapter.js';
import { ReflectionClass } from '@d7/type';

export async function createSetup(adapter: SQLDatabaseAdapter, schemas: (ReflectionClass<any> | ClassType)[]) {
    const database = new Database(adapter);
    database.registerEntity(...schemas);
    await adapter.createTables(database.entityRegistry);

    return database;
}
