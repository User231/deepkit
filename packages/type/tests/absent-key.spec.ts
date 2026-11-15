import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { BackReference, Minimum, PrimaryKey, Reference, assert, is, isStrict, isWeak, typeGuard, typeGuardStrict, validate } from '../index.js';

// ONE rule for a member whose key is absent, whichever function asks and whatever else the
// type holds: the absent key reads `undefined`, and the member's own guard says whether
// `undefined` will do. `unknown` admits it, as it admits every value.
//
// A guard that collects no errors used to ask for the key on top — on one of its two paths.
// The same value was a `UV` for is() and validate() and none for typeGuard(), and whether a
// Set's entries were asked for the key depended on what else their type had in it.
//
// (A tuple is not an object: it has a length, and one short of a required member is short —
// tuple-validation.spec.ts.)

/** A validator: such a type is checked member by member, with statements. */
interface UV {
    payload: unknown;
    n: number & Minimum<1>;
}
/** An array member: the same. */
interface UA {
    payload: unknown;
    n: number[];
}
/** Neither: a bare chain of expressions. */
interface U {
    payload: unknown;
    n: number;
}

test('a required `unknown` member whose key is absent: every guard gives the same answer', () => {
    const value = { n: 5 };

    expect(is<UV>(value)).toBe(true);
    expect(validate<UV>(value)).toEqual([]);
    expect(() => assert<UV>(value)).not.toThrow();
    expect(typeGuard<UV>()(value)).toBe(true);
    expect(isWeak<UV>(value)).toBe(true);
    expect(isStrict<UV>(value)).toBe(true);

    // As the member of a collection — a Set, a Map and a tuple's rest check theirs through a
    // guard that collects no errors.
    expect(is<UV[]>([value])).toBe(true);
    expect(is<Set<UV>>(new Set([value]))).toBe(true);
    expect(validate<Set<UV>>(new Set([value]))).toEqual([]);
    expect(is<Map<string, UV>>(new Map([['a', value]]))).toBe(true);
    expect(validate<Map<string, UV>>(new Map([['a', value]]))).toEqual([]);
    expect(is<[string, ...UV[]]>(['a', value])).toBe(true);
    expect(validate<[string, ...UV[]]>(['a', value])).toEqual([]);
    expect(typeGuard<[string, ...UV[]]>()(['a', value])).toBe(true);
    expect(() => assert<[string, ...UV[]]>(['a', value])).not.toThrow();
    expect(is<[UV]>([value])).toBe(true);
    expect(typeGuard<[UV]>()([value])).toBe(true);

    // The key there, with any value, is the same type.
    for (const payload of [undefined, null, 0, 'x', {}]) {
        expect(typeGuard<UV>()({ n: 5, payload })).toBe(true);
        expect(is<UV>({ n: 5, payload })).toBe(true);
    }

    // A member whose guard has something against `undefined` still needs its key.
    for (const wrong of [{}, { payload: 1 }, { payload: 1, n: undefined }, { payload: 1, n: 0 }]) {
        expect(typeGuard<UV>()(wrong)).toBe(false);
        expect(isWeak<UV>(wrong)).toBe(false);
        expect(is<UV>(wrong)).toBe(false);
        expect(is<Set<UV>>(new Set([wrong]))).toBe(false);
    }
});

