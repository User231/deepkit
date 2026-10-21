/**
 * A variable-name hint handed to the JIT builder is a hint, never an
 * identifier: whatever a caller passes, the emitted binding is one JavaScript
 * accepts (2026-10-21 — the BSON deserializer names a variable per property,
 * and a property named `carried-differently` made `new Function` throw).
 */
import { describe, test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { sanitizeIdentifier } from '../src/jit.js';

describe('sanitizeIdentifier', () => {
    test('keeps an identifier as it is', () => {
        expect(sanitizeIdentifier('carried')).toBe('carried');
        expect(sanitizeIdentifier('_x$1')).toBe('_x$1');
    });

    test('replaces what a binding refuses', () => {
        expect(sanitizeIdentifier('carried-differently')).toBe('carried_differently');
        expect(sanitizeIdentifier('a b.c')).toBe('a_b_c');
    });

    test('never starts with a digit, never answers empty', () => {
        expect(sanitizeIdentifier('2024')).toBe('_2024');
        expect(sanitizeIdentifier('')).toBe('_');
    });
});
