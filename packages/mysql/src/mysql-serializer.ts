/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { SqlSerializer, uuid4Stringify } from '@deepkit/sql';
import { TypeClass, isUUIDType, nodeBufferToArrayBuffer, nodeBufferToTypedArray } from '@deepkit/type';

// For queries with `returning`, MySQL returns binary data base64-encoded with a
// `base64:type254:` prefix. Decode it back to a Buffer before the normal binary handling.
const BASE64_PREFIX = 'base64:';
const BASE64_OFFSET = 'base64:type254:'.length;

function fromMysqlBase64(value: any): any {
    return typeof value === 'string' && value.startsWith(BASE64_PREFIX)
        ? Buffer.from(value.substr(BASE64_OFFSET), 'base64')
        : value;
}

function deserializeMysqlUuid(value: any): string {
    const decoded = fromMysqlBase64(value);
    // already a UUID string (normal SELECT) → keep; otherwise stringify the 16 binary bytes.
    return typeof decoded === 'string' ? decoded : uuid4Stringify(decoded);
}

class MySQLSerializer extends SqlSerializer {
    name = 'mysql';

    protected override registerSerializers() {
        super.registerSerializers();

        // Binary columns: decode the base64 wrapper, then convert the Buffer like the SQL default.
        this.deserializeRegistry.replaceBinary((type, input, b) => {
            const classType = (type as TypeClass).classType;
            const buffer = b.call(fromMysqlBase64, input);
            return classType === ArrayBuffer
                ? b.call(nodeBufferToArrayBuffer, buffer)
                : b.call(nodeBufferToTypedArray, buffer, b.lit(classType));
        });

        // UUIDs are stored as binary; the SQL UUID handler can't tell a base64 wrapper from a real
        // UUID string, so short-circuit it here (pre-hooks run before the annotation handlers).
        this.deserializeRegistry.addPreHook((type, input, b, ctx, next) => {
            if (isUUIDType(type)) return b.call(deserializeMysqlUuid, input);
            return next();
        });
    }
}

export const mySqlSerializer = new MySQLSerializer();
