/**
 * Property names that are not JavaScript identifiers — `carried-differently`,
 * `left-behind`, `2024`, `a b` — must survive the JIT: the deserializer names
 * a variable after each property, and a hint that is not a binding made
 * `new Function` throw `Unexpected token '-'` (2026-10-21, a Record keyed by
 * a dashed literal union on an RPC view).
 */
import { describe, test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { deserializeBSON, getBSONDeserializer, serializeBSON } from '../../index.js';

type Register = 'carried' | 'carried-differently' | 'left-behind' | '2024' | 'a b';

interface Summary {
    id: string;
    registers: Record<Register, number>;
}

interface Dashed {
    'carried-differently': number;
    'left-behind'?: string;
    plain: boolean;
}

describe('BSON: property names that are not identifiers', () => {
    test('a Record keyed by a dashed literal union round-trips', () => {
        const value: Summary = {
            id: '1',
            registers: { carried: 1, 'carried-differently': 2, 'left-behind': 3, '2024': 4, 'a b': 5 },
        };
        expect(deserializeBSON<Summary>(serializeBSON<Summary>(value))).toEqual(value);
    });

    test('an object literal with dashed and optional properties round-trips', () => {
        const value: Dashed = { 'carried-differently': 7, plain: true };
        const deserializer = getBSONDeserializer<Dashed>();
        expect(deserializer(serializeBSON<Dashed>(value))).toEqual(value);
        const full: Dashed = { 'carried-differently': 7, 'left-behind': 'x', plain: false };
        expect(deserializer(serializeBSON<Dashed>(full))).toEqual(full);
    });

    test('an array of such records round-trips', () => {
        const value: Summary[] = [{ id: 'a', registers: { carried: 0, 'carried-differently': 0, 'left-behind': 0, '2024': 0, 'a b': 0 } }];
        expect(deserializeBSON<Summary[]>(serializeBSON<Summary[]>(value))).toEqual(value);
    });
});
