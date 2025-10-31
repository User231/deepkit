/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { cli, Command } from '@7b/core';
import { DebugController } from '../debug/debug.controller.js';
import { ConfigOption } from "@7b/ui";
import { ReflectionClass } from "@7b/reflection";
import { createTable } from 'nice-table';
import { inspect } from 'util';

/**
 * @description Prints the current configuration, they type and default value.
 */
@cli.controller('debug:config')
export class DebugConfigController implements Command {
    constructor(
        protected debug: DebugController
    ) {
    }

    async execute(): Promise<void> {
        const configs = this.debug.configuration();
        console.log('Application config');
        this.logConfigTable(configs.appConfig);
        console.log('Modules config');
        this.logConfigTable(configs.modulesConfig);
    }

    private logConfigTable(config: ConfigOption[]) {
        console.log(
            createTable(config, ReflectionClass.from(ConfigOption).getPropertyNames() as (keyof ConfigOption)[], {
                horizontalAlignment: 'middle',
                verticalAlignment: 'middle',
                columnSizing: 'stretch',
                maxWidth: process.stdout.columns,
                fullWidth: true,
                throwIfTooSmall: false,
                indexColumn: false,
                stringify: (value) => inspect(value, { colors: true })
            })
        );
    }
}
