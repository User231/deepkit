import { Database } from '@7b/db';
import { ClassType } from '@7b/runtime';
import { SQLDatabaseAdapter } from '../src/sql-adapter.js';
import { ReflectionClass } from '@7b/reflection';

export async function createSetup(adapter: SQLDatabaseAdapter, schemas: (ReflectionClass<any> | ClassType)[]) {
    const database = new Database(adapter);
    database.registerEntity(...schemas);
    await adapter.createTables(database.entityRegistry);

    return database;
}
