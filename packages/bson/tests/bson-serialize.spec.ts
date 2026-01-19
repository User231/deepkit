import { expect, test } from '@jest/globals';
import bson from 'bson';
import { randomBytes } from 'crypto';

import { BinaryBigInt, Excluded, MongoId, PrimaryKey, Reference, SignedBinaryBigInt, UUID, createReference, hasCircularReference, nodeBufferToArrayBuffer, typeOf, uuid } from '@deepkit/type';

import { deserializeBSON, getBSONDeserializer } from '../src/bson-deserializer.js';
import { deserializeBSONWithoutOptimiser } from '../src/bson-parser.js';
import { AutoBuffer, getBSONSerializer, getBSONSizer, getValueSize, hexToByte, serializeBSONWithoutOptimiser, uuidStringToByte, wrapObjectId, wrapUUID, wrapValue } from '../src/bson-serializer.js';
import { BSONType, BSON_BINARY_SUBTYPE_DEFAULT } from '../src/utils.js';

const { Binary, calculateObjectSize, deserialize, Long, ObjectId: OfficialObjectId, UUID: OfficialUUID, serialize } = bson;

test('hexToByte', () => {
    expect(hexToByte('00')).toBe(0);
    expect(hexToByte('01')).toBe(1);
    expect(hexToByte('0f')).toBe(15);
    expect(hexToByte('10')).toBe(16);
    expect(hexToByte('ff')).toBe(255);
    expect(hexToByte('f0')).toBe(240);
    expect(hexToByte('50')).toBe(80);
    expect(hexToByte('7f')).toBe(127);
    expect(hexToByte('f00f', 1)).toBe(15);
    expect(hexToByte('f0ff', 1)).toBe(255);
    expect(hexToByte('f00001', 2)).toBe(1);

    expect(hexToByte('f8')).toBe(16 * 15 + 8);
    expect(hexToByte('41')).toBe(16 * 4 + 1);

    expect(uuidStringToByte('bef8de96-41fe-442f-b70c-c3a150f8c96c', 1)).toBe(16 * 15 + 8);
    expect(uuidStringToByte('bef8de96-41fe-442f-b70c-c3a150f8c96c', 4)).toBe(16 * 4 + 1);

    expect(uuidStringToByte('bef8de96-41fe-442f-b70c-c3a150f8c96c', 6)).toBe(16 * 4 + 4);
    expect(uuidStringToByte('bef8de96-41fe-442f-b70c-c3a150f8c96c', 7)).toBe(16 * 2 + 15);
    expect(uuidStringToByte('bef8de96-41fe-442f-b70c-c3a150f8c96c', 8)).toBe(16 * 11 + 7);
    expect(uuidStringToByte('bef8de96-41fe-442f-b70c-c3a150f8c96c', 10)).toBe(16 * 12 + 3);
    expect(uuidStringToByte('bef8de96-41fe-442f-b70c-c3a150f8c96c', 11)).toBe(16 * 10 + 1);
    expect(uuidStringToByte('bef8de96-41fe-442f-b70c-c3a150f8c96c', 15)).toBe(16 * 6 + 12);
});

test('basic string', () => {
    const object = { name: 'Peter' };

    const expectedSize =
        4 + //size uint32
        1 + // type (string)
        'name\0'.length +
        (4 + //string size uint32
            'Peter'.length +
            1) + //string content + null
        1; //object null
    expect(calculateObjectSize(object)).toBe(expectedSize);

    const schema = typeOf<{
        name: string;
    }>();

    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object).byteLength).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize(object));
});

test('basic number int', () => {
    const object = { position: 24 };

    const expectedSize =
        4 + //size uint32
        1 + // type (number)
        'position\0'.length +
        4 + //int uint32
        1; //object null
    expect(calculateObjectSize(object)).toBe(expectedSize);

    const schema = typeOf<{
        position: number;
    }>();

    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object).byteLength).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize(object));
});

test('basic long', () => {
    const object = { position: 3364367088039355000n };

    //23
    const expectedSize =
        4 + //size uint32
        1 + // type (number)
        'position\0'.length +
        (4 + //uint32 low bits
            4) + //uint32 high bits
        1; //object null
    const schema = typeOf<{
        position: number;
    }>();

    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object).byteLength).toBe(expectedSize);
    // expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize(object)); //mongo doesnt support bigint

    const serializer = getBSONSerializer(undefined, schema);
    // const deserializer = getBSONDecoder(schema);
    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    expect(serializer(object).byteLength).toBe(expectedSize);

    // const reParsed = getBSONDecoder<any>(schema)(serializer(object));
    // expect(reParsed.position).toBe(3364367088039355000n);

    expect(serializer({ position: 123456n })).toEqual(serialize({ position: Long.fromNumber(123456) }));
    expect(serializer({ position: -123456n })).toEqual(serialize({ position: Long.fromNumber(-123456) }));
    expect(serializer({ position: 3364367088039355000n })).toEqual(serialize({ position: Long.fromBigInt(3364367088039355000n) }));
    expect(serializer({ position: -3364367088039355000n })).toEqual(serialize({ position: Long.fromBigInt(-3364367088039355000n) }));

    // expect(deserializer(serializer({ position: 3364367088039355000n }))).toEqual({ position: 3364367088039355000n });
    // expect(deserializer(serializer({ position: -3364367088039355000n }))).toEqual({ position: -3364367088039355000n });
});

test('basic bigint', () => {
    const object = { position: 3364367088039355000n };

    const expectedSize =
        4 + //size uint32
        1 + // type (binary)
        'position\0'.length +
        (4 + //uint32 low bits
            4) + //uint32 high bits
        1; //object null
    const schema = typeOf<{
        position: bigint;
    }>();

    const serializer = getBSONSerializer(undefined, schema);
    // const deserializer = getBSONDecoder(schema);
    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    expect(serializer(object).byteLength).toBe(expectedSize);

    // const reParsed = deserializer(serializer(object));
    // expect(reParsed.position).toBe(3364367088039355000n);

    //this cases are valid when dynamic bigint serialization is activated
    // expect(serializer({ position: 123456n })).toEqual(serialize({ position: 123456 }));
    // expect(serializer({ position: -123456n })).toEqual(serialize({ position: -123456 }));
    // expect(serializer({ position: 3364367088039355000n })).toEqual(serialize({ position: Long.fromBigInt(3364367088039355000n) }));
    // expect(serializer({ position: -3364367088039355000n })).toEqual(serialize({ position: Long.fromBigInt(-3364367088039355000n) }));
    //
    // expect(serializer({ position: 9223372036854775807n })).toEqual(serialize({ position: Long.fromBigInt(9223372036854775807n) }));
    // expect(serializer({ position: -9223372036854775807n })).toEqual(serialize({ position: Long.fromBigInt(-9223372036854775807n) }));

    // expect(deserializer(serializer({ position: 123456n }))).toEqual({ position: 123456n });
    // expect(deserializer(serializer({ position: -123456n }))).toEqual({ position: -123456n });
    // expect(deserializer(serializer({ position: 3364367088039355000n }))).toEqual({ position: 3364367088039355000n });
    // expect(deserializer(serializer({ position: -3364367088039355000n }))).toEqual({ position: -3364367088039355000n });
    //
    // expect(deserializer(serializer({ position: 9223372036854775807n }))).toEqual({ position: 9223372036854775807n });
    // expect(deserializer(serializer({ position: -9223372036854775807n }))).toEqual({ position: -9223372036854775807n });
});

test('basic BinaryBigInt', () => {
    const object = { position: 3364367088039355000n };

    const expectedSize =
        4 + //size uint32
        1 + // type (binary)
        'position\0'.length +
        (4 + //binary size
            1 + //binary type
            8) + //binary content
        1; //object null
    const schema = typeOf<{
        position: BinaryBigInt;
    }>();

    const serializer = getBSONSerializer(undefined, schema);
    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    expect(serializer(object).byteLength).toBe(expectedSize);

    {
        const bson = serializer({ position: 9223372036854775810n }); //force binary format
        expect(bson).toEqual(
            Buffer.from([
                28,
                0,
                0,
                0, //size
                BSONType.BINARY, //type long
                112,
                111,
                115,
                105,
                116,
                105,
                111,
                110,
                0, //position\n string

                8,
                0,
                0,
                0, //binary size, int32
                BSON_BINARY_SUBTYPE_DEFAULT, //binary type

                128,
                0,
                0,
                0,
                0,
                0,
                0,
                2, //binary data

                0, //object null
            ]),
        );
    }

    {
        const bson = serializer({ position: -9223372036854775810n }); //force binary format
        expect(bson).toEqual(
            Buffer.from([
                28,
                0,
                0,
                0, //size
                BSONType.BINARY, //type long
                112,
                111,
                115,
                105,
                116,
                105,
                111,
                110,
                0, //position\n string

                8,
                0,
                0,
                0, //binary size, int32
                BSON_BINARY_SUBTYPE_DEFAULT, //binary type

                128,
                0,
                0,
                0,
                0,
                0,
                0,
                2, //binary data

                0, //object null
            ]),
        );
    }
});

