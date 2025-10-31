import { InjectorContext, OrmBrowserController, createModuleClass, findParentPath } from '@7b/core';
import { Database, DatabaseRegistry } from '@7b/db';
import { rpc } from '@7b/io/rpc';
import { getCurrentFileName } from '@7b/runtime';
import { registerStaticHttpController } from '@7b/io/http';

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

        const localPath = findParentPath('node_modules/@deepkit/orm-browser-gui/dist/orm-browser-gui', dirname(getCurrentFileName()));
        if (!localPath) throw new Error('node_modules/@deepkit/orm-browser-gui not installed in ' + dirname(getCurrentFileName()));

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
