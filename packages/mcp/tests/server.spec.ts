import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { MinLength, Positive, integer } from '@deepkit/type';

import { mcp } from '../src/decorator.js';
import { ERROR, MCP_PROTOCOL_VERSION, META } from '../src/protocol.js';
import { McpCallContext, McpRegistry } from '../src/registry.js';
import { McpFrame, McpServer, structuredContentOf } from '../src/server.js';

interface EchoInput {
    /** What to echo. */
    text: string & MinLength<1>;
    times?: integer & Positive;
}

interface Big {
    rows: number;
}

class FakeTools {
    static calls: unknown[] = [];

    /** Echoes the text, `times` times. */
    @(mcp.tool('echo').group('role:reader').readOnly())
    echo(input: EchoInput): { echoed: string } {
        FakeTools.calls.push(input);
        return { echoed: input.text.repeat(input.times ?? 1) };
    }

    @(mcp.tool().title('Fail loudly').outputSchema())
    fail(): Promise<{ never: true }> {
        throw new Error('the service refused: table_locked');
    }

    @(mcp.tool('slow').description('Counts with progress.'))
    async slow(input: { steps: integer }, context: McpCallContext): Promise<string> {
        for (let i = 1; i <= input.steps; i++) {
            context.progress(i, input.steps, `step ${i}`);
            await new Promise(resolve => setTimeout(resolve, 1));
        }
        return `done after ${input.steps}`;
    }

    @mcp.tool()
    noInput(): string[] {
        return ['a', 'b'];
    }

    @(mcp.tool('big').group('role:admin'))
    big(input: Big): string[] {
        return Array.from({ length: input.rows }, (_, i) => `row-${i}`);
    }

    @mcp.tool('meta')
    meta(input: Record<string, never>, context: McpCallContext): { traceparent: unknown; principal: unknown } {
        return { traceparent: context.meta[META.traceparent], principal: context.principal };
    }

    @(mcp.resource('mz://status').mimeType('application/json'))
    status(): { up: boolean } {
        return { up: true };
    }

    /** The last lines of one app's log. */
    @(mcp.resource('mz://logs/{app}').mimeType('text/plain').group('role:reader'))
    logs(vars: { app: string }): string {
        return `log of ${vars.app}`;
    }
}

const registry = new McpRegistry(() => new FakeTools()).addProvider(FakeTools);

const refusing = new Set<string>();
const server = new McpServer({
    registry,
    serverInfo: { name: 'fake', version: '0.0.1' },
    instructions: 'Use echo.',
    authorize: groups => {
        const refused = groups.find(group => refusing.has(group));
        if (refused) throw new Error(`needs ${refused}`);
    },
    maxTextChars: 200,
});

const meta = (extra: Record<string, unknown> = {}) => ({
    [META.protocolVersion]: MCP_PROTOCOL_VERSION,
    [META.clientCapabilities]: {},
    [META.clientInfo]: { name: 'test', version: '1' },
    ...extra,
});

const request = (method: string, params: Record<string, unknown> = {}, id: string | number = 1, metaExtra?: Record<string, unknown>) => ({
    jsonrpc: '2.0',
    id,
    method,
    params: { ...params, _meta: meta(metaExtra) },
});

async function frames(message: unknown, context = {}): Promise<McpFrame[]> {
    const out: McpFrame[] = [];
    for await (const frame of server.handle(message, context)) out.push(frame);
    return out;
}

async function result(message: unknown, context = {}): Promise<any> {
    const out = await frames(message, context);
    const last = out[out.length - 1];
    expect(last.kind).toBe('response');
    if (last.kind !== 'response') throw new Error('unreachable');
    expect(last.httpStatus).toBe(200);
    expect('result' in last.message).toBe(true);
    return 'result' in last.message ? last.message.result : undefined;
}

