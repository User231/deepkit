import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { cast, deserialize, serialize } from '../src/serializer-facade.js';
import { assert, is, isStrict, typeGuard } from '../src/typeguard.js';
import { ValidationError, validate } from '../src/validator.js';

// A recursive type is compiled as a function of its own, called wherever the type comes up
// again. The call used to read that function from a variable, assigned at the place the type
// was FIRST met — and when that place sat in a block that did not run, every later call found
// the variable empty: `TypeError: fn is not a function`, on valid data.

/** `Tree` is first met under `meta`, an optional member; `next` meets it again. */
interface Tree {
    meta?: { parent?: Tree; tags: string[] };
    next?: Tree;
}

test('a recursive type first met inside an absent optional member', () => {
    const value: Tree = { next: { next: {} } };

    expect(serialize<Tree>(value)).toEqual({ next: { next: {} } });
    expect(deserialize<Tree>(value)).toEqual({ next: { next: {} } });
    expect(cast<Tree>(value)).toEqual({ next: { next: {} } });
    expect(validate<Tree>(value)).toEqual([]);
    expect(is<Tree>(value)).toBe(true);
    expect(() => assert<Tree>(value)).not.toThrow();
    expect(typeGuard<Tree>()(value)).toBe(true);
    expect(isStrict<Tree>(value)).toBe(true);

    // With the member present, both places are reached — and both still check.
    const full: Tree = { meta: { parent: { next: {} }, tags: ['a'] }, next: { meta: { tags: [] } } };
    expect(deserialize<Tree>(full)).toEqual(full);
    expect(validate<Tree>(full)).toEqual([]);
    expect(typeGuard<Tree>()(full)).toBe(true);
    expect(typeGuard<Tree>()({ next: { meta: { tags: [5] } } })).toBe(false);
    expect(typeGuard<Tree>()({ meta: { parent: { next: 5 }, tags: [] } })).toBe(false);
    expect(validate<Tree>({ next: { next: 5 } }).map(v => v.code)).toEqual(['type']);
});

/** `Chain` is first met under `head`, a required member. */
interface Chain {
    head: { previous?: Chain; values: number[] };
    next?: Chain;
}

test('a recursive type first met inside an object that is not there: an error, not a throw', () => {
    const link: Chain = { head: { values: [1] } };

    // `head` is null: its members are not looked at, and `next` is still checked.
    const errors = validate<Chain>({ head: null, next: link });
    expect(errors.map(v => [v.path, v.code])).toEqual([['head', 'type']]);
    expect(is<Chain>({ head: null, next: link })).toBe(false);
    expect(() => assert<Chain>({ head: null, next: link })).toThrow(ValidationError);
    expect(() => cast<Chain>({ head: null, next: link })).toThrow(ValidationError);

    expect(validate<Chain>({ head: { values: [1] }, next: link })).toEqual([]);
    expect(validate<Chain>({ head: null, next: { head: null } }).map(v => v.code)).toEqual(['type', 'type']);
});

type Step = { kind: 'jump'; to?: Flow } | { kind: 'stop' };
/** `Flow` is first met in one case of a discriminated union's switch. */
interface Flow {
    step?: Step;
    next?: Flow;
}

test('a recursive type first met inside one member of a discriminated union', () => {
    expect(deserialize<Flow>({ next: {} })).toEqual({ next: {} });
    expect(serialize<Flow>({ next: {} })).toEqual({ next: {} });
    expect(deserialize<Flow>({ step: { kind: 'stop' }, next: { step: { kind: 'jump', to: {} } } })).toEqual({
        step: { kind: 'stop' },
        next: { step: { kind: 'jump', to: {} } },
    });
    expect(validate<Flow>({ step: { kind: 'stop' }, next: { step: { kind: 'jump', to: {} } } })).toEqual([]);
});
