import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { isStrict, isWeak, typeGuard } from '../src/typeguard.js';

// A guard answers `true` or `false`. A member of a kind that has no guard of its own is
// "checked" by its value, and a chain that ended in one handed that value out: `undefined`
// for an absent member (found by review, 2026-11-15, after the key check was dropped).
test('a guard answers a boolean when a member has a kind with no guard of its own', () => {
    interface WithSymbol {
        m: symbol;
        arr: number[];
    }
    interface WithVoid {
        a: void;
        n: number;
    }
    interface WithObject {
        o: object;
        n: number;
    }
    interface WithPromise {
        p: Promise<string>;
        n: number;
    }

    const guards: [string, (value: unknown) => unknown, unknown][] = [
        ['symbol, absent', typeGuard<WithSymbol>(), { arr: [] }],
        ['symbol, present', typeGuard<WithSymbol>(), { m: Symbol('x'), arr: [1] }],
        ['void, absent', typeGuard<WithVoid>(), { n: 1 }],
        ['object, absent', typeGuard<WithObject>(), { n: 1 }],
        ['object, present', typeGuard<WithObject>(), { o: {}, n: 1 }],
        ['promise, absent', typeGuard<WithPromise>(), { n: 1 }],
        ['not an object', typeGuard<WithSymbol>(), null],
        ['strict, absent', (value: unknown) => isStrict<WithSymbol>(value), { arr: [] }],
        ['weak, absent', (value: unknown) => isWeak<WithSymbol>(value), { arr: [] }],
    ];
    for (const [name, guard, value] of guards) {
        const answer = guard(value);
        expect(`${name}: ${typeof answer}`).toBe(`${name}: boolean`);
    }
    // And the answers themselves are what they were: an absent symbol is no symbol.
    expect(typeGuard<WithSymbol>()({ arr: [] })).toBe(false);
    expect(typeGuard<WithSymbol>()({ m: Symbol('x'), arr: [1] })).toBe(true);
});
