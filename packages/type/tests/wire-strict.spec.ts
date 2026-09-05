import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { cast, deserialize, serialize } from '../index.js';

// What a TYPED wire relies on when it decodes with `loosely: false`: the canonical JSON
// form of every value must be accepted in strict mode — strict refuses COERCIONS, never
// the representation the serializer itself emits.

test('bigint: the canonical string form decodes in strict mode; a number stays loose-only', () => {
    expect(serialize<bigint>(9007199254740993n)).toBe('9007199254740993');
    expect(cast<bigint>('9007199254740993', { loosely: false })).toBe(9007199254740993n);
    expect(cast<bigint>('-12', { loosely: false })).toBe(-12n);
    expect(cast<{ b: bigint }>({ b: '5' }, { loosely: false })).toEqual({ b: 5n });
    expect(cast<bigint>(12)).toBe(12n);
    expect(() => cast<bigint>(12, { loosely: false })).toThrow('Validation error');
    expect(() => cast<bigint>('1.5', { loosely: false })).toThrow('Validation error');
    expect(() => cast<bigint>('', { loosely: false })).toThrow('Validation error');
});

test('void travels as null (JSON has no undefined) and comes back as undefined', () => {
    expect(serialize<{ v?: void }>({ v: undefined })).toEqual({ v: null });
    expect(deserialize<void>(null)).toBe(undefined);
    expect(deserialize<void>(undefined)).toBe(undefined);
    expect(deserialize<void>(null, { loosely: false })).toBe(undefined);
    expect(deserialize<{ v?: void }>({ v: null }).v).toBe(undefined);
});

test('strict mode keeps the canonical forms of the other wire types', () => {
    const iso = '2026-07-03T12:34:56.789Z';
    expect(cast<Date>(iso, { loosely: false }).toISOString()).toBe(iso);
    expect(cast<Uint8Array>('AQI=', { loosely: false })).toEqual(new Uint8Array([1, 2]));
    expect(
        cast<Map<string, Date>>([['k', iso]], { loosely: false })
            .get('k')!
            .toISOString(),
    ).toBe(iso);
    expect(cast<Set<string>>(['a'], { loosely: false })).toEqual(new Set(['a']));
    expect(cast<string | number>('7', { loosely: false })).toBe('7');
    expect(cast<string | number>(7, { loosely: false })).toBe(7);
});

test('strict mode reaches the object member of a union (T | null, T | undefined, nested)', () => {
    interface M {
        t: string | number;
        at: Date;
    }
    const iso = '2026-07-03T12:34:56.789Z';
    const json = { t: '7', at: iso };
    expect(cast<M>(json, { loosely: false }).t).toBe('7');
    expect(cast<M | null>(json, { loosely: false })!.t).toBe('7');
    expect(cast<M | undefined>(json, { loosely: false })!.t).toBe('7');
    expect(cast<{ m: M | null }>({ m: json }, { loosely: false }).m!.t).toBe('7');
    expect(cast<M[] | null>([json], { loosely: false })![0].t).toBe('7');
    expect(cast<M | null>(json, { loosely: false })!.at.toISOString()).toBe(iso);
    expect(cast<M | null>(null, { loosely: false })).toBe(null);
    // loose stays loose: the fork's documented union coercion
    expect(cast<M | null>(json)!.t).toBe(7);
    // the special Map/Set members of a union get the options too
    expect(cast<Map<string, bigint> | null>([['a', '5']], { loosely: false })!.get('a')).toBe(5n);
    expect(cast<Set<string> | null>(['a'], { loosely: false })).toEqual(new Set(['a']));
});