test('basic SignedBinaryBigInt', () => {
    const object = { position: 3364367088039355000n };

    const expectedSize =
        4 + //size uint32
        1 + // type (binary)
        'position\0'.length +
        (4 + //binary size
            1 + //binary type
            9) + //binary content
        1; //object null
    const schema = typeOf<{
        position: SignedBinaryBigInt;
    }>();

    const serializer = getBSONSerializer(undefined, schema);
    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    expect(serializer(object).byteLength).toBe(expectedSize);

    {
        const bson = serializer({ position: 9223372036854775810n }); //force binary format
        expect(bson).toEqual(
            Buffer.from([
                29,
                0,
                0,
                0, //size
                BSONType.BINARY, //type long
                112,
                111,
                115,
                105,
                116,
                105,
                111,
                110,
                0, //position\n string

                9,
                0,
                0,
                0, //binary size, int32
                BSON_BINARY_SUBTYPE_DEFAULT, //binary type

                0, //signum
                128,
                0,
                0,
                0,
                0,
                0,
                0,
                2, //binary data

                0, //object null
            ]),
        );
    }

    {
        const bson = serializer({ position: -9223372036854775810n }); //force binary format
        expect(bson).toEqual(
            Buffer.from([
                29,
                0,
                0,
                0, //size
                BSONType.BINARY, //type long
                112,
                111,
                115,
                105,
                116,
                105,
                111,
                110,
                0, //position\n string

                9,
                0,
                0,
                0, //binary size, int32
                BSON_BINARY_SUBTYPE_DEFAULT, //binary type

                255, //signum, 255 = -1
                128,
                0,
                0,
                0,
                0,
                0,
                0,
                2, //binary data

                0, //object null
            ]),
        );
    }
});

// test('basic any bigint', () => {
//     const object = { position: 3364367088039355000n };
//
//     const expectedSize =
//             4 //size uint32
//             + 1 // type (binary)
//             + 'position\0'.length
//             + (
//                 4 //binary size
//                 + 1 //binary type
//                 + 9 //binary content
//             )
//             + 1 //object null
//     ;
//
//     const schema = t.schema({
//         position: t.any,
//     });
//
//     const serializer = getBSONSerializer(undefined, schema);
//     const deserializer = getBSONDecoder(schema);
//     expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
//     expect(serializer(object).byteLength).toBe(expectedSize);
//
//     const reParsed = getBSONDecoder(schema)(serializer(object));
//     expect(reParsed.position).toBe(3364367088039355000n);
//
//     expect(deserializer(serializer({ position: 123456n }))).toEqual({ position: 123456n });
//     expect(deserializer(serializer({ position: -123456n }))).toEqual({ position: -123456n });
//     expect(deserializer(serializer({ position: 3364367088039355000n }))).toEqual({ position: 3364367088039355000n });
//     expect(deserializer(serializer({ position: -3364367088039355000n }))).toEqual({ position: -3364367088039355000n });
//
//     expect(deserializer(serializer({ position: 9223372036854775807n }))).toEqual({ position: 9223372036854775807n });
//     expect(deserializer(serializer({ position: -9223372036854775807n }))).toEqual({ position: -9223372036854775807n });
//
//     {
//         const bson = serializer({ position: 9223372036854775810n }); //force binary format
//         expect(bson).toEqual(Buffer.from([
//             29, 0, 0, 0, //size
//             BSONType.BINARY, //type long
//             112, 111, 115, 105, 116, 105, 111, 110, 0, //position\n string
//
//             9, 0, 0, 0, //binary size, int32
//             BSON_BINARY_SUBTYPE_BIGINT, //binary type
//
//             1, //signum
//             128, 0, 0, 0, 0, 0, 0, 2, //binary data
//
//             0, //object null
//         ]));
//     }
//
//     {
//         const bson = serializer({ position: -9223372036854775810n }); //force binary format
//         expect(bson).toEqual(Buffer.from([
//             29, 0, 0, 0, //size
//             BSONType.BINARY, //type long
//             112, 111, 115, 105, 116, 105, 111, 110, 0, //position\n string
//
//             9, 0, 0, 0, //binary size, int32
//             BSON_BINARY_SUBTYPE_BIGINT, //binary type
//
//             255, //signum, 255 = -1
//             128, 0, 0, 0, 0, 0, 0, 2, //binary data
//
//             0, //object null
//         ]));
//     }
// });

// test('basic long bigint', () => {
//     const bla: { n: number, m: string }[] = [
//         { n: 1, m: '1' },
//         { n: 1 << 16, m: 'max uint 16' },
//         { n: (1 << 16) + 100, m: 'max uint 16 + 100' },
//         { n: 4294967296, m: 'max uint 32' },
//         { n: 4294967296 - 100, m: 'max uint 32 - 100' },
//         { n: 4294967296 - 1, m: 'max uint 32 - 1' },
//         { n: 4294967296 + 100, m: 'max uint 32 + 100' },
//         { n: 4294967296 + 1, m: 'max uint 32 + 1' },
//         { n: 4294967296 * 10 + 1, m: 'max uint 32 * 10 + 1' },
//         // {n: 9223372036854775807, m: 'max uint64'},
//         // {n: 9223372036854775807 + 1, m: 'max uint64 - 1'},
//         // {n: 9223372036854775807 - 1, m: 'max uint64 + 2'},
//     ];
//     for (const b of bla) {
//         const long = Long.fromNumber(b.n);
//         console.log(b.n, long.toNumber(), long, b.m);
//     }
// });

test('basic number double', () => {
    const object = { position: 149943944399 };

    const expectedSize =
        4 + //size uint32
        1 + // type (number)
        'position\0'.length +
        8 + //double, 64bit
        1; //object null
    const expectedSizeNull =
        4 + //size uint32
        1 + // type (number)
        'position\0'.length +
        0 + //undefined
        1; //object null
    expect(calculateObjectSize(object)).toBe(expectedSize);
    expect(calculateObjectSize({ position: null })).toBe(expectedSizeNull);
    expect(calculateObjectSize({ position: undefined })).toBe(5);

    const schema = typeOf<{
        position?: number;
    }>();

    expect(getBSONSerializer(undefined, schema)(object).byteLength).toBe(expectedSize);
    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize(object));

    expect(getBSONSerializer(undefined, schema)({ position: undefined }).byteLength).toBe(expectedSizeNull);
    expect(getBSONSerializer(undefined, schema)({}).byteLength).toBe(5);
});

test('basic boolean', () => {
    const object = { valid: true };

    const expectedSize =
        4 + //size uint32
        1 + // type (boolean)
        'valid\0'.length +
        1 + //boolean
        1; //object null
    expect(calculateObjectSize(object)).toBe(expectedSize);

    const schema = typeOf<{
        valid: boolean;
    }>();

    expect(getBSONSerializer(undefined, schema)(object).byteLength).toBe(expectedSize);
    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize(object));
});

test('basic date', () => {
    const object = { created: new Date() };

    const expectedSize =
        4 + //size uint32
        1 + // type (date)
        'created\0'.length +
        8 + //date
        1; //object null
    expect(calculateObjectSize(object)).toBe(expectedSize);

    const schema = typeOf<{
        created: Date;
    }>();

    const serializer = getBSONSerializer(undefined, schema);

    // expect(serializer(object).byteLength).toBe(expectedSize);
    // expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    // expect(serializer(object)).toEqual(serialize(object));

    expect(serializer({ created: new Date('2900-10-12T00:00:00.000Z') })).toEqual(serialize({ created: new Date('2900-10-12T00:00:00.000Z') }));
    expect(serializer({ created: new Date('1900-10-12T00:00:00.000Z') })).toEqual(serialize({ created: new Date('1900-10-12T00:00:00.000Z') }));
    expect(serializer({ created: new Date('1000-10-12T00:00:00.000Z') })).toEqual(serialize({ created: new Date('1000-10-12T00:00:00.000Z') }));

    // const deserializer = getBSONDecoder(schema);
    // expect(deserializer(serializer({ created: new Date('2900-10-12T00:00:00.000Z') }))).toEqual({ created: new Date('2900-10-12T00:00:00.000Z') });
    // expect(deserializer(serializer({ created: new Date('1900-10-12T00:00:00.000Z') }))).toEqual({ created: new Date('1900-10-12T00:00:00.000Z') });
    // expect(deserializer(serializer({ created: new Date('1000-10-12T00:00:00.000Z') }))).toEqual({ created: new Date('1000-10-12T00:00:00.000Z') });
});

test('basic binary', () => {
    const object = { binary: new Uint16Array(32) };

    const expectedSize =
        4 + //size uint32
        1 + // type (date)
        'binary\0'.length +
        (4 + //size of binary, uin32
            1 + //sub type
            32 * 2) + //size of data
        1; //object null
    expect(new Uint16Array(32).byteLength).toBe(32 * 2);

    //this doesn't support typed arrays
    // expect(calculateObjectSize(object)).toBe(expectedSize);

    const schema = typeOf<{
        binary: Uint16Array;
    }>();

    expect(getBSONSerializer(undefined, schema)(object).byteLength).toBe(expectedSize);
    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);

    //doesnt support typed arrays
    // expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize(object));

    // expect(getBSONDecoder(schema)(getBSONSerializer(undefined, schema)(object))).toEqual(object);
});

test('basic arrayBuffer', () => {
    const arrayBuffer = new ArrayBuffer(5);
    const view = new Uint8Array(arrayBuffer);
    view[0] = 22;
    view[1] = 44;
    view[2] = 55;
    view[3] = 66;
    view[4] = 77;
    const object = { binary: arrayBuffer };

    const expectedSize =
        4 + //size uint32
        1 + // type (date)
        'binary\0'.length +
        (4 + //size of binary, uin32
            1 + //sub type
            5) + //size of data
        1; //object null
    // expect(calculateObjectSize(object)).toBe(expectedSize);

    const schema = typeOf<{
        binary: ArrayBuffer;
    }>();

    expect(getBSONSerializer(undefined, schema)(object).byteLength).toBe(expectedSize);
    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    // expect(getBSONDecoder(schema)(getBSONSerializer(undefined, schema)(object))).toEqual(object);
    // expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize(object));
});

