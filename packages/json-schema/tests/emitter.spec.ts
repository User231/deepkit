import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { Maximum, MinLength, PositiveNoZero, integer, typeOf } from '@deepkit/type';

import { SchemaEmitter, typeToJsonSchema } from '../src/emitter.js';

interface Inner {
    /** A documented field. */
    label: string & MinLength<2>;
    count: integer & Maximum<10>;
}

interface Outer {
    id: string;
    inner: Inner;
    list: Inner[];
    maybe?: number;
    nullable: string | null;
    ratio: number & PositiveNoZero;
    when: Date;
    big: bigint;
    bag: Record<string, number>;
    anything: unknown;
    tuple: [string, number];
}

enum Colour {
    Red = 'red',
    Blue = 'blue',
}

type Explicit = 'x' | 'y';

type Shape = { kind: 'circle'; radius: number } | { kind: 'square'; side: number };
// A flattened alias: `Shape`'s two variants plus one more (a type alias's own doc comment is not reflected).
type AnyShape = Shape | { kind: 'point' };

function documentOf(entries: [string, ReturnType<typeof typeOf>][]) {
    const emitter = new SchemaEmitter();
    for (const [name, type] of entries) emitter.define(name, type);
    return emitter.sortedDefs();
}

test('names nested object types once and references them', () => {
    const defs = documentOf([['Outer', typeOf<Outer>()]]);
    expect(Object.keys(defs)).toEqual(['Inner', 'Outer']);
    expect(defs.Outer).toEqual({
        type: 'object',
        properties: {
            id: { type: 'string' },
            inner: { $ref: '#/$defs/Inner' },
            list: { type: 'array', items: { $ref: '#/$defs/Inner' } },
            maybe: { type: 'number' },
            nullable: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            ratio: { type: 'number', exclusiveMinimum: 0 },
            when: { type: 'string', format: 'date-time' },
            big: { type: 'string', pattern: '^-?\\d+$', description: 'bigint as a decimal string' },
            bag: { type: 'object', properties: {}, additionalProperties: { type: 'number' } },
            anything: {},
            tuple: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], minItems: 2, maxItems: 2 },
        },
        additionalProperties: false,
        required: ['id', 'inner', 'list', 'nullable', 'ratio', 'when', 'big', 'bag', 'anything', 'tuple'],
    });
});

test('carries the integer brand, the validators and the doc comment', () => {
    const defs = documentOf([['Inner', typeOf<Inner>()]]);
    expect(defs.Inner).toEqual({
        type: 'object',
        properties: {
            label: { description: 'A documented field.', type: 'string', minLength: 2 },
            count: { type: 'integer', maximum: 10 },
        },
        additionalProperties: false,
        required: ['label', 'count'],
    });
});

test('turns literal unions and TS enums into enums', () => {
    const defs = documentOf([
        ['Explicit', typeOf<Explicit>()],
        ['Colour', typeOf<Colour>()],
    ]);
    expect(defs.Explicit).toEqual({ type: 'string', enum: ['x', 'y'] });
    expect(defs.Colour).toEqual({ enum: ['red', 'blue'] });
});

test('turns a discriminated union into oneOf over named variants, reusing a flattened alias’s variants', () => {
    const defs = documentOf([
        ['Shape', typeOf<Shape>()],
        ['AnyShape', typeOf<AnyShape>()],
    ]);
    expect(defs.Shape).toEqual({ oneOf: [{ $ref: '#/$defs/ShapeCircle' }, { $ref: '#/$defs/ShapeSquare' }] });
    expect(defs.ShapeSquare).toEqual({
        type: 'object',
        properties: { kind: { const: 'square' }, side: { type: 'number' } },
        additionalProperties: false,
        required: ['kind', 'side'],
    });
    // The alias reaches the same two objects: no structural twins, one new variant.
    expect(defs.AnyShape).toEqual({
        oneOf: [{ $ref: '#/$defs/ShapeCircle' }, { $ref: '#/$defs/ShapeSquare' }, { $ref: '#/$defs/AnyShapePoint' }],
    });
    expect(Object.keys(defs)).toEqual(['AnyShape', 'AnyShapePoint', 'Shape', 'ShapeCircle', 'ShapeSquare']);
});

test('a standalone schema puts the type at the root and what it reaches under $defs', () => {
    const schema = typeToJsonSchema(typeOf<Outer>());
    expect(schema.type).toBe('object');
    expect((schema.properties as Record<string, unknown>).inner).toEqual({ $ref: '#/$defs/Inner' });
    expect(Object.keys(schema.$defs as object)).toEqual(['Inner']);
    // A type reaching nothing named has no $defs at all.
    expect(typeToJsonSchema(typeOf<Explicit>())).toEqual({ type: 'string', enum: ['x', 'y'] });
    expect(typeToJsonSchema(typeOf<{ a: string }>())).toEqual({
        type: 'object',
        properties: { a: { type: 'string' } },
        additionalProperties: false,
        required: ['a'],
    });
});

test('is deterministic', () => {
    const once = JSON.stringify(
        documentOf([
            ['Outer', typeOf<Outer>()],
            ['AnyShape', typeOf<AnyShape>()],
        ]),
    );
    expect(
        JSON.stringify(
            documentOf([
                ['Outer', typeOf<Outer>()],
                ['AnyShape', typeOf<AnyShape>()],
            ]),
        ),
    ).toBe(once);
});

test('refuses a type with no JSON form', () => {
    expect(() => typeToJsonSchema(typeOf<() => void>())).toThrow('json-schema: cannot express');
});
