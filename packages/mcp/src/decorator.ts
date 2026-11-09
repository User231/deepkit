import { ClassType } from '@deepkit/core';
import {
    ClassDecoratorResult,
    PropertyDecoratorResult,
    createClassDecoratorContext,
    createPropertyDecoratorContext,
    mergeDecorator,
} from '@deepkit/type';

import { ToolAnnotations } from './protocol.js';

/**
 * What `@mcp.tool()` records about one method. The method takes ONE object parameter
 * (its `inputSchema`) and may take a second, `McpCallContext`, for progress and
 * cancellation; its return value is the tool's result (`structuredContent` + text).
 */
export class McpTool {
    /** The wire name; defaults to the method's name. */
    name: string = '';
    method: string = '';
    classType!: ClassType;
    title: string = '';
    /** Defaults to the method's reflected doc comment (the type compiler keeps the summary). */
    description: string = '';
    /** The authorization groups the binding enforces BEFORE dispatch — the same strings routes and RPC actions declare. */
    groups: string[] = [];
    annotations: ToolAnnotations = {};
    /** Emit an `outputSchema` from the method's return type (opt-in: the schema is a promise the result then has to keep). */
    outputSchema: boolean = false;
    /**
     * Input parameters MIRRORED into HTTP headers (`x-mcp-header`): param name →
     * the `{Name}` of `Mcp-Param-{Name}`. A Streamable HTTP client sends the
     * header beside the body; the binding validates they agree. What it buys: a
     * guard can read the value BEFORE the body is parsed (an RPC action's own
     * groups, say). Primitive parameters only.
     */
    headers: Record<string, string> = {};
}

/**
 * What `@mcp.resource(uri)` records about one method. A `uri` holding `{name}`
 * segments is a TEMPLATE (RFC 6570 simple expansion): the method's one object
 * parameter receives the variables. A plain `uri` is one resource; the method
 * takes no parameter. The method returns a string (text), a `Uint8Array` (blob),
 * or `{ text | blob, mimeType? }`.
 */
export class McpResource {
    uri: string = '';
    method: string = '';
    classType!: ClassType;
    name: string = '';
    title: string = '';
    description: string = '';
    mimeType: string = '';
    groups: string[] = [];

    get isTemplate(): boolean {
        return /\{[A-Za-z_][A-Za-z0-9_]*\}/.test(this.uri);
    }
}

export class McpClassMeta {
    classType?: ClassType;
    tools = new Map<string, McpTool>();
    resources = new Map<string, McpResource>();
}

class McpClass {
    t = new McpClassMeta();

    /** Marks a class as a tool/resource provider. Optional: declaring one method does the same. */
    provider() {}

    addTool(tool: McpTool) {
        this.t.tools.set(tool.method, tool);
    }

    addResource(resource: McpResource) {
        this.t.resources.set(resource.method, resource);
    }

    onDecorator(classType: ClassType) {
        this.t.classType = classType;
    }
}

export const mcpClass: ClassDecoratorResult<typeof McpClass> = createClassDecoratorContext(McpClass);

class McpProperty {
    t: McpTool | McpResource = new McpTool();

    onDecorator(classType: ClassType, property: string | undefined) {
        if (!property) return;
        this.t.method = property;
        this.t.classType = classType;
        if (this.t instanceof McpTool) {
            if (!this.t.name) this.t.name = property;
            mcpClass.addTool(this.t)(classType);
        } else {
            if (!this.t.name) this.t.name = property;
            mcpClass.addResource(this.t)(classType);
        }
    }

    /** Declare the method as a tool, under `name` (default: the method's name). */
    tool(name?: string) {
        const tool = new McpTool();
        if (name) tool.name = name;
        this.t = tool;
    }

    /** Declare the method as a resource at `uri` (a template when it holds `{var}` segments). */
    resource(uri: string) {
        const resource = new McpResource();
        resource.uri = uri;
        this.t = resource;
    }

    title(title: string) {
        this.t.title = title;
    }

    description(text: string) {
        this.t.description = text;
    }

    name(name: string) {
        this.t.name = name;
    }

    mimeType(mimeType: string) {
        if (this.t instanceof McpResource) this.t.mimeType = mimeType;
    }

    group(...groups: string[]) {
        this.t.groups.push(...groups);
    }

    annotations(annotations: ToolAnnotations) {
        if (this.t instanceof McpTool) Object.assign(this.t.annotations, annotations);
    }

    /** Shorthands for the four behaviour hints. */
    readOnly(hint: boolean = true) {
        this.annotations({ readOnlyHint: hint });
    }

    destructive(hint: boolean = true) {
        this.annotations({ destructiveHint: hint });
    }

    idempotent(hint: boolean = true) {
        this.annotations({ idempotentHint: hint });
    }

    openWorld(hint: boolean = true) {
        this.annotations({ openWorldHint: hint });
    }

    outputSchema(emit: boolean = true) {
        if (this.t instanceof McpTool) this.t.outputSchema = emit;
    }

    /** Mirror the input parameter `param` into the HTTP header `Mcp-Param-{name}` (see `McpTool.headers`). */
    header(param: string, name: string) {
        if (this.t instanceof McpTool) this.t.headers[param] = name;
    }
}

export const mcpProperty: PropertyDecoratorResult<typeof McpProperty> = createPropertyDecoratorContext(McpProperty);

/**
 * `@mcp.tool()` / `@mcp.resource(uri)` on methods, `@mcp.provider()` on a class:
 *
 * ```ts
 * class InspectTools {
 *     /** What an id is — an event, an aggregate, a request — and its detail. *\/
 *     @(mcp.tool('inspect').group('role:platform_viewer').readOnly())
 *     async inspect(input: { id: string }): Promise<WhatIs> { … }
 *
 *     @(mcp.resource('mz://logs/{app}').mimeType('text/plain'))
 *     logs(vars: { app: string }): Promise<string> { … }
 * }
 * ```
 */
export const mcp: typeof mcpClass & typeof mcpProperty = mergeDecorator(mcpClass, mcpProperty) as any;

/** The declarations a class carries (an undecorated class has none). */
export function getMcpMeta(classType: ClassType): McpClassMeta {
    return mcpClass._fetch(classType) ?? new McpClassMeta();
}