test('basic Buffer', () => {
    const object = { binary: new Uint8Array(32) };

    const expectedSize =
        4 + //size uint32
        1 + // type (date)
        'binary\0'.length +
        (4 + //size of binary, uin32
            1 + //sub type
            32) + //size of data
        1; //object null
    // expect(calculateObjectSize(object)).toBe(expectedSize);

    const schema = typeOf<{
        binary: Uint8Array;
    }>();

    expect(getBSONSerializer(undefined, schema)(object).byteLength).toBe(expectedSize);
    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    // expect(getBSONDecoder(schema)(getBSONSerializer(undefined, schema)(object))).toEqual(object);

    Buffer.alloc(2);
    Buffer.alloc(200);
    Buffer.alloc(20000);

    // expect(getBSONDecoder(schema)(getBSONSerializer(undefined, schema)({
    //     binary: Buffer.alloc(44)
    // }))).toEqual({
    //     binary: new Uint8Array(44)
    // });
});

test('basic uuid', () => {
    const uuidRandomBinary = new Binary(Buffer.allocUnsafe(16), Binary.SUBTYPE_UUID);

    const object = { uuid: '75ed2328-89f2-4b89-9c49-1498891d616d' };

    const expectedSize =
        4 + //size uint32
        1 + // type (date)
        'uuid\0'.length +
        (4 + //size of binary
            1 + //sub type
            16) + //content of uuid
        1; //object null
    expect(calculateObjectSize({ uuid: uuidRandomBinary })).toBe(expectedSize);

    const schema = typeOf<{
        uuid: UUID;
    }>();

    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object).byteLength).toBe(expectedSize);

    const uuidPlain = Buffer.from([0x75, 0xed, 0x23, 0x28, 0x89, 0xf2, 0x4b, 0x89, 0x9c, 0x49, 0x14, 0x98, 0x89, 0x1d, 0x61, 0x6d]);
    const uuidBinary = new Binary(uuidPlain, 4);
    const objectBinary = {
        uuid: uuidBinary,
    };

    expect(getBSONSerializer(undefined, schema)(object).byteLength).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize(objectBinary));

    // const bson = serialize(objectBinary);
    // const parsed = parseObject(new ParserV2(bson));
    // expect(parsed.uuid).toBe('75ed2328-89f2-4b89-9c49-1498891d616d');
});

test('basic objectId', () => {
    const object = { _id: '507f191e810c19729de860ea' };

    const expectedSize =
        4 + //size uint32
        1 + // type
        '_id\0'.length +
        12 + //size of objectId
        1; //object null
    const nativeBson = { _id: new OfficialObjectId('507f191e810c19729de860ea') };
    expect(calculateObjectSize(nativeBson)).toBe(expectedSize);

    const schema = typeOf<{
        _id: MongoId;
    }>();

    expect(getBSONSerializer(undefined, schema)(object).byteLength).toBe(expectedSize);
    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize(nativeBson));
});

test('basic nested', () => {
    const object = { name: { anotherOne: 'Peter2' } };

    const expectedSize =
        4 + //size uint32
        1 + //type (object)
        'name\0'.length +
        (4 + //size uint32
            1 + //type (object)
            'anotherOne\0'.length +
            (4 + //string size uint32
                'Peter2'.length +
                1) + //string content + null
            1) + //object null
        1; //object null
    expect(calculateObjectSize(object)).toBe(expectedSize);

    const schema = typeOf<{
        name: {
            anotherOne: string;
        };
    }>();

    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize(object));
});

test('basic map', () => {
    const object = { name: new Map([['abc', 'Peter']]) };

    const expectedSize =
        4 + //size uint32
        1 + //type (array)
        'name\0'.length +
        (4 + //size uint32 of array
            1 + //type (array)
            '0\0'.length + //key
            (4 + //size uint32 of array
                1 + //type (string)
                '0\0'.length + //key
                (4 + //string size uint32
                    'abc'.length +
                    1) + //string content + null
                1 + //type (string)
                '1\0'.length + //key
                (4 + //string size uint32
                    'Peter'.length +
                    1) + //string content + null
                1) + //object null
            1) + //object null
        1; //object null
    expect(calculateObjectSize({ name: [['abc', 'Peter']] })).toBe(expectedSize);

    const schema = typeOf<{
        name: Map<string, string>;
    }>();

    const sizer = getBSONSizer(undefined, schema);
    expect(sizer(object)).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object).byteLength).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize({ name: [['abc', 'Peter']] }));
});

test('basic set', () => {
    const object = { name: new Set(['abc', 'Peter']) };

    const expectedSize =
        4 + //size uint32
        1 + //type (array)
        'name\0'.length +
        (4 + //size uint32 of array
            1 + //type (string)
            '0\0'.length + //key
            (4 + //string size uint32
                'abc'.length +
                1) + //string content + null
            1 + //type (string)
            '1\0'.length + //key
            (4 + //string size uint32
                'Peter'.length +
                1) + //string content + null
            1) + //object null
        1; //object null
    expect(calculateObjectSize({ name: ['abc', 'Peter'] })).toBe(expectedSize);
    expect(getValueSize({ name: ['abc', 'Peter'] })).toBe(expectedSize);

    const schema = typeOf<{
        name: Set<string>;
    }>();

    expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object).byteLength).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize({ name: ['abc', 'Peter'] }));
});

test('basic array', () => {
    const object = { name: ['Peter3'] };

    const expectedSize =
        4 + //size uint32
        1 + //type (array)
        'name\0'.length +
        (4 + //size uint32 of array
            1 + //type (string)
            '0\0'.length + //key
            (4 + //string size uint32
                'Peter3'.length +
                1) + //string content + null
            1) + //object null
        1; //object null
    expect(calculateObjectSize(object)).toBe(expectedSize);
    expect(getValueSize(object)).toBe(expectedSize);

    const schema = typeOf<{
        name: string[];
    }>();

    const sizer = getBSONSizer(undefined, schema);
    const serialize = getBSONSerializer(undefined, schema);
    expect(sizer(object)).toBe(expectedSize);
    expect(serialize(object).byteLength).toBe(expectedSize);
    expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize(object));
});

// test('number', () => {
//     const object = { name: 'Peter4', tags: ['a', 'b', 'c'], priority: 15, position: 149943944399, valid: true, created: new Date() };
//
//     const schema = t.schema({
//         name: t.string,
//         tags: t.array(t.string),
//         priority: t.number,
//         position: t.number,
//         valid: t.boolean,
//         created: t.date,
//     });
//
//     expect(getBSONSizer(undefined, schema)(object)).toBe(calculateObjectSize(object));
//     expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize(object));
// });
//
test('all supported base types', () => {
    const object = { name: 'Peter4', tags: ['a', 'b', 'c'], priority: 15, position: 149943944399, valid: true, created: new Date() };

    const schema = typeOf<{
        name: string;
        tags: string[];
        priority: number;
        position: number;
        valid: boolean;
        created: Date;
    }>();

    expect(getBSONSizer(undefined, schema)(object)).toBe(calculateObjectSize(object));
    expect(getBSONSerializer(undefined, schema)(object)).toEqual(serialize(object));
});

// test('string utf8', () => {
//     const schema = typeOf<{
//         name: string,
//         any: any
//     }>();
//
//     const serialize = getBSONSerializer(undefined, schema);
//     const parse = getBSONDecoder(schema);
//
//     expect(parse(serialize({ name: 'Peter' }))).toEqual({ name: 'Peter' });
//     expect(parse(serialize({ name: 'Peter✌️' }))).toEqual({ name: 'Peter✌️' });
//     expect(parse(serialize({ name: '✌️' }))).toEqual({ name: '✌️' });
//     expect(parse(serialize({ name: '🌉' }))).toEqual({ name: '🌉' });
//     expect(parse(serialize({ name: 'πøˆ️' }))).toEqual({ name: 'πøˆ️' });
//     expect(parse(serialize({ name: 'Ѓ' }))).toEqual({ name: 'Ѓ' });
//     expect(parse(serialize({ name: '㒨' }))).toEqual({ name: '㒨' });
//     expect(parse(serialize({ name: '﨣' }))).toEqual({ name: '﨣' });
//
//     expect(parse(serialize({ any: { base: true } }))).toEqual({ any: { base: true } });
//     expect(parse(serialize({ any: { '✌️': true } }))).toEqual({ any: { '✌️': true } });
//     expect(parse(serialize({ any: { 'Ѓ': true } }))).toEqual({ any: { 'Ѓ': true } });
//     expect(parse(serialize({ any: { 㒨: true } }))).toEqual({ any: { 㒨: true } });
//     expect(parse(serialize({ any: { 﨣: true } }))).toEqual({ any: { 﨣: true } });
// });

test('optional field', () => {
    const schema = typeOf<{
        find: string;
        batchSize: number;
        limit?: number;
        skip?: number;
    }>();

    const findSerializer = getBSONSerializer(undefined, schema);
    const bson = findSerializer({
        find: 'user',
        batchSize: 1,
        limit: 1,
    });

    const bsonOfficial = serialize({
        find: 'user',
        batchSize: 1,
        limit: 1,
    });

    expect(bson).toEqual(bsonOfficial);
});

