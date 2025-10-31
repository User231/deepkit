/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { ClassType, isClass, isPrototypeOfBase, ProcessLocker } from '@7b/runtime';
import { AppModule, ControllerConfig, DeepPartial, EventDispatcher, InjectorContext, Logger, ProviderWithScope, Stopwatch, StopwatchStore, Token, createModuleClass, onAppShutdown } from '@7b/core';
import { http, HttpLogger, HttpModule, HttpRegExp, HttpRequest, HttpResponse, serveStaticListener } from '@7b/io/http';
import { Database, DatabaseRegistry } from '@7b/db';
import { rpcClass, RpcKernel, RpcKernelBaseConnection, RpcKernelConnection, RpcKernelSecurity, SessionState } from '@7b/io/rpc';
import { ApiConsoleModule } from '@7b/ui';
import { Filesystem } from '@7b/io/fs';
import { BrokerBus, BrokerCache, BrokerDeepkitAdapter, BrokerKeyValue, BrokerLock, BrokerQueue } from '@7b/io/broker';
import { getBrokerServers } from './broker.js';

export class FrameworkModule extends createModuleClass({
    name: 'framework',
    config: FrameworkConfig,
    providers: [
        ProcessLocker,
        ApplicationServer,
        WebWorkerFactory,
        RpcServer,
        MigrationProvider,
        DebugController,
        BrokerServer,
        FilesystemRegistry,
        { provide: DatabaseRegistry, useFactory: (ic: InjectorContext) => new DatabaseRegistry(ic) },
        {
            provide: RpcKernel,
            useFactory(rpcControllers: RpcControllers, injectorContext: InjectorContext, logger: Logger, stopwatch?: Stopwatch) {
                const classType = stopwatch ? RpcKernelWithStopwatch : RpcKernel;
                const kernel: RpcKernel = new classType(injectorContext, logger.scoped('rpc'));

                if (kernel instanceof RpcKernelWithStopwatch) {
                    kernel.stopwatch = stopwatch;
                }

                for (const [name, info] of rpcControllers.controllers.entries()) {
                    kernel.registerController(info.controller, name, info.module);
                }

                return kernel;
            },
        },

        {
            provide: BrokerDeepkitAdapter,
            useFactory: (config: BrokerConfig) => new BrokerDeepkitAdapter({ servers: getBrokerServers(config) }),
        },
        { provide: BrokerCache, useFactory: (adapter: BrokerDeepkitAdapter) => new BrokerCache(adapter) },
        { provide: BrokerLock, useFactory: (adapter: BrokerDeepkitAdapter) => new BrokerLock(adapter) },
        { provide: BrokerQueue, useFactory: (adapter: BrokerDeepkitAdapter) => new BrokerQueue(adapter) },
        { provide: BrokerBus, useFactory: (adapter: BrokerDeepkitAdapter) => new BrokerBus(adapter) },
        { provide: BrokerKeyValue, useFactory: (adapter: BrokerDeepkitAdapter) => new BrokerKeyValue(adapter) },

        // { provide: LiveDatabase, scope: 'rpc' },
        { provide: RpcKernelSecurity, scope: 'rpc' },

        //all of these will be set on scope creation
        { provide: HttpRequest, scope: 'rpc', useValue: undefined },
        { provide: InjectorContext, scope: 'rpc', useValue: undefined },
        { provide: SessionState, scope: 'rpc', useValue: undefined },
        { provide: RpcKernelBaseConnection, scope: 'rpc', useValue: undefined },
        { provide: RpcKernelConnection, scope: 'rpc', useValue: undefined },
    ],
    listeners: [
        DatabaseListener,
        BrokerListener,
    ],
    controllers: [
        ServerStartController,
        DebugRouterController,
        DebugDIController,
        DebugProfileFramesCommand,
        DebugConfigController,

        MigrationUpCommand,
        MigrationDownCommand,
        MigrationPendingCommand,
        MigrationCreateController,
    ],
    exports: [
        ProcessLocker,
        ApplicationServer,
        WebWorkerFactory,
        RpcServer,
        RpcKernelSecurity,
        RpcKernel,
        MigrationProvider,

        DatabaseRegistry,

        HttpRequest,
        InjectorContext,
        SessionState,
        RpcKernelConnection,
        RpcKernelBaseConnection,

        BrokerDeepkitAdapter,
        BrokerCache,
        BrokerLock,
        BrokerQueue,
        BrokerBus,
        BrokerKeyValue,
        BrokerServer,

        FilesystemRegistry,

        HttpModule,
    ],
}) {
    imports = [
        new HttpModule(),
    ];

    name = 'framework';

    protected dbs: { module: AppModule<any>, classType: ClassType }[] = [];
    protected filesystems: { module: AppModule<any>, classType: ClassType }[] = [];

    protected rpcControllers = new RpcControllers;

    constructor(options?: DeepPartial<FrameworkConfig>) {
        super(options);
    }

    process() {
        this.addImport();
        this.addProvider({ provide: RpcControllers, useValue: this.rpcControllers });

        this.configureProvider<MigrationProvider>(v => v.setMigrationDir(this.config.migrationDir));
        this.configureProvider<DatabaseRegistry>(v => v.setMigrateOnStartup(this.config.migrateOnStartup));

        if (this.config.httpLog) {
            this.addListener(HttpLogger);
        }

        this.getImportedModuleByClass(HttpModule).configure(this.config.http);

        if (this.config.logStartup) {
            this.addListener(LogStartupListener);
        }

        if (this.config.publicDir) {
            const localPublicDir =
                isAbsolute(this.config.publicDir) ? this.config.publicDir :
                    join(process.cwd(), this.config.publicDir);

            this.addListener(serveStaticListener(this, normalizeDirectory(this.config.publicDirPrefix), localPublicDir));

            this.addProvider({
                provide: PublicFilesystem, useFactory: () => {
                    return new PublicFilesystem(localPublicDir, this.config.publicDirPrefix);
                },
            });
        }

        if (this.config.debug) {
            Zone.enable();

            this.addProvider({
                provide: OrmBrowserController,
                useFactory: (registry: DatabaseRegistry) => new OrmBrowserController(registry.getDatabases()),
            });
            this.addController(DebugController);
            this.addController(MediaController);
            this.addController(OrmBrowserController);
            registerDebugHttpController(this, this.config.debugUrl);

            @http.controller(this.config.debugUrl)
            class ScopedDebugHttpController extends DebugHttpController {
            }

            this.addController(ScopedDebugHttpController);

            //only register the RPC controller
            this.addImport(new ApiConsoleModule({ listen: false, markdown: '' }).rename('internalApi'));
            // this.setupProvider(LiveDatabase).enableChangeFeed(DebugRequest);
        }

        if (this.config.httpRpcBasePath) {
            const rpcBaseUrl = this.config.httpRpcBasePath;

            @http.controller(rpcBaseUrl)
            class HttpRpcController {
                constructor(protected rpcKernel: RpcKernel) {
                }

                @http.GET(':controller/:method')
                @http.POST(':controller/:method')
                async handle(
                    controller: HttpRegExp<string, '.*'>,
                    method: string,
                    request: HttpRequest,
                    response: HttpResponse,
                ) {
                    const connection = this.rpcKernel.createConnection({
                        write: (data) => {

                        },
                        bufferedAmount() {
                            return 0;
                        },
                        close() {

                        },
                        clientAddress() {
                            return request.socket.remoteAddress || '';
                        },
                    });
                    request.body = await request.readBody();
                    await connection.onRequest(rpcBaseUrl, request, response);
                    return response;
                }
            }

            this.addController(HttpRpcController);
        }

        const disconnect = async (event: unknown, broker: DebugBrokerBus, store: StopwatchStore) => {
            await store.close();
            await broker.adapter.disconnect();
        };
        this.addListener(onAppShutdown.listen(disconnect));
        // Registering at onServerShutdown also so that ApplicationServer.close disconnects all connections.
        this.addListener(onServerShutdown.listen(disconnect));

        this.addProvider(DebugBrokerBus);
        this.addProvider({ provide: StopwatchStore, useClass: FileStopwatchStore });

        this.configureProvider<Stopwatch>(stopwatch => {
            if (this.config.profile || this.config.debug) {
                stopwatch.enable();
            } else {
                stopwatch.disable();
            }
        }, { global: true });
        this.addExport(DebugBrokerBus, StopwatchStore);
    }

    postProcess() {
        //all providers are known at this point
        this.setupDatabase();
        this.configureProvider<FilesystemRegistry>(v => {
            for (const fs of this.filesystems) {
                v.addFilesystem(fs.classType, fs.module);
            }
        });
    }

    protected setupDatabase() {
        for (const db of this.dbs) {
            this.configureProvider<DatabaseRegistry>(v => v.addDatabase(db.classType, {}, db.module));
            db.module.configureProvider((db: Database, eventDispatcher: EventDispatcher, logger: Logger, stopwatch: Stopwatch) => {
                db.setEventDispatcher(eventDispatcher);
                db.setLogger(logger);
                db.stopwatch = stopwatch;
            }, {}, db.classType);
        }
    }

    processProvider(module: AppModule<any>, token: Token, provider: ProviderWithScope) {
        if (!isClass(token)) return;
        if (isPrototypeOfBase(token, Database)) {
            this.dbs.push({ classType: token as ClassType, module });
        }
        if (isPrototypeOfBase(token, Filesystem)) {
            this.filesystems.push({ classType: token as ClassType, module });
        }
    }

    processController(module: AppModule<any>, config: ControllerConfig) {
        const controller = config.controller;
        if (!controller) return;

        const rpcConfig = rpcClass._fetch(controller);
        if (!rpcConfig) return;

        if (!module.isProvided(controller)) module.addProvider({ provide: controller, scope: 'rpc' });
        if (this.rpcControllers.controllers.has(rpcConfig.getPath())) {
            throw new Error(`Already an RPC controller with the name ${rpcConfig.getPath()} registered.`);
        }
        this.rpcControllers.controllers.set(rpcConfig.getPath(), { controller, module });
    }
}
