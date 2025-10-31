#!/usr/bin/env ts-node-script
import { App, FrameworkModule, JSONTransport, Logger, LoggerInterface, createCrudRoutes, onServerMainBootstrapDone } from '@7b/core';
import { ApiConsoleModule, OrmBrowserModule } from '@7b/ui';
// import { OpenAPIModule } from 'deepkit-openapi';

const bookStoreCrud = createCrudRoutes([Author, Book]);

const app = new App({
    config: Config,
    providers: [
        SQLiteDatabase, MainController,
    ],
    controllers: [MainController, UsersCommand, RpcController],
    listeners: [
        onServerMainBootstrapDone.listen((event, logger: LoggerInterface, environment: Config['environment']) => {
            logger.log(`Environment <yellow>${environment}</yellow>`);
        })
    ],
    imports: [
        createCrudRoutes([User], { identifier: 'username', identifierChangeable: true }),
        bookStoreCrud,

        // this doesn't support newest deepkit
        // new OpenAPIModule({ prefix: '/openapi/' }),

        new OrmBrowserModule({ path: '/data' }),
        new ApiConsoleModule({ path: '/api' }).filter(filter => filter.excludeModules(bookStoreCrud)),
        new ApiConsoleModule({
            path: '/api/bookstore',
            markdown: `
             # Bookstore

             Welcome to my little bookstore API. Feel free to manage the content.

             Have fun
            `
        }).filter(filter => filter.forModules(bookStoreCrud)),

        new FrameworkModule({
            publicDir: 'public',
            httpLog: true,
            migrateOnStartup: true,
            httpRpcBasePath: 'rpc/v1'
        }),
    ]
});

app.setup((module, config) => {
    if (config.environment === 'development') {
        module.getImportedModuleByClass(FrameworkModule).configure({ debug: true });
    }

    module.configureProvider<Logger>(logger => {
        if (config.environment === 'production') {
            logger.setTransport([new JSONTransport]);
        }
    });
});

app.loadConfigFromEnv().run();