test('complex', () => {
    const schema = typeOf<{
        find: string;
        batchSize: number;
        limit?: number;
        filter: any;
        projection: any;
        sort: any;
        skip?: number;
    }>();

    const findSerializer = getBSONSerializer(undefined, schema);

    const bson = findSerializer({
        find: 'user',
        batchSize: 1,
        limit: 1,
    });
    const bsonOfficial = serialize({
        find: 'user',
        batchSize: 1,
        limit: 1,
    });

    expect(bson).toEqual(bsonOfficial);
});

//for the moment, bson does not support embedded
// test('embedded', () => {
//     class DecoratedValue {
//         constructor(public items: string[] = []) {
//         }
//     }
//
//     const object = { v: new DecoratedValue(['Peter3']) };
//
//     const expectedSize =
//             4 //size uint32
//             + 1 //type (array)
//             + 'v\0'.length
//             + (
//                 4 //size uint32 of array
//                 + 1 //type (string)
//                 + '0\0'.length //key
//                 + (
//                     4 //string size uint32
//                     + 'Peter3'.length + 1 //string content + null
//                 )
//                 + 1 //object null
//             )
//             + 1 //object null
//     ;
//
//     expect(calculateObjectSize({ v: ['Peter3'] })).toBe(expectedSize);
//
//     const schema = typeOf<{
//         v: Embedded<DecoratedValue>
//     }>();
//
//     const bson = getBSONSerializer(undefined, schema)(object);
//
//     const officialDeserialize = deserialize(Buffer.from(bson));
//     expect(officialDeserialize.v).toEqual(['Peter3']);
//
//     expect(bson.byteLength).toBe(expectedSize);
//     expect(getBSONSizer(undefined, schema)(object)).toBe(expectedSize);
//
//     expect(bson).toEqual(serialize({ v: ['Peter3'] }));
//
//     // const back = getBSONDecoder(schema)(bson);
//     // expect(back.v).toBeInstanceOf(DecoratedValue);
//     // expect(back.v.items).toEqual(['Peter3']);
//     // expect(back).toEqual(object);
// });

test('reference', () => {
    class Entity {
        public id: number & PrimaryKey = 0;

        constructor(public title: string) {}
    }

    const object = { v: createReference(Entity, { id: 5 }) };

    const expectedSize =
        4 + //size uint32
        1 + //type (number)
        'v\0'.length +
        4 + //int uint32
        1; //object null
    expect(calculateObjectSize({ v: 5 })).toBe(expectedSize);

    const schema = typeOf<{
        v: Entity & Reference;
    }>();

    const sizer = getBSONSizer(undefined, schema);
    expect(sizer(object)).toBe(expectedSize);
    const bson = getBSONSerializer(undefined, schema)(object);

    const officialDeserialize = deserialize(Buffer.from(bson));
    expect(officialDeserialize.v).toEqual(5);

    expect(bson.byteLength).toBe(expectedSize);

    expect(bson).toEqual(serialize({ v: 5 }));

    // const back = getBSONDecoder(schema)(bson);
    // expect(back.v).toBeInstanceOf(DecoratedValue);
    // expect(back.v.items).toEqual(['Peter3']);
    // expect(back).toEqual(object);
});

test('deep reference', () => {
    class Entity {
        public id: number & PrimaryKey = 0;

        constructor(public title: string) {}
    }

    const object = { v: { item: createReference(Entity, { id: 5 }) } };

    const schema = typeOf<{
        v: { item: Entity & Reference };
    }>();

    const bson = getBSONSerializer(undefined, schema)(object);

    const officialDeserialize = deserialize(Buffer.from(bson));
    expect(officialDeserialize.v.item).toEqual(5);

    expect(bson).toEqual(serialize({ v: { item: 5 } }));

    // const back = getBSONDecoder(schema)(bson);
    // expect(back.v).toBeInstanceOf(DecoratedValue);
    // expect(back.v.items).toEqual(['Peter3']);
    // expect(back).toEqual(object);
});

test('bson length', () => {
    const nonce = randomBytes(24);

    const SaslStartCommand = typeOf<{
        saslStart: 1;
        $db: string;
        mechanism: string;
        payload: Uint8Array;
        autoAuthorize: 1;
        options: {
            skipEmptyExchange: true;
        };
    }>();

    const message = {
        saslStart: 1,
        $db: 'admin',
        mechanism: 'SCRAM-SHA-1',
        payload: Buffer.concat([Buffer.from('n,,', 'utf8'), Buffer.from(`n=Peter,r=${nonce.toString('base64')}`, 'utf8')]),
        autoAuthorize: 1,
        options: { skipEmptyExchange: true },
    };

    expect(message.payload.byteLength).toBe(13 + nonce.toString('base64').length);

    const size = getBSONSizer(undefined, SaslStartCommand)(message);
    expect(size).toBe(calculateObjectSize(message));

    const bson = getBSONSerializer(undefined, SaslStartCommand)(message);

    expect(bson).toEqual(serialize(message));
});

test('arrayBuffer', () => {
    const schema = typeOf<{
        name: string;
        secondId: MongoId;
        preview: ArrayBuffer;
    }>();

    const message = {
        name: 'myName',
        secondId: '5bf4a1ccce060e0b38864c9e',
        preview: nodeBufferToArrayBuffer(Buffer.from('Baar', 'utf8')),
    };

    expect(Buffer.from(message.preview).toString('utf8')).toBe('Baar');

    const mongoMessage = {
        name: message.name,
        secondId: new OfficialObjectId(message.secondId),
        preview: new Binary(Buffer.from(message.preview)),
    };
    const size = getBSONSizer(undefined, schema)(message);
    expect(size).toBe(calculateObjectSize(mongoMessage));

    const bson = getBSONSerializer(undefined, schema)(message);

    expect(bson).toEqual(serialize(mongoMessage));

    // const back = getBSONDecoder(schema)(bson);
    // expect(Buffer.from(back.preview).toString('utf8')).toBe('Baar');
    // expect(back.preview).toEqual(message.preview);
});

test('typed array', () => {
    const schema = typeOf<{
        name: string;
        secondId: MongoId;
        preview: Uint16Array;
    }>();

    const message = {
        name: 'myName',
        secondId: '5bf4a1ccce060e0b38864c9e',
        preview: new Uint16Array(nodeBufferToArrayBuffer(Buffer.from('LAA3AEIATQBYAA==', 'base64'))), //44, 55, 66, 77, 88
    };

    expect(message.preview).toBeInstanceOf(Uint16Array);
    expect(message.preview.byteLength).toBe(10);

    const mongoMessage = {
        name: message.name,
        secondId: new OfficialObjectId(message.secondId),
        preview: new Binary(Buffer.from(new Uint8Array(message.preview.buffer, message.preview.byteOffset, message.preview.byteLength))),
    };
    const size = getBSONSizer(undefined, schema)(message);
    expect(size).toBe(calculateObjectSize(mongoMessage));

    const bson = getBSONSerializer(undefined, schema)(message);

    expect(bson).toEqual(serialize(mongoMessage));

    // const back = getBSONDecoder(schema)(bson);
    // expect(back.preview).toEqual(message.preview);
});

test('union string | number', () => {
    const schema = typeOf<{
        v: string | number;
    }>();

    expect(getBSONSizer(undefined, schema)({ v: 'abc' })).toBe(calculateObjectSize({ v: 'abc' }));
    expect(getBSONSizer(undefined, schema)({ v: 2 })).toBe(calculateObjectSize({ v: 3 }));

    expect(getBSONSerializer(undefined, schema)({ v: 'abc' })).toEqual(serialize({ v: 'abc' }));
    expect(getBSONSerializer(undefined, schema)({ v: 2 })).toEqual(serialize({ v: 2 }));
});

test('union number | class', () => {
    class MyClass {
        id: number = 0;
    }

    const schema = typeOf<{
        v: number | MyClass;
    }>();

    expect(getBSONSizer(undefined, schema)({ v: { id: 5 } })).toBe(calculateObjectSize({ v: { id: 5 } }));
    expect(getBSONSizer(undefined, schema)({ v: 2 })).toBe(calculateObjectSize({ v: 3 }));

    expect(getBSONSerializer(undefined, schema)({ v: { id: 5 } })).toEqual(serialize({ v: { id: 5 } }));
    expect(getBSONSerializer(undefined, schema)({ v: 2 })).toEqual(serialize({ v: 2 }));
});

test('index signature', () => {
    const schema = typeOf<{
        [name: string]: number;
    }>();

    expect(getValueSize({ a: 5 })).toBe(calculateObjectSize({ a: 5 }));
    expect(getBSONSizer(undefined, schema)({ a: 5 })).toBe(calculateObjectSize({ a: 5 }));
    expect(getBSONSizer(undefined, schema)({ a: 5, b: 6 })).toBe(calculateObjectSize({ a: 5, b: 6 }));

    expect(getBSONSerializer(undefined, schema)({ a: 5 })).toEqual(serialize({ a: 5 }));
    expect(getBSONSerializer(undefined, schema)({ a: 5, b: 6 })).toEqual(serialize({ a: 5, b: 6 }));
});

test('index signature + properties', () => {
    const schema = typeOf<{
        id: number;
        [name: string]: number | string;
    }>();

    expect(getBSONSizer(undefined, schema)({ id: 1, a: 5 })).toBe(calculateObjectSize({ id: 1, a: 5 }));
    expect(getBSONSizer(undefined, schema)({ id: 1, a: 5, b: 6 })).toBe(calculateObjectSize({ id: 1, a: 5, b: 6 }));

    expect(getBSONSerializer(undefined, schema)({ id: 1, a: 5 })).toEqual(serialize({ id: 1, a: 5 }));
    expect(getBSONSerializer(undefined, schema)({ id: 1, a: 5, b: 6 })).toEqual(serialize({ id: 1, a: 5, b: 6 }));
});

