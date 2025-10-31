import { Database, DatabaseAdapter, DatabasePlugin } from '@d7/orm';
import { AbstractClassType } from '@d7/core';
import { ReflectionClass, Type } from '@d7/type';

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
