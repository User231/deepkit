import { deserializeBSONWithoutOptimiser, getBSONDeserializer, getBSONSerializer } from '@deepkit/bson';
import { createBuffer } from '@deepkit/core';
import { AnalyticData, FrameData, FrameEnd, FrameStart, FrameType, getTypeOfCategory } from '@deepkit/stopwatch';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function stringByteLength(str: string): number {
    return textEncoder.encode(str).byteLength;
}

/**
 * Minimal little-endian binary writer.
 *
 * Replaces the `Writer` that `@deepkit/bson` used to export (removed in the v2 rewrite, which
 * switched serialization to the zero-copy `[buffer, size]` tuple API). This module only needs a
 * handful of primitive writes for its custom stopwatch frame format.
 */
class Writer {
    public dataView: DataView;
    public offset = 0;

    constructor(public buffer: Uint8Array) {
        this.dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    writeByte(v: number): void {
        this.buffer[this.offset++] = v;
    }

    writeUint32(v: number): void {
        this.dataView.setUint32(this.offset, v, true);
        this.offset += 4;
    }

    writeDouble(v: number): void {
        this.dataView.setFloat64(this.offset, v, true);
        this.offset += 8;
    }

    writeBuffer(buf: Uint8Array): void {
        this.buffer.set(buf, this.offset);
        this.offset += buf.byteLength;
    }

    writeString(str: string): void {
        const bytes = textEncoder.encode(str);
        this.buffer.set(bytes, this.offset);
        this.offset += bytes.byteLength;
    }
}

/**
 * Minimal little-endian binary parser. Replaces the removed `@deepkit/bson` `BaseParser`.
 */
class BaseParser {
    public offset = 0;
    public dataView: DataView;

    constructor(public buffer: Uint8Array) {
        this.dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    eatByte(): number {
        return this.buffer[this.offset++];
    }

    eatUInt32(): number {
        const v = this.dataView.getUint32(this.offset, true);
        this.offset += 4;
        return v;
    }

    peekUInt32(): number {
        return this.dataView.getUint32(this.offset, true);
    }

    eatDouble(): number {
        const v = this.dataView.getFloat64(this.offset, true);
        this.offset += 8;
        return v;
    }

    eatString(size: number): string {
        const str = textDecoder.decode(this.buffer.subarray(this.offset, this.offset + size));
        this.offset += size;
        return str;
    }
}

export function encodeFrames(frames: (FrameStart | FrameEnd)[]): Uint8Array {
    //cid = id and worker, as compound key
    //<cid uint32><type uint8><timestamp uint64><context uint32><category uint8><labelSize uint8><label utf8string>.
    let size = 0;
    for (const frame of frames) {
        size +=
            frame.type === FrameType.end
                ? (32 + 8 + 64) / 8
                : (32 + 8 + 64 + 32 + 8 + 8) / 8 + Math.min(255, stringByteLength(frame.label));
    }

    const buffer = createBuffer(size);
    const writer = new Writer(buffer);

    for (const frame of frames) {
        writer.writeUint32(frame.cid);
        writer.writeByte(frame.type);

        //up to 2⁵³=9,007,199,254,740,992 the representable numbers are exactly the integers
        //so we have no precision loss when using timestamp=Math.floor(performance.timeOrigin * 1_000 + performance.now() * 1_000)
        //timestamp current output vs max precise integers:
        //1613654358960142
        //9007199254740992
        writer.writeDouble(frame.timestamp);

        if (frame.type === FrameType.start) {
            writer.writeUint32(frame.context);
            writer.writeByte(frame.category);
            let size = stringByteLength(frame.label);
            for (let i = 0; size > 255; i++) {
                frame.label = frame.label.substr(0, 255 - i);
                size = stringByteLength(frame.label);
            }
            writer.writeByte(size);
            writer.writeString(frame.label);
        }
    }

    return buffer;
}

export function encodeFrameData(dataItems: FrameData[]): Uint8Array {
    //<cid uint32><category uint8><bson document>
    // Pre-serialize each BSON body up front. getBSONSerializer now returns a [buffer, size]
    // tuple over a SHARED scratch buffer, so we copy each result (slice) before the next call.
    const bodies: (Uint8Array | undefined)[] = [];
    let size = 0;
    for (const data of dataItems) {
        const type = getTypeOfCategory(data.category);
        let body: Uint8Array | undefined;
        if (type) {
            const [buffer, bsonSize] = getBSONSerializer(type)(data.data);
            body = buffer.slice(0, bsonSize);
        }
        bodies.push(body);
        size += (32 + 8) / 8 + (body ? body.byteLength : 4);
    }

    const buffer = createBuffer(size);
    const writer = new Writer(buffer);

    for (let i = 0; i < dataItems.length; i++) {
        const data = dataItems[i];
        writer.writeUint32(data.cid);
        writer.writeByte(data.category);
        const body = bodies[i];
        if (body) {
            //BSON document contains its own size prefix at the beginning
            writer.writeBuffer(body);
        } else {
            writer.writeUint32(0);
        }
    }

    return buffer;
}

export function encodeAnalytic(data: AnalyticData[]): Uint8Array {
    //<timestamp uint64><cpu uint8><memory uint8><loopBlocked uint8>
    const buffer = createBuffer(data.length * (4 + 1 + 1 + 4));
    const writer = new Writer(buffer);

    for (const item of data) {
        writer.writeUint32(item.timestamp);
        writer.writeByte(item.cpu);
        writer.writeByte(item.memory);
        writer.writeUint32(item.loopBlocked);
    }

    return buffer;
}

export function decodeAnalytic(buffer: Uint8Array, callback: (data: AnalyticData) => void) {
    const parser = new BaseParser(buffer);

    while (parser.offset < buffer.byteLength) {
        const timestamp = parser.eatUInt32();
        const cpu = parser.eatByte();
        const memory = parser.eatByte();
        const loopBlocked = parser.eatUInt32();
        callback({ timestamp, cpu, memory, loopBlocked });
    }
}

export function decodeFrameData(
    buffer: Uint8Array,
    callback: (data: { cid: number; category: number; data: Uint8Array }) => void,
) {
    const parser = new BaseParser(buffer);

    while (parser.offset < buffer.byteLength) {
        const cid = parser.eatUInt32();
        const category = parser.eatByte();
        const end = parser.peekUInt32() + parser.offset;
        callback({ cid, category, data: parser.buffer.slice(parser.offset, end) });
        parser.offset = end;
    }
}

export function deserializeFrameData(data: { cid: number; category: number; data: Uint8Array }): any {
    const classType = getTypeOfCategory(data.category);
    const deserializer = classType ? getBSONDeserializer(classType) : deserializeBSONWithoutOptimiser;
    return deserializer(data.data);
}

export function decodeFrames(buffer: Uint8Array, callback: (frame: FrameStart | FrameEnd) => void): void {
    const parser = new BaseParser(buffer);

    while (parser.offset < buffer.byteLength) {
        const cid = parser.eatUInt32();
        const type = parser.eatByte();
        const timestamp = parser.eatDouble();

        if (type === FrameType.start) {
            const context = parser.eatUInt32();
            const category = parser.eatByte();
            const stringSize = parser.eatByte();
            const label = parser.eatString(stringSize);
            callback({ cid, type: FrameType.start, timestamp, context, category, label });
        } else {
            callback({ cid, type: FrameType.end, timestamp });
        }
    }
}
