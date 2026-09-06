import { describe, test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { Serializer, serializer } from '../index.js';
import { typeOf } from '../src/reflection/reflection.js';
import { ReflectionKind, TypeUnion } from '../src/reflection/type.js';
import { deserialize, serialize } from '../src/serializer-facade.js';

/**
 * Compiled code calls `buildDeserializer` / `buildSerializer` back at RUNTIME
 * wherever a union member can only be chosen from the input (the scored union
 * of object literals). Uncached, that was one full code-generation per VALUE
 * (2026-09-06: an aggregate replay over `{kind:'quantity'}|{kind:'text'}|…`
 * cells spent 75% of its CPU in the JIT). The build is now one per
 * (type, registry generation).
 */
type Cell = { kind: 'quantity'; value: number } | { kind: 'text'; text: string } | { kind: 'flag'; on: boolean };
type Change = { op: 'set'; itemId: string; value: Cell };
type ValuesSet = { changes: Change[] };

describe('serializer build cache', () => {
    test('buildDeserializer / buildSerializer return the SAME function for the same type', () => {
        const union = typeOf<Cell>() as TypeUnion;
        expect(union.kind).toBe(ReflectionKind.union);
        const member = union.types[0];
        expect(serializer.buildDeserializer(member)).toBe(serializer.buildDeserializer(member));
        expect(serializer.buildSerializer(member)).toBe(serializer.buildSerializer(member));
        // The two directions never share a build.
        expect(serializer.buildDeserializer(member)).not.toBe(serializer.buildSerializer(member));
    });

    test('a registry mutation invalidates the cached build', () => {
        const s = new Serializer();
        const member = (typeOf<Cell>() as TypeUnion).types[1];
        const before = s.buildDeserializer(member);
        expect(s.buildDeserializer(member)).toBe(before);
        // Registering anything re-numbers the registry: the next build is fresh.
        s.deserializeRegistry.addPreHook((type, input, b, ctx, next) => next());
        expect(s.buildDeserializer(member)).not.toBe(before);
    });

    test('THE REGRESSION: N scored-union values do not compile N deserializers', () => {
        const changes: Change[] = [];
        for (let i = 0; i < 300; i++) {
            changes.push({ op: 'set', itemId: String(i), value: i % 3 === 0 ? { kind: 'quantity', value: i } : i % 3 === 1 ? { kind: 'text', text: `t${i}` } : { kind: 'flag', on: true } });
        }
        const union = typeOf<Cell>() as TypeUnion;
        // Warm up: first call compiles the outer function and the three members once.
        deserialize<ValuesSet>({ changes: changes.slice(0, 3) }, { loosely: false });
        const compiled = union.types.map(m => serializer.buildDeserializer(m));
        const out = deserialize<ValuesSet>({ changes }, { loosely: false });
        expect(out.changes.length).toBe(300);
        expect(out.changes[0].value).toEqual({ kind: 'quantity', value: 0 });
        expect(out.changes[1].value).toEqual({ kind: 'text', text: 't1' });
        expect(out.changes[2].value).toEqual({ kind: 'flag', on: true });
        // Every member still resolves to the very function built before the run.
        union.types.forEach((m, i) => expect(serializer.buildDeserializer(m)).toBe(compiled[i]));
        // And it is fast: 300 values in well under the time 300 compiles took (~4 ms each).
        const started = performance.now();
        for (let i = 0; i < 20; i++) deserialize<ValuesSet>({ changes }, { loosely: false });
        expect(performance.now() - started).toBeLessThan(500);
        // Round trip through the serializer side too.
        expect(serialize<ValuesSet>(out).changes[5].value).toEqual({ kind: 'flag', on: true });
    });
});
