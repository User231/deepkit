import { type Server, createServer } from 'node:http';
import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { decodeHeaderValue, handleMcpHttp, requiredGroups } from '../src/http.js';
import { ERROR, MCP_PROTOCOL_VERSION } from '../src/protocol.js';
import { BindingTools, fixtureServer, request } from './fixture.js';

const server = fixtureServer();

function listen(options = {}): Promise<{ http: Server; url: string }> {
    return new Promise(resolve => {
        const http = createServer((req, res) => {
            void handleMcpHttp(server, req, res, { allowedOrigins: ['http://localhost:32073'], principal: r => r.headers['x-user'] ?? null, ...options });
        });
        http.listen(0, '127.0.0.1', () => {
            const address = http.address();
            if (address === null || typeof address === 'string') throw new Error('no port');
            resolve({ http, url: `http://127.0.0.1:${address.port}/mcp` });
        });
    });
}

const headersFor = (body: any, extra: Record<string, string> = {}) => {
    const h: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': MCP_PROTOCOL_VERSION,
        'mcp-method': body.method,
        ...extra,
    };
    if (body.params?.name) h['mcp-name'] = body.params.name;
    if (body.params?.uri) h['mcp-name'] = body.params.uri;
    return h;
};

async function post(url: string, body: unknown, headers: Record<string, string>): Promise<Response> {
    return fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

test('a request is answered as one JSON object with the core status', async () => {
    const { http, url } = await listen();
    try {
        const body = request('tools/call', { name: 'echo', arguments: { text: 'hi' } });
        const response = await post(url, body, headersFor(body));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/json');
        const json: any = await response.json();
        expect(json.id).toBe(1);
        expect(json.result.structuredContent).toEqual({ echoed: 'hi' });

        const unknown = request('nope/method');
        const notFound = await post(url, unknown, headersFor(unknown));
        expect(notFound.status).toBe(404);
        expect(((await notFound.json()) as any).error.code).toBe(ERROR.methodNotFound);
    } finally {
        http.close();
    }
});

test('a notification is 202 with no body', async () => {
    const { http, url } = await listen();
    try {
        const response = await post(url, { jsonrpc: '2.0', method: 'notifications/whatever' }, { 'content-type': 'application/json' });
        expect(response.status).toBe(202);
        expect(await response.text()).toBe('');
    } finally {
        http.close();
    }
});

test('GET and DELETE are 405 with Allow: POST; a foreign Origin is 403; a body that is not JSON is -32700', async () => {
    const { http, url } = await listen();
    try {
        const get = await fetch(url);
        expect(get.status).toBe(405);
        expect(get.headers.get('allow')).toBe('POST');
        const del = await fetch(url, { method: 'DELETE' });
        expect(del.status).toBe(405);

        const body = request('ping');
        const foreign = await post(url, body, headersFor(body, { origin: 'http://evil.example' }));
        expect(foreign.status).toBe(403);
        const ours = await post(url, body, headersFor(body, { origin: 'http://localhost:32073' }));
        expect(ours.status).toBe(200);

        const broken = await fetch(url, { method: 'POST', headers: headersFor(body), body: '{not json' });
        expect(broken.status).toBe(400);
        expect(((await broken.json()) as any).error.code).toBe(ERROR.parse);
    } finally {
        http.close();
    }
});

test('the mirrored headers are validated against the body: missing or disagreeing is 400 + -32020', async () => {
    const { http, url } = await listen();
    try {
        const body = request('tools/call', { name: 'echo', arguments: { text: 'x' } }, 7);
        const cases: [Record<string, string>, string][] = [
            [{ ...headersFor(body), 'mcp-protocol-version': '' }, 'MCP-Protocol-Version'],
            [{ ...headersFor(body), 'mcp-protocol-version': '2025-11-25' }, "does not match body value '2026-07-28'"],
            [{ ...headersFor(body), 'mcp-method': 'tools/list' }, 'Mcp-Method header value'],
            [{ ...headersFor(body), 'mcp-name': 'other' }, 'Mcp-Name header value'],
        ];
        for (const [headers, fragment] of cases) {
            if (headers['mcp-protocol-version'] === '') delete headers['mcp-protocol-version'];
            const response = await post(url, body, headers);
            expect(response.status).toBe(400);
            const json: any = await response.json();
            expect(json.error.code).toBe(ERROR.headerMismatch);
            expect(json.error.message).toContain(fragment);
            expect(json.id).toBe(7);
        }
        const noName = { ...headersFor(body) };
        delete noName['mcp-name'];
        expect((await post(url, body, noName)).status).toBe(400);
    } finally {
        http.close();
    }
});

test('a Base64-sentinel Mcp-Name decodes to the body value; a legacy initialize needs no headers and is refused by the core', async () => {
    const { http, url } = await listen();
    try {
        const body = request('resources/read', { uri: 'mz://status' });
        const encoded = `=?base64?${Buffer.from('mz://status').toString('base64')}?=`;
        expect(decodeHeaderValue(encoded)).toBe('mz://status');
        const response = await post(url, body, headersFor(body, { 'mcp-name': encoded }));
        expect(response.status).toBe(200);
        expect(((await response.json()) as any).result.contents[0].text).toContain('"up": true');

        const legacy = await post(url, { jsonrpc: '2.0', id: 'i', method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'old', version: '1' } } }, { 'content-type': 'application/json' });
        expect(legacy.status).toBe(404);
        const json: any = await legacy.json();
        expect(json.error.code).toBe(ERROR.methodNotFound);
        expect(json.error.data.supported).toEqual([MCP_PROTOCOL_VERSION]);
    } finally {
        http.close();
    }
});

