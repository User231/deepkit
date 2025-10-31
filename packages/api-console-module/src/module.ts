import { createModuleClass, findParentPath } from '@d7/app';
import { HttpRouteFilter, normalizeDirectory, registerStaticHttpController } from '@d7/http';
import { ApiConsoleApi } from '@d7/api-console-api';
import { Config } from './module.config.js';
import { rpc } from '@d7/rpc';
import { ApiConsoleController } from './controller.js';
import { dirname } from 'path';
import { getCurrentFileName } from '@d7/core';

export class ApiConsoleModule extends createModuleClass({
    name: 'apiConsole',
    config: Config,
}) {
    protected routeFilter = new HttpRouteFilter().excludeRoutes({group: 'app-static'});

    filter(cb: (filter: HttpRouteFilter) => any): this {
        cb(this.routeFilter);
        return this;
    }

    process() {
        this.addProvider({provide: HttpRouteFilter, useValue: this.routeFilter});

        if (!this.config.listen) {
            @rpc.controller(ApiConsoleApi)
            class NamedApiConsoleController extends ApiConsoleController {
            }

            this.addController(NamedApiConsoleController);
            return;
        }

        const controllerName = '.deepkit/api-console' + normalizeDirectory(this.config.path);

        @rpc.controller(controllerName)
        class NamedApiConsoleController extends ApiConsoleController {
        }

        this.addController(NamedApiConsoleController);

        const localPath = findParentPath('node_modules/@d7/api-console-gui/dist/api-console-gui', dirname(getCurrentFileName()));
        if (!localPath) throw new Error('node_modules/@d7/api-console-gui not installed in ' + dirname(getCurrentFileName()));

        registerStaticHttpController(this, {
            path: this.config.path,
            localPath,
            groups: ['app-static'],
            controllerName: 'ApiConsoleController',
            indexReplace: {
                APP_CONTROLLER_NAME: controllerName
            }
        });
    }
}