async function error(message: unknown): Promise<{ code: number; message: string; data?: unknown; httpStatus: number; id: unknown }> {
    const out = await frames(message);
    expect(out).toHaveLength(1);
    const only = out[0];
    if (only.kind !== 'response' || !('error' in only.message)) throw new Error(`expected an error frame, got ${JSON.stringify(only)}`);
    return { ...only.message.error, httpStatus: only.httpStatus, id: only.message.id };
}

test('server/discover answers the supported revision, the capabilities, the instructions and the server identity', async () => {
    const r = await result(request('server/discover'));
    expect(r.resultType).toBe('complete');
    expect(r.supportedVersions).toEqual([MCP_PROTOCOL_VERSION]);
    expect(r.capabilities).toEqual({ tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } });
    expect(r.instructions).toBe('Use echo.');
    expect(r._meta).toEqual({ [META.serverInfo]: { name: 'fake', version: '0.0.1' } });
});

test('ping is an empty complete result', async () => {
    const r = await result(request('ping'));
    expect(r.resultType).toBe('complete');
});

test('tools/list is deterministic, in declaration order, with schemas from reflection and the doc comment as description', async () => {
    const r = await result(request('tools/list'));
    expect(r.tools.map((t: any) => t.name)).toEqual(['echo', 'fail', 'slow', 'noInput', 'big', 'meta']);
    expect(JSON.stringify((await result(request('tools/list'))).tools)).toBe(JSON.stringify(r.tools));
    const echo = r.tools[0];
    expect(echo.description).toBe('Echoes the text, `times` times.');
    expect(echo.annotations).toEqual({ readOnlyHint: true });
    expect(echo.inputSchema).toEqual({
        type: 'object',
        properties: {
            text: { description: 'What to echo.', type: 'string', minLength: 1 },
            times: { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
        required: ['text'],
    });
    const fail = r.tools[1];
    expect(fail.title).toBe('Fail loudly');
    expect(fail.outputSchema).toEqual({ type: 'object', properties: { never: { const: true } }, additionalProperties: false, required: ['never'] });
    expect(r.tools[2].description).toBe('Counts with progress.');
    // The context parameter is not part of the input schema.
    expect(r.tools[2].inputSchema.properties).toEqual({ steps: { type: 'integer' } });
    expect(r.tools[3].inputSchema).toEqual({ type: 'object', additionalProperties: false });
});

test('tools/call returns the value as text and as structuredContent', async () => {
    const r = await result(request('tools/call', { name: 'echo', arguments: { text: 'ab', times: 2 } }));
    expect(r.isError).toBe(false);
    expect(r.structuredContent).toEqual({ echoed: 'abab' });
    expect(r.content).toEqual([{ type: 'text', text: JSON.stringify({ echoed: 'abab' }, null, 2) }]);
    expect(FakeTools.calls[FakeTools.calls.length - 1]).toEqual({ text: 'ab', times: 2 });
});

test('a validation failure is a TOOL error naming the path, not a protocol error', async () => {
    const r = await result(request('tools/call', { name: 'echo', arguments: { text: '', times: 'two' } }));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Invalid arguments');
    expect(r.content[0].text).toContain('text');
});

test('a thrown error is a TOOL error with its message', async () => {
    const r = await result(request('tools/call', { name: 'fail' }));
    expect(r.isError).toBe(true);
    expect(r.content).toEqual([{ type: 'text', text: 'the service refused: table_locked' }]);
});

test('an unknown tool is a protocol error (-32602)', async () => {
    const e = await error(request('tools/call', { name: 'nope' }));
    expect(e.code).toBe(ERROR.invalidParams);
    expect(e.message).toBe('Unknown tool: nope');
    expect(e.httpStatus).toBe(400);
    expect(e.id).toBe(1);
});

test('an unknown method is -32601 and HTTP 404', async () => {
    const e = await error(request('prompts/list'));
    expect(e.code).toBe(ERROR.methodNotFound);
    expect(e.httpStatus).toBe(404);
});

test('a legacy initialize is refused with the supported revision named', async () => {
    const e = await error({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'old', version: '1' } } });
    expect(e.code).toBe(ERROR.methodNotFound);
    expect(e.message).toContain(MCP_PROTOCOL_VERSION);
    expect(e.data).toEqual({ supported: [MCP_PROTOCOL_VERSION] });
    expect(e.id).toBe('init');
});

