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
 * Minimal little-endian buffer writer for the RPC binary message framing.
 *
 * Replaces the `Writer` class that used to be exported from `@deepkit/bson`.
 * Only the methods that {@link ./protocol.ts} relies on are implemented; the
 * BSON bodies themselves are serialized separately (via `getBSONSerializer`)
 * and copied in with {@link Writer#writeBuffer}, so this writer never needs to
 * understand BSON — it just lays out the message header and frames bodies.
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

    writeUint8(v: number): void {
        this.buffer[this.offset++] = v;
    }

    writeUint32(v: number): void {
        this.dataView.setUint32(this.offset, v, true);
        this.offset += 4;
    }

    writeBuffer(buf: Uint8Array): void {
        this.buffer.set(buf, this.offset);
        this.offset += buf.byteLength;
    }

    writeAsciiString(str: string): void {
        for (let i = 0; i < str.length; i++) {
            this.buffer[this.offset++] = str.charCodeAt(i);
        }
    }

    writeNull(): void {
        this.buffer[this.offset++] = 0;
    }
}