test('exclude', () => {
    const schema = typeOf<{
        id: number;
        password: string & Excluded;
    }>();

    expect(getBSONSizer(undefined, schema)({ id: 1, password: 'asdasd' })).toBe(calculateObjectSize({ id: 1 }));
    expect(getBSONSerializer(undefined, schema)({ id: 1, password: 'asdasd' })).toEqual(serialize({ id: 1 }));
});

test('promise', () => {
    const schema = typeOf<{
        id: Promise<number>;
    }>();

    expect(getBSONSizer(undefined, schema)({ id: 1 })).toBe(calculateObjectSize({ id: 1 }));
    expect(getBSONSerializer(undefined, schema)({ id: 1 })).toEqual(serialize({ id: 1 }));
});

test('regepx', () => {
    const schema = typeOf<{
        id: RegExp;
    }>();

    expect(getBSONSizer(undefined, schema)({ id: /asd/g })).toBe(calculateObjectSize({ id: /asd/g }));
    expect(getBSONSerializer(undefined, schema)({ id: /asd/g })).toEqual(serialize({ id: /asd/g }));
});

test('typed any and undefined', () => {
    const schema = typeOf<{
        data: any;
    }>();

    const message = {
        data: {
            $set: {},
            $inc: undefined,
        },
    };

    // expect(getValueSize({ $inc: undefined })).toBe(calculateObjectSize({ $inc: undefined })); //official BSON does not include undefined values, but we do
    expect(getValueSize({ $inc: [undefined] })).toBe(calculateObjectSize({ $inc: [undefined] }));

    // const size = getBSONSizer(undefined, schema)(message);
    // expect(size).toBe(calculateObjectSize(message)); //official bson doesnt include undefined

    //todo: not sure what the expectation here was
    const bson = getBSONSerializer(undefined, schema)(message);
    // expect(bson).toEqual(serialize(message)); //official bson doesnt include undefined

    // const back = getBSONDecoder(schema)(bson);
    // expect(back.data.$set).toEqual({});
    // expect(back.data.$inc).toEqual(undefined);
    // expect('$inc' in back.data).toEqual(true);
});

test('Excluded', () => {
    class Model {
        id: UUID & PrimaryKey = uuid();

        excludedForMongo: string & Excluded<'bson'> = 'excludedForMongo';

        constructor(public name: string) {}
    }

    const model = new Model('asd');

    interface Message {
        insert: string;
        $db: string;
        documents: Model[];
    }

    const fn = getBSONSerializer<Message>();
    const bson = fn({ insert: 'a', $db: 'b', documents: [model] });

    const back = deserializeBSONWithoutOptimiser(bson);
    expect(back.documents[0].name).toBe('asd');
    expect(back.documents[0].excludedForMongo).toBeUndefined();
});

test('complex recursive', () => {
    class ModuleApi {
        api?: ModuleApi;

        imports: ModuleApi[] = [];

        constructor(public name: string) {}
    }

    const data = {
        name: 'a',
        api: {
            imports: [],
            name: 'a2',
        },
        imports: [
            {
                name: 'b',
                api: {
                    imports: [],
                    name: 'b2',
                },
                imports: [
                    {
                        imports: [],
                        name: 'c',
                    },
                ],
            },
        ],
    };
    const fn = getBSONSerializer<ModuleApi>();

    {
        const bson = fn(data);
        console.log('first', Buffer.from(bson).toString('hex'));
        const back1 = deserializeBSONWithoutOptimiser(bson);
        console.log('back 1', back1);
        expect(back1).toEqual(data);
    }

    {
        const bson = fn(data);
        console.log('second', Buffer.from(bson).toString('hex'));
        const back1 = deserializeBSONWithoutOptimiser(bson);
        console.log('back 1', back1);
        expect(back1).toEqual(data);
    }

    {
        const bson = fn(data);
        const back1 = deserializeBSON<ModuleApi>(bson);
        console.log('back 1', back1);
        expect(back1).toEqual(data);
    }
});

test('circular', () => {
    interface Model {
        id: number;
        another?: Model;
    }

    expect(hasCircularReference(typeOf<Model>())).toBe(true);
    const schema = typeOf<Model>();

    {
        const model: Model = { id: 1 };
        const model2: Model = { id: 2 };
        model.another = model2;

        const sizer = getBSONSizer(undefined, schema);
        const serialize = getBSONSerializer(undefined, schema);
        const bson = serialize(model);
        const back = deserializeBSONWithoutOptimiser(bson);
        expect(back).toEqual(model);
    }
});

test('string', () => {
    {
        const value = { v: 'a' };
        type T = { v: string };
        const sizer = getBSONSizer<T>();
        expect(sizer(value)).toBe(getValueSize(value));
        const serialize = getBSONSerializer<T>();
        const bson = serialize(value);
        const back = deserializeBSONWithoutOptimiser(bson);
        expect(back).toEqual(value);
    }
});

test('array', () => {
    {
        const value = { v: ['a', 'b'] };
        type T = { v: string[] };
        const sizer = getBSONSizer<T>();
        expect(sizer(value)).toBe(getValueSize(value));
        const serialize = getBSONSerializer<T>();
        const bson = serialize(value);
        const back = deserializeBSONWithoutOptimiser(bson);
        expect(back).toEqual(value);
    }
});

test('set', () => {
    {
        const value = { v: new Set(['a', 'b']) };
        type T = { v: Set<string> };
        const sizer = getBSONSizer<T>();
        expect(sizer(value)).toBe(getValueSize({ v: ['a', 'b'] }));
        const serialize = getBSONSerializer<T>();
        const bson = serialize(value);
        const back = deserializeBSONWithoutOptimiser(bson);
        expect(back).toEqual({ v: ['a', 'b'] });
        const back2 = getBSONDeserializer<T>()(bson);
        expect(back2).toEqual(value);
    }
});

test('undefined for required string', () => {
    type T = { name: string };

    const user = { name: undefined };

    const serialize = getBSONSerializer<T>();
    expect(() => serialize(user)).toThrow('Cannot convert undefined to string');

    const deserialize = getBSONDeserializer<T>();
    const bson = serializeBSONWithoutOptimiser(user);
    expect(deserialize(bson)).toEqual({ name: '' });
});

test('undefined for required number', () => {
    type T = { id: number };

    const user = { id: undefined };

    const serialize = getBSONSerializer<T>();
    expect(() => serialize(user)).toThrow('Cannot convert undefined to number');

    const deserialize = getBSONDeserializer<T>();
    const bson = serializeBSONWithoutOptimiser(user);
    expect(deserialize(bson)).toEqual({ id: 0 });
});

test('undefined for required object', () => {
    type T = { set: { id: number } };

    const user = { set: undefined };

    const serialize = getBSONSerializer<T>();
    expect(() => serialize(user)).toThrow('Cannot convert undefined to {id: number}');

    const deserialize = getBSONDeserializer<T>();
    const bson = serializeBSONWithoutOptimiser(user);
    expect(() => deserialize(bson)).toThrow('Cannot convert bson type UNDEFINED to {id: number}');
});

test('wrapValue', () => {
    {
        const objectId = wrapValue<MongoId>('507f191e810c19729de860ea');
        const bson = serializeBSONWithoutOptimiser({ v: objectId });
        const back = deserialize(bson);
        expect(back.v).toBeInstanceOf(OfficialObjectId);
        expect(back.v.toHexString()).toBe('507f191e810c19729de860ea');
    }
    {
        const objectId = wrapValue<MongoId>('507f191e810c19729de860ea');
        const serialize = getBSONSerializer<{ v: any }>();
        const bson = serialize({ v: objectId });
        const back = deserialize(bson);
        expect(back.v).toBeInstanceOf(OfficialObjectId);
        expect(back.v.toHexString()).toBe('507f191e810c19729de860ea');
    }
    {
        const objectId = wrapObjectId('507f191e810c19729de860ea');
        const bson = serializeBSONWithoutOptimiser({ v: objectId });
        const back = deserialize(bson);
        expect(back.v).toBeInstanceOf(OfficialObjectId);
        expect(back.v.toHexString()).toBe('507f191e810c19729de860ea');
    }
    {
        const uuid1 = wrapUUID(uuid());
        const bson = serializeBSONWithoutOptimiser({ v: uuid1 });
        const back = deserialize(bson);
        expect(back.v).toBeInstanceOf(OfficialUUID);
        expect(back.v.toHexString()).toBe(uuid1.value);
    }
});

test('utf16 surrogate pair', () => {
    const comment = 'Hehe, yes. Baby’s first collar \uD83E\uDD2D';

    {
        const bson1 = serialize({ v: comment });
        const bson2 = Buffer.from(serializeBSONWithoutOptimiser({ v: comment }));
        expect(bson1.toString('hex')).toBe(bson2.toString('hex'));

        const back1 = deserialize(bson1);
        const back2 = deserializeBSONWithoutOptimiser(bson1);
        expect(back1.v).toBe(comment);
        expect(back2.v).toBe(comment);
    }

    {
        const bson = serialize({ comment });
        const back = deserialize(bson);
        expect(back.comment).toBe(comment);
    }
    {
        const bson = serialize({ comment });
        const back = deserializeBSONWithoutOptimiser(bson);
        expect(back.comment).toBe(comment);
    }

    {
        const bson = serializeBSONWithoutOptimiser({ comment });
        const back = deserialize(bson);
        expect(back.comment).toBe(comment);
    }
    {
        const bson = serializeBSONWithoutOptimiser({ comment });
        const back = deserializeBSONWithoutOptimiser(bson);
        expect(back.comment).toBe(comment);
    }
    {
        const bson = getBSONSerializer<{ comment: string }>()({ comment });
        const back = getBSONDeserializer<{ comment: string }>()(bson);
        expect(back.comment).toBe(comment);
    }

    {
        const o = {
            comment: 'Hehe, yes. Baby’s first collar \uD83E\uDD2D',
        };
        const bson = serialize(o);
        const back1 = deserialize(bson);
        const back2 = deserializeBSONWithoutOptimiser(bson);
        expect(back1).toEqual(o);
        expect(back2).toEqual(o);
    }
});

