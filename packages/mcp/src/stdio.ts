import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import { ERROR, JsonRpcId } from './protocol.js';
import { McpServer } from './server.js';

/**
 * The stdio binding: one JSON-RPC message per line on the input, one per line on
 * the output, nothing else ever on the output (logs go to `errors`, stderr). Every
 * message is handled as it arrives — concurrently, so a `notifications/cancelled`
 * can reach a request still running — and the server returns when the input ends,
 * which is the client's graceful-shutdown signal. There is no header layer: the
 * `_meta` rules are the core's.
 */
export interface McpStdioOptions {
    input: Readable;
    output: Writable;
    /** Where a malformed line is reported; nothing is written there otherwise. */
    errors?: Writable;
    /** The caller every request runs as (a stdio server is launched by one user). */
    principal?: unknown;
}

export interface McpStdioHandle {
    /** Resolves when the input has ended and every in-flight request has answered. */
    done: Promise<void>;
    /** Stops reading and aborts every in-flight request. */
    close(): void;
}

export function serveStdio(server: McpServer, options: McpStdioOptions): McpStdioHandle {
    const inFlight = new Map<JsonRpcId, AbortController>();
    const running = new Set<Promise<void>>();
    const lines = createInterface({ input: options.input, crlfDelay: Infinity });
    const write = (message: unknown): void => {
        options.output.write(`${JSON.stringify(message)}\n`);
    };

    const handle = async (line: string): Promise<void> => {
        if (line.trim() === '') return;
        let message: unknown;
        try {
            message = JSON.parse(line);
        } catch (error) {
            options.errors?.write(
                `mcp stdio: unparseable line dropped: ${error instanceof Error ? error.message : String(error)}\n`,
            );
            write({ jsonrpc: '2.0', id: null, error: { code: ERROR.parse, message: 'Parse error' } });
            return;
        }
        const id = readableId(message);
        const controller = new AbortController();
        if (id !== null) inFlight.set(id, controller);
        try {
            for await (const frame of server.handle(message, {
                principal: options.principal,
                signal: controller.signal,
                onCancel: requestId => inFlight.get(requestId)?.abort(),
            })) {
                if (frame.kind === 'accepted') continue;
                write(frame.message);
            }
        } finally {
            if (id !== null) inFlight.delete(id);
        }
    };

    let resolveDone!: () => void;
    const done = new Promise<void>(resolve => {
        resolveDone = resolve;
    });

    lines.on('line', line => {
        const task = handle(line).finally(() => running.delete(task));
        running.add(task);
    });
    lines.on('close', () => {
        void Promise.allSettled([...running]).then(() => resolveDone());
    });

    return {
        done,
        close: () => {
            lines.close();
            for (const controller of inFlight.values()) controller.abort();
        },
    };
}

function readableId(message: unknown): JsonRpcId | null {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) return null;
    const id = (message as Record<string, unknown>).id;
    return typeof id === 'string' || typeof id === 'number' ? id : null;
}
