import { integer } from '@deepkit/type';

import { mcp } from '../src/decorator.js';
import { MCP_PROTOCOL_VERSION, META } from '../src/protocol.js';
import { McpCallContext, McpRegistry } from '../src/registry.js';
import { McpServer } from '../src/server.js';

interface MirroredInput {
    controller: string;
    action: string;
    payload?: Record<string, unknown>;
}

/** The provider the binding tests drive: an echo, a slow counter that reports progress and notices cancellation, a resource. */
export class BindingTools {
    static aborted: string[] = [];

    @(mcp.tool('echo').readOnly())
    echo(input: { text: string }): { echoed: string } {
        return { echoed: input.text };
    }

    @mcp.tool('slow')
    async slow(input: { steps: integer; stepMs: integer }, context: McpCallContext): Promise<string> {
        for (let i = 1; i <= input.steps; i++) {
            if (context.signal.aborted) {
                BindingTools.aborted.push(`at ${i}`);
                return 'aborted';
            }
            context.progress(i, input.steps, `step ${i}`);
            await new Promise(resolve => setTimeout(resolve, input.stepMs));
        }
        return `done after ${input.steps}`;
    }

    @mcp.tool('who')
    who(input: Record<string, never>, context: McpCallContext): { principal: unknown } {
        return { principal: context.principal };
    }

    @(mcp.tool('mirrored').header('controller', 'Controller').header('action', 'Action'))
    mirrored(input: MirroredInput): MirroredInput {
        return input;
    }

    @(mcp.resource('mz://status').mimeType('application/json'))
    status(): { up: boolean } {
        return { up: true };
    }
}

export function fixtureServer(): McpServer {
    return new McpServer({
        registry: new McpRegistry(() => new BindingTools()).addProvider(BindingTools),
        serverInfo: { name: 'fixture', version: '0' },
    });
}

export const meta = (extra: Record<string, unknown> = {}) => ({
    [META.protocolVersion]: MCP_PROTOCOL_VERSION,
    [META.clientCapabilities]: {},
    ...extra,
});

export const request = (
    method: string,
    params: Record<string, unknown> = {},
    id: string | number = 1,
    metaExtra?: Record<string, unknown>,
) => ({
    jsonrpc: '2.0',
    id,
    method,
    params: { ...params, _meta: meta(metaExtra) },
});
