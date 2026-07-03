import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { rpc } from '../src/decorators.js';
import { RpcKernel } from '../src/server/kernel.js';

class TeapotError extends Error {
    kind = 'teapot';
}

@rpc.controller('test')
class Controller {
    @rpc.action()
    hello(): string {
        return 'world';
    }

    @rpc.action()
    boom(): string {
        throw new TeapotError('short and stout');
    }
}

function createMocks(path: string) {
    const request = {
        url: path,
        headers: {},
        body: Buffer.from(JSON.stringify({ args: [] })),
        socket: { remoteAddress: '127.0.0.1' },
    };
    const written: { status?: number; headers: Record<string, string>; body?: string } = { headers: {} };
    const response = {
        setHeader(name: string, value: any) {
            written.headers[name] = String(value);
        },
        writeHead(status: number) {
            written.status = status;
        },
        end(body?: string) {
            written.body = body;
        },
    };
    return { request, response, written };
}

function createConnection(kernel: RpcKernel) {
    return kernel.createConnection({
        write: () => {},
        bufferedAmount: () => 0,
        close: () => {},
        clientAddress: () => '127.0.0.1',
    });
}

test('http action error default: 200 + error envelope', async () => {
    const kernel = new RpcKernel();
    kernel.registerController(Controller);

    const { request, response, written } = createMocks('/rpc/test/boom');
    await createConnection(kernel).onRequest('/rpc', request as any, response as any);

    expect(written.status).toBe(200);
    // RpcTypes.Error envelope is flagged via the X-Message-Type header
    expect(Number(written.headers['X-Message-Type'])).toBeGreaterThan(0);
    expect(written.body).toContain('short and stout');
});

test('http action error with propagateErrors: rethrown, nothing written', async () => {
    const kernel = new RpcKernel();
    kernel.registerController(Controller);

    const { request, response, written } = createMocks('/rpc/test/boom');
    let thrown: any;
    try {
        await createConnection(kernel).onRequest('/rpc', request as any, response as any, {
            propagateErrors: true,
        });
    } catch (error) {
        thrown = error;
    }

    expect(thrown).toBeInstanceOf(TeapotError);
    expect(thrown.message).toBe('short and stout');
    expect(written.status).toBe(undefined);
    expect(written.body).toBe(undefined);
});

test('http success with propagateErrors: unchanged', async () => {
    const kernel = new RpcKernel();
    kernel.registerController(Controller);

    const { request, response, written } = createMocks('/rpc/test/hello');
    await createConnection(kernel).onRequest('/rpc', request as any, response as any, {
        propagateErrors: true,
    });

    expect(written.status).toBe(200);
    expect(written.body).toBe(JSON.stringify('world'));
});

test('http unknown method with propagateErrors: rethrown', async () => {
    const kernel = new RpcKernel();
    kernel.registerController(Controller);

    const { request, response, written } = createMocks('/rpc/test/doesNotExist');
    let thrown: any;
    try {
        await createConnection(kernel).onRequest('/rpc', request as any, response as any, {
            propagateErrors: true,
        });
    } catch (error) {
        thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(written.status).toBe(undefined);
});
