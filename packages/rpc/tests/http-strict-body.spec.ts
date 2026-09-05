import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { rpc } from '../src/decorators.js';
import { RpcKernel } from '../src/server/kernel.js';

// The HTTP bridge casts a JSON BODY with `loosely: false` — a typed client serialized it
// through the same parameter types, so a string is a string and a number a number —
// while `?arg=` query strings, which are text by nature, keep the loose coercing cast.

interface Input {
    text: string | number;
    count: number;
}

@rpc.controller('strict')
class Controller {
    @rpc.action()
    echo(input: Input): { text: string | number; textType: string; count: number } {
        return { text: input.text, textType: typeof input.text, count: input.count };
    }

    @rpc.action()
    double(n: number): number {
        return n * 2;
    }
}

function createMocks(path: string, body?: unknown) {
    const request = {
        url: path,
        headers: {} as Record<string, string>,
        body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
        socket: { remoteAddress: '127.0.0.1' },
    };
    const written: { status?: number; headers: Record<string, string>; body?: Uint8Array | string } = { headers: {} };
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

function connection(kernel: RpcKernel) {
    return kernel.createConnection({
        write: () => {},
        bufferedAmount: () => 0,
        close: () => {},
        clientAddress: () => '127.0.0.1',
    });
}

test('a JSON body is exact: a string | number parameter keeps its string', async () => {
    const kernel = new RpcKernel();
    kernel.registerController(Controller);
    const { request, response, written } = createMocks('/rpc/strict/echo', { args: [{ text: '7', count: 3 }] });
    await connection(kernel).onRequest('/rpc', request as any, response as any);
    expect(written.status).toBe(200);
    expect(JSON.parse(String(written.body))).toEqual({ text: '7', textType: 'string', count: 3 });
});

test('a JSON body is exact: a number parameter refuses a numeric string', async () => {
    const kernel = new RpcKernel();
    kernel.registerController(Controller);
    const { request, response, written } = createMocks('/rpc/strict/echo', { args: [{ text: 'x', count: '3' }] });
    await connection(kernel).onRequest('/rpc', request as any, response as any);
    // Without propagateErrors the bridge answers the legacy error frame (X-Message-Type: 1).
    expect(written.headers['X-Message-Type']).toBe('1');
    expect(String(written.body)).toContain('Validation error');
});

test('query-string args are text: ?arg= for a number parameter still coerces', async () => {
    const kernel = new RpcKernel();
    kernel.registerController(Controller);
    const { request, response, written } = createMocks('/rpc/strict/double?arg=21');
    await connection(kernel).onRequest('/rpc', request as any, response as any);
    expect(written.status).toBe(200);
    expect(JSON.parse(String(written.body))).toBe(42);
});
