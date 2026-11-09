import { ClassType, DeepkitError } from '@deepkit/core';
import { typeToJsonSchema } from '@deepkit/json-schema';
import { ReflectionClass, ReflectionKind, Type } from '@deepkit/type';

import { McpResource, McpTool, getMcpMeta } from './decorator.js';
import { ResourceDefinition, ResourceTemplateDefinition, ToolDefinition } from './protocol.js';

/**
 * What a tool method may take as its SECOND parameter: the call's progress sink,
 * its cancellation signal and the request's `_meta`. Declared as a class so the
 * registry recognises the parameter by its type, like the HTTP router does with
 * `HttpRequest`.
 */
export class McpCallContext {
    constructor(
        /** Aborted when the client cancels — a closed stream on HTTP, `notifications/cancelled` on stdio. */
        public readonly signal: AbortSignal,
        /** Reports progress to the client; a no-op when the request carried no `progressToken`. `progress` must rise. */
        public readonly progress: (progress: number, total?: number, message?: string) => void,
        /** The request's `_meta` as sent — the client's info and capabilities, a `traceparent`, … */
        public readonly meta: Readonly<Record<string, unknown>>,
        /** Whatever the binding resolved for the caller (a principal); unknown to the core. */
        public readonly principal: unknown,
    ) {}
}

export interface RegisteredTool {
    tool: McpTool;
    definition: ToolDefinition;
    /** The one input parameter's type, or undefined for a tool that takes none. */
    inputType: Type | undefined;
    /** Where the `McpCallContext` parameter sits, if the method asks for one. */
    contextIndex: number | undefined;
    /** The mirrored parameters: param name → the lowercase header name (`mcp-param-…`) the binding validates. */
    headerParams: ReadonlyMap<string, string>;
}

export interface RegisteredResource {
    resource: McpResource;
    definition: ResourceDefinition | ResourceTemplateDefinition;
    /** For a template: the variables' object type and the matcher that extracts them. */
    variablesType: Type | undefined;
    matcher: RegExp | undefined;
    variableNames: string[];
}

/**
 * Every tool and resource the server offers, resolved from the provider classes a
 * module declares. Schemas are built ONCE here, at registration, from the method's
 * reflected types: the first parameter is the tool's `inputSchema`, the return type
 * (a promise unwrapped) its `outputSchema` when the tool opts in. The order is the
 * registration order, then declaration order — deterministic, as the specification
 * asks, so a client can cache the list.
 */
export class McpRegistry {
    private readonly toolList: RegisteredTool[] = [];
    private readonly byName = new Map<string, RegisteredTool>();
    private readonly resourceList: RegisteredResource[] = [];

    constructor(
        /** How a provider instance is obtained per call — the injector, in a module; `new` in a test. */
        public readonly resolve: (classType: ClassType) => unknown = classType => new classType(),
    ) {}

    addProvider(classType: ClassType): this {
        const meta = getMcpMeta(classType);
        const reflection = ReflectionClass.from(classType);
        for (const tool of meta.tools.values()) this.registerTool(tool, reflection);
        for (const resource of meta.resources.values()) this.registerResource(resource, reflection);
        return this;
    }

    tools(): readonly RegisteredTool[] {
        return this.toolList;
    }

    toolNamed(name: string): RegisteredTool | undefined {
        return this.byName.get(name);
    }

    resources(): readonly RegisteredResource[] {
        return this.resourceList.filter(r => r.matcher === undefined);
    }

    templates(): readonly RegisteredResource[] {
        return this.resourceList.filter(r => r.matcher !== undefined);
    }

    /** The resource serving `uri` — a plain one by equality, a template by match — with the variables it binds. */
    resourceFor(uri: string): { entry: RegisteredResource; variables: Record<string, string> } | undefined {
        for (const entry of this.resourceList) {
            if (entry.matcher === undefined) {
                if (entry.resource.uri === uri) return { entry, variables: {} };
                continue;
            }
            const match = entry.matcher.exec(uri);
            if (!match) continue;
            const variables: Record<string, string> = {};
            entry.variableNames.forEach((name, index) => {
                variables[name] = decodeURIComponent(match[index + 1] ?? '');
            });
            return { entry, variables };
        }
        return undefined;
    }