test('a tool that reports progress is answered as an SSE stream: notifications, then the response, then the end', async () => {
    const { http, url } = await listen();
    try {
        const body = request('tools/call', { name: 'slow', arguments: { steps: 2, stepMs: 1 } }, 3, { progressToken: 'tok' });
        const response = await post(url, body, headersFor(body));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/event-stream');
        expect(response.headers.get('x-accel-buffering')).toBe('no');
        const text = await response.text();
        const events = text
            .split('\n\n')
            .filter(e => e.trim() !== '')
            .map(e => JSON.parse(e.replace(/^event: message\ndata: /, '')));
        expect(events.map(e => e.method ?? 'response')).toEqual(['notifications/progress', 'notifications/progress', 'response']);
        expect(events[0].params).toEqual({ progressToken: 'tok', progress: 1, total: 2, message: 'step 1' });
        expect(events[2].result.content[0].text).toBe('done after 2');
    } finally {
        http.close();
    }
});

test('closing the response stream cancels the request: the tool sees its signal aborted', async () => {
    const { http, url } = await listen();
    try {
        BindingTools.aborted = [];
        const body = request('tools/call', { name: 'slow', arguments: { steps: 50, stepMs: 20 } }, 4, { progressToken: 't' });
        const controller = new AbortController();
        const response = await post(url, body, headersFor(body)).then(r => r); // headers arrive with the first frame
        void controller; // fetch's own abort would race the first byte; read one chunk then destroy the body instead
        const reader = response.body!.getReader();
        await reader.read();
        await reader.cancel();
        await new Promise(resolve => setTimeout(resolve, 120));
        expect(BindingTools.aborted.length).toBe(1);
    } finally {
        http.close();
    }
});

test('the principal the application resolves reaches the tool; requiredGroups reads the headers alone', async () => {
    const { http, url } = await listen();
    try {
        const body = request('tools/call', { name: 'who', arguments: {} });
        const response = await post(url, body, headersFor(body, { 'x-user': 'ada' }));
        expect(((await response.json()) as any).result.structuredContent).toEqual({ principal: 'ada' });
        expect(requiredGroups(server.registry, { 'mcp-method': 'tools/call', 'mcp-name': 'echo' })).toEqual([]);
        expect(requiredGroups(server.registry, { 'mcp-method': 'tools/call', 'mcp-name': 'nope' })).toBeUndefined();
        expect(requiredGroups(server.registry, {})).toBeUndefined();
    } finally {
        http.close();
    }
});
