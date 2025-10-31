/*
 * Deepkit Framework  
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

// Main exports - ORM and SQL core
export * from './src/orm/index.js';
export * from './src/sql/index.js';

// Database adapters should be imported from subpackages:
// import { PostgresAdapter } from '@7b/db/postgres';
// import { MySQLAdapter } from '@7b/db/mysql';
// import { SQLiteAdapter } from '@7b/db/sqlite';
// import { MongoAdapter } from '@7b/db/mongo';
