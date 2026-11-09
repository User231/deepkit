/**
 * The Model Context Protocol as this package speaks it — revision 2026-07-28, the
 * STATELESS protocol: every request carries its protocol version and the client's
 * capabilities in `_meta`, the server answers each request on its own, and there is
 * no `initialize` handshake and no session. The shapes here are the specification's
 * (https://modelcontextprotocol.io/specification/2026-07-28); what the server does
 * with them is `server.ts`.
 */

/** The one revision served. A legacy `initialize` is answered with an error naming it. */
export const MCP_PROTOCOL_VERSION = '2026-07-28';
export const MCP_SUPPORTED_VERSIONS: readonly string[] = [MCP_PROTOCOL_VERSION];

/** The reserved `_meta` keys (basic/index.md § _meta). */
export const META = {
    protocolVersion: 'io.modelcontextprotocol/protocolVersion',
    clientInfo: 'io.modelcontextprotocol/clientInfo',
    clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
    serverInfo: 'io.modelcontextprotocol/serverInfo',
    logLevel: 'io.modelcontextprotocol/logLevel',
    progressToken: 'progressToken',
    traceparent: 'traceparent',
} as const;

/** JSON-RPC 2.0 codes MCP uses, plus the codes the specification reserves for itself. */
export const ERROR = {
    parse: -32700,
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
    internal: -32603,
    /** The mirrored HTTP headers disagree with the body, or one is missing (Streamable HTTP). */
    headerMismatch: -32020,
    missingClientCapability: -32021,
    unsupportedProtocolVersion: -32022,
} as const;

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: JsonRpcId;
    method: string;
    params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}

export interface JsonRpcError {
    code: number;
    message: string;
    data?: unknown;
}

export type JsonRpcResponse =
    | { jsonrpc: '2.0'; id: JsonRpcId; result: Record<string, unknown> }
    | { jsonrpc: '2.0'; id: JsonRpcId | null; error: JsonRpcError };

export interface Implementation {
    name: string;
    version: string;
    title?: string;
    description?: string;
}

/** What `tools/list` says about one tool. */
export interface ToolDefinition {
    name: string;
    title?: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    annotations?: ToolAnnotations;
}

/** Hints about a tool's behaviour — untrusted by the client unless the server is. */
export interface ToolAnnotations {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
}

export interface ResourceDefinition {
    uri: string;
    name: string;
    title?: string;
    description?: string;
    mimeType?: string;
}

export interface ResourceTemplateDefinition {
    uriTemplate: string;
    name: string;
    title?: string;
    description?: string;
    mimeType?: string;
}

export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'resource_link'; uri: string; name: string; description?: string; mimeType?: string }
    | { type: 'resource'; resource: ResourceContents };

export type ResourceContents =
    | { uri: string; mimeType?: string; text: string }
    | { uri: string; mimeType?: string; blob: string };

export interface ServerCapabilities {
    tools?: { listChanged?: boolean };
    resources?: { listChanged?: boolean; subscribe?: boolean };
    prompts?: { listChanged?: boolean };
}

/**
 * A PROTOCOL error — the request itself is wrong (an unknown method, a malformed
 * call, an unsupported version). Answered as a JSON-RPC error, with the HTTP status
 * the Streamable HTTP binding sends for it. A tool's OWN failure is never one of
 * these: it is a tool result with `isError: true`, which the model can act on.
 */
export class McpProtocolError extends Error {
    constructor(
        public readonly code: number,
        message: string,
        public readonly httpStatus: number = 400,
        public readonly data?: unknown,
    ) {
        super(message);
        this.name = 'McpProtocolError';
    }

    toJsonRpc(): JsonRpcError {
        return this.data === undefined
            ? { code: this.code, message: this.message }
            : { code: this.code, message: this.message, data: this.data };
    }
}

export const unsupportedVersion = (requested: unknown): McpProtocolError =>
    new McpProtocolError(ERROR.unsupportedProtocolVersion, 'Unsupported protocol version', 400, {
        supported: [...MCP_SUPPORTED_VERSIONS],
        requested,
    });

export const methodNotFound = (method: string, hint?: string): McpProtocolError =>
    new McpProtocolError(ERROR.methodNotFound, `Method not found: ${method}${hint ? ` — ${hint}` : ''}`, 404);

export const invalidParams = (message: string, data?: unknown): McpProtocolError =>
    new McpProtocolError(ERROR.invalidParams, message, 400, data);

export const invalidRequest = (message: string): McpProtocolError =>
    new McpProtocolError(ERROR.invalidRequest, message, 400);
