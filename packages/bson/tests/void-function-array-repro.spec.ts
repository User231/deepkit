import * as bson from 'bson';
import { describe, test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { ReflectionKind, Type, TypeObjectLiteral } from '@deepkit/type';

import { getBSONEncoder, getBSONSerializer } from '../index.js';
import { deserializeBSON } from '../index.js';

/**
 * Repro for DK-B060 release-blocker: the BSON serializer throws
 * TypeNotSerializableError for `void`/`function`/`method`/`never` value types
 * and for top-level `array` documents on the RPC + MongoDB command path.
 */
describe('DK-B060 repro: void / function / array / never', () => {
    test('RPC void-return result schema: { v?: void }', () => {
        // This is exactly what packages/rpc/src/server/action.ts builds as
        // `resultSchema` when an action returns void (type kind = void).
        const resultSchema: TypeObjectLiteral = {
            kind: ReflectionKind.objectLiteral,
            types: [
                {
                    kind: ReflectionKind.propertySignature,
                    name: 'v',
                    parent: undefined as any,
                    optional: true,
                    type: { kind: ReflectionKind.void } as Type,
                },
            ],
        };
        (resultSchema.types[0] as any).parent = resultSchema;

        const serialize = getBSONSerializer(resultSchema as any);
        // Before the fix this threw DK-B060 at JIT-build time (the `void` branch
        // hit the serializeValue default). It must now build and serialize.

        // result of a void action: response.reply(..., { v: result }) where result === undefined.
        // `v` is present-but-undefined → serialized as BSON null (existing optional-nullish contract).
        const [buf1, size1] = serialize({ v: undefined });
        expect(Array.from(buf1.subarray(0, size1))).toEqual(Array.from(bson.serialize({ v: null })));

        // When `v` is entirely absent the optional property is omitted → empty document.
        const [buf2, size2] = serialize({});
        expect(Array.from(buf2.subarray(0, size2))).toEqual(Array.from(bson.serialize({})));
    });

    test('RPC array-return result schema: { v?: number[] }', () => {
        const resultSchema: TypeObjectLiteral = {
            kind: ReflectionKind.objectLiteral,
            types: [
                {
                    kind: ReflectionKind.propertySignature,
                    name: 'v',
                    parent: undefined as any,
                    optional: true,
                    type: { kind: ReflectionKind.array, type: { kind: ReflectionKind.number } } as Type,
                },
            ],
        };
        (resultSchema.types[0] as any).parent = resultSchema;

        const serialize = getBSONSerializer(resultSchema as any);
        const [buffer, size] = serialize({ v: [1, 2, 3] });
        expect(Array.from(buffer.subarray(0, size))).toEqual(Array.from(bson.serialize({ v: [1, 2, 3] })));
    });

    test('top-level array document via getBSONEncoder<number[]>', () => {
        const encoder = getBSONEncoder<number[]>();
        const encoded = encoder.encode([1, 2, 3]);
        // bson encodes an array as a document with numeric string keys
        expect(Array.from(encoded)).toEqual(Array.from(bson.serialize({ v: [1, 2, 3] })));
        expect(encoder.decode(encoded)).toEqual([1, 2, 3]);
    });

    test('top-level array via getBSONSerializer<number[]>', () => {
        const serialize = getBSONSerializer<number[]>();
        const [buffer, size] = serialize([1, 2, 3]);
        // Top-level array serializes as { "0": 1, "1": 2, "2": 3 }
        expect(Array.from(buffer.subarray(0, size))).toEqual(Array.from(bson.serialize({ 0: 1, 1: 2, 2: 3 })));
    });

    test('class with a void-returning method property is skipped', () => {
        class WithMethod {
            name: string = '';
            doStuff(): void {}
            compute(): number[] {
                return [];
            }
        }
        const serialize = getBSONSerializer<WithMethod>();
        const instance = new WithMethod();
        instance.name = 'hello';
        const [buffer, size] = serialize(instance);
        // Methods are not data — only `name` is serialized.
        expect(Array.from(buffer.subarray(0, size))).toEqual(Array.from(bson.serialize({ name: 'hello' })));
    });

    test('object literal with function-typed property is skipped', () => {
        interface Doc {
            name: string;
            cb: () => void;
        }
        const serialize = getBSONSerializer<Doc>();
        const [buffer, size] = serialize({ name: 'hi', cb: () => {} });
        expect(Array.from(buffer.subarray(0, size))).toEqual(Array.from(bson.serialize({ name: 'hi' })));
    });

    test('function-typed property value (in object schema) is skipped, not thrown', () => {
        // A property whose *value type* is a function/method has no BSON
        // representation. The serializer must emit nothing for it (skip) rather
        // than throwing DK-B060 — this is the value-type analogue of the void
        // RPC return and the function-on-the-command-path case.
        const schema: TypeObjectLiteral = {
            kind: ReflectionKind.objectLiteral,
            types: [
                {
                    kind: ReflectionKind.propertySignature,
                    name: 'name',
                    parent: undefined as any,
                    type: { kind: ReflectionKind.string } as Type,
                },
                {
                    kind: ReflectionKind.propertySignature,
                    name: 'fn',
                    parent: undefined as any,
                    type: {
                        kind: ReflectionKind.function,
                        name: undefined,
                        parameters: [],
                        return: { kind: ReflectionKind.void },
                    } as Type,
                },
            ],
        };
        for (const t of schema.types) (t as any).parent = schema;

        const serialize = getBSONSerializer(schema as any);
        const [buffer, size] = serialize({ name: 'x', fn: () => {} });
        expect(Array.from(buffer.subarray(0, size))).toEqual(Array.from(bson.serialize({ name: 'x' })));
    });

    test('never-typed property value serializes as nothing', () => {
        const schema: TypeObjectLiteral = {
            kind: ReflectionKind.objectLiteral,
            types: [
                {
                    kind: ReflectionKind.propertySignature,
                    name: 'name',
                    parent: undefined as any,
                    type: { kind: ReflectionKind.string } as Type,
                },
                {
                    kind: ReflectionKind.propertySignature,
                    name: 'v',
                    parent: undefined as any,
                    optional: true,
                    type: { kind: ReflectionKind.never } as Type,
                },
            ],
        };
        for (const t of schema.types) (t as any).parent = schema;

        const serialize = getBSONSerializer(schema as any);
        const [buffer, size] = serialize({ name: 'x' });
        expect(Array.from(buffer.subarray(0, size))).toEqual(Array.from(bson.serialize({ name: 'x' })));
    });
});
