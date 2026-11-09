import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

import { DeepkitError } from '@deepkit/core';

import { ERROR, JsonRpcId, META, McpProtocolError } from './protocol.js';
import { McpRegistry } from './registry.js';
import { McpFrame, McpRequestContext, McpServer } from './server.js';

/**
 * The Streamable HTTP binding (revision 2026-07-28): ONE endpoint accepting POST,
 * every JSON-RPC message its own request, the reply one JSON object or an SSE
 * stream scoped to that request. Written against Node's `IncomingMessage` /
 * `ServerResponse` so that `@deepkit/http`'s `HttpRequest` / `HttpResponse` (which
 * extend them) and a bare `node:http` server both serve it; an application mounts
 * {@link handleMcpHttp} on a functional route (`HttpRouterRegistry.post(path, …)`),
 * which is how the path stays the application's choice.
 *
 * The rules held here are the transport's: the `Origin` allowlist (403), POST only
 * (405 with `Allow`), the mirrored headers `MCP-Protocol-Version`, `Mcp-Method` and
 * `Mcp-Name` validated against the body (400 + `-32020 HeaderMismatch`, the Base64
 * sentinel decoded first), a notification answered `202` with no body, a request
 * answered `application/json` or `text/event-stream` with `X-Accel-Buffering: no`,
 * and a closed response stream treated as the request's cancellation. What the
 * message MEANS is the core's (`server.ts`).
 */
export interface McpHttpOptions {
    /**
     * Origins allowed to call; a request carrying an `Origin` outside it is 403.
     * A request WITHOUT an `Origin` (a non-browser client) is never refused here —
     * authentication is the application's guard, not this check, which exists
     * against DNS rebinding of a browser. Unset = any origin.
     */
    allowedOrigins?: readonly string[] | ((origin: string) => boolean);
    /** Whatever the application resolved for the caller; handed to tools as `principal`. */
    principal?: (request: IncomingMessage) => unknown;
    /** The body cap, bytes. Default 4 MiB; over it is 413. */
    maxBodyBytes?: number;
    /** The body, when the host framework has already read it off the stream (`HttpRequest.readBodyText()`). */
    bodyText?: string;
}

/** The mirrored headers, as the body's values they must equal (Base64 sentinels decoded). */
export interface McpHeaders {
    protocolVersion: string | undefined;
    method: string | undefined;
    name: string | undefined;
}

const SENTINEL = /^=\?base64\?(.*)\?=$/;

/** `=?base64?SGk=?=` → `Hi`; any other value is itself. */
export function decodeHeaderValue(value: string): string {
    const match = SENTINEL.exec(value);
    return match ? Buffer.from(match[1], 'base64').toString('utf8') : value;
}

export function readMcpHeaders(headers: IncomingHttpHeaders): McpHeaders {
    const one = (name: string): string | undefined => {
        const value = headers[name];
        return Array.isArray(value) ? value[0] : value;
    };
    const name = one('mcp-name');
    return {
        protocolVersion: one('mcp-protocol-version'),
        method: one('mcp-method'),
        name: name === undefined ? undefined : decodeHeaderValue(name),
    };
}

/**
 * The authorization groups the request needs, from its HEADERS alone — what a
 * guard asks before the body is parsed. Undefined means the headers name a tool
 * or resource the registry does not have (the dispatch then answers -32602), or
 * no `Mcp-Method` at all (the dispatch answers -32020).
 */
export function requiredGroups(registry: McpRegistry, headers: IncomingHttpHeaders): readonly string[] | undefined {
    const read = readMcpHeaders(headers);
    if (read.method === undefined) return undefined;
    return registry.groupsFor(read.method, read.name);
}

/** The methods whose `Mcp-Name` header mirrors `params.name` or `params.uri`. */
const NAMED_METHODS: Record<string, 'name' | 'uri'> = {
    'tools/call': 'name',
    'resources/read': 'uri',
    'prompts/get': 'name',
};

export async function handleMcpHttp(
    server: McpServer,
    request: IncomingMessage,
    response: ServerResponse,
    options: McpHttpOptions = {},
): Promise<void> {
    const origin = request.headers.origin;
    if (typeof origin === 'string' && !originAllowed(origin, options.allowedOrigins)) {
        return sendJson(response, 403, errorBody(null, ERROR.invalidRequest, `Origin not allowed: ${origin}`));
    }
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return sendJson(
            response,
            405,
            errorBody(
                null,
                ERROR.invalidRequest,
                `${request.method} is not served: the MCP endpoint accepts POST only.`,
            ),
        );
    }

    let body: unknown;
    try {
        const text = options.bodyText ?? (await readBody(request, options.maxBodyBytes ?? 4 * 1024 * 1024));
        body = JSON.parse(text);
    } catch (error) {
        if (error instanceof BodyTooLarge)
            return sendJson(response, 413, errorBody(null, ERROR.invalidRequest, error.message));
        return sendJson(
            response,
            400,
            errorBody(null, ERROR.parse, `Parse error: ${error instanceof Error ? error.message : String(error)}`),
        );
    }

    const id = readableId(body);
    const isNotification = isRecord(body) && !('id' in body) && typeof body.method === 'string';
    if (!isNotification) {
        const mismatch = headerMismatch(request.headers, body, server.registry);
        if (mismatch) return sendJson(response, 400, errorBody(id, ERROR.headerMismatch, mismatch));
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    response.on('close', abort);
    const context: McpRequestContext = { principal: options.principal?.(request), signal: controller.signal };

    let streaming = false;
    try {
        for await (const frame of server.handle(body, context)) {
            if (response.destroyed || response.writableEnded) return;
            if (frame.kind === 'accepted') {
                response.statusCode = 202;
                response.end();
                return;
            }
            if (!streaming && frame.kind === 'response') {
                return sendJson(response, frame.httpStatus, frame.message);
            }
            if (!streaming) {
                streaming = true;
                response.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                    'X-Accel-Buffering': 'no',
                });
            }
            response.write(sseEvent(frame));
            if (frame.kind === 'response') {
                response.end();
                return;
            }
        }
    } finally {
        response.off('close', abort);
    }
}

