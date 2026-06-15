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

import { typeRequiresJSONCast } from '../platform/default-platform.js';

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
// On deserialize, a DB usually returns a JSON string for union columns that need JSON casting;
// parse it before the default union handler runs (prepend). Serialize needs no special casing
// (matches the old serializer, which left it to the default union handler).

const deserializeSqlUnion: SqlTypeHandler<TypeUnion> = (type, input, b, ctx) => {
    if (isDirectEntityColumn(ctx) && typeRequiresJSONCast(type)) {
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

        // union deserialize: JSON-parse direct columns that need it, before the default union handler.
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
