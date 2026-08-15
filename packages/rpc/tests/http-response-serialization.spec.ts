/**
 * The HTTP bridge must serialize the response BEFORE writeHead: a response
 * whose serialization fails used to leave the socket open forever behind an
 * already-sent 200 (observed with BSON documents crossing the serializer's
 * old fixed 1MB buffer — the RangeError was thrown between writeHead and
 * end, no error path could render, no log line appeared). These tests pin
 * the two halves: big responses complete, and serialization failures always
 * complete the request as a real error.
 */
import { test } from 'node:test';

import { deserializeBSONWithoutOptimiser } from '@deepkit/bson';
import { expect } from '@deepkit/run/expect';

import { rpc } from '../src/decorators.js';
import { RpcKernel } from '../src/server/kernel.js';

interface WideRow {
    id: string;
    cells: string[];
}

@rpc.controller('test')
class Controller {
    @rpc.action()
    bigPage(): WideRow[] {
        // ~100 rows × 1000 cells ≈ several MB — crosses the serializer's 1MB
        // initial buffer (the mz-next wide-table page that surfaced the hang).
        return Array.from({ length: 100 }, (_, r) => ({
            id: `row-${r}`,
            cells: Array.from({ length: 1000 }, (_, c) => `r${r}c${c}-value`),
        }));
    }

    @rpc.action()
    circular(): any {
        const a: any = { name: 'a' };
        a.self = a;
        return a;
    }
}

function createMocks(path: string, headers: Record<string, string> = {}) {
    const request = {
        url: path,
        headers,
        body: Buffer.from(JSON.stringify({ args: [] })),
        socket: { remoteAddress: '127.0.0.1' },
    };
    const written: {
        status?: number;
        headers: Record<string, string>;
        body?: Uint8Array | string;
        writeHeadCalls: number;
        endCalls: number;
    } = { headers: {}, writeHeadCalls: 0, endCalls: 0 };
    const response = {
        setHeader(name: string, value: any) {
            written.headers[name] = String(value);
        },
        writeHead(status: number) {
            written.writeHeadCalls++;
            written.status = status;
        },
        end(body?: Uint8Array | string) {
            written.endCalls++;
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

test('BSON response larger than the initial 1MB buffer completes', async () => {
    const kernel = new RpcKernel();
    kernel.registerController(Controller);

    const { request, response, written } = createMocks('/rpc/test/bigPage', { accept: 'application/bson' });
    await createConnection(kernel).onRequest('/rpc', request as any, response as any);

    expect(written.status).toBe(200);
    expect(written.headers['Content-Type']).toBe('application/bson');
    expect(written.endCalls).toBe(1);
    const body = written.body as Uint8Array;
    expect(body.byteLength).toBeGreaterThan(1024 * 1024);
    const decoded = deserializeBSONWithoutOptimiser(body);
    expect(decoded.v[99].cells[999]).toBe('r99c999-value');
});

test('response serialization failure without propagateErrors: error envelope, request completes', async () => {
    const kernel = new RpcKernel();
    kernel.registerController(Controller);

    const { request, response, written } = createMocks('/rpc/test/circular', { accept: 'application/bson' });
    await createConnection(kernel).onRequest('/rpc', request as any, response as any);

    // The failed attempt must not have sent headers — only the error write does.
    expect(written.writeHeadCalls).toBe(1);
    expect(written.endCalls).toBe(1);
    expect(written.status).toBe(200);
    expect(Number(written.headers['X-Message-Type'])).toBeGreaterThan(0);
});

test('response serialization failure with propagateErrors: rethrown, nothing written', async () => {
    const kernel = new RpcKernel();
    kernel.registerController(Controller);

    const { request, response, written } = createMocks('/rpc/test/circular', { accept: 'application/bson' });
    let thrown: any;
    try {
        await createConnection(kernel).onRequest('/rpc', request as any, response as any, {
            propagateErrors: true,
        });
    } catch (error) {
        thrown = error;
    }

    // Rethrown with the response untouched, so the surrounding HTTP framework
    // can still render a real error status — previously writeHead(200) had
    // already gone out and the connection hung open.
    expect(thrown).toBeInstanceOf(Error);
    expect(written.writeHeadCalls).toBe(0);
    expect(written.endCalls).toBe(0);
});
