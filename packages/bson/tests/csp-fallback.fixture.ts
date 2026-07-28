/**
 * Runs in a subprocess with --disallow-code-generation-from-strings (the V8
 * behavior of a strict CSP without 'unsafe-eval'): the JIT entry points must
 * transparently fall back to the closure executor. Spawned by
 * csp-fallback.spec.ts; prints "ok" on success, throws otherwise.
 */
import { canJIT } from '@deepkit/core';

import { getBSONDeserializer, getBSONSerializer, serializeBSONWithoutOptimiser } from '../index.js';

if (canJIT) throw new Error('expected canJIT=false under --disallow-code-generation-from-strings');

interface Doc {
    id: string;
    n: number;
    at: Date;
    tags: string[];
    nested: { deep: number[] };
}

const doc: Doc = {
    id: 'a1',
    n: 42.5,
    at: new Date('2026-01-01T00:00:00Z'),
    tags: ['x', 'y'],
    nested: { deep: [1, 2, 3] },
};

// Bytes from the non-JIT serializer; decode through the JIT entry (exec fallback).
const bytes = serializeBSONWithoutOptimiser(doc);
const deserialize = getBSONDeserializer<Doc>();
const out = deserialize(bytes);
if (out.id !== 'a1' || out.n !== 42.5 || !(out.at instanceof Date) || out.tags[1] !== 'y' || out.nested.deep[2] !== 3) {
    throw new Error('roundtrip mismatch: ' + JSON.stringify(out));
}

// And the JIT serializer entry under exec mode, back through the deserializer.
const [buf, size] = getBSONSerializer<Doc>()(out);
const again = deserialize(buf.slice(0, size));
if (again.id !== 'a1' || again.nested.deep.length !== 3)
    throw new Error('second roundtrip mismatch: ' + JSON.stringify(again));

console.log('ok');