test('the answer does not depend on what else the type holds', () => {
    const answers = (accepts: { [call: string]: boolean }) => Object.entries(accepts).filter(([, accepted]) => !accepted);

    expect(
        answers({
            is: is<UA>({ n: [5] }),
            validate: validate<UA>({ n: [5] }).length === 0,
            typeGuard: typeGuard<UA>()({ n: [5] }),
            isWeak: isWeak<UA>({ n: [5] }),
            isStrict: isStrict<UA>({ n: [5] }),
            set: is<Set<UA>>(new Set([{ n: [5] }])),
            map: is<Map<string, UA>>(new Map([['a', { n: [5] }]])),
            rest: typeGuard<[string, ...UA[]]>()(['a', { n: [5] }]),
            tuple: typeGuard<[UA]>()([{ n: [5] }]),
        }),
    ).toEqual([]);

    expect(
        answers({
            is: is<U>({ n: 5 }),
            validate: validate<U>({ n: 5 }).length === 0,
            typeGuard: typeGuard<U>()({ n: 5 }),
            isWeak: isWeak<U>({ n: 5 }),
            isStrict: isStrict<U>({ n: 5 }),
            set: is<Set<U>>(new Set([{ n: 5 }])),
            map: is<Map<string, U>>(new Map([['a', { n: 5 }]])),
            rest: typeGuard<[string, ...U[]]>()(['a', { n: 5 }]),
            tuple: typeGuard<[U]>()([{ n: 5 }]),
        }),
    ).toEqual([]);

    // `any` and `T | undefined` were optional all along.
    expect(typeGuard<{ payload: any; n: number[] }>()({ n: [5] })).toBe(true);
    expect(typeGuard<{ payload: string | undefined; n: number[] }>()({ n: [5] })).toBe(true);
    expect(is<{ payload: any; n: number[] }>({ n: [5] })).toBe(true);
});

class User {
    id: number & PrimaryKey = 0;
}
class Post {
    id: number & PrimaryKey = 0;
}
interface Owned {
    owner: User & Reference;
    tags: string[];
}
interface Listed {
    posts: Post[] & BackReference;
    tags: string[];
}

test('a reference that is not populated: its guard accepts `undefined`, so its key may be absent', () => {
    const value = { tags: ['a'] };

    expect(is<Owned>(value)).toBe(true);
    expect(validate<Owned>(value)).toEqual([]);
    expect(typeGuard<Owned>()(value)).toBe(true);
    expect(isStrict<Owned>(value)).toBe(true);
    expect(is<Set<Owned>>(new Set([value]))).toBe(true);
    expect(typeGuard<Owned>()({ tags: ['a'], owner: 5 })).toBe(true);
    expect(typeGuard<Owned>()({ tags: ['a'], owner: 'x' })).toBe(false);

    expect(is<Listed>(value)).toBe(true);
    expect(typeGuard<Listed>()(value)).toBe(true);
    expect(isStrict<Listed>(value)).toBe(true);
});

test('isStrict: an absent key leaves no room for an unknown one', () => {
    // `{ n: 5, extra: 1 }` has as many keys as `UV` declares. The count alone would let
    // `extra` through in the place of `payload`.
    expect(isStrict<UV>({ n: 5 })).toBe(true);
    expect(isStrict<UV>({ n: 5, payload: undefined })).toBe(true);
    expect(isStrict<UV>({ n: 5, payload: 1 })).toBe(true);
    expect(isStrict<UV>({ n: 5, extra: 1 })).toBe(false);
    expect(isStrict<UV>({ n: 5, payload: 1, extra: 1 })).toBe(false);
    expect(isStrict<UV>({ n: 5, payload: undefined, extra: 1 })).toBe(false);
    expect(typeGuardStrict<U>()({ n: 5 })).toBe(true);
    expect(typeGuardStrict<U>()({ n: 5, extra: 1 })).toBe(false);
    expect(typeGuardStrict<U>()({ payload: 1, extra: 1 })).toBe(false);

    // An optional method is such a member too: absent, it made room for `extra`.
    interface Named {
        name: string;
        rename?(): void;
    }
    expect(isStrict<Named>({ name: 'a' })).toBe(true);
    expect(isStrict<Named>({ name: 'a', rename() {} })).toBe(true);
    expect(isStrict<Named>({ name: 'a', extra: 1 })).toBe(false);
    expect(isStrict<Named>({ name: 'a', rename() {}, extra: 1 })).toBe(false);

    // Every key there: the count decides, as before.
    expect(isStrict<{ a: string; b: number }>({ a: 'x', b: 1 })).toBe(true);
    expect(isStrict<{ a: string; b: number }>({ a: 'x', b: 1, c: 1 })).toBe(false);
    expect(isStrict<{ a: string; b: number }>({ a: 'x' })).toBe(false);
    expect(isStrict<{ a: string; b?: number }>({ a: 'x' })).toBe(true);
    expect(isStrict<{ a: string; b?: number }>({ a: 'x', c: 1 })).toBe(false);
});
