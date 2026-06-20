/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

/**
 * Minimal little-endian buffer writer for the MongoDB wire-protocol (OP_MSG)
 * message framing.
 *
 * Replaces the `Writer` class that used to be exported from `@deepkit/bson`
 * (removed in the v2 BSON rewrite). Only the methods the MongoDB connection
 * relies on are implemented; the BSON body itself is serialized separately
 * (via `getBSONSerializer`) and copied in with {@link Writer#writeBuffer}, so
 * this writer never needs to understand BSON — it only lays out the OP_MSG
 * header and section frame.
 */
export class Writer {
    public dataView: DataView;
    public offset = 0;

    constructor(public buffer: Uint8Array) {
        this.dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    writeByte(v: number): void {
        this.buffer[this.offset++] = v;
    }

    writeInt32(v: number): void {
        this.dataView.setInt32(this.offset, v, true);
        this.offset += 4;
    }

    writeUint32(v: number): void {
        this.dataView.setUint32(this.offset, v, true);
        this.offset += 4;
    }

    writeBuffer(buf: Uint8Array): void {
        this.buffer.set(buf, this.offset);
        this.offset += buf.byteLength;
    }
}
