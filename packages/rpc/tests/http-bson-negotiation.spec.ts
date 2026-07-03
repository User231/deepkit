import { test } from 'node:test';

import { deserializeBSONWithoutOptimiser } from '@deepkit/bson';
import { expect } from '@deepkit/run/expect';

import { rpc } from '../src/decorators.js';
import { RpcKernel } from '../src/server/kernel.js';

interface Item {
    id: string;
    value: number;
    at: Date;
}

@rpc.controller('test')
class Controller {
    @rpc.action()
    items(): Item[] {
        return [
            { id: '198669992735137978', value: 42, at: new Date('2026-07-03T00:00:00.000Z') },
            { id: '2', value: 7.5, at: new Date('2026-07-03T01:00:00.000Z') },
        ];
    }

    @rpc.action()
    nothing(): void {}
}

function createMocks(path: string, headers: Record<string, string> = {}) {
    const request = {
        url: path,
        headers,
        body: Buffer.from(JSON.stringify({ args: [] })),
        socket: { remoteAddress: '127.0.0.1' },
    };
    const written: { status?: number; headers: Record<string, string>; body?: Uint8Array | string } = {
        headers: {},
    };
    const response = {
        setHeader(name: string, value: any) {
            written.headers[name] = String(value);
        },
        writeHead(status: number) {
            written.status = status;
        },
        end(body?: Uint8Array | string) {
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

test('json stays the default wire', async () => {
    const kernel = new RpcKernel();
    kernel.registerController(Controller);

    const { request, response, written } = createMocks('/rpc/test/items');
    await createConnection(kernel).onRequest('/rpc', request as any, response as any);

    expect(written.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(written.body));
    expect(body[0].id).toBe('198669992735137978');
    expect(typeof body[0].at).toBe('string'); // JSON wire: Dates are ISO strings
});

test('Accept: application/bson negotiates a typed BSON response', async () => {
    const kernel = new RpcKernel();
    kernel.registerController(Controller);

    const { request, response, written } = createMocks('/rpc/test/items', { accept: 'application/bson' });
    await createConnection(kernel).onRequest('/rpc', request as any, response as any);

    expect(written.status).toBe(200);
    expect(written.headers['Content-Type']).toBe('application/bson');
    // The wrapper document is NOT unwrapped on the wire (BSON needs a top-level
    // document); decode + unwrap `.v` like the HTTP client does.
    const decoded = deserializeBSONWithoutOptimiser(written.body as Uint8Array);
    expect(decoded.v[0].id).toBe('198669992735137978'); // Snowflake stays a STRING
    expect(decoded.v[0].value).toBe(42);
    expect(decoded.v[0].at).toBeInstanceOf(Date); // BSON wire: real Dates
    expect(decoded.v[0].at.toISOString()).toBe('2026-07-03T00:00:00.000Z');
    expect(decoded.v[1].value).toBe(7.5);
});

test('void action with Accept: application/bson still responds', async () => {
    const kernel = new RpcKernel();
    kernel.registerController(Controller);

    const { request, response, written } = createMocks('/rpc/test/nothing', { accept: 'application/bson' });
    await createConnection(kernel).onRequest('/rpc', request as any, response as any);

    expect(written.status).toBe(200);
});