test('null for optional', () => {
    {
        const bson = serialize({ v: null });
        const back = getBSONDeserializer<{ v?: string }>()(bson);
        expect(back.v).toBe(undefined);
    }
    {
        const bson = getBSONSerializer<{ v?: string }>()({ v: null });
        const back = deserialize(bson);
        // undefined is serialized as null
        expect(back.v).toBe(null);
        const back2 = deserializeBSONWithoutOptimiser(bson);
        expect(back2.v).toBe(null);
        const back3 = getBSONDeserializer<{ v?: string }>()(bson);
        expect(back3.v).toBe(undefined);
    }
});

test('NaN roundtrip to 0', () => {
    {
        // official behaviour is to serialize NaN to NaN
        const bson = serialize({ v: NaN });
        const back = deserialize(bson);
        expect(back.v).toBe(NaN);
    }
    {
        const bson = serialize({ v: NaN });
        const back = deserializeBSONWithoutOptimiser(bson);
        expect(back.v).toBe(0);
    }
    {
        const bson = serialize({ v: NaN });
        const back = getBSONDeserializer<{ v: number }>()(bson);
        expect(back.v).toBe(0);
    }
});

test('NaN serialization with typed serializer (#573)', () => {
    // Issue #573: NaN should be serialized as 0, not skipped
    // Previously NaN was skipped entirely, causing the property to become undefined

    interface Model {
        value: number;
    }

    const serializer = getBSONSerializer<Model>();
    const deserializer = getBSONDeserializer<Model>();

    // Test that NaN is serialized (not skipped) and deserialized as 0
    const obj: Model = { value: NaN };
    const bson = serializer(obj);
    const back = deserializer(bson);

    // NaN should become 0, not undefined
    expect(back.value).toBe(0);

    // Verify the property exists in BSON (not skipped)
    const rawBack = deserializeBSONWithoutOptimiser(bson);
    expect('value' in rawBack).toBe(true);
    expect(rawBack.value).toBe(0);
});

test('NaN in nested objects and arrays (#573)', () => {
    interface NestedModel {
        data: {
            score: number;
            values: number[];
        };
    }

    const serializer = getBSONSerializer<NestedModel>();
    const deserializer = getBSONDeserializer<NestedModel>();

    const obj: NestedModel = {
        data: {
            score: NaN,
            values: [1, NaN, 3],
        },
    };

    const bson = serializer(obj);
    const back = deserializer(bson);

    expect(back.data.score).toBe(0);
    expect(back.data.values).toEqual([1, 0, 3]);
});

test('utf8', () => {
    const messages = {
        '— feel free to": "— それまでご自由に': '— feel free to": "— それまでご自由に',
        'Schoolismの1年間のサブスクリプションを勝つチャンスを得るために、ツアーを必ず完全に終了してください！ 体験は約10分で完了します':
            'Schoolismの1年間のサブスクリプションを勝つチャンスを得るために、ツアーを必ず完全に終了してください！ 体験は約10分で完了します',
    };

    for (const [_, msg] of Object.entries(messages)) {
        {
            const bson = serialize({ msg });
            const back = deserialize(bson);
            expect(back.msg).toBe(msg);
        }

        {
            const bson = serialize({ msg });
            const back = deserializeBSONWithoutOptimiser(bson);
            expect(back.msg).toBe(msg);
        }

        {
            const bson = getBSONSerializer<{ msg: string }>()({ msg });
            const back = deserializeBSONWithoutOptimiser(bson);
            expect(back.msg).toBe(msg);
        }
        {
            const bson = getBSONSerializer<{ msg: string }>()({ msg });
            const back = getBSONDeserializer<{ msg: string }>()(bson);
            expect(back.msg).toBe(msg);
        }
        {
            const bson = getBSONSerializer<[string, string]>()([_, msg]);
            const back = getBSONDeserializer<[string, string]>()(bson);
            expect(back).toEqual([_, msg]);
        }
        {
            const bson = getBSONSerializer<{ [name: string]: string }>()({ [_]: msg });
            const back = getBSONDeserializer<{ [name: string]: string }>()(bson);
            expect(back).toEqual({ [_]: msg });
        }
    }
});

test('AutoSerializer string', () => {
    const auto = new AutoBuffer(0, 0);
    const serializer = getBSONSerializer<string>();
    const buffer = auto._buffer;
    expect(auto.size).toBe(0);

    auto.apply(serializer, 'asd');
    expect(auto.size).toBe(8);
    expect(buffer !== auto._buffer).toBe(true);
    const buffer2 = auto._buffer;
    auto.apply(serializer, 'asd');
    expect(auto.size).toBe(8);
    expect(buffer2 === auto._buffer).toBe(true);

    auto.apply(serializer, 'a');
    expect(auto.size).toBe(6);
    expect(buffer2 === auto._buffer).toBe(true);
});

test('AutoSerializer object', () => {
    const auto = new AutoBuffer(0, 0);
    const serializer = getBSONSerializer<{ a: string }>();
    const buffer = auto._buffer;
    expect(auto.size).toBe(0);

    auto.apply(serializer, { a: 'asd' });
    expect(deserializeBSONWithoutOptimiser(auto._buffer)).toEqual({ a: 'asd' });
    expect(auto.size).toBe(4 + 2 + 1 + 8 + 1);
    expect(buffer !== auto._buffer).toBe(true);
    const buffer2 = auto._buffer;
    auto.apply(serializer, { a: 'asd' });
    expect(deserializeBSONWithoutOptimiser(auto._buffer)).toEqual({ a: 'asd' });
    expect(auto.size).toBe(4 + 2 + 1 + 8 + 1);
    expect(buffer2 === auto._buffer).toBe(true);

    auto.apply(serializer, { a: 'a' });
    expect(deserializeBSONWithoutOptimiser(auto._buffer)).toEqual({ a: 'a' });
    expect(auto.size).toBe(4 + 2 + 1 + 6 + 1);
    expect(buffer2 === auto._buffer).toBe(true);
});

test('MongoId in union', () => {
    type T = { v: (MongoId | string)[] };
    {
        const bson = getBSONSerializer<T>()({ v: ['507f191e810c19729de860ea', 'abc'] });
        const back1 = deserialize(bson);
        console.log(back1);
        expect(back1.v[0]).toBeInstanceOf(OfficialObjectId);
        expect(back1.v[1]).toBe('abc');

        const back2 = deserializeBSONWithoutOptimiser(bson);
        expect(back2.v).toEqual(['507f191e810c19729de860ea', 'abc']);

        const back3 = getBSONDeserializer<T>()(bson);
        expect(back3.v).toEqual(['507f191e810c19729de860ea', 'abc']);
    }
});

test('string fallback from number', () => {
    type T = { v: (MongoId | string)[] };
    {
        const bson = serialize({ v: [1, '2'] });
        const back2 = getBSONDeserializer<T>()(bson);
        expect(back2.v).toEqual(['1', '2']);
    }
});

test('optional MongoId in object', () => {
    type T = { v: any };
    const serialize = getBSONSerializer<T>();
    const bson = serialize({ v: wrapObjectId(undefined as any) });
    const back = getBSONDeserializer<T>()(bson);
    expect(back.v).toBeUndefined();
});

