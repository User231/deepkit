import { afterEach, describe, it, test } from 'node:test';

import { App } from '@deepkit/app';
import { sleep } from '@deepkit/core';
import { HttpRequest, http } from '@deepkit/http';
import { InjectorContext } from '@deepkit/injector';
import { ConsoleTransport, Logger, MemoryLoggerTransport } from '@deepkit/logger';
import { rpc } from '@deepkit/rpc';
import { expect, jest } from '@deepkit/run/expect';

import { ApplicationServer, onServerBootstrap, onServerBootstrapDone, onServerMainBootstrap, onServerMainBootstrapDone } from '../src/application-server.js';
import { FrameworkModule } from '../src/module.js';
import { createTestingApp } from '../src/testing.js';
import { RpcServer, RpcServerInterface, WebWorker } from '../src/worker.js';

// node:test note: jest.mock('ws') is not portable. node:test's mock.module() only intercepts
// relative specifiers (not bare node_modules ids like 'ws') under the @deepkit/run loader, so the
// two `RpcServer` tests below assert via the `RpcServer.createWebSocketServer()` DI seam instead of
// module-mocking `ws`. Most other tests use createTestingApp() (WebMemoryWorkerFactory — no real
// HTTP/TCP server) and need no mocks.

Error.stackTraceLimit = 50;

