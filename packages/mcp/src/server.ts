import { ValidationError, cast } from '@deepkit/type';

import {
    ContentBlock,
    ERROR,
    Implementation,
    JsonRpcId,
    JsonRpcNotification,
    JsonRpcResponse,
    MCP_PROTOCOL_VERSION,
    MCP_SUPPORTED_VERSIONS,
    META,
    McpProtocolError,
    ResourceContents,
    ServerCapabilities,
    invalidParams,
    invalidRequest,
    methodNotFound,
    unsupportedVersion,
} from './protocol.js';
import { McpCallContext, McpRegistry, RegisteredResource, RegisteredTool } from './registry.js';

/** What a binding passes in with each message: who is calling, how to cancel, where the request's `traceparent` goes. */
export interface McpRequestContext {
    /** The caller the binding resolved (a principal); handed to tools untouched. */
    principal?: unknown;
    /** Aborted by the binding when the client cancels (stream closed, process cancelled). */
    signal?: AbortSignal;
    /** stdio: a `notifications/cancelled` names a request id; the binding aborts that request's signal. */
    onCancel?: (requestId: JsonRpcId) => void;
}

/** One unit of the server's answer — a binding frames them (one SSE event or stdout line each). */
export type McpFrame =
    /** A notification was taken; nothing more follows (HTTP: 202, no body). */
    | { kind: 'accepted' }
    /** A request-related notification (`notifications/progress`), before the response. */
    | { kind: 'notification'; message: JsonRpcNotification }
    /** The final answer. `httpStatus` is what Streamable HTTP sends: 200, or the protocol error's status. */
    | { kind: 'response'; message: JsonRpcResponse; httpStatus: number };

export interface McpServerOptions {
    registry: McpRegistry;
    serverInfo: Implementation;
    /** Natural-language guidance for the model, answered by `server/discover`. */
    instructions?: string;
    /**
     * Refuse a call whose tool (or resource) declares groups the caller does not
     * hold. Throw to refuse: the message becomes a TOOL error the model reads. A
     * binding that enforces groups before dispatch (the HTTP guard) may leave this
     * unset; stdio and tests set it.
     */
    authorize?: (groups: readonly string[], context: McpRequestContext) => void | Promise<void>;
    /** The text block's budget; a result past it is cut and the cut is named. Default 64 KiB. */
    maxTextChars?: number;
}

const CAPABILITIES: ServerCapabilities = {
    tools: { listChanged: false },
    resources: { listChanged: false, subscribe: false },
};

/**
 * The transport-neutral core: one JSON-RPC message in, frames out. `handle` is an
 * async generator so a tool's progress notifications can leave before its result,
 * and so a binding can decide from the FIRST frame whether the reply is one JSON
 * object (the response came first) or a stream (a notification did).
 *
 * The rules it holds (protocol.ts names the revision): a request without the
 * required `_meta` is `-32602`; an unsupported version `-32022` with the supported
 * list; an unknown method `-32601` (HTTP 404); a legacy `initialize` the same, its
 * message naming the revision; a notification is accepted and never answered; a
 * tool's own failure — validation, refusal, a thrown error — is a result with
 * `isError: true`, never a protocol error.
 */
export class McpServer {
    private readonly maxTextChars: number;

    constructor(private readonly options: McpServerOptions) {
        this.maxTextChars = options.maxTextChars ?? 64 * 1024;
    }

    get registry(): McpRegistry {
        return this.options.registry;
    }