describe('BSON literal union serialization', () => {
    test('string literals only', () => {
        type T = { v: 'a' | 'b' | 'c' };
        const serialize = getBSONSerializer<T>();

        const bsonA = serialize({ v: 'a' });
        const bsonB = serialize({ v: 'b' });
        const bsonC = serialize({ v: 'c' });

        // Verify buffer is valid BSON
        expect(bsonA).toBeInstanceOf(Uint8Array);
        expect(bsonB).toBeInstanceOf(Uint8Array);
        expect(bsonC).toBeInstanceOf(Uint8Array);

        // Verify content is correct
        expect(deserializeBSONWithoutOptimiser(bsonA)).toEqual({ v: 'a' });
        expect(deserializeBSONWithoutOptimiser(bsonB)).toEqual({ v: 'b' });
        expect(deserializeBSONWithoutOptimiser(bsonC)).toEqual({ v: 'c' });
    });

    test('number literals only', () => {
        type T = { v: 1 | 2 | 3 };
        const serialize = getBSONSerializer<T>();

        const bson1 = serialize({ v: 1 });
        const bson2 = serialize({ v: 2 });
        const bson3 = serialize({ v: 3 });

        // Verify buffer is valid BSON
        expect(bson1).toBeInstanceOf(Uint8Array);
        expect(bson2).toBeInstanceOf(Uint8Array);
        expect(bson3).toBeInstanceOf(Uint8Array);

        // Verify content is correct
        expect(deserializeBSONWithoutOptimiser(bson1)).toEqual({ v: 1 });
        expect(deserializeBSONWithoutOptimiser(bson2)).toEqual({ v: 2 });
        expect(deserializeBSONWithoutOptimiser(bson3)).toEqual({ v: 3 });
    });

    test('boolean literals only', () => {
        type T = { v: true | false };
        const serialize = getBSONSerializer<T>();

        const bsonTrue = serialize({ v: true });
        const bsonFalse = serialize({ v: false });

        // Verify buffer is valid BSON
        expect(bsonTrue).toBeInstanceOf(Uint8Array);
        expect(bsonFalse).toBeInstanceOf(Uint8Array);

        // Verify content is correct
        expect(deserializeBSONWithoutOptimiser(bsonTrue)).toEqual({ v: true });
        expect(deserializeBSONWithoutOptimiser(bsonFalse)).toEqual({ v: false });
    });

    test('mixed string + number', () => {
        type T = { v: 'a' | 1 };
        const serialize = getBSONSerializer<T>();

        const bsonA = serialize({ v: 'a' });
        const bson1 = serialize({ v: 1 });

        // Verify buffer is valid BSON
        expect(bsonA).toBeInstanceOf(Uint8Array);
        expect(bson1).toBeInstanceOf(Uint8Array);

        // Verify content is correct
        expect(deserializeBSONWithoutOptimiser(bsonA)).toEqual({ v: 'a' });
        expect(deserializeBSONWithoutOptimiser(bson1)).toEqual({ v: 1 });
    });

    test('mixed string + number + boolean', () => {
        type T = { v: 'a' | 1 | true };
        const serialize = getBSONSerializer<T>();

        const bsonA = serialize({ v: 'a' });
        const bson1 = serialize({ v: 1 });
        const bsonTrue = serialize({ v: true });

        // Verify buffer is valid BSON
        expect(bsonA).toBeInstanceOf(Uint8Array);
        expect(bson1).toBeInstanceOf(Uint8Array);
        expect(bsonTrue).toBeInstanceOf(Uint8Array);

        // Verify content is correct
        expect(deserializeBSONWithoutOptimiser(bsonA)).toEqual({ v: 'a' });
        expect(deserializeBSONWithoutOptimiser(bson1)).toEqual({ v: 1 });
        expect(deserializeBSONWithoutOptimiser(bsonTrue)).toEqual({ v: true });
    });

    test('getBSONSerializer works correctly', () => {
        const serialize = getBSONSerializer<{ prop: 'a' | 'b' }>();
        const buffer = serialize({ prop: 'a' });

        // Verify buffer is valid BSON
        expect(buffer).toBeInstanceOf(Uint8Array);
        expect(buffer.byteLength).toBeGreaterThan(0);

        // Verify content via official deserializer
        const back = deserializeBSONWithoutOptimiser(buffer);
        expect(back).toEqual({ prop: 'a' });
    });

    test('invalid value throws ValidationError', () => {
        type T = { v: 'a' | 'b' | 'c' };
        const serialize = getBSONSerializer<T>();

        // Invalid string
        expect(() => serialize({ v: 'invalid' as any })).toThrow();

        // Invalid type (number instead of string)
        expect(() => serialize({ v: 123 as any })).toThrow();

        // Check error message format includes value info
        try {
            serialize({ v: 'invalid' as any });
            fail('Expected error');
        } catch (e: any) {
            expect(e.message).toContain('Cannot convert');
            expect(e.message).toContain('invalid');
        }
    });
});

describe('BSON literal union sizing', () => {
    test('sizer output matches serializer output length - string literals', () => {
        type T = { v: 'a' | 'b' | 'c' };
        const sizer = getBSONSizer<T>();
        const serialize = getBSONSerializer<T>();

        const objA = { v: 'a' as const };
        const objB = { v: 'b' as const };
        const objC = { v: 'c' as const };

        expect(sizer(objA)).toBe(serialize(objA).byteLength);
        expect(sizer(objB)).toBe(serialize(objB).byteLength);
        expect(sizer(objC)).toBe(serialize(objC).byteLength);
    });

    test('sizer output matches serializer output length - number literals', () => {
        type T = { v: 1 | 2 | 3 };
        const sizer = getBSONSizer<T>();
        const serialize = getBSONSerializer<T>();

        const obj1 = { v: 1 as const };
        const obj2 = { v: 2 as const };
        const obj3 = { v: 3 as const };

        expect(sizer(obj1)).toBe(serialize(obj1).byteLength);
        expect(sizer(obj2)).toBe(serialize(obj2).byteLength);
        expect(sizer(obj3)).toBe(serialize(obj3).byteLength);
    });

    test('sizer output matches serializer output length - boolean literals', () => {
        type T = { v: true | false };
        const sizer = getBSONSizer<T>();
        const serialize = getBSONSerializer<T>();

        const objTrue = { v: true as const };
        const objFalse = { v: false as const };

        expect(sizer(objTrue)).toBe(serialize(objTrue).byteLength);
        expect(sizer(objFalse)).toBe(serialize(objFalse).byteLength);
    });

    test('sizer output matches serializer output length - mixed literals', () => {
        type T = { v: 'a' | 1 | true };
        const sizer = getBSONSizer<T>();
        const serialize = getBSONSerializer<T>();

        expect(sizer({ v: 'a' })).toBe(serialize({ v: 'a' }).byteLength);
        expect(sizer({ v: 1 })).toBe(serialize({ v: 1 }).byteLength);
        expect(sizer({ v: true })).toBe(serialize({ v: true }).byteLength);
    });

    test('sizer throws for invalid value (same as serializer)', () => {
        type T = { v: 'a' | 'b' | 'c' };
        const sizer = getBSONSizer<T>();
        const serialize = getBSONSerializer<T>();

        // Both should throw for invalid value
        expect(() => sizer({ v: 'invalid' as any })).toThrow();
        expect(() => serialize({ v: 'invalid' as any })).toThrow();

        // Both should throw with similar error message
        let sizerError: Error | undefined;
        let serializerError: Error | undefined;

        try {
            sizer({ v: 'invalid' as any });
        } catch (e: any) {
            sizerError = e;
        }

        try {
            serialize({ v: 'invalid' as any });
        } catch (e: any) {
            serializerError = e;
        }

        expect(sizerError).toBeDefined();
        expect(serializerError).toBeDefined();
        expect(sizerError!.message).toContain('Cannot convert');
        expect(serializerError!.message).toContain('Cannot convert');
    });
});

describe('BSON literal union round-trip', () => {
    test('string literal round-trip', () => {
        type T = { status: 'active' | 'inactive' | 'pending' };
        const serialize = getBSONSerializer<T>();
        const deserialize = getBSONDeserializer<T>();

        const data: T = { status: 'active' };
        const buffer = serialize(data);
        const result = deserialize(buffer);
        expect(result).toEqual(data);

        const data2: T = { status: 'inactive' };
        const buffer2 = serialize(data2);
        const result2 = deserialize(buffer2);
        expect(result2).toEqual(data2);

        const data3: T = { status: 'pending' };
        const buffer3 = serialize(data3);
        const result3 = deserialize(buffer3);
        expect(result3).toEqual(data3);
    });

    test('number literal round-trip', () => {
        type T = { level: 1 | 2 | 3 | 4 | 5 };
        const serialize = getBSONSerializer<T>();
        const deserialize = getBSONDeserializer<T>();

        for (const level of [1, 2, 3, 4, 5] as const) {
            const data: T = { level };
            const buffer = serialize(data);
            const result = deserialize(buffer);
            expect(result).toEqual(data);
        }
    });

    test('boolean literal round-trip', () => {
        type T = { flag: true | false };
        const serialize = getBSONSerializer<T>();
        const deserialize = getBSONDeserializer<T>();

        const dataTrue: T = { flag: true };
        const bufferTrue = serialize(dataTrue);
        const resultTrue = deserialize(bufferTrue);
        expect(resultTrue).toEqual(dataTrue);

        const dataFalse: T = { flag: false };
        const bufferFalse = serialize(dataFalse);
        const resultFalse = deserialize(bufferFalse);
        expect(resultFalse).toEqual(dataFalse);
    });

    test('mixed literals round-trip', () => {
        type T = { value: 'a' | 'b' | 1 | 2 | true | false };
        const serialize = getBSONSerializer<T>();
        const deserialize = getBSONDeserializer<T>();

        const testValues: ('a' | 'b' | 1 | 2 | true | false)[] = ['a', 'b', 1, 2, true, false];
        for (const value of testValues) {
            const data: T = { value };
            const buffer = serialize(data);
            const result = deserialize(buffer);
            expect(result).toEqual(data);
        }
    });

    test('array of literal unions round-trip', () => {
        type T = { items: ('x' | 'y' | 'z')[] };
        const serialize = getBSONSerializer<T>();
        const deserialize = getBSONDeserializer<T>();

        const data: T = { items: ['x', 'y', 'z', 'x', 'y'] };
        const buffer = serialize(data);
        const result = deserialize(buffer);
        expect(result).toEqual(data);
    });

    test('empty string in literal union round-trip', () => {
        type T = { value: '' | 'a' | 'b' };
        const serialize = getBSONSerializer<T>();
        const deserialize = getBSONDeserializer<T>();

        const data: T = { value: '' };
        const buffer = serialize(data);
        const result = deserialize(buffer);
        expect(result).toEqual(data);
    });

    test('negative number literals round-trip', () => {
        type T = { value: -1 | 0 | 1 };
        const serialize = getBSONSerializer<T>();
        const deserialize = getBSONDeserializer<T>();

        for (const value of [-1, 0, 1] as const) {
            const data: T = { value };
            const buffer = serialize(data);
            const result = deserialize(buffer);
            expect(result).toEqual(data);
        }
    });
});

