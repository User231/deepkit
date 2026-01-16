/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { BenchSuite } from '../../../bench';
import { createBSONSizer, getBSONSerializer } from '@deepkit/bson';

// Try to import official bson package for comparison
let officialBson: typeof import('bson') | undefined;
try {
    officialBson = require('bson');
} catch {
    // Official bson package not available
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
            name: 'Peter',
            ready: true,
            priority: 0,
            tags: ['a', 'b', 'c', 'd'],
        });
    }

    interface Schema {
        cursor: {
            firstBatch: ItemSchema[];
        };
    }

    const suite = new BenchSuite(`BSON Serializer array of ${count} items`);
    const data: Schema = { cursor: { firstBatch: items } };

    // Create JIT serializer
    const serializer = getBSONSerializer<Schema>();
    const sizer = createBSONSizer<Schema>();

    // Warm up
    serializer(data);
    sizer(data);

    // Log sizes for debugging
    if (officialBson) {
        console.log('buffer official size for 1 item:', officialBson.calculateObjectSize(items[0]));
    }
    console.log('buffer deepkit size for 1 item:', createBSONSizer<ItemSchema>()(items[0]));

    // Sizer benchmarks (p0 - highest priority)
    suite.add('deepkit/bson sizer', () => {
        const size = sizer(data);
        Buffer.alloc(size);
    }, { category: 'p0' });

    if (officialBson) {
        const { calculateObjectSize } = officialBson;
        suite.add('js-bson calculateObjectSize', () => {
            const size = calculateObjectSize(data);
            Buffer.alloc(size);
        }, { category: 'p0' });
    }

    // Single item serialization (p0)
    const serializer1Item = getBSONSerializer<ItemSchema>();
    suite.add('deepkit/bson serialize 1 item', () => {
        serializer1Item(items[0]);
    }, { category: 'p0' });

    suite.add('JSON.stringify 1 item', () => {
        Buffer.from(JSON.stringify(items[0]), 'utf8');
    }, { category: 'p0' });

    if (officialBson) {
        const { serialize } = officialBson;
        suite.add('js-bson serialize 1 item', () => {
            serialize(items[0]);
        }, { category: 'p0' });
    }

    // Full array serialization (p0)
    suite.add('deepkit/bson', () => {
        serializer(data);
    }, { category: 'p0' });

    if (officialBson) {
        const { serialize } = officialBson;
        suite.add('official js-bson', () => {
            serialize(data);
        }, { category: 'p0' });
    }

    suite.add('JSON.stringify', () => {
        Buffer.from(JSON.stringify(data), 'utf8');
    }, { category: 'p0' });

    // Buffer baseline benchmark
    const numbers: number[] = [2, 4, 8, 12, 2, 4, 8, 12];
    suite.add('baseline buffer allocation', () => {
        const buffer = Buffer.allocUnsafe(8);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        for (let i = 0; i < 8; i++) {
            view.setUint8(i, numbers[i]);
        }
    }, { category: 'p0' });

    suite.add('baseline JSON.stringify numbers', () => {
        JSON.stringify(numbers);
    }, { category: 'p0' });

    return suite;
}
