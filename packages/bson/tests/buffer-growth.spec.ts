/**
 * The serializer's shared buffer must GROW when a document doesn't fit — it
 * starts at 1MB and used to be fixed, so any document crossing 1MB either
 * threw a RangeError (DataView writes) or was silently truncated (plain byte
 * writes). Regression tests for both overflow surfaces, the untyped path,
 * and the oversized-document temporary-buffer path.
 */
import { describe, test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { typeOf } from '@deepkit/type';

import { deserializeBSON, deserializeBSONWithoutOptimiser, getBSONSerializer, serializeBSON, serializeBSONWithoutOptimiser } from '../index.js';

describe('serialize buffer growth', () => {
    test('string content > 1MB (silent Uint8Array overflow path) round-trips', () => {
        // Strings are written byte-by-byte into the Uint8Array — out-of-bounds
        // writes are silently dropped, only the returned size reveals overflow.
        type T = { items: string[] };
        const items = Array.from({ length: 30_000 }, (_, i) => `row-${i}-` + 'x'.repeat(100));
        const bson = serializeBSON<T>({ items });
        expect(bson.byteLength).toBeGreaterThan(1024 * 1024);
        expect(deserializeBSON<T>(bson)).toEqual({ items });
    });

    test('number content > 1MB (DataView RangeError path) round-trips', () => {
        // Numbers are written via DataView.setFloat64, which THROWS past the end.
        type T = { values: number[] };
        const values = Array.from({ length: 300_000 }, (_, i) => i + 0.5);
        const bson = serializeBSON<T>({ values });
        expect(bson.byteLength).toBeGreaterThan(1024 * 1024);
        expect(deserializeBSON<T>(bson)).toEqual({ values });
    });

    test('untyped serializeBSONWithoutOptimiser > 1MB round-trips', () => {
        const data: Record<string, any> = {};
        for (let i = 0; i < 20_000; i++) data[`key-${i}`] = `value-${i}-` + 'y'.repeat(80);
        const bson = serializeBSONWithoutOptimiser(data);
        expect(bson.byteLength).toBeGreaterThan(1024 * 1024);
        expect(deserializeBSONWithoutOptimiser(bson)).toEqual(data);
    });

    test('document beyond the retained cap (> 16MB) uses a temporary buffer and round-trips', () => {
        type T = { blobs: string[] };
        const blobs = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i).repeat(1024 * 1024));
        const bson = serializeBSON<T>({ blobs });
        expect(bson.byteLength).toBeGreaterThan(16 * 1024 * 1024);
        expect(deserializeBSON<T>(bson).blobs[19]).toBe('T'.repeat(1024 * 1024));

        // The shared buffer stays healthy for subsequent small documents.
        type S = { ok: boolean; n: number };
        expect(deserializeBSON<S>(serializeBSON<S>({ ok: true, n: 42 }))).toEqual({ ok: true, n: 42 });
    });

    test('repeated large serializes reuse the grown buffer correctly', () => {
        type T = { items: string[] };
        const serializer = getBSONSerializer<T>();
        for (let round = 0; round < 3; round++) {
            const items = Array.from({ length: 20_000 }, (_, i) => `round-${round}-item-${i}-` + 'z'.repeat(60));
            const [buffer, size] = serializer({ items });
            expect(size).toBeGreaterThan(1024 * 1024);
            expect(size).toBeLessThanOrEqual(buffer.byteLength);
            expect(deserializeBSON<T>(buffer.slice(0, size))).toEqual({ items });
        }
    });
});
