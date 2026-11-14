import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { typeOf } from '../src/reflection/reflection.js';
import { serializer } from '../src/serializer/serializer.js';
import { Maximum, Minimum, integer } from '../src/type-annotations.js';
import { assert, is } from '../src/typeguard.js';
import { ValidationError, ValidationErrorItem, validate } from '../src/validator.js';

// A tuple that is not valid says why. It used to say so only for a member at a fixed position:
// a rest element was checked through a prebuilt guard that can only answer "no", and what is
// wrong with the tuple itself (not an array, too long) was reported by nobody — `validate()`
// answered `[]` for a value `is()` rejects, and `assert()` threw a ValidationError with no
// errors in it.

/** `path(code)` of every error, in order. */
const brief = (errors: ValidationErrorItem[]) => errors.map(v => `${v.path}(${v.code})`);

interface Rates {
    startRate: number & Minimum<1> & Maximum<10>;
    steps: integer & Minimum<1>;
}

test('a failing rest element is reported at its index', () => {
    expect(validate<[string, ...number[]]>(['a'])).toEqual([]);
    expect(validate<[string, ...number[]]>(['a', 1, 2, 3])).toEqual([]);

    expect(validate<[string, ...number[]]>(['a', 'x'])).toEqual([{ path: '1', code: 'type', message: 'Cannot convert string "x" to number', value: 'x' }]);
    // Every failing element, not the first.
    expect(brief(validate<[string, ...number[]]>(['a', 1, 'x', 2, null]))).toEqual(['2(type)', '4(type)']);
    // Beside a failing member at a fixed position.
    expect(brief(validate<[string, ...number[]]>([1, 'x']))).toEqual(['0(type)', '1(type)']);
});

test('a rest element with validators reports the validator', () => {
    type Positive = [string, ...(number & Minimum<1>)[]];
    expect(validate<Positive>(['a', 1, 2])).toEqual([]);
    expect(validate<Positive>(['a', 1, 0])).toEqual([{ path: '2', code: 'minimum', message: 'Number needs to be greater than or equal to 1', value: 0 }]);
    expect(brief(validate<Positive>(['a', 'x', 0]))).toEqual(['1(type)', '2(minimum)']);
    expect(is<Positive>(['a', 1, 0])).toBe(false);
});

test('a rest element that is an object reports the path into it', () => {
    type Steps = [string, ...Rates[]];
    expect(validate<Steps>(['a', { startRate: 5, steps: 2 }])).toEqual([]);
    // Threw a TypeError: the prebuilt guard of `Rates` read `startRate` of the null.
    expect(validate<Steps>(['a', null])).toEqual([{ path: '1', code: 'type', message: 'Not an object', value: null }]);
    expect(brief(validate<Steps>(['a', { startRate: 5, steps: 2 }, { startRate: 50, steps: 0 }]))).toEqual(['2.startRate(maximum)', '2.steps(minimum)']);
    expect(is<Steps>(['a', null])).toBe(false);
});

test('rest elements in the middle and at the start, and a named rest', () => {
    type Middle = [string, ...number[], boolean];
    expect(validate<Middle>(['a', true])).toEqual([]);
    expect(validate<Middle>(['a', 1, 2, true])).toEqual([]);
    expect(brief(validate<Middle>(['a', 1, 'x', true]))).toEqual(['2(type)']);

    type Leading = [...number[], string];
    expect(validate<Leading>([1, 2, 'a'])).toEqual([]);
    expect(brief(validate<Leading>(['x', 2, 'a']))).toEqual(['0(type)']);

    type Named = [name: string, ...values: number[]];
    expect(validate<Named>(['a', 1])).toEqual([]);
    expect(brief(validate<Named>(['a', 1, 'x']))).toEqual(['2(type)']);
});

test('the path of a rest element continues the path of its tuple', () => {
    interface Holder {
        row: [string, ...number[]];
        rows: [string, ...number[]][];
    }
    expect(validate<Holder>({ row: ['a', 1], rows: [['b', 2]] })).toEqual([]);
    expect(
        brief(
            validate<Holder>({
                row: ['a', 'x'],
                rows: [
                    ['b', 2],
                    ['c', 3, 'y'],
                ],
            }),
        ),
    ).toEqual(['row.1(type)', 'rows.1.2(type)']);
});

test('assert() names the failing rest element', () => {
    let thrown: unknown;
    try {
        assert<[string, ...number[]]>(['a', 'x']);
    } catch (error) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    expect(brief((thrown as ValidationError).errors)).toEqual(['1(type)']);
});

test('a tuple that fails as a whole reports itself', () => {
    // Not an array.
    expect(validate<[string, number]>('x')).toEqual([{ path: '', code: 'type', message: 'Cannot convert string "x" to [string, number]', value: 'x' }]);
    expect(brief(validate<[string, number]>(null))).toEqual(['(type)']);
    expect(brief(validate<[string, number]>({ 0: 'a', 1: 1 }))).toEqual(['(type)']);
    expect(brief(validate<[string, ...number[]]>('x'))).toEqual(['(type)']);
    expect(brief(validate<{ pair: [string, number] }>({ pair: 5 }))).toEqual(['pair(type)']);
    expect(brief(validate<{ pair: [string, number] }>({}))).toEqual(['pair(type)']);

    // Too long.
    expect(brief(validate<[string, number]>(['a', 1, 2]))).toEqual(['(type)']);

    // Short of a required member whose own guard has nothing against a missing value.
    expect(is<[string, unknown]>(['a'])).toBe(false);
    expect(brief(validate<[string, unknown]>(['a']))).toEqual(['(type)']);

    // At the path of the tuple, wherever it sits.
    expect(brief(validate<[number, number][]>([[1, 2], [1, 2, 3], 'x']))).toEqual(['1(type)', '2(type)']);
    expect(brief(validate<[string, ...{ pair: [number, number] }[]]>(['a', { pair: [1, 2] }, { pair: 'x' }]))).toEqual(['2.pair(type)']);
});

test('a tuple whose member reported adds nothing of its own', () => {
    expect(validate<[string, number]>(['a', 'b'])).toEqual([{ path: '1', code: 'type', message: 'Cannot convert string "b" to number', value: 'b' }]);
    expect(brief(validate<[string, number]>(['a']))).toEqual(['1(type)']);
    expect(brief(validate<[name: string, age: number]>([1, 'x']))).toEqual(['name(type)', 'age(type)']);
    expect(validate<[string, number]>(['a', 1])).toEqual([]);
    expect(validate<[a: string, b?: number]>(['a'])).toEqual([]);
});

test('the guard that collects no errors answers the same', () => {
    const rest = serializer.buildFastTypeGuard(typeOf<[string, ...(number & Minimum<1>)[]]>());
    expect(rest(['a'])).toBe(true);
    expect(rest(['a', 1, 2])).toBe(true);
    expect(rest(['a', 1, 0])).toBe(false);
    expect(rest(['a', 'x'])).toBe(false);
    expect(rest('x')).toBe(false);

    const objects = serializer.buildFastTypeGuard(typeOf<[string, ...Rates[]]>());
    expect(objects(['a', { startRate: 5, steps: 2 }])).toBe(true);
    expect(objects(['a', null])).toBe(false);
    expect(objects(['a', { startRate: 50, steps: 2 }])).toBe(false);
});
