/**
 * Deepkit Framework - Public Benchmark
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * BSON: Deepkit vs js-bson
 *
 * This benchmark compares Deepkit's JIT-compiled BSON serializer/deserializer
 * against the official MongoDB js-bson library.
 */
import { BenchSuite } from '@deepkit/bench';
import { getBSONDeserializer, getBSONSerializer } from '@deepkit/bson';

// Try to import official bson package for comparison
let officialBson: typeof import('bson') | undefined;
try {
    officialBson = require('bson');
} catch {
    // Official bson package not available
}

// ============================================================================
// Test Schema - Realistic MongoDB document structure
// ============================================================================

interface Item {
    id: number;
    name: string;
    ready: boolean;
    priority: number;
    tags: string[];
}

interface MongoResponse {
    cursor: {
        firstBatch: Item[];
    };
}

// ============================================================================
// Benchmark
// ============================================================================

export default async function () {
    if (!officialBson) {
        console.log('Skipping BSON benchmark: bson package not installed');
        return new BenchSuite('comparison/bson (skipped)');
    }

    const suite = new BenchSuite('comparison/bson', 1, true);

    // Generate test data - 10,000 items simulating a MongoDB cursor response
    const items: Item[] = [];
    for (let i = 0; i < 10_000; i++) {
        items.push({
            id: i,
            name: 'Peter',
            ready: true,
            priority: 0,
            tags: ['a', 'b', 'c'],
        });
    }

    const data: MongoResponse = { cursor: { firstBatch: items } };

    // Create serializers
    const deepkitSerialize = getBSONSerializer<MongoResponse>();
    const deepkitDeserialize = getBSONDeserializer<MongoResponse>();

    // Serialize with both to get BSON data
    const deepkitBson = deepkitSerialize(data);
    const officialBsonData = officialBson.serialize(data);

    // Warmup
    deepkitSerialize(data);
    deepkitDeserialize(deepkitBson);
    officialBson.serialize(data);
    officialBson.deserialize(officialBsonData);

    // ========================================================================
    // Serialize (object -> BSON)
    // ========================================================================

    suite.add('Deepkit serialize', () => {
        deepkitSerialize(data);
    });

    suite.add('js-bson serialize', () => {
        officialBson!.serialize(data);
    });

    // ========================================================================
    // Deserialize (BSON -> object)
    // ========================================================================

    suite.add('Deepkit deserialize', () => {
        deepkitDeserialize(deepkitBson);
    });

    suite.add('js-bson deserialize', () => {
        officialBson!.deserialize(officialBsonData);
    });

    return suite;
}
