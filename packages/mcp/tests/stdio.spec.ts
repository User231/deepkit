import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { ERROR } from '../src/protocol.js';
import { serveStdio } from '../src/stdio.js';
import { BindingTools, fixtureServer, request } from './fixture.js';

function harness(principal?: unknown) {
    const input = new PassThrough();
    const output = new PassThrough();
    const errors = new PassThrough();
    const outLines: unknown[] = [];
    let buffer = '';
    output.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let at: number;
        while ((at = buffer.indexOf('\n')) >= 0) {
            outLines.push(JSON.parse(buffer.slice(0, at)));
            buffer = buffer.slice(at + 1);
        }
    });
    const handle = serveStdio(fixtureServer(), { input, output, errors, principal });
    const send = (message: unknown) => input.write(`${JSON.stringify(message)}\n`);
    const until = async (count: number) => {
        for (let i = 0; i < 200 && outLines.length < count; i++) await new Promise(resolve => setTimeout(resolve, 5));
        return outLines;
    };
    return { input, output, errors, outLines, handle, send, until };
}

test('answers each line with a line, writes nothing for a notification, and resolves when the input ends', async () => {
    const h = harness('cli-user');
    h.send(request('ping', {}, 'a'));
    h.send({ jsonrpc: '2.0', method: 'notifications/whatever' });
    h.send(request('tools/call', { name: 'who', arguments: {} }, 'b'));
    const lines: any[] = await h.until(2);
    expect(lines.map(l => l.id).sort()).toEqual(['a', 'b']);
    expect(lines.find(l => l.id === 'b').result.structuredContent).toEqual({ principal: 'cli-user' });
    h.input.end();
    await h.handle.done;
    expect(h.outLines).toHaveLength(2);
});

test('an unparseable line is a -32700 with a null id, and a note on the error stream', async () => {
    const h = harness();
    let noted = '';
    h.errors.on('data', (chunk: Buffer) => (noted += chunk.toString()));
    h.input.write('{nope\n');
    const lines: any[] = await h.until(1);
    expect(lines[0]).toEqual({ jsonrpc: '2.0', id: null, error: { code: ERROR.parse, message: 'Parse error' } });
    expect(noted).toContain('unparseable line dropped');
    h.input.end();
    await h.handle.done;
});

test('progress notifications are lines before the response; notifications/cancelled aborts the named request', async () => {
    const h = harness();
    BindingTools.aborted = [];
    h.send(request('tools/call', { name: 'slow', arguments: { steps: 50, stepMs: 10 } }, 'long', { progressToken: 'p' }));
    const first: any[] = await h.until(1);
    expect(first[0]).toEqual({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'p', progress: 1, total: 50, message: 'step 1' } });
    h.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'long' } });
    h.input.end();
    await h.handle.done;
    const response: any = h.outLines.find((l: any) => l.id === 'long');
    expect(response.result.content[0].text).toBe('aborted');
    expect(BindingTools.aborted).toHaveLength(1);
});

test('close() aborts what is in flight', async () => {
    const h = harness();
    BindingTools.aborted = [];
    h.send(request('tools/call', { name: 'slow', arguments: { steps: 50, stepMs: 10 } }, 'x'));
    await new Promise(resolve => setTimeout(resolve, 15));
    h.handle.close();
    await h.handle.done;
    expect(BindingTools.aborted).toHaveLength(1);
});
