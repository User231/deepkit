import { Database } from '@7b/db';
import { DatabaseFactory } from '@7b/db';
import { MySQLDatabaseAdapter } from '../src/mysql-adapter.js';

export const databaseFactory: DatabaseFactory<MySQLDatabaseAdapter> = async (entities, plugins): Promise<Database<MySQLDatabaseAdapter>> => {
    const adapter = new MySQLDatabaseAdapter({ host: '127.0.0.1', database: 'default', user: 'root', password: process.env.MYSQL_PW });

    const database = new Database(adapter);
    if (entities) database.registerEntity(...entities);
    if (plugins) database.registerPlugin(...plugins);
    await adapter.createTables(database.entityRegistry);

    return database;
};