test('a request without the required _meta fields is -32602 (HTTP 400)', async () => {
    const e = await error({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(e.code).toBe(ERROR.invalidParams);
    expect(e.httpStatus).toBe(400);
    const noCaps = await error({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { [META.protocolVersion]: MCP_PROTOCOL_VERSION } } });
    expect(noCaps.message).toContain(META.clientCapabilities);
});

test('an unsupported protocol version is -32022 listing the supported ones', async () => {
    const e = await error({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { [META.protocolVersion]: '1900-01-01', [META.clientCapabilities]: {} } } });
    expect(e.code).toBe(ERROR.unsupportedProtocolVersion);
    expect(e.data).toEqual({ supported: [MCP_PROTOCOL_VERSION], requested: '1900-01-01' });
    expect(e.httpStatus).toBe(400);
});

test('a malformed envelope is -32600 with a null id; a client-sent response is refused', async () => {
    expect((await error('nope')).code).toBe(ERROR.invalidRequest);
    expect((await error({ jsonrpc: '2.0', id: null, method: 'ping' })).code).toBe(ERROR.invalidRequest);
    const response = await error({ jsonrpc: '2.0', id: 1, result: {} });
    expect(response.code).toBe(ERROR.invalidRequest);
    expect(response.message).toContain('responses');
    expect(response.id).toBe(1);
});

test('a notification is accepted and never answered; notifications/cancelled reaches the binding', async () => {
    expect(await frames({ jsonrpc: '2.0', method: 'notifications/whatever' })).toEqual([{ kind: 'accepted' }]);
    const cancelled: unknown[] = [];
    await frames({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } }, { onCancel: (id: unknown) => cancelled.push(id) });
    expect(cancelled).toEqual([7]);
});

test('progress notifications leave before the response, only with a progressToken, and only rising', async () => {
    const out = await frames(request('tools/call', { name: 'slow', arguments: { steps: 3 } }, 9, { [META.progressToken]: 'p1' }));
    expect(out.map(f => f.kind)).toEqual(['notification', 'notification', 'notification', 'response']);
    const first = out[0];
    if (first.kind !== 'notification') throw new Error('unreachable');
    expect(first.message).toEqual({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'p1', progress: 1, total: 3, message: 'step 1' } });
    const silent = await frames(request('tools/call', { name: 'slow', arguments: { steps: 2 } }));
    expect(silent.map(f => f.kind)).toEqual(['response']);
});

test('a tool with no input takes no arguments and answers an array as text, and wrapped as `{ items }` in structuredContent (the specification wants an object)', async () => {
    const r = await result(request('tools/call', { name: 'noInput' }));
    expect(r.content[0].text).toBe('[\n  "a",\n  "b"\n]');
    expect(r.structuredContent).toEqual({ items: ['a', 'b'] });
});

test('structuredContentOf: an object as is, an array wrapped, nothing for a primitive, null or a value past the budget', () => {
    expect(structuredContentOf({ a: 1 }, true)).toEqual({ a: 1 });
    expect(structuredContentOf([1], true)).toEqual({ items: [1] });
    expect(structuredContentOf('text', true)).toBeUndefined();
    expect(structuredContentOf(null, true)).toBeUndefined();
    expect(structuredContentOf(7, true)).toBeUndefined();
    expect(structuredContentOf({ a: 1 }, false)).toBeUndefined();
});

