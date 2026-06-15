/**
 * `& Reference & Inline` serializes as the full nested object for presentation serializers
 * (JSON), while database serializers keep emitting the foreign key. Circular graphs are
 * broken with `undefined` via the object serializer's runtime _stack.
 */
import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import {
    BackReference,
    Inline,
    PrimaryKey,
    Reference,
    Serializer,
    registerDefaultHandlers,
    registerTypeGuards,
    serialize,
} from '../index.js';

class Plain {
    id: number & PrimaryKey = 0;
    name: string = '';
    ref?: Plain & Reference;
}

class Inlined {
    id: number & PrimaryKey = 0;
    name: string = '';
    ref?: Inlined & Reference & Inline;
    refs?: Inlined[] & BackReference & Inline;
}

test('plain & Reference still serializes as FK (regression)', () => {
    const a = new Plain();
    a.id = 1;
    a.name = 'a';
    const b = new Plain();
    b.id = 2;
    b.name = 'b';
    a.ref = b;

    expect(serialize<Plain>(a)).toEqual({ id: 1, name: 'a', ref: 2 });
});

test('& Reference & Inline serializes as a nested object (JSON)', () => {
    const a = new Inlined();
    a.id = 1;
    a.name = 'a';
    const b = new Inlined();
    b.id = 2;
    b.name = 'b';
    b.ref = a; // give b a forward ref so the nested object has a populated ref too
    a.ref = b;

    const out = serialize<Inlined>(a) as any;
    expect(typeof out.ref).toBe('object');
    expect(out.ref.id).toBe(2);
    expect(out.ref.name).toBe('b');
    // b.ref points back to a (circular) → serialized as undefined
    expect(out.ref.ref).toBe(undefined);
});

test('database serializers (inlineReferences=false) keep emitting FK', () => {
    // A serializer whose `inlineReferences` stays false (the default) must ignore bare `& Inline`.
    class DbSerializer extends Serializer {
        constructor() {
            super('sql');
            registerDefaultHandlers(this);
            registerTypeGuards(this);
        }
    }
    const db = new DbSerializer();

    const a = new Inlined();
    a.id = 1;
    a.name = 'a';
    const b = new Inlined();
    b.id = 2;
    b.name = 'b';
    a.ref = b;

    expect(serialize<Inlined>(a, undefined, db)).toEqual({ id: 1, name: 'a', ref: 2 });
});