    /**
     * The authorization groups a request needs, resolvable BEFORE its body is read:
     * a binding reads the method (and the tool or resource name) from the mirrored
     * HTTP headers and asks here. Unknown names answer undefined; the dispatch then
     * refuses them as protocol errors.
     */
    groupsFor(method: string, name: string | undefined): readonly string[] | undefined {
        if (method === 'tools/call') return name === undefined ? undefined : this.byName.get(name)?.tool.groups;
        if (method === 'resources/read')
            return name === undefined ? undefined : this.resourceFor(name)?.entry.resource.groups;
        return [];
    }

    private registerTool(tool: McpTool, reflection: ReflectionClass<any>): void {
        if (this.byName.has(tool.name))
            throw new DeepkitError('DK-MCP100', `mcp: a tool named "${tool.name}" is already registered.`);
        const method = reflection.getMethod(tool.method);
        const parameters = method.getParameters();
        const contextIndex = parameters.findIndex(p => {
            const type = p.getType();
            return type.kind === ReflectionKind.class && type.classType === McpCallContext;
        });
        const inputs = parameters.filter((_, index) => index !== contextIndex);
        if (inputs.length > 1) {
            throw new DeepkitError(
                'DK-MCP101',
                `mcp: tool "${tool.name}" takes ${inputs.length} input parameters; a tool takes ONE object (and optionally a McpCallContext).`,
            );
        }
        const inputType = inputs[0]?.getType();
        const definition: ToolDefinition = {
            name: tool.name,
            inputSchema:
                inputType === undefined
                    ? { type: 'object', additionalProperties: false }
                    : typeToJsonSchema(inputType, `${pascal(tool.name)}Input`),
        };
        const description = tool.description || method.getDescription();
        if (tool.title) definition.title = tool.title;
        if (description) definition.description = description;
        if (tool.outputSchema)
            definition.outputSchema = typeToJsonSchema(
                unwrapPromise(method.getReturnType()),
                `${pascal(tool.name)}Output`,
            );
        if (Object.keys(tool.annotations).length > 0) definition.annotations = { ...tool.annotations };
        const headerParams = new Map<string, string>();
        for (const [param, name] of Object.entries(tool.headers)) {
            if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
                throw new DeepkitError(
                    'DK-MCP102',
                    `mcp: tool "${tool.name}" mirrors "${param}" into an invalid header name "${name}".`,
                );
            const properties = definition.inputSchema.properties;
            const property = isRecord(properties) ? properties[param] : undefined;
            if (!isRecord(property))
                throw new DeepkitError(
                    'DK-MCP103',
                    `mcp: tool "${tool.name}" mirrors "${param}", which its input does not declare.`,
                );
            if (!['string', 'integer', 'boolean'].includes(String(property.type))) {
                throw new DeepkitError(
                    'DK-MCP104',
                    `mcp: tool "${tool.name}" mirrors "${param}", which is not a string, integer or boolean.`,
                );
            }
            property['x-mcp-header'] = name;
            headerParams.set(param, `mcp-param-${name.toLowerCase()}`);
        }
        const entry: RegisteredTool = {
            tool,
            definition,
            inputType,
            contextIndex: contextIndex === -1 ? undefined : contextIndex,
            headerParams,
        };
        this.toolList.push(entry);
        this.byName.set(tool.name, entry);
    }

    private registerResource(resource: McpResource, reflection: ReflectionClass<any>): void {
        const method = reflection.getMethod(resource.method);
        const description = resource.description || method.getDescription();
        const common = {
            name: resource.name,
            ...(resource.title ? { title: resource.title } : {}),
            ...(description ? { description } : {}),
            ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
        };
        if (!resource.isTemplate) {
            this.resourceList.push({
                resource,
                definition: { uri: resource.uri, ...common },
                variablesType: undefined,
                matcher: undefined,
                variableNames: [],
            });
            return;
        }
        const variableNames: string[] = [];
        const pattern = resource.uri
            .split(/(\{[A-Za-z_][A-Za-z0-9_]*\})/)
            .map(part => {
                const variable = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(part);
                if (!variable) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                variableNames.push(variable[1]);
                return '([^/]+)';
            })
            .join('');
        const variablesType = method.getParameters()[0]?.getType();
        this.resourceList.push({
            resource,
            definition: { uriTemplate: resource.uri, ...common },
            variablesType,
            matcher: new RegExp(`^${pattern}$`),
            variableNames,
        });
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapPromise(type: Type): Type {
    return type.kind === ReflectionKind.promise ? type.type : type;
}

function pascal(text: string): string {
    return text
        .split(/[^A-Za-z0-9]+/)
        .filter(part => part !== '')
        .map(part => part[0].toUpperCase() + part.slice(1))
        .join('');
}
