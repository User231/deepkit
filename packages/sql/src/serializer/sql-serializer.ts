/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import {
    JsonBuildContext,
    ReflectionKind,
    Serializer,
    Type,
    TypeArray,
    TypeClass,
    TypeHandler,
    TypeObjectLiteral,
    TypeUnion,
    isUUIDType,
    nodeBufferToArrayBuffer,
    nodeBufferToTypedArray,
    referenceAnnotation,
    registerDefaultHandlers,
    registerTypeGuards,
    registerUnionHandler,
    registerValidationHook,
    typedArrayToBuffer,
} from '@deepkit/type';

import { typeRequiresJSONCast, typeResolvesToDate } from '../platform/default-platform.js';

export const hexTable: string[] = [];
for (let i = 0; i < 256; i++) {
    hexTable[i] = (i <= 15 ? '0' : '') + i.toString(16);
}

/**
 * SQL-specialized type handler: a {@link TypeHandler} bound to {@link JsonBuildContext}
 * (the JSON/object build context that the SQL serializer reuses).
 */
type SqlTypeHandler<T extends Type = Type> = TypeHandler<T, JsonBuildContext>;

/**
 * Only direct properties of an entity are serialized in the SQL-special way (e.g. JSON
 * columns). Deeper types get the normal JSON serialization and are folded into the parent's
 * single JSON.stringify.
 *
 * The old serializer inspected `state.parentTypes` (an ancestor-Type chain). The new build
 * context exposes the equivalent signal as `treeDepth`: the root entity is at `treeDepth` 0 and
 * each structural descent (`forProperty()` / `forIndex()` / `forKey()` / `forUnionMember()`)
 * increments it, so a *direct* property of the entity is exactly `treeDepth === 1`.
 *
 * We use `treeDepth` rather than `depth` because `depth` is reset to 0 inside JIT-extracted
 * functions (it doubles as the inline-size budget). `treeDepth` is preserved across extraction,
 * so deeply nested values past the extraction threshold are NOT mistaken for direct columns and
 * JSON-encoded a second time. (Edge case: serializing a bare property value as the root —
 * `treeDepth` 0 — is not treated as a direct property; the old code's `[property, this]` shape
 * was rare.)
 */
export function isDirectEntityColumn(ctx: JsonBuildContext): boolean {
    return ctx.treeDepth === 1;
}

// --- `any` -----------------------------------------------------------------------------------
// Direct entity columns of type `any` are stored as a JSON string.

const serializeSqlAny: SqlTypeHandler = (type, input, b, ctx) => {
    if (!isDirectEntityColumn(ctx)) return input;
    return b.call(JSON.stringify, input);
};

const deserializeSqlAny: SqlTypeHandler = (type, input, b, ctx) => {
    if (!isDirectEntityColumn(ctx)) return input;
    // 'string' === typeof input ? JSON.parse(input) : input
    return b.ternary(b.isType(input, 'string'), b.call(JSON.parse, input), input);
};

// --- arrays ----------------------------------------------------------------------------------
// Direct entity columns of array type are stored as a JSON string (back-references excluded).

const serializeSqlArray: SqlTypeHandler<TypeArray> = (type, input, b, ctx) => {
    if (undefined !== referenceAnnotation.getFirst(type)) return input;
    if (!isDirectEntityColumn(ctx)) return input;
    return b.call(JSON.stringify, input);
};

const deserializeSqlArray: SqlTypeHandler<TypeArray> = (type, input, b, ctx) => {
    if (undefined !== referenceAnnotation.getFirst(type)) return input;
    if (!isDirectEntityColumn(ctx)) return input;
    return b.ternary(b.isType(input, 'string'), b.call(JSON.parse, input), input);
};

// --- object literals / classes ---------------------------------------------------------------
// Reference properties (`& Reference`) are serialized to their primary key by the default
// reference decorator, which short-circuits before these kind handlers run — so these only
// ever see non-reference objects, which (as direct entity columns) are stored as JSON strings.
//
// Serialize: run the default object handler first, then JSON.stringify (append).
// Deserialize: JSON.parse first, then run the default object handler (prepend).

const serializeSqlObjectWrap: SqlTypeHandler<TypeClass | TypeObjectLiteral> = (type, input, b, ctx) => {
    if (!isDirectEntityColumn(ctx)) return input;
    return b.call(JSON.stringify, input);
};

const deserializeSqlObjectUnwrap: SqlTypeHandler<TypeClass | TypeObjectLiteral> = (type, input, b, ctx) => {
    if (!isDirectEntityColumn(ctx)) return input;
    return b.ternary(b.isType(input, 'string'), b.call(JSON.parse, input), input);
};

