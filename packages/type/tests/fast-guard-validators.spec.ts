import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { typeOf } from '../src/reflection/reflection.js';
import { Type } from '../src/reflection/type.js';
import { serializer } from '../src/serializer/serializer.js';
import { MaxLength, Maximum, MinLength, Minimum, Validate, integer } from '../src/type-annotations.js';
import { assert, is, isWeak, typeGuard } from '../src/typeguard.js';
import { ValidationError, ValidatorError, validate } from '../src/validator.js';

// A fast guard answers for ANY value: what does not have the type's shape is `false`, never a
// throw. For a type with validators it used to throw — the validators' statements sat above
// the `&&` chain that checks the object, and read `v.params.startRate` of a `v` that was
// `null`, or had no `params` — on exactly the inputs a guard is asked about.

interface Rates {
    startRate: number & Minimum<1> & Maximum<10>;
    steps: integer & Minimum<1>;
}
interface Payload {
    id: string;
    profile: 'stairs';
    params: Rates;
}

const fast = <T>(type: Type) => serializer.buildFastTypeGuard<T>(type);

/** Values that are no object of any of the types below. */
const notObjects = [null, undefined, 'x', 5, 0, true, false, Symbol.iterator, () => 1];

test('a flat object with validators: no value makes the guard throw', () => {
    const guard = fast<Rates>(typeOf<Rates>());
    for (const value of notObjects) expect(guard(value)).toBe(false);
    expect(guard([])).toBe(false);
    expect(guard({})).toBe(false);
    expect(guard({ startRate: 5 })).toBe(false);
    expect(guard({ startRate: '5', steps: 2 })).toBe(false);
    expect(guard({ startRate: null, steps: 2 })).toBe(false);
    expect(guard({ startRate: 5, steps: 2 })).toBe(true);
    expect(guard({ startRate: 11, steps: 2 })).toBe(false);
});

test('a nested object with validators: missing, null and wrong-typed on the way down', () => {
    const guard = fast<Payload>(typeOf<Payload>());
    const head = { id: '1', profile: 'stairs' };
    for (const value of notObjects) expect(guard(value)).toBe(false);
    expect(guard({})).toBe(false);
    expect(guard(head)).toBe(false);
    for (const params of [null, undefined, 5, 'x', true, [], {}, { startRate: 5 }, { startRate: '5', steps: 2 }]) {
        expect(guard({ ...head, params })).toBe(false);
    }
    expect(guard({ ...head, params: { startRate: 5, steps: 2 } })).toBe(true);
    expect(guard({ ...head, params: { startRate: 5, steps: 0 } })).toBe(false);
    // The wrong-typed sibling is found whatever `params` is.
    expect(guard({ id: 1, profile: 'stairs', params: null })).toBe(false);
});

test('typeGuard() and isWeak() of a type with validators', () => {
    const guard = typeGuard<Payload>();
    for (const value of notObjects) expect(guard(value)).toBe(false);
    expect(guard({})).toBe(false);
    expect(guard({ id: '1', profile: 'stairs', params: null })).toBe(false);
    expect(guard({ id: '1', profile: 'stairs', params: { startRate: 5, steps: 2 } })).toBe(true);
    expect(guard({ id: '1', profile: 'stairs', params: { startRate: 50, steps: 2 } })).toBe(false);

    for (const value of notObjects) expect(isWeak<Rates>(value)).toBe(false);
    expect(isWeak<Rates>({ startRate: 5, steps: 2 })).toBe(true);
    expect(isWeak<Rates>({ startRate: 50, steps: 2 })).toBe(false);
});

interface Optional {
    limit?: number & Minimum<1>;
    name: string & MinLength<2>;
    inner?: { code: string & MaxLength<3> };
}

test('optional members with validators', () => {
    const guard = fast<Optional>(typeOf<Optional>());
    for (const value of notObjects) expect(guard(value)).toBe(false);
    expect(guard({})).toBe(false);
    expect(guard({ name: 'ab' })).toBe(true);
    expect(guard({ name: 'ab', limit: undefined, inner: undefined })).toBe(true);
    expect(guard({ name: 'a' })).toBe(false);
    expect(guard({ name: 'ab', limit: 0 })).toBe(false);
    expect(guard({ name: 'ab', inner: {} })).toBe(false);
    expect(guard({ name: 'ab', inner: 5 })).toBe(false);
    expect(guard({ name: 'ab', inner: { code: 'abc' } })).toBe(true);
    expect(guard({ name: 'ab', inner: { code: 'abcd' } })).toBe(false);
});

interface Chain {
    name: string & MinLength<1>;
    next?: Chain;
}