// ── helpers ──────────────────────────────────────────────────

function originAllowed(origin: string, allowed: McpHttpOptions['allowedOrigins']): boolean {
    if (allowed === undefined) return true;
    if (typeof allowed === 'function') return allowed(origin);
    return allowed.includes(origin);
}

/**
 * Why the mirrored headers disagree with the body, or undefined when they agree.
 * A legacy `initialize` carries no headers by design and is left to the core,
 * which refuses it by name.
 */
function headerMismatch(headers: IncomingHttpHeaders, body: unknown, registry: McpRegistry): string | undefined {
    if (!isRecord(body) || typeof body.method !== 'string') return undefined; // the core answers -32600
    if (body.method === 'initialize') return undefined;
    const read = readMcpHeaders(headers);
    const params = isRecord(body.params) ? body.params : {};
    const meta = isRecord(params._meta) ? params._meta : {};
    const version = meta[META.protocolVersion];
    if (read.protocolVersion === undefined)
        return 'Header mismatch: MCP-Protocol-Version is required on every request.';
    if (typeof version === 'string' && read.protocolVersion !== version) {
        return `Header mismatch: MCP-Protocol-Version header value '${read.protocolVersion}' does not match body value '${version}'.`;
    }
    if (read.method === undefined) return 'Header mismatch: Mcp-Method is required on every request.';
    if (read.method !== body.method)
        return `Header mismatch: Mcp-Method header value '${read.method}' does not match body value '${body.method}'.`;
    const named = NAMED_METHODS[body.method];
    if (named !== undefined) {
        const expected = params[named];
        if (read.name === undefined) return `Header mismatch: Mcp-Name is required on ${body.method}.`;
        if (typeof expected === 'string' && read.name !== expected) {
            return `Header mismatch: Mcp-Name header value '${read.name}' does not match body value '${expected}'.`;
        }
    }
    if (body.method === 'tools/call' && typeof params.name === 'string')
        return paramHeaderMismatch(headers, params, registry.toolNamed(params.name));
    return undefined;
}

/**
 * The `Mcp-Param-{Name}` headers a tool declares (`x-mcp-header`): present and
 * equal whenever the argument is, absent whenever it is not. Integers compare
 * numerically, booleans as `true` / `false`, strings after sentinel decoding.
 */
function paramHeaderMismatch(
    headers: IncomingHttpHeaders,
    params: Record<string, unknown>,
    tool: ReturnType<McpRegistry['toolNamed']>,
): string | undefined {
    if (!tool || tool.headerParams.size === 0) return undefined;
    const args = isRecord(params.arguments) ? params.arguments : {};
    for (const [param, header] of tool.headerParams) {
        const raw = headers[header];
        const sent = Array.isArray(raw) ? raw[0] : raw;
        const value = args[param];
        if (value === undefined || value === null) {
            if (sent !== undefined) return `Header mismatch: ${header} is present but the argument '${param}' is not.`;
            continue;
        }
        if (sent === undefined)
            return `Header mismatch: ${header} is required while the argument '${param}' is present.`;
        const decoded = decodeHeaderValue(sent);
        const agrees = typeof value === 'number' ? Number(decoded) === value : decoded === String(value);
        if (!agrees)
            return `Header mismatch: ${header} header value '${decoded}' does not match body value '${String(value)}'.`;
    }
    return undefined;
}

class BodyTooLarge extends DeepkitError {
    constructor(message: string) {
        super('DK-MCP200', message);
    }
}

function readBody(request: IncomingMessage, max: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        request.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > max) {
                reject(new BodyTooLarge(`Body over ${max} bytes.`));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        request.on('error', reject);
    });
}

function readableId(body: unknown): JsonRpcId | null {
    if (!isRecord(body)) return null;
    return typeof body.id === 'string' || typeof body.id === 'number' ? body.id : null;
}

function errorBody(id: JsonRpcId | null, code: number, message: string): unknown {
    return { jsonrpc: '2.0', id, error: new McpProtocolError(code, message).toJsonRpc() };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
    if (response.destroyed || response.writableEnded) return;
    const text = JSON.stringify(body);
    response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
    response.end(text);
}

function sseEvent(frame: McpFrame): string {
    const message = frame.kind === 'accepted' ? {} : frame.message;
    return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
