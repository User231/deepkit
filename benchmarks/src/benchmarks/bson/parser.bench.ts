/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { BenchSuite } from '../../suite';
import { BaseParser, getBSONDeserializer, getBSONSerializer, parseObject, decodeUTF8 } from '@deepkit/bson';

// Try to import official bson package for comparison
let officialBson: typeof import('bson') | undefined;
try {
    officialBson = require('bson');
} catch {
    // Official bson package not available
}

function randomString(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export default async function() {
    interface ItemSchema {
        id: number;
        name: string;
        ready: boolean;
        priority: number;
        tags: string[];
    }

    const items: ItemSchema[] = [];

    const count = 10_000;
    for (let i = 0; i < count; i++) {
        items.push({
            id: i,
            name: 'x'.repeat(5),
            ready: true,
            priority: 0,
            tags: ['a', 'b', 'c'],
        });
    }

    interface Schema {
        cursor: {
            firstBatch: ItemSchema[];
        };
    }

    // Serialize test data
    let bsonData: Uint8Array;
    if (officialBson) {
        bsonData = officialBson.serialize({ cursor: { firstBatch: items } });
    } else {
        const serializer = getBSONSerializer<Schema>();
        bsonData = serializer({ cursor: { firstBatch: items } });
    }

    const json = JSON.stringify({ cursor: { firstBatch: items } });

    const suite = new BenchSuite(`BSON Parser array with ${count} objects`);

    // Create JIT deserializer
    const parser = getBSONDeserializer<Schema>();
    // Warm up the parser
    parser(bsonData);

    // Deepkit BSON JIT deserializer (p0 - highest priority)
    suite.add('deepkit/bson JIT', () => {
        parser(bsonData);
    }, { category: 'p0' });

    // Deepkit generic parser (p0)
    suite.add('deepkit/bson generic BaseParser', () => {
        parseObject(new BaseParser(bsonData));
    }, { category: 'p0' });

    // Official js-bson if available (p0)
    if (officialBson) {
        const { deserialize } = officialBson;
        suite.add('official js-bson', () => {
            deserialize(bsonData);
        }, { category: 'p0' });
    }

    // JSON.parse for comparison (p0)
    suite.add('JSON.parse', () => {
        JSON.parse(json);
    }, { category: 'p0' });

    // Single item benchmarks
    const parserItem = getBSONDeserializer<ItemSchema>();
    let bsonOneItem: Uint8Array;
    if (officialBson) {
        bsonOneItem = officialBson.serialize(items[0]);
    } else {
        const serializer = getBSONSerializer<ItemSchema>();
        bsonOneItem = serializer(items[0]);
    }
    const jsonOneItem = JSON.stringify(items[0]);

    suite.add('deepkit/bson JIT 1 item', () => {
        parserItem(bsonOneItem);
    }, { category: 'p0' });

    suite.add('JSON.parse 1 item', () => {
        JSON.parse(jsonOneItem);
    }, { category: 'p0' });

    // UTF-8 decoding benchmarks for various sizes
    for (const size of [8, 16, 32, 64, 128, 256, 512, 1024]) {
        const stringBinary = Buffer.from(randomString(size));
        suite.add(`decodeUTF8 ${size} bytes`, () => {
            decodeUTF8(stringBinary, 0, stringBinary.byteLength);
        }, { category: 'p0' });
    }

    // ObjectId benchmarks if official bson is available
    if (officialBson) {
        const { ObjectId } = officialBson;
        const objectId = new ObjectId();
        const b = objectId.id;

        const hexTable: string[] = [];
        for (let i = 0; i < 256; i++) {
            hexTable[i] = (i <= 15 ? '0' : '') + i.toString(16);
        }

        suite.add('ObjectId.toString()', () => {
            objectId.toString();
        }, { category: 'p0' });

        suite.add('deepkit hex conversion', () => {
            let offset = 0;
            const a =
                hexTable[b[offset]] +
                hexTable[b[offset + 1]] +
                hexTable[b[offset + 2]] +
                hexTable[b[offset + 3]] +
                hexTable[b[offset + 4]] +
                hexTable[b[offset + 5]] +
                hexTable[b[offset + 6]] +
                hexTable[b[offset + 7]] +
                hexTable[b[offset + 8]] +
                hexTable[b[offset + 9]] +
                hexTable[b[offset + 10]] +
                hexTable[b[offset + 11]];
        }, { category: 'p0' });
    }

    suite.run();
}