test('a recursive type with validators: the end of the chain is not read past', () => {
    const guard = fast<Chain>(typeOf<Chain>());
    for (const value of notObjects) expect(guard(value)).toBe(false);
    expect(guard({ name: 'a' })).toBe(true);
    // Threw on VALID data: the inlined next level read `next.name` of a `next` that is absent.
    expect(guard({ name: 'a', next: { name: 'b' } })).toBe(true);
    expect(guard({ name: 'a', next: { name: 'b', next: { name: 'c', next: { name: 'd' } } } })).toBe(true);
    expect(guard({ name: 'a', next: { name: 'b', next: { name: '' } } })).toBe(false);
    expect(guard({ name: 'a', next: 5 })).toBe(false);
});

interface InUnion {
    value: (string & MinLength<3>) | (number & Minimum<1>);
}
type Shape = { kind: 'circle'; radius: number & Minimum<0> } | { kind: 'square'; side: number & Minimum<0> };
interface Drawing {
    shape: Shape;
}

test('validators on the members of a union', () => {
    // The one case that threw before fast guards with validators compiled at all: in a union
    // the validators push no error, so this guard always parsed.
    const inUnion = fast<InUnion>(typeOf<InUnion>());
    for (const value of notObjects) expect(inUnion(value)).toBe(false);
    expect(inUnion({})).toBe(false);
    expect(inUnion({ value: 'abc' })).toBe(true);
    expect(inUnion({ value: 'ab' })).toBe(false);
    expect(inUnion({ value: 1 })).toBe(true);
    expect(inUnion({ value: 0 })).toBe(false);

    const drawing = fast<Drawing>(typeOf<Drawing>());
    for (const value of notObjects) expect(drawing(value)).toBe(false);
    expect(drawing({})).toBe(false);
    expect(drawing({ shape: null })).toBe(false);
    expect(drawing({ shape: { kind: 'circle', radius: 1 } })).toBe(true);
    expect(drawing({ shape: { kind: 'circle', radius: -1 } })).toBe(false);
    expect(drawing({ shape: { kind: 'square', radius: 1 } })).toBe(false);
});

function even(value: number) {
    if (value % 2) return new ValidatorError('even', 'Not even');
}
class Step {
    size: number & Validate<typeof even> = 2;
    label: string = '';
}
interface Plan {
    first: Step;
    rest: (number & Minimum<1>)[];
    byName: { [name: string]: number & Maximum<5> };
}

test('a validator function, a class, an array and an index signature', () => {
    const step = fast<Step>(typeOf<Step>());
    for (const value of notObjects) expect(step(value)).toBe(false);
    expect(step({ size: 2, label: '' })).toBe(true);
    expect(step({ size: 3, label: '' })).toBe(false);
    expect(step({ label: '' })).toBe(false);

    const plan = fast<Plan>(typeOf<Plan>());
    for (const value of notObjects) expect(plan(value)).toBe(false);
    expect(plan({})).toBe(false);
    expect(plan({ first: null, rest: [], byName: {} })).toBe(false);
    expect(plan({ first: { size: 2, label: '' }, rest: null, byName: {} })).toBe(false);
    expect(plan({ first: { size: 2, label: '' }, rest: [], byName: null })).toBe(false);
    expect(plan({ first: { size: 2, label: '' }, rest: [1, 2], byName: { a: 5 } })).toBe(true);
    expect(plan({ first: { size: 3, label: '' }, rest: [1, 2], byName: { a: 5 } })).toBe(false);
    expect(plan({ first: { size: 2, label: '' }, rest: [1, 0], byName: { a: 5 } })).toBe(false);
    expect(plan({ first: { size: 2, label: '' }, rest: [1, 2], byName: { a: 6 } })).toBe(false);
});

interface InSet {
    set: Set<Rates>;
}
interface InMap {
    map: Map<string, Rates>;
}

test('Set and Map check their entries through a fast guard: a null entry is an error, not a throw', () => {
    const ok = { startRate: 5, steps: 2 };

    expect(validate<InSet>({ set: new Set([ok]) })).toEqual([]);
    expect(is<InSet>({ set: new Set([null]) })).toBe(false);
    expect(validate<InSet>({ set: new Set([null]) }).map(v => [v.path, v.code])).toEqual([['set', 'type']]);
    expect(validate<InSet>({ set: new Set([ok, undefined, 5]) }).map(v => [v.path, v.code])).toEqual([['set', 'type']]);
    expect(validate<InSet>({ set: new Set([{ startRate: 50, steps: 2 }]) }).map(v => [v.path, v.code])).toEqual([['set', 'type']]);
    expect(() => assert<InSet>({ set: new Set([null]) })).toThrow(ValidationError);

    expect(validate<InMap>({ map: new Map([['a', ok]]) })).toEqual([]);
    expect(is<InMap>({ map: new Map([['a', null]]) })).toBe(false);
    expect(validate<InMap>({ map: new Map([['a', null]]) }).map(v => [v.path, v.code])).toEqual([['map', 'type']]);
    expect(
        validate<InMap>({
            map: new Map<string, unknown>([
                ['a', ok],
                ['b', {}],
            ]),
        }).map(v => [v.path, v.code]),
    ).toEqual([['map', 'type']]);
    expect(() => assert<InMap>({ map: new Map([['a', null]]) })).toThrow(ValidationError);
});
