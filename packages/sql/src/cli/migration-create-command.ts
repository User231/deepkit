/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { indent } from '@7b/runtime';
import { Command, Flag, LoggerInterface, cli } from '@7b/core';
import { ReflectionClass } from '@7b/reflection';
import { MigrateOptions, Migration } from '@7b/db';

/**
 * Schema migration created automatically. You should commit this into your Git repository.
 *
 * You can rename and modify this file as you like, but make sure that 'databaseName' and 'created' are not modified.
*/
export class SchemaMigration implements Migration {
    /**
     * The migration name/title. Defaults to the file name, but can be overwritten here and to give a nice explanation what has been done.
     */
    name = \`\`;

    /**
     * Database name used for this migration. Should usually not be changed.
     * If you change your database names later, you can adjust those here as well to make sure
     * migration files are correctly assigned to the right database connection.
     *
     * Used adapter: ${JSON.stringify(db.adapter.getName())}
     */
    databaseName = ${JSON.stringify(db.name)};

    /**
     * This version should not be changed since it is used to detect if this migration
     * has been already executed against the database.
     *
     * This version was created at ${date.toISOString()}.
     */
    version = ${Math.floor(date.getTime() / 1000)};

    /**
     * SQL queries executed one by one, to apply a migration.
     */
    up() {
        return [
${upSql.map(serializeSQLLine).map(indent(12)).join(',\n')}
        ];
    }

    /**
     * SQL queries executed one by one, to revert a migration.
     */
    down() {
        return [
${downSql.map(serializeSQLLine).map(indent(12)).join(',\n')}
        ];
    }
}
`;

            console.log(migrationFile);
            mkdirSync(dirname(migrationFile), { recursive: true });
            writeFileSync(migrationFile, code.trim());
            this.logger.log(`Migration file for database <green>${db.name}</green> written to <yellow>${migrationFile}</yellow>`);
        }
        console.log('done');
    }
}
