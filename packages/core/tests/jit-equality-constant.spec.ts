/**
 * `===` and `!==` against a constant, in the interpreter.
 *
 * The interpreter holds the constant of such a comparison and reads a variable beside it in place
 * (`compileEquality`, `src/jit/exec.ts`) — the commonest test of a generated function
 * (`value !== undefined` per property, a key against a name) was three closure calls and is one.
 * A shortcut has to give the answer of the general path: every shape of the two sides is run
 * interpreted and compiled, against what plain JavaScript answers.
 */
import { describe, test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { Builder, Ref, arg, canJIT, fnExec, fnJIT } from '../src/jit.js';

const anObject = { a: 1 };
const aFunction = (): number => 1;
const VALUES: unknown[] = [undefined, null, 0, -0, 1, NaN, '', 'a', '__proto__', true, false, anObject, aFunction, 10n];

type Compare = (b: Builder, left: Ref, right: Ref) => Ref<boolean>;
const OPERATORS: Array<[string, Compare, (a: unknown, b: unknown) => boolean]> = [
    ['===', (b, left, right) => b.eq(left, right), (a, b) => a === b],
    ['!==', (b, left, right) => b.neq(left, right), (a, b) => a !== b],
];

const MODES: Array<[string, typeof fnExec]> = [['interpreted', fnExec], ...(canJIT ? [['compiled', fnJIT] as [string, typeof fnExec]] : [])];

describe('jit: a comparison with a constant', () => {
    for (const [mode, define] of MODES) {
        for (const [operator, compare, expected] of OPERATORS) {
            test(`a variable ${operator} a constant, either side (${mode})`, () => {
                for (const constant of VALUES) {
                    const right = define<boolean>(arg(), (b: Builder, x: Ref) => compare(b, b.let(x), b.lit(constant)));
                    const left = define<boolean>(arg(), (b: Builder, x: Ref) => compare(b, b.lit(constant), b.let(x)));
                    for (const value of VALUES) {
                        expect(right(value)).toBe(expected(value, constant));
                        expect(left(value)).toBe(expected(constant, value));
                    }
                }
            });

            test(`an expression ${operator} a constant, either side (${mode})`, () => {
                for (const constant of VALUES) {
                    // An argument, and a property read: neither is a variable.
                    const input = define<boolean>(arg(), (b: Builder, x: Ref) => compare(b, x, b.lit(constant)));
                    const read = define<boolean>(arg(), (b: Builder, x: Ref) => compare(b, b.lit(constant), b.get(x, 'value')));
                    for (const value of VALUES) {
                        expect(input(value)).toBe(expected(value, constant));
                        expect(read({ value })).toBe(expected(constant, value));
                    }
                }
            });

            test(`a constant ${operator} a constant (${mode})`, () => {
                for (const a of VALUES) {
                    for (const c of VALUES) {
                        const both = define<boolean>((b: Builder) => compare(b, b.lit(a), b.lit(c)));
                        expect(both()).toBe(expected(a, c));
                    }
                }
            });

            test(`two sides that are not constants (${mode})`, () => {
                const general = define<boolean>(arg(), arg(), (b: Builder, x: Ref, y: Ref) => compare(b, b.let(x), y));
                for (const a of VALUES) {
                    for (const c of VALUES) expect(general(a, c)).toBe(expected(a, c));
                }
            });
        }

        test(`the side that is not constant is evaluated once (${mode})`, () => {
            let calls = 0;
            const count = (): string => {
                calls++;
                return 'a';
            };
            const once = define<boolean>((b: Builder) => b.eq(b.call(count), b.lit('a')));
            expect(once()).toBe(true);
            expect(calls).toBe(1);
        });
    }
});
