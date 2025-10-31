/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { onServerMainBootstrap } from '../application-server.js';
import { eventDispatcher } from '@d7/event';
import { LoggerInterface } from '@d7/logger';
import { DatabaseRegistry } from '@d7/orm';
import { getClassName } from '@d7/core';
import { onAppShutdown } from '@d7/app';

export class DatabaseListener {
    constructor(
        protected databases: DatabaseRegistry,
        protected logger: LoggerInterface,
    ) {
    }

    @eventDispatcher.listen(onServerMainBootstrap)
    async onMainBootstrap() {
        for (const databaseType of this.databases.getDatabaseTypes()) {
            if (this.databases.isMigrateOnStartup(databaseType.classType)) {
                const database = this.databases.getDatabase(databaseType.classType);
                if (!database) throw new Error('Database not created');
                this.logger.log(`Migrate database <yellow>${getClassName(database)} ${database.name}</yellow> (${getClassName(database.adapter)})`);
                await database.migrate();
            }
        }
    }

    @eventDispatcher.listen(onAppShutdown)
    onShutdown() {
        this.databases.onShutDown();
    }
}