describe('application-server', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('testing app api', async () => {
        @rpc.controller('test')
        class MyController {
            constructor(protected logger: Logger) {}

            @rpc.action()
            foo() {
                this.logger.log('bar');
                return 'bar';
            }
        }

        const testing = createTestingApp({ controllers: [MyController] });
        await testing.startServer();

        const client = testing.createRpcClient();
        const controller = client.controller<MyController>('test');

        expect(await controller.foo()).toBe('bar');
        expect(testing.app.get(MemoryLoggerTransport).messageStrings.includes('bar'));
        await testing.stopServer();
    });

    test('bootstrap events fire exactly once in single-process start', async () => {
        // Regression: start() dispatched onServerBootstrap before the cluster branch AND
        // again inside the single-process (workers=0) branch, so every bootstrap listener
        // ran twice on a plain start.
        const counts = { bootstrap: 0, main: 0, done: 0, mainDone: 0 };

        const testing = createTestingApp({});
        testing.app.listen(onServerBootstrap, () => void counts.bootstrap++);
        testing.app.listen(onServerMainBootstrap, () => void counts.main++);
        testing.app.listen(onServerBootstrapDone, () => void counts.done++);
        testing.app.listen(onServerMainBootstrapDone, () => void counts.mainDone++);

        await testing.startServer();
        expect(counts).toEqual({ bootstrap: 1, main: 1, done: 1, mainDone: 1 });
        await testing.stopServer();
    });

    test('basic controller', async () => {
        let createdControllers = 0;

        @rpc.controller('test')
        class MyController {
            constructor() {
                createdControllers++;
            }

            @rpc.action()
            foo() {
                return 'bar';
            }
        }

        const app = createTestingApp({
            controllers: [MyController],
            imports: [
                new FrameworkModule({
                    broker: { startOnBootstrap: false },
                }),
            ],
        }).app;
        const applicationServer = app.get(ApplicationServer);
        const injectorContext = app.get(InjectorContext);
        const controller = injectorContext.createChildScope('rpc').get(MyController);
        expect(controller.foo()).toBe('bar');

        createdControllers = 0;

        expect(createdControllers).toBe(0);

        await applicationServer.start();

        {
            const client = applicationServer.createClient();

            const controller = client.controller<MyController>('test');
            const a = await controller.foo();
            expect(a).toBe('bar');
            expect(createdControllers).toBe(1);
            client.disconnect();
        }

        {
            const client = applicationServer.createClient();

            const controller = client.controller<MyController>('test');
            const a = await controller.foo();
            expect(a).toBe('bar');
            expect(createdControllers).toBe(2);
            client.disconnect();
        }

        await applicationServer.close();
    });

    describe('http worker', () => {
        test('needed for publicDir', async () => {
            const testing = createTestingApp({
                controllers: [],
                imports: [new FrameworkModule({ publicDir: 'public' })],
            });

            await testing.startServer();
            const applicationServer = testing.app.get(ApplicationServer);
            expect(applicationServer.getWorker()).toBeInstanceOf(WebWorker);
            await testing.stopServer();
        });

        test('graceful shutdown succeeds', async () => {
            class MyController {
                @http.GET()
                async get() {
                    await sleep(0.2);
                    return 'wait-for-me';
                }
            }

            const testing = createTestingApp({
                controllers: [MyController],
                imports: [new FrameworkModule({ publicDir: 'public', gracefulShutdownTimeout: 1 })],
            });

            await testing.startServer();
            const request1 = testing.request(HttpRequest.GET('/'));
            await testing.stopServer(true);
            expect(testing.getLogger().messages.some(v => v.message.includes('Waiting 1s for all 1'))).toBe(true);
            expect(testing.getLogger().messages.some(v => v.message.includes('Timeout of 1s exceeded'))).toBe(false);
            expect((await request1).json).toBe('wait-for-me');
        });

        test('graceful shutdown fails', async () => {
            class MyController {
                @http.GET()
                async get() {
                    await sleep(1.2);
                    return 'wait-for-me';
                }
            }

            const testing = createTestingApp({
                controllers: [MyController],
                imports: [new FrameworkModule({ publicDir: 'public', gracefulShutdownTimeout: 1 })],
            });

            await testing.startServer();
            const request1 = testing.request(HttpRequest.GET('/'));
            await testing.stopServer(true);
            expect(testing.getLogger().messages.some(v => v.message.includes('Waiting 1s for all 1'))).toBe(true);
            expect(testing.getLogger().messages.some(v => v.message.includes('Timeout of 1s exceeded'))).toBe(true);
        });

        test('not needed without controllers or publicDir', async () => {
            const testing = createTestingApp({
                controllers: [],
            });

            await testing.startServer();
            const applicationServer = testing.app.get(ApplicationServer);
            expect(() => applicationServer.getWorker()).toThrow();
            await testing.stopServer();
        });
    });

    describe('RpcServer', () => {
        // These were ported from jest.mock('ws'). node:test's mock.module() does NOT intercept
        // bare node_modules specifiers (only relative paths) under the @deepkit/run loader, so we
        // assert via the `RpcServer` DI seam instead: a custom `provide: RpcServer` replaces the
        // default, and `RpcServer.createWebSocketServer()` is the overridable hook that decides
        // whether the real `ws.Server` is constructed.
        test('should use custom implementation when provided', async () => {
            const onMock = jest.fn();
            const wsServerMock = {
                on: onMock,
            };

            const rpcServerMock: RpcServerInterface = {
                start: jest.fn((options: any, createRpcConnection: any) =>
                    wsServerMock.on('connection', (ws: any, req: HttpRequest) => {
                        createRpcConnection({
                            write: jest.fn(),
                            close: jest.fn(),
                            bufferedAmount: jest.fn(),
                            clientAddress: jest.fn(),
                        });
                    }),
                ),
            };

            @rpc.controller('test')
            class MyController {}

            const app = new App({
                controllers: [MyController],
                providers: [
                    {
                        provide: RpcServer,
                        useValue: rpcServerMock,
                    },
                ],
                imports: [
                    new FrameworkModule({
                        broker: { startOnBootstrap: false },
                    }),
                ],
            });
            const applicationServer = app.get(ApplicationServer);
            await applicationServer.start();

            // custom RpcServer.start() ran, registered a single connection handler, and the
            // default ws-backed implementation was never reached (no real ws.Server constructed).
            expect(rpcServerMock.start).toHaveBeenCalledTimes(1);
            expect(onMock).toHaveBeenCalledTimes(1);

            await applicationServer.close();
        });

        test('should use default implementation via ws when not specified', async () => {
            // Subclass the real RpcServer and override only the ws-construction seam so we can
            // observe it without binding a real ws/http port. Default DI resolves `RpcServer`,
            // so providing this subclass exercises the production start()/createWebSocketServer()
            // path exactly.
            const createServerCalls: any[] = [];
            class SpyRpcServer extends RpcServer {
                protected createWebSocketServer(options: any): any {
                    createServerCalls.push(options);
                    // minimal ws.Server stand-in: start() only calls `.on('connection', ...)`,
                    // and the listener's close() calls `.close()`.
                    return {
                        on: jest.fn(),
                        close: jest.fn(),
                    };
                }
            }

            @rpc.controller('test')
            class MyController {}

            const app = new App({
                controllers: [MyController],
                providers: [
                    {
                        provide: RpcServer,
                        useClass: SpyRpcServer,
                    },
                ],
                imports: [
                    new FrameworkModule({
                        broker: { startOnBootstrap: false },
                    }),
                ],
            });
            const applicationServer = app.get(ApplicationServer);
            await applicationServer.start();

            // the default code path constructed exactly one ws server via createWebSocketServer().
            expect(createServerCalls.length).toBe(1);

            await applicationServer.close();
        });

        test('refuses a text frame instead of feeding it to the binary reader', () => {
            // The RPC WebSocket server answers EVERY upgrade path of the app's port, so a client
            // of some other protocol (graphql-ws, socket.io) lands here and opens with a TEXT
            // frame. `ws@7` hands text over as a string and `ws@8` as a Buffer with isBinary=false;
            // both index into character codes, which the BSON reader decodes as a nonsense
            // document size. Refuse the frame at the transport with the close code that says so.
            const socketListeners = new Map<string, Function>();
            const socket = {
                on: (event: string, callback: Function) => void socketListeners.set(event, callback),
                close: jest.fn(),
                send: jest.fn(),
                bufferedAmount: 0,
            };

            let onConnection: Function | undefined;
            class FakeRpcServer extends RpcServer {
                protected createWebSocketServer(): any {
                    return {
                        on: (event: string, callback: Function) => {
                            if ('connection' === event) onConnection = callback;
                        },
                        close: jest.fn(),
                    };
                }
            }

            const fed: Uint8Array[] = [];
            new FakeRpcServer().start({}, () => ({ feed: (message: Uint8Array) => void fed.push(message) }) as any);
            onConnection!(socket, { getRemoteAddress: () => '127.0.0.1' } as unknown as HttpRequest);

            const onMessage = socketListeners.get('message')!;

            onMessage('{"type":"connection_init"}');
            expect(fed).toHaveLength(0);
            expect(socket.close).toHaveBeenCalledWith(1003, 'RPC expects binary messages');

            onMessage(Buffer.from('{"type":"connection_init"}'), false);
            expect(fed).toHaveLength(0);

            // A binary frame is still an RPC message and reaches the kernel connection.
            onMessage(new Uint8Array([5, 0, 0, 0, 0]), true);
            expect(fed).toHaveLength(1);
        });
    });
});

describe('createTestingApp', () => {
    it('should setup the logger correctly', async () => {
        const loggerRemoveTransportSpy = jest.spyOn(Logger.prototype, 'removeTransport');
        const loggerAddTransportSpy = jest.spyOn(Logger.prototype, 'addTransport');
        const facade = createTestingApp({});
        await facade.startServer();
        expect(loggerAddTransportSpy).toHaveBeenCalledWith(expect.any(MemoryLoggerTransport));
        expect(loggerRemoveTransportSpy).toHaveBeenCalledWith(expect.any(ConsoleTransport));
    });
});