describe('BSON literal union errors', () => {
    test('error uses stringifyValueWithType format', () => {
        type T = { status: 'active' | 'inactive' };
        const serialize = getBSONSerializer<T>();

        // stringifyValueWithType produces format like "string(invalid)"
        expect(() => serialize({ status: 'invalid' as any })).toThrow(/string\(invalid\)/);
    });

    test('error includes value field', () => {
        type T = { status: 'active' | 'inactive' };
        const serialize = getBSONSerializer<T>();

        try {
            serialize({ status: 'invalid' as any });
            fail('Expected error to be thrown');
        } catch (e: any) {
            expect(e.errors).toBeDefined();
            expect(e.errors[0].value).toBe('invalid');
        }
    });

    test('nested property has correct error path', () => {
        type T = { outer: { inner: { status: 'x' | 'y' } } };
        const serialize = getBSONSerializer<T>();

        try {
            serialize({ outer: { inner: { status: 'invalid' as any } } });
            fail('Expected error to be thrown');
        } catch (e: any) {
            expect(e.errors).toBeDefined();
            expect(e.errors[0].path).toBe('outer.inner.status');
        }
    });

    test('number value in string literal union shows correct format', () => {
        type T = { status: 'active' | 'inactive' };
        const serialize = getBSONSerializer<T>();

        // stringifyValueWithType produces format like "number(123)"
        expect(() => serialize({ status: 123 as any })).toThrow(/number\(123\)/);
    });

    test('sizer throws same error as serializer', () => {
        type T = { status: 'active' | 'inactive' };
        const serialize = getBSONSerializer<T>();
        const sizer = getBSONSizer<T>();

        const invalidData = { status: 'invalid' as any };

        let serializerError: Error | undefined;
        let sizerError: Error | undefined;

        try {
            serialize(invalidData);
        } catch (e: any) {
            serializerError = e;
        }

        try {
            sizer(invalidData);
        } catch (e: any) {
            sizerError = e;
        }

        expect(serializerError).toBeDefined();
        expect(sizerError).toBeDefined();
        expect(serializerError!.message).toBe(sizerError!.message);
    });
});

describe('BSON literal union contexts', () => {
    test('literal union in array', () => {
        type T = { items: ('a' | 'b')[] };
        const serialize = getBSONSerializer<T>();
        const deserialize = getBSONDeserializer<T>();

        const data: T = { items: ['a', 'b', 'a', 'b'] };
        const buffer = serialize(data);
        const result = deserialize(buffer);
        expect(result).toEqual(data);
    });

    test('literal union in array - invalid value throws', () => {
        type T = { items: ('a' | 'b')[] };
        const serialize = getBSONSerializer<T>();

        expect(() => serialize({ items: ['a', 'invalid' as any, 'b'] })).toThrow();
    });

    test('literal union in nested object', () => {
        type T = { outer: { status: 'x' | 'y' } };
        const serialize = getBSONSerializer<T>();
        const deserialize = getBSONDeserializer<T>();

        const data: T = { outer: { status: 'x' } };
        const buffer = serialize(data);
        const result = deserialize(buffer);
        expect(result).toEqual(data);
    });

    test('literal union in deeply nested object', () => {
        type T = { level1: { level2: { level3: { value: 'a' | 'b' | 'c' } } } };
        const serialize = getBSONSerializer<T>();
        const deserialize = getBSONDeserializer<T>();

        const data: T = { level1: { level2: { level3: { value: 'b' } } } };
        const buffer = serialize(data);
        const result = deserialize(buffer);
        expect(result).toEqual(data);
    });

    test('multiple literal union properties', () => {
        type T = {
            status: 'active' | 'inactive';
            priority: 1 | 2 | 3;
            enabled: true | false;
        };
        const serialize = getBSONSerializer<T>();
        const deserialize = getBSONDeserializer<T>();

        const data: T = { status: 'active', priority: 2, enabled: true };
        const buffer = serialize(data);
        const result = deserialize(buffer);
        expect(result).toEqual(data);
    });

    test('optional literal union property', () => {
        type T = { status?: 'active' | 'inactive' };
        const serialize = getBSONSerializer<T>();
        const deserialize = getBSONDeserializer<T>();

        // With value
        const data1: T = { status: 'active' };
        const buffer1 = serialize(data1);
        const result1 = deserialize(buffer1);
        expect(result1).toEqual(data1);

        // Without value
        const data2: T = {};
        const buffer2 = serialize(data2);
        const result2 = deserialize(buffer2);
        expect(result2).toEqual(data2);
    });

    test('literal union as root type in object', () => {
        // Wrapping in object since BSON serializes documents
        type T = { value: 'a' | 'b' | 'c' };
        const serialize = getBSONSerializer<T>();
        const deserialize = getBSONDeserializer<T>();

        for (const value of ['a', 'b', 'c'] as const) {
            const data: T = { value };
            const buffer = serialize(data);
            const result = deserialize(buffer);
            expect(result).toEqual(data);
        }
    });
});

describe('BSON literal union performance', () => {
    test('large literal union (10+ members) does not cause stack overflow', () => {
        // Test with a union of 15 string literals
        type LargeStringUnion = { v: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm' | 'n' | 'o' };
        const serializeString = getBSONSerializer<LargeStringUnion>();
        const sizerString = getBSONSizer<LargeStringUnion>();

        // Should not stack overflow
        const bson = serializeString({ v: 'o' });
        const size = sizerString({ v: 'o' });

        expect(bson.byteLength).toBe(size);
        expect(deserializeBSONWithoutOptimiser(bson)).toEqual({ v: 'o' });

        // Test with a union of 15 number literals
        type LargeNumberUnion = { v: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 };
        const serializeNumber = getBSONSerializer<LargeNumberUnion>();
        const sizerNumber = getBSONSizer<LargeNumberUnion>();

        const bsonNum = serializeNumber({ v: 15 });
        const sizeNum = sizerNumber({ v: 15 });

        expect(bsonNum.byteLength).toBe(sizeNum);
        expect(deserializeBSONWithoutOptimiser(bsonNum)).toEqual({ v: 15 });
    });

    test('very large literal union (100 members) does not cause stack overflow', () => {
        // Create a type with 100 literal values
        type HundredUnion = {
            v:
                | 1
                | 2
                | 3
                | 4
                | 5
                | 6
                | 7
                | 8
                | 9
                | 10
                | 11
                | 12
                | 13
                | 14
                | 15
                | 16
                | 17
                | 18
                | 19
                | 20
                | 21
                | 22
                | 23
                | 24
                | 25
                | 26
                | 27
                | 28
                | 29
                | 30
                | 31
                | 32
                | 33
                | 34
                | 35
                | 36
                | 37
                | 38
                | 39
                | 40
                | 41
                | 42
                | 43
                | 44
                | 45
                | 46
                | 47
                | 48
                | 49
                | 50
                | 51
                | 52
                | 53
                | 54
                | 55
                | 56
                | 57
                | 58
                | 59
                | 60
                | 61
                | 62
                | 63
                | 64
                | 65
                | 66
                | 67
                | 68
                | 69
                | 70
                | 71
                | 72
                | 73
                | 74
                | 75
                | 76
                | 77
                | 78
                | 79
                | 80
                | 81
                | 82
                | 83
                | 84
                | 85
                | 86
                | 87
                | 88
                | 89
                | 90
                | 91
                | 92
                | 93
                | 94
                | 95
                | 96
                | 97
                | 98
                | 99
                | 100;
        };

        // This should complete without stack overflow
        const serialize = getBSONSerializer<HundredUnion>();
        const sizer = getBSONSizer<HundredUnion>();

        // Test first value
        const bson1 = serialize({ v: 1 });
        expect(sizer({ v: 1 })).toBe(bson1.byteLength);
        expect(deserializeBSONWithoutOptimiser(bson1)).toEqual({ v: 1 });

        // Test middle value
        const bson50 = serialize({ v: 50 });
        expect(sizer({ v: 50 })).toBe(bson50.byteLength);
        expect(deserializeBSONWithoutOptimiser(bson50)).toEqual({ v: 50 });

        // Test last value
        const bson100 = serialize({ v: 100 });
        expect(sizer({ v: 100 })).toBe(bson100.byteLength);
        expect(deserializeBSONWithoutOptimiser(bson100)).toEqual({ v: 100 });

        // Invalid value should still throw
        expect(() => serialize({ v: 101 as any })).toThrow();
    });

    test('large union sizer matches serializer for all test values', () => {
        type LargeUnion = {
            value:
                | 1
                | 2
                | 3
                | 4
                | 5
                | 6
                | 7
                | 8
                | 9
                | 10
                | 11
                | 12
                | 13
                | 14
                | 15
                | 16
                | 17
                | 18
                | 19
                | 20
                | 21
                | 22
                | 23
                | 24
                | 25
                | 26
                | 27
                | 28
                | 29
                | 30
                | 31
                | 32
                | 33
                | 34
                | 35
                | 36
                | 37
                | 38
                | 39
                | 40
                | 41
                | 42
                | 43
                | 44
                | 45
                | 46
                | 47
                | 48
                | 49
                | 50;
        };

        const serialize = getBSONSerializer<LargeUnion>();
        const sizer = getBSONSizer<LargeUnion>();

        // Test a few values from the large union
        for (const value of [1, 25, 50] as const) {
            const data: LargeUnion = { value };
            const buffer = serialize(data);
            const size = sizer(data);
            expect(buffer.byteLength).toBe(size);
        }
    });
});