// --- unions ----------------------------------------------------------------------------------
// A direct entity column whose type is a union that mixes scalars with objects/arrays (e.g.
// `{ foo: string } | 54`, `{ name: string } | null`) is stored as a single JSON-string column so
// the scalar/object distinction round-trips (`54` ↔ `"54"`, `{...}` ↔ `'{...}'`). We JSON-encode the
// chosen union value once, here at the column level (treeDepth 1), after the default union handler
// has serialized the picked member.
//
// Why this is needed: the default union handler's *scored* path (a union mixing an object with a
// scalar/null, e.g. `{name} | null`, `{foo} | 54`) returns the object member as a RAW object — the
// member's objectLiteral handler doesn't stringify it there — so without this the driver gets a raw
// object as a bind param and fails ("named parameters in two different objects" / wrong column value).
//
// Two exclusions keep us from corrupting values that are already correct:
//
//  1. ALREADY-STRINGIFIED MEMBERS — the *discriminated* path (a union of object literals sharing a
//     discriminator, e.g. `{type:'local'} | {type:'remote'}`) builds the chosen member at the
//     column's tree depth, so serializeSqlObjectWrap has ALREADY produced a JSON string by the time
//     we run. Re-encoding would double-stringify (`'"{\\"type\\":...}"'`). So we skip values that
//     are already strings (handled in sqlSerializeJsonUnionValue).
//
//  2. DATE UNIONS — a union that resolves to Date (e.g. `Date | null`) gets a native datetime/
//     timestamp column (the platform maps `typeResolvesToDate` → datetime), NOT a JSON column, so its
//     value must stay a raw Date; JSON-encoding it would bind `'"1960-...Z"'` and the driver rejects
//     it. `unionNeedsJsonColumn` excludes these, mirroring the DDL's JSON-vs-native column choice.
//
// NULL/undefined always pass through so the column stores SQL NULL (the JSON `'null'` string would
// defeat `WHERE col IS NULL`).
//
// On deserialize, deserializeSqlUnion (prepend) JSON-parses the stored string before the default
// union handler runs, restoring the scalar-or-object value.

function unionNeedsJsonColumn(type: TypeUnion): boolean {
    return typeRequiresJSONCast(type) && !typeResolvesToDate(type);
}

// Scalar member kinds — these are NOT pre-stringified by serializeSqlObjectWrap, so a string
// value of such a member is a genuine value (not an already-JSON-encoded object).
function isScalarMember(type: Type): boolean {
    return (
        type.kind === ReflectionKind.string ||
        type.kind === ReflectionKind.number ||
        type.kind === ReflectionKind.boolean ||
        type.kind === ReflectionKind.bigint ||
        type.kind === ReflectionKind.literal ||
        type.kind === ReflectionKind.null ||
        type.kind === ReflectionKind.undefined
    );
}

function unionIsAllScalars(type: TypeUnion): boolean {
    return type.types.every(isScalarMember);
}

function sqlSerializeJsonUnionValue(value: any): any {
    // null/undefined → SQL NULL; already-a-string → discriminated member already JSON-encoded.
    if (value === null || value === undefined || typeof value === 'string') return value;
    return JSON.stringify(value);
}

// Pure-scalar union (e.g. `string | number | null`): no object members were pre-stringified, so
// EVERY non-null value must be JSON-encoded — including strings, which the object-aware path above
// wrongly skips (a genuine string `"hi"` would otherwise reach the driver as invalid JSON `hi`).
// This keeps the scalar distinction (`"42"` ↔ `'"42"'`, `42` ↔ `'42'`) round-tripping through a
// JSON column. Mirrored on read by the standard `isType(string) → JSON.parse` deserialize, which
// needs the driver to hand back raw JSON text (postgres: json/jsonb auto-parse is disabled).
function sqlSerializeScalarJsonValue(value: any): any {
    if (value === null || value === undefined) return value;
    return JSON.stringify(value);
}

const serializeSqlUnion: SqlTypeHandler<TypeUnion> = (type, input, b, ctx) => {
    if (isDirectEntityColumn(ctx) && unionNeedsJsonColumn(type)) {
        if (unionIsAllScalars(type)) return b.call(sqlSerializeScalarJsonValue, input);
        return b.call(sqlSerializeJsonUnionValue, input);
    }
    return input;
};

const deserializeSqlUnion: SqlTypeHandler<TypeUnion> = (type, input, b, ctx) => {
    if (isDirectEntityColumn(ctx) && unionNeedsJsonColumn(type)) {
        return b.ternary(b.isType(input, 'string'), b.call(JSON.parse, input), input);
    }
    return input;
};

// --- UUID ------------------------------------------------------------------------------------
// The Builder has no try/catch statement, so the try/catch lives in a plain JS closure that
// `b.call` invokes at runtime.

function sqlSerializeUuidValue(value: any): Buffer {
    try {
        return uuid4Binary(value);
    } catch (error) {
        throw new TypeError('Invalid UUID v4: ' + error);
    }
}

function sqlDeserializeUuidValue(value: any): string {
    try {
        return 'string' === typeof value ? value : uuid4Stringify(value);
    } catch (error) {
        throw new TypeError('Invalid UUID v4: ' + error);
    }
}

const serializeSqlUuid: SqlTypeHandler = (type, input, b, ctx) => {
    // Only direct entity columns are stored as binary; nested UUIDs pass through.
    if (!isDirectEntityColumn(ctx)) return input;
    return b.call(sqlSerializeUuidValue, input);
};

