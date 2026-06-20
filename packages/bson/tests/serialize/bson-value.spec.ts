/**
 * Tests for {@link BSONValue}: a type-carrying wrapper that lets the runtime (`any`)
 * serialization path encode a value with full BSON fidelity (MongoId → ObjectId,
 * UUID → binary, BinaryBigInt → binary, raw bytes → binary) even though the surrounding
 * property is typed `any`. This is the mechanism MongoDB filter / update documents rely on.
 */
import * as bson from 'bson';
import { test } from 'node:test';

import { BinaryBigInt, MongoId, UUID, typeOf } from '@deepkit/type';

import { BSONValue, getBSONDeserializer, getBSONSerializer } from '../../index.js';
import { expectBytes } from '../test-utils.js';

const mongoIdType = typeOf<string & MongoId>();
const uuidType = typeOf<string & UUID>();
const binaryBigIntType = typeOf<bigint & BinaryBigInt>();

test('BSONValue MongoId in any-field → BSON ObjectId', () => {
    const hex = '5f1a2b3c4d5e6f7a8b9c0d1e';
    const serializer = getBSONSerializer<{ _id: any }>();
    const result = serializer({ _id: new BSONValue(hex, mongoIdType) });

    // first field's BSON type byte (offset 4) must be ObjectId (0x07), not String (0x02)
    const [buffer] = result;
    expectBytes(result, bson.serialize({ _id: new bson.ObjectId(hex) }));

    const out = getBSONDeserializer<{ _id: any }>()(buffer.slice(0, result[1]));
    if (out._id !== hex) throw new Error('MongoId roundtrip failed: ' + out._id);
    if (buffer[4] !== 0x07) throw new Error('expected ObjectId type byte 0x07, got ' + buffer[4]);
});

test('BSONValue UUID in any-field → BSON binary subtype 4', () => {
    const uuidStr = '0d4c97f2-1b3c-4d5e-8f7a-8b9c0d1e2f3a';
    const serializer = getBSONSerializer<{ v: any }>();
    const result = serializer({ v: new BSONValue(uuidStr, uuidType) });

    const expected = bson.serialize({ v: new bson.Binary(Buffer.from(uuidStr.replace(/-/g, ''), 'hex'), 4) });
    expectBytes(result, expected);

    const [buffer] = result;
    const out = getBSONDeserializer<{ v: any }>()(buffer.slice(0, result[1]));
    if (out.v !== uuidStr) throw new Error('UUID roundtrip failed: ' + out.v);
});

test('BSONValue BinaryBigInt in any-field → BSON binary, roundtrips', () => {
    const value = 123456789012345678901234567890n;
    const serializer = getBSONSerializer<{ v: any }>();
    const result = serializer({ v: new BSONValue(value, binaryBigIntType) });

    const [buffer] = result;
    // BSON binary type byte (0x05), not Long (0x12)
    if (buffer[4] !== 0x05) throw new Error('expected binary type byte 0x05, got ' + buffer[4]);

    const out = getBSONDeserializer<{ v: bigint & BinaryBigInt }>()(buffer.slice(0, result[1]));
    if (out.v !== value) throw new Error('BinaryBigInt roundtrip failed: ' + out.v);
});

test('raw Uint8Array in any-field → BSON binary subtype 0', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const serializer = getBSONSerializer<{ v: any }>();
    const result = serializer({ v: bytes });

    expectBytes(result, bson.serialize({ v: new bson.Binary(Buffer.from(bytes), 0) }));
});

test('BSONValue with null/undefined inner value', () => {
    const serializer = getBSONSerializer<{ a: any; b: any }>();
    // null → BSON null; undefined → omitted (matches official BSON behavior)
    const result = serializer({ a: new BSONValue(null, mongoIdType), b: new BSONValue(undefined, mongoIdType) });
    expectBytes(result, bson.serialize({ a: null }));
});

test('BSONValue nested inside an array and object', () => {
    const a = '5f1a2b3c4d5e6f7a8b9c0d1e';
    const b = 'aa1a2b3c4d5e6f7a8b9c0d1e';
    const serializer = getBSONSerializer<{ ids: any; nested: any }>();
    const result = serializer({
        ids: [new BSONValue(a, mongoIdType), new BSONValue(b, mongoIdType)],
        nested: { id: new BSONValue(a, mongoIdType) },
    });

    const expected = bson.serialize({
        ids: [new bson.ObjectId(a), new bson.ObjectId(b)],
        nested: { id: new bson.ObjectId(a) },
    });
    expectBytes(result, expected);
});
