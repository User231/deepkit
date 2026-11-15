import { describe, test } from 'node:test';

import { HttpRequest } from '@deepkit/http';
import { RpcKernel, rpc } from '@deepkit/rpc';
import { expect } from '@deepkit/run/expect';

import { FrameworkModule } from '../src/module.js';
import { createTestingApp } from '../src/testing.js';

// The RPC-over-HTTP bridge (`httpRpcBasePath`) opens a kernel connection for each call. The
// kernel keeps every open connection in its list, so the bridge has to close what it opened:
// a connection left open keeps its request, the request's body and its injector scope
// reachable for the life of the process. Found by a two-hour load run of the application this
// fork serves: 109,069 requests alive after a full garbage collection, one for every call.
describe('the RPC-over-HTTP bridge closes the connection of each call', () => {
    class Boom extends Error {}

    @rpc.controller('test')
    class Controller {
        @rpc.action()
        hello(name: string): string {
            return 'hello ' + name;
        }

        @rpc.action()
        boom(): string {
            throw new Boom('no');
        }
    }

    function app(propagateErrors: boolean) {
        return createTestingApp({
            controllers: [Controller],
            imports: [new FrameworkModule({ httpRpcBasePath: '_rpc', httpRpcPropagateErrors: propagateErrors })],
        });
    }

    test('after calls that answered', async () => {
        const testing = app(false);
        await testing.startServer();
        const kernel = testing.app.get(RpcKernel);
        for (let i = 0; i < 25; i++) {
            const response = await testing.request(HttpRequest.POST('/_rpc/test/hello').json({ args: ['a'] }));
            expect(response.statusCode).toBe(200);
            expect(response.json).toBe('hello a');
        }
        expect(kernel.stats.totalConnections).toBe(25);
        expect(kernel.stats.connections).toBe(0);
        await testing.stopServer();
    });

    test('after calls whose action threw, with the error answered and with it propagated', async () => {
        for (const propagateErrors of [false, true]) {
            const testing = app(propagateErrors);
            await testing.startServer();
            const kernel = testing.app.get(RpcKernel);
            for (let i = 0; i < 5; i++) {
                await testing.request(HttpRequest.POST('/_rpc/test/boom').json({ args: [] }));
            }
            expect(kernel.stats.totalConnections).toBe(5);
            expect(kernel.stats.connections).toBe(0);
            await testing.stopServer();
        }
    });

    test('after a call for an action that does not exist', async () => {
        const testing = app(false);
        await testing.startServer();
        const kernel = testing.app.get(RpcKernel);
        await testing.request(HttpRequest.POST('/_rpc/test/nothing').json({ args: [] }));
        await testing.request(HttpRequest.POST('/_rpc/nobody/hello').json({ args: [] }));
        expect(kernel.stats.totalConnections).toBe(2);
        expect(kernel.stats.connections).toBe(0);
        await testing.stopServer();
    });
});