test('the authorize hook refuses as a TOOL error; without groups it is never asked', async () => {
    refusing.add('role:admin');
    try {
        const r = await result(request('tools/call', { name: 'big', arguments: { rows: 1 } }));
        expect(r.isError).toBe(true);
        expect(r.content[0].text).toBe('Refused: needs role:admin');
        const ok = await result(request('tools/call', { name: 'noInput' }));
        expect(ok.isError).toBe(false);
    } finally {
        refusing.delete('role:admin');
    }
});

test('a result past the text budget is cut, the cut named, and structuredContent withheld', async () => {
    const r = await result(request('tools/call', { name: 'big', arguments: { rows: 100 } }));
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain('[cut at 200 of');
    expect(r.structuredContent).toBeUndefined();
});

test('the call context carries the request _meta and the principal', async () => {
    const r = await result(request('tools/call', { name: 'meta', arguments: {} }, 1, { [META.traceparent]: '00-abc-def-01' }), { principal: { userId: 'u1' } });
    expect(r.structuredContent).toEqual({ traceparent: '00-abc-def-01', principal: { userId: 'u1' } });
});

test('resources: list, templates, read by uri and by template; a missing one is -32602', async () => {
    const list = await result(request('resources/list'));
    expect(list.resources).toEqual([{ uri: 'mz://status', name: 'status', mimeType: 'application/json' }]);
    const templates = await result(request('resources/templates/list'));
    expect(templates.resourceTemplates).toEqual([{ uriTemplate: 'mz://logs/{app}', name: 'logs', description: "The last lines of one app's log.", mimeType: 'text/plain' }]);
    const status = await result(request('resources/read', { uri: 'mz://status' }));
    expect(status.contents).toEqual([{ uri: 'mz://status', mimeType: 'application/json', text: JSON.stringify({ up: true }, null, 2) }]);
    const logs = await result(request('resources/read', { uri: 'mz://logs/backend' }));
    expect(logs.contents).toEqual([{ uri: 'mz://logs/backend', mimeType: 'text/plain', text: 'log of backend' }]);
    const missing = await error(request('resources/read', { uri: 'mz://nope' }));
    expect(missing.code).toBe(ERROR.invalidParams);
    expect(missing.data).toEqual({ uri: 'mz://nope' });
});

test("groupsFor answers a tool's or resource's groups before dispatch, from method + name", () => {
    expect(registry.groupsFor('tools/call', 'echo')).toEqual(['role:reader']);
    expect(registry.groupsFor('tools/call', 'noInput')).toEqual([]);
    expect(registry.groupsFor('tools/call', 'nope')).toBeUndefined();
    expect(registry.groupsFor('resources/read', 'mz://logs/web')).toEqual(['role:reader']);
    expect(registry.groupsFor('tools/list', undefined)).toEqual([]);
});

test('a second tool under the same name is refused at registration', () => {
    class Twin {
        @mcp.tool('echo')
        echo(input: { text: string }) {
            return input;
        }
    }
    expect(() => new McpRegistry().addProvider(FakeTools).addProvider(Twin)).toThrow('already registered');
});

test('a mirrored parameter lands on the input schema as x-mcp-header and on the entry as its header name', () => {
    class Mirrored {
        @(mcp.tool('call').header('controller', 'Controller').header('action', 'Action'))
        call(input: { controller: string; action: string; payload?: Record<string, unknown> }) {
            return input;
        }
    }
    const reg = new McpRegistry().addProvider(Mirrored);
    const entry = reg.toolNamed('call');
    if (!entry) throw new Error('unreachable');
    expect((entry.definition.inputSchema.properties as any).controller['x-mcp-header']).toBe('Controller');
    expect([...entry.headerParams.entries()]).toEqual([
        ['controller', 'mcp-param-controller'],
        ['action', 'mcp-param-action'],
    ]);
    class Bad {
        @(mcp.tool('bad').header('payload', 'Payload'))
        bad(input: { payload: Record<string, unknown> }) {
            return input;
        }
    }
    expect(() => new McpRegistry().addProvider(Bad)).toThrow('not a string, integer or boolean');
});