const deserializeSqlUuid: SqlTypeHandler = (type, input, b, ctx) => {
    return b.call(sqlDeserializeUuidValue, input);
};

// --- binary ----------------------------------------------------------------------------------
// SQL stores raw Buffers, not the base64 strings the JSON default produces.

function arrayBufferToBuffer(value: ArrayBuffer): Buffer {
    return Buffer.from(value);
}

const serializeSqlBinary: SqlTypeHandler = (type, input, b, ctx) => {
    const classType = (type as TypeClass).classType;
    if (classType === ArrayBuffer) {
        return b.call(arrayBufferToBuffer, input);
    }
    return b.call(typedArrayToBuffer, input);
};

const deserializeSqlBinary: SqlTypeHandler = (type, input, b, ctx) => {
    const classType = (type as TypeClass).classType;
    if (classType === ArrayBuffer) {
        return b.call(nodeBufferToArrayBuffer, input);
    }
    return b.call(nodeBufferToTypedArray, input, b.lit(classType));
};

export class SqlSerializer extends Serializer {
    constructor() {
        super('sql');
    }

    override setExplicitUndefined(type: Type, state: JsonBuildContext): boolean {
        //make sure that `foo?: string` is not explicitly set to undefined when database returns `null`.
        if (state.direction === 'deserialize') return false;
        return true;
    }

    protected override registerSerializers() {
        // SQL-specific annotation handlers must be added BEFORE the defaults: addDecorator is
        // first-match-wins, so registering ours first shadows the default UUID decorator.
        this.serializeRegistry.addDecorator(isUUIDType, serializeSqlUuid);
        this.deserializeRegistry.addDecorator(isUUIDType, deserializeSqlUuid);

        // Default JSON handlers (mirrors the built-in JSONSerializer).
        registerDefaultHandlers(this);
        registerUnionHandler(this);
        registerValidationHook(this);
        registerTypeGuards(this);

        // --- SQL overrides on top of the defaults ---

        // `any`: JSON-encode direct entity columns.
        this.serializeRegistry.replaceKind(ReflectionKind.any, serializeSqlAny);
        this.deserializeRegistry.replaceKind(ReflectionKind.any, deserializeSqlAny);

        // string deserialize: no coercion — UUID/MongoId arrive as binary and are handled by
        // their decorators above/in the defaults, plain strings come back verbatim from the DB.
        this.deserializeRegistry.replaceKind(ReflectionKind.string, (type, input) => input);

        // object/class columns are stored as JSON strings: serialize → default then stringify;
        // deserialize → parse then default.
        this.serializeRegistry.append(ReflectionKind.objectLiteral, serializeSqlObjectWrap);
        this.serializeRegistry.append(ReflectionKind.class, serializeSqlObjectWrap);
        this.deserializeRegistry.prepend(ReflectionKind.objectLiteral, deserializeSqlObjectUnwrap);
        this.deserializeRegistry.prepend(ReflectionKind.class, deserializeSqlObjectUnwrap);

        // array columns: same JSON pattern.
        this.serializeRegistry.append(ReflectionKind.array, serializeSqlArray);
        this.deserializeRegistry.prepend(ReflectionKind.array, deserializeSqlArray);

        // union serialize: JSON-encode direct columns that mix scalars with objects/arrays, after
        // the default union handler. union deserialize: JSON-parse those columns first, before it.
        this.serializeRegistry.append(ReflectionKind.union, serializeSqlUnion);
        this.deserializeRegistry.prepend(ReflectionKind.union, deserializeSqlUnion);

        // Date serialize: pass the Date through — the SQL driver/escaping handles it (no ISO string).
        this.serializeRegistry.replaceClass(Date, (type, input) => input);

        // binary: store/read raw Buffers rather than base64.
        this.serializeRegistry.replaceBinary(serializeSqlBinary);
        this.deserializeRegistry.replaceBinary(deserializeSqlBinary);
    }
}

export const sqlSerializer: Serializer = new SqlSerializer();

export function uuid4Binary(u: any): Buffer {
    return 'string' === typeof u ? Buffer.from(u.replace(/-/g, ''), 'hex') : Buffer.alloc(0);
}

export function uuid4Stringify(buffer: Buffer): string {
    return (
        hexTable[buffer[0]] +
        hexTable[buffer[1]] +
        hexTable[buffer[2]] +
        hexTable[buffer[3]] +
        '-' +
        hexTable[buffer[4]] +
        hexTable[buffer[5]] +
        '-' +
        hexTable[buffer[6]] +
        hexTable[buffer[7]] +
        '-' +
        hexTable[buffer[8]] +
        hexTable[buffer[9]] +
        '-' +
        hexTable[buffer[10]] +
        hexTable[buffer[11]] +
        hexTable[buffer[12]] +
        hexTable[buffer[13]] +
        hexTable[buffer[14]] +
        hexTable[buffer[15]]
    );
}
