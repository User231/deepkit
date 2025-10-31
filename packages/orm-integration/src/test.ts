import { Database, DatabaseAdapter, DatabasePlugin } from '@7b/db';
import { AbstractClassType } from '@7b/runtime';
import { ReflectionClass, Type } from '@7b/reflection';

export type DatabaseFactory<T extends DatabaseAdapter = DatabaseAdapter> = (entities?: (Type | ReflectionClass<any> | AbstractClassType)[], plugins?: DatabasePlugin[]) => Promise<Database<T>>;

export async function executeTest(test: (factory: DatabaseFactory) => any, factory: DatabaseFactory): Promise<void> {
    let databases: Database<any>[] = [];

    const collectedFactory: DatabaseFactory<any> = async (entities, plugins) => {
        const database = await factory(entities, plugins);
        databases.push(database);
        return database;
    }

    try {
        await test(collectedFactory);
    } finally {
        for (const db of databases) {
            db.disconnect(true);
        }
    }
}