    async *handle(message: unknown, context: McpRequestContext = {}): AsyncGenerator<McpFrame> {
        // The id is echoed on every error that can read one — a malformed request
        // still names what it answers; only an unreadable id is null.
        let id: JsonRpcId | null =
            isRecord(message) && (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : null;
        try {
            const envelope = this.envelope(message);
            if (envelope.kind === 'notification') {
                if (envelope.method === 'notifications/cancelled') {
                    const requestId = envelope.params?.requestId;
                    if ((typeof requestId === 'string' || typeof requestId === 'number') && context.onCancel)
                        context.onCancel(requestId);
                }
                yield { kind: 'accepted' };
                return;
            }
            id = envelope.id;
            if (envelope.method === 'initialize') {
                throw new McpProtocolError(
                    ERROR.methodNotFound,
                    `Method not found: initialize — this server speaks the stateless revision ${MCP_PROTOCOL_VERSION} (no handshake): send server/discover, with the protocol version in _meta.`,
                    404,
                    { supported: [...MCP_SUPPORTED_VERSIONS] },
                );
            }
            const meta = this.requireMeta(envelope.params);
            const result = yield* this.dispatch(envelope.method, envelope.params, meta, context);
            yield { kind: 'response', message: { jsonrpc: '2.0', id, result: this.complete(result) }, httpStatus: 200 };
        } catch (error) {
            const protocolError =
                error instanceof McpProtocolError
                    ? error
                    : new McpProtocolError(ERROR.internal, errorMessage(error), 500);
            yield {
                kind: 'response',
                message: { jsonrpc: '2.0', id, error: protocolError.toJsonRpc() },
                httpStatus: protocolError.httpStatus,
            };
        }
    }

    // ── Envelope ───────────────────────────────────────────────

    private envelope(
        message: unknown,
    ):
        | { kind: 'request'; id: JsonRpcId; method: string; params: Record<string, unknown> | undefined }
        | { kind: 'notification'; method: string; params: Record<string, unknown> | undefined } {
        if (!isRecord(message)) throw invalidRequest('A JSON-RPC message is an object.');
        if (message.jsonrpc !== '2.0') throw invalidRequest('jsonrpc must be "2.0".');
        if (typeof message.method !== 'string') {
            if ('result' in message || 'error' in message)
                throw invalidRequest('Clients do not send JSON-RPC responses to a server.');
            throw invalidRequest('A JSON-RPC message names a method.');
        }
        const params = message.params === undefined ? undefined : isRecord(message.params) ? message.params : undefined;
        if (message.params !== undefined && params === undefined) throw invalidRequest('params must be an object.');
        if (!('id' in message)) return { kind: 'notification', method: message.method, params };
        const id = message.id;
        if (typeof id !== 'string' && typeof id !== 'number')
            throw invalidRequest('A request id is a string or an integer, never null.');
        return { kind: 'request', id, method: message.method, params };
    }

    private requireMeta(params: Record<string, unknown> | undefined): Record<string, unknown> {
        const meta = params?._meta;
        if (!isRecord(meta))
            throw invalidParams(`params._meta is required: ${META.protocolVersion} and ${META.clientCapabilities}.`);
        const version = meta[META.protocolVersion];
        if (typeof version !== 'string')
            throw invalidParams(`_meta["${META.protocolVersion}"] is required on every request.`);
        if (!isRecord(meta[META.clientCapabilities]))
            throw invalidParams(`_meta["${META.clientCapabilities}"] is required on every request.`);
        if (!MCP_SUPPORTED_VERSIONS.includes(version)) throw unsupportedVersion(version);
        return meta;
    }

    private complete(result: Record<string, unknown>): Record<string, unknown> {
        return { resultType: 'complete', ...result, _meta: { [META.serverInfo]: this.options.serverInfo } };
    }

    // ── Dispatch ───────────────────────────────────────────────

    private async *dispatch(
        method: string,
        params: Record<string, unknown> | undefined,
        meta: Record<string, unknown>,
        context: McpRequestContext,
    ): AsyncGenerator<McpFrame, Record<string, unknown>> {
        const registry = this.options.registry;
        switch (method) {
            case 'server/discover':
                return {
                    supportedVersions: [...MCP_SUPPORTED_VERSIONS],
                    capabilities: CAPABILITIES,
                    ...(this.options.instructions ? { instructions: this.options.instructions } : {}),
                };
            case 'ping':
                return {};
            case 'tools/list':
                this.refuseForeignCursor(params);
                return { tools: registry.tools().map(entry => entry.definition) };
            case 'tools/call':
                return yield* this.callTool(params, meta, context);
            case 'resources/list':
                this.refuseForeignCursor(params);
                return { resources: registry.resources().map(entry => entry.definition) };
            case 'resources/templates/list':
                this.refuseForeignCursor(params);
                return { resourceTemplates: registry.templates().map(entry => entry.definition) };
            case 'resources/read':
                return await this.readResource(params, context);
            default:
                throw methodNotFound(method);
        }
    }

    /** Lists are one page; a cursor this server never issued is a malformed request. */
    private refuseForeignCursor(params: Record<string, unknown> | undefined): void {
        if (params?.cursor !== undefined) throw invalidParams('Unknown cursor: this server lists in one page.');
    }

    // ── tools/call ─────────────────────────────────────────────

    private async *callTool(
        params: Record<string, unknown> | undefined,
        meta: Record<string, unknown>,
        context: McpRequestContext,
    ): AsyncGenerator<McpFrame, Record<string, unknown>> {
        const name = params?.name;
        if (typeof name !== 'string') throw invalidParams('tools/call needs params.name.');
        const entry = this.options.registry.toolNamed(name);
        if (!entry) throw invalidParams(`Unknown tool: ${name}`);
        if (params?.arguments !== undefined && !isRecord(params.arguments))
            throw invalidParams('tools/call arguments must be an object.');

        const refusal = await this.authorize(entry.tool.groups, context);
        if (refusal !== undefined) return this.toolError(refusal);

        let input: unknown = undefined;
        if (entry.inputType !== undefined) {
            try {
                input = cast(params?.arguments ?? {}, undefined, undefined, undefined, entry.inputType);
            } catch (error) {
                return this.toolError(
                    error instanceof ValidationError
                        ? `Invalid arguments: ${describeValidation(error)}`
                        : `Invalid arguments: ${errorMessage(error)}`,
                );
            }
        }

        const progressToken = meta[META.progressToken];
        const emitsProgress = typeof progressToken === 'string' || typeof progressToken === 'number';
        const pending = new FrameQueue();
        let last = -Infinity;
        const callContext = new McpCallContext(
            context.signal ?? new AbortController().signal,
            (progress, total, progressMessage) => {
                if (!emitsProgress || progress <= last) return; // the spec: progress must rise; a token-less request gets none
                last = progress;
                const progressParams: Record<string, unknown> = { progressToken, progress };
                if (total !== undefined) progressParams.total = total;
                if (progressMessage !== undefined) progressParams.message = progressMessage;
                pending.push({
                    kind: 'notification',
                    message: { jsonrpc: '2.0', method: 'notifications/progress', params: progressParams },
                });
            },
            meta,
            context.principal,
        );

        const run = this.invoke(entry, input, callContext).then(
            value => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
        );
        pending.closeWhen(run);
        for await (const frame of pending) yield frame;
        const outcome = await run;
        if (!outcome.ok) return this.toolError(errorMessage(outcome.error));
        return this.toolResult(outcome.value);
    }

    private async invoke(entry: RegisteredTool, input: unknown, callContext: McpCallContext): Promise<unknown> {
        const instance = this.options.registry.resolve(entry.tool.classType) as Record<
            string,
            (...args: unknown[]) => unknown
        >;
        const args: unknown[] = [];
        if (entry.inputType !== undefined) args.push(input);
        if (entry.contextIndex !== undefined) args.splice(entry.contextIndex, 0, callContext);
        return await instance[entry.tool.method](...args);
    }

    private async authorize(groups: readonly string[], context: McpRequestContext): Promise<string | undefined> {
        if (groups.length === 0 || !this.options.authorize) return undefined;
        try {
            await this.options.authorize(groups, context);
            return undefined;
        } catch (error) {
            return `Refused: ${errorMessage(error)}`;
        }
    }

    /** A tool result: the JSON as text (cut at the budget), and the value itself as `structuredContent` when it is an object. */
    private toolResult(value: unknown): Record<string, unknown> {
        if (value === undefined) return { content: [], isError: false };
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        const content: ContentBlock[] = [{ type: 'text', text: this.cut(text) }];
        const structured = value !== null && typeof value === 'object' && text.length <= this.maxTextChars;
        return structured ? { content, structuredContent: value, isError: false } : { content, isError: false };
    }

    private toolError(message: string): Record<string, unknown> {
        return { content: [{ type: 'text', text: message }], isError: true };
    }

    private cut(text: string): string {
        if (text.length <= this.maxTextChars) return text;
        return `${text.slice(0, this.maxTextChars)}\n… [cut at ${this.maxTextChars} of ${text.length} characters — ask for less]`;
    }

    // ── resources/read ─────────────────────────────────────────

    private async readResource(
        params: Record<string, unknown> | undefined,
        context: McpRequestContext,
    ): Promise<Record<string, unknown>> {
        const uri = params?.uri;
        if (typeof uri !== 'string') throw invalidParams('resources/read needs params.uri.');
        const found = this.options.registry.resourceFor(uri);
        if (!found) throw invalidParams('Resource not found', { uri });
        const { entry, variables } = found;
        const refusal = await this.authorize(entry.resource.groups, context);
        if (refusal !== undefined) throw new McpProtocolError(ERROR.invalidParams, refusal, 403, { uri });
        const instance = this.options.registry.resolve(entry.resource.classType) as Record<
            string,
            (...args: unknown[]) => unknown
        >;
        const args: unknown[] = [];
        if (entry.variablesType !== undefined) {
            try {
                args.push(cast(variables, undefined, undefined, undefined, entry.variablesType));
            } catch (error) {
                throw invalidParams(
                    `Resource variables invalid: ${error instanceof ValidationError ? describeValidation(error) : errorMessage(error)}`,
                    { uri },
                );
            }
        }
        const value = await instance[entry.resource.method](...args);
        return { contents: [resourceContents(uri, entry, value)] };
    }
}

// ── helpers ──────────────────────────────────────────────────

function resourceContents(uri: string, entry: RegisteredResource, value: unknown): ResourceContents {
    const mimeType = entry.resource.mimeType || undefined;
    if (typeof value === 'string') return { uri, ...(mimeType ? { mimeType } : {}), text: value };
    if (value instanceof Uint8Array)
        return { uri, mimeType: mimeType ?? 'application/octet-stream', blob: Buffer.from(value).toString('base64') };
    if (isRecord(value) && (typeof value.text === 'string' || typeof value.blob === 'string')) {
        const own = typeof value.mimeType === 'string' ? value.mimeType : mimeType;
        return typeof value.text === 'string'
            ? { uri, ...(own ? { mimeType: own } : {}), text: value.text }
            : { uri, ...(own ? { mimeType: own } : {}), blob: String(value.blob) };
    }
    return { uri, mimeType: mimeType ?? 'application/json', text: JSON.stringify(value, null, 2) };
}

function describeValidation(error: ValidationError): string {
    return error.errors.map(item => `${item.path || '(root)'}: ${item.message} [${item.code}]`).join('; ');
}

/** An error's message without `DeepkitError`'s appended code and docs link — the model reads the sentence, the code is for operators. */
function errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.split('\n\nError code: ')[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Frames a running tool pushes (progress) while the caller iterates them; closed
 * when the tool settles. The iteration ends on close, after the pushed frames.
 */
class FrameQueue implements AsyncIterable<McpFrame> {
    private readonly frames: McpFrame[] = [];
    private closed = false;
    private wake: (() => void) | null = null;

    push(frame: McpFrame): void {
        this.frames.push(frame);
        this.wake?.();
    }

    closeWhen(settled: Promise<unknown>): void {
        void settled.finally(() => {
            this.closed = true;
            this.wake?.();
        });
    }

    async *[Symbol.asyncIterator](): AsyncGenerator<McpFrame> {
        while (true) {
            if (this.frames.length > 0) {
                yield this.frames.shift()!;
                continue;
            }
            if (this.closed) return;
            await new Promise<void>(resolve => {
                this.wake = resolve;
            });
            this.wake = null;
        }
    }
}
