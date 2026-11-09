import { DeepkitError } from '@deepkit/core';
import {
    ReflectionKind,
    Type,
    TypeClass,
    TypeLiteral,
    TypeObjectLiteral,
    TypeUnion,
    isIntegerType,
    validationAnnotation,
} from '@deepkit/type';

/**
 * Deepkit runtime types → JSON Schema (draft 2020-12).
 *
 * What a `Type` becomes:
 *  · a NAMED object type (an interface, a class, an aliased literal) is a `$defs`
 *    entry referenced by `$ref` wherever it appears — one definition per name;
 *  · a union of literals is an `enum`; a union of object literals with a literal
 *    `kind` is `oneOf` over named variants (`<Union><Kind>`), the discriminated
 *    shape a consumer can switch on;
 *  · `T | null` is `anyOf [T, null]`; an optional property leaves `required`;
 *  · `integer` (the brand) is `integer`; validators (`MinLength`, `Maximum`,
 *    `PositiveNoZero`, …) become the matching keywords;
 *  · `bigint` is a decimal STRING (ids are strings on every wire); `Date` is
 *    `date-time`;
 *  · `Record<string, T>` is `additionalProperties`; `unknown`/`any` is `{}`.
 *
 * Doc comments cross as `description`s: the type compiler reflects a declaration's
 * JSDoc summary — or its explicit `@description` — onto the type and onto each
 * property, and the emitter copies them onto the schema node (a `$ref` carries
 * none: the description belongs to the definition). A literal union spelled
 * `(typeof ARRAY)[number]` over an `as const` array reflects its literals, so
 * either spelling of a wire union yields its enum.
 *
 * Two entry points: {@link SchemaEmitter} collects a DOCUMENT of named
 * definitions (a cross-language contract set), {@link typeToJsonSchema} answers
 * ONE standalone schema for one type (a tool's input, a route's body) with the
 * named types it reaches under its own `$defs`.
 */
export type JsonSchema = Record<string, unknown>;

export class SchemaEmitter {
    readonly defs = new Map<string, JsonSchema>();
    /** Names claimed before their body is emitted — the recursion guard. */
    private readonly claimed = new Set<string>();

    /** Emit `type` as the definition `name` (and every named type it reaches). */
    define(name: string, type: Type): void {
        if (this.claimed.has(name)) return;
        this.claimed.add(name);
        this.defs.set(name, this.body(type, name));
    }

    /** A reference to `type` — by `$ref` when it is named, inline otherwise. */
    ref(type: Type, hint: string): JsonSchema {
        const name = definitionName(type);
        if (name !== undefined && this.isDefinable(type)) {
            this.define(name, type);
            return { $ref: `#/$defs/${name}` };
        }
        return this.body(type, hint);
    }

    /** The schema of `type` itself, inline, with its description when it carries one. */
    body(type: Type, hint: string): JsonSchema {
        const schema = this.plain(type, hint);
        const description =
            'description' in type && typeof type.description === 'string' ? type.description.trim() : '';
        return description && !('$ref' in schema) ? { description, ...schema } : schema;
    }

