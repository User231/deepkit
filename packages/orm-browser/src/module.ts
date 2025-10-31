import { createModuleClass, findParentPath } from '@d7/app';
import { OrmBrowserController } from '@d7/framework';
import { Database, DatabaseRegistry } from '@d7/orm';
import { Config } from './config.js';
import { rpc } from '@d7/rpc';
import { getCurrentFileName } from '@d7/core';
import { InjectorContext } from '@d7/injector';
import { dirname } from 'path';
import { registerStaticHttpController } from '@d7/http';

export class OrmBrowserModule extends createModuleClass({
    config: Config
}) {
    databases: Database[] = [];

    forDatabases(databases: Database[]): this {
        this.databases = databases;
        return this;
    }

    process() {
        const controllerName = '.deepkit/orm-browser/' + this.config.path;


        @rpc.controller(controllerName)
        // @ts-ignore
        class ScopedOrmBrowserController extends OrmBrowserController {
        }

        this.addController(ScopedOrmBrowserController);

        this.addProvider({
            provide: ScopedOrmBrowserController,
            useFactory: (registry: DatabaseRegistry, injectorContext: InjectorContext) => {
                return new ScopedOrmBrowserController(this.databases);
            }
        });

        const localPath = findParentPath('node_modules/@d7/orm-browser-gui/dist/orm-browser-gui', dirname(getCurrentFileName()));
        if (!localPath) throw new Error('node_modules/@d7/orm-browser-gui not installed in ' + dirname(getCurrentFileName()));

        registerStaticHttpController(this, {
            path: this.config.path,
            localPath,
            groups: ['app-static'],
            controllerName: 'ScopedController',
            indexReplace: {
                APP_CONTROLLER_NAME: controllerName
            }
        });
    }
}