    /** The collected definitions, sorted by name — a stable document. */
    sortedDefs(): Record<string, JsonSchema> {
        return Object.fromEntries([...this.defs.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }

    /**
     * Only shapes worth a class or an enum get a definition; scalars stay
     * inline, and so does a mapped object (`Record<string, T>` — an index
     * signature and nothing else: its name is the utility's, not a contract's).
     */
    private isDefinable(type: Type): boolean {
        switch (type.kind) {
            case ReflectionKind.objectLiteral:
            case ReflectionKind.class:
                if (type.kind === ReflectionKind.class && type.classType === Date) return false;
                return type.types.some(member => member.kind !== ReflectionKind.indexSignature);
            case ReflectionKind.union:
                return true;
            case ReflectionKind.enum:
                return true;
            default:
                return false;
        }
    }

    private plain(type: Type, hint: string): JsonSchema {
        switch (type.kind) {
            case ReflectionKind.string:
                return withValidators({ type: 'string' }, type);
            case ReflectionKind.number:
                return withValidators({ type: isIntegerType(type) ? 'integer' : 'number' }, type);
            case ReflectionKind.boolean:
                return { type: 'boolean' };
            case ReflectionKind.bigint:
                return { type: 'string', pattern: '^-?\\d+$', description: 'bigint as a decimal string' };
            case ReflectionKind.null:
                return { type: 'null' };
            case ReflectionKind.undefined:
                return { type: 'null' };
            case ReflectionKind.any:
            case ReflectionKind.unknown:
                return {};
            case ReflectionKind.never:
                return { not: {} };
            case ReflectionKind.literal:
                return literalSchema(type);
            case ReflectionKind.enum:
                return {
                    enum: Object.values(type.enum).filter((value): value is string | number => value !== undefined),
                };
            case ReflectionKind.array:
                return { type: 'array', items: this.ref(type.type, `${hint}Item`) };
            case ReflectionKind.tuple:
                return {
                    type: 'array',
                    prefixItems: type.types.map((member, index) => this.ref(member.type, `${hint}${index}`)),
                    minItems: type.types.length,
                    maxItems: type.types.length,
                };
            case ReflectionKind.union:
                return this.union(type, hint);
            case ReflectionKind.objectLiteral:
            case ReflectionKind.class:
                return this.object(type, hint);
            case ReflectionKind.promise:
                return this.ref(type.type, hint);
            default:
                throw new DeepkitError(
                    'DK-JS100',
                    `json-schema: cannot express ${ReflectionKind[type.kind]} (${hint}) as JSON Schema.`,
                );
        }
    }

    private object(type: TypeObjectLiteral | TypeClass, hint: string): JsonSchema {
        if (type.kind === ReflectionKind.class && type.classType === Date)
            return { type: 'string', format: 'date-time' };
        const properties: Record<string, JsonSchema> = {};
        const required: string[] = [];
        let additionalProperties: JsonSchema | false = false;
        for (const member of type.types) {
            if (member.kind === ReflectionKind.indexSignature) {
                additionalProperties = this.ref(member.type, `${hint}Value`);
                continue;
            }
            if (member.kind !== ReflectionKind.propertySignature && member.kind !== ReflectionKind.property) continue;
            const name = String(member.name);
            const { valueType, optional } = stripUndefined(member.type);
            const schema = this.ref(valueType, `${hint}${pascal(name)}`);
            const description = member.description?.trim();
            properties[name] = description && !('$ref' in schema) ? { description, ...schema } : schema;
            if (!member.optional && !optional) required.push(name);
        }
        const schema: JsonSchema = { type: 'object', properties, additionalProperties };
        if (required.length > 0) schema.required = required;
        return schema;
    }

    private union(type: TypeUnion, hint: string): JsonSchema {
        const members = type.types;
        const nullable = members.some(m => m.kind === ReflectionKind.null || m.kind === ReflectionKind.undefined);
        const real = members.filter(m => m.kind !== ReflectionKind.null && m.kind !== ReflectionKind.undefined);
        let schema: JsonSchema;
        if (real.every(m => m.kind === ReflectionKind.literal)) {
            const values = real.flatMap(m =>
                m.kind === ReflectionKind.literal && isJsonLiteral(m.literal) ? [m.literal] : [],
            );
            const kinds = new Set(values.map(v => typeof v));
            schema = { enum: values };
            if (kinds.size === 1)
                schema = {
                    type: kinds.has('string') ? 'string' : kinds.has('number') ? 'number' : 'boolean',
                    ...schema,
                };
        } else if (real.length === 1) {
            schema = this.ref(real[0], hint);
        } else if (real.every(m => m.kind === ReflectionKind.objectLiteral && discriminant(m) !== undefined)) {
            const unionName = definitionName(type) ?? hint;
            schema = {
                oneOf: real.map(m => {
                    // A variant reached through a flattened alias (`A | B` where `A` is
                    // itself a union) is the same object as the one `A` defined: reuse
                    // that definition rather than minting a structural twin per alias.
                    const body = this.body(m, unionName);
                    const existing = [...this.defs.entries()].find(
                        ([, def]) => JSON.stringify(def) === JSON.stringify(body),
                    );
                    const variantName = existing?.[0] ?? `${unionName}${pascal(String(discriminant(m)))}`;
                    if (!existing) this.define(variantName, m);
                    return { $ref: `#/$defs/${variantName}` };
                }),
            };
        } else {
            schema = { anyOf: real.map((m, index) => this.ref(m, `${hint}${index}`)) };
        }
        if (!nullable) return schema;
        const anyOf: unknown = schema.anyOf;
        if (Array.isArray(anyOf)) return { anyOf: [...(anyOf as unknown[]), { type: 'null' }] };
        return { anyOf: [schema, { type: 'null' }] };
    }
}

/**
 * One standalone schema for one type — the shape a tool's `inputSchema` or a
 * route's body wants: the type itself inline at the root (so a caller sees the
 * properties without following a reference), every NAMED type it reaches as
 * `$defs` on that same root, where `#/$defs/…` resolves. No `$schema` field: the
 * dialect is 2020-12 by default wherever this is consumed.
 */
export function typeToJsonSchema(type: Type, name: string = 'Root'): JsonSchema {
    const emitter = new SchemaEmitter();
    const schema = emitter.body(type, name);
    return emitter.defs.size === 0 ? schema : { ...schema, $defs: emitter.sortedDefs() };
}

/** The literal `kind` an object-literal variant carries, if any. */
function discriminant(type: Type): string | number | boolean | undefined {
    if (type.kind !== ReflectionKind.objectLiteral) return undefined;
    for (const member of type.types) {
        if (member.kind !== ReflectionKind.propertySignature || member.name !== 'kind') continue;
        if (member.type.kind === ReflectionKind.literal && isJsonLiteral(member.type.literal))
            return member.type.literal;
    }
    return undefined;
}

function definitionName(type: Type): string | undefined {
    if (type.kind === ReflectionKind.class) {
        if (type.classType === Date) return undefined;
        return type.typeName ?? type.classType.name;
    }
    return type.typeName;
}

function stripUndefined(type: Type): { valueType: Type; optional: boolean } {
    if (type.kind !== ReflectionKind.union) return { valueType: type, optional: false };
    const rest = type.types.filter(m => m.kind !== ReflectionKind.undefined);
    if (rest.length === type.types.length) return { valueType: type, optional: false };
    if (rest.length === 1) return { valueType: rest[0], optional: true };
    return { valueType: { ...type, types: rest }, optional: true };
}

function literalSchema(type: TypeLiteral): JsonSchema {
    const literal = type.literal;
    if (isJsonLiteral(literal)) return { const: literal };
    if (typeof literal === 'bigint') return { const: literal.toString() };
    throw new DeepkitError('DK-JS101', `json-schema: a ${typeof literal} literal has no JSON form.`);
}

function isJsonLiteral(value: unknown): value is string | number | boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Deepkit validator annotations → the JSON Schema keywords that mean the same. */
function withValidators(schema: JsonSchema, type: Type): JsonSchema {
    for (const { name, args } of validationAnnotation.getAnnotations(type)) {
        const arg = args[0]?.kind === ReflectionKind.literal ? args[0].literal : undefined;
        switch (name) {
            case 'minLength':
                schema.minLength = arg;
                break;
            case 'maxLength':
                schema.maxLength = arg;
                break;
            case 'minimum':
                schema.minimum = arg;
                break;
            case 'maximum':
                schema.maximum = arg;
                break;
            case 'exclusiveMinimum':
                schema.exclusiveMinimum = arg;
                break;
            case 'exclusiveMaximum':
                schema.exclusiveMaximum = arg;
                break;
            case 'positive':
                if (arg === true) schema.minimum = 0;
                else schema.exclusiveMinimum = 0;
                break;
            case 'negative':
                if (arg === true) schema.maximum = 0;
                else schema.exclusiveMaximum = 0;
                break;
            case 'pattern':
                if (arg instanceof RegExp) schema.pattern = arg.source;
                break;
            default:
                break; // a validator with no schema counterpart (a custom function) stays server-side
        }
    }
    return schema;
}

function pascal(text: string): string {
    return text
        .split(/[^A-Za-z0-9]+/)
        .filter(part => part !== '')
        .map(part => part[0].toUpperCase() + part.slice(1))
        .join('');
}
