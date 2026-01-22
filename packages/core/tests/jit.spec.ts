import { describe, expect, test } from '@jest/globals';

import { Context, ExecContext, ExecSlot, JITContext, Slot, canJIT, getJitThreshold, getRuntimeCapabilities, jit, setJitThreshold } from '../src/jit.js';

describe('jit', () => {
    describe('runtime detection', () => {
        test('canJIT is boolean', () => {
            expect(typeof canJIT).toBe('boolean');
        });

        test('getRuntimeCapabilities returns valid object', () => {
            const caps = getRuntimeCapabilities();
            expect(typeof caps.newFunction).toBe('boolean');
            expect(['node', 'deno', 'bun', 'cloudflare', 'browser', 'unknown']).toContain(caps.runtime);
            expect(typeof caps.trustedTypes).toBe('boolean');
            expect(typeof caps.webAssembly).toBe('boolean');
        });

        test('canJIT matches getRuntimeCapabilities', () => {
            expect(canJIT).toBe(getRuntimeCapabilities().newFunction);
        });
    });

    // Helper to run tests in both JIT and Exec modes
    function testBothModes(name: string, testFn: (fnBuilder: typeof jit.fn) => void) {
        describe(name, () => {
            test('JIT mode', () => testFn(jit.fnJIT));
            test('Exec mode', () => testFn(jit.fnExec));
        });
    }

    describe('jit.fn basics', () => {
        testBothModes('returns primitive value', fn => {
            const f = fn(ctx => ctx.lit(42));
            expect(f()).toBe(42);
        });

        testBothModes('returns string literal', fn => {
            const f = fn(ctx => ctx.lit('hello'));
            expect(f()).toBe('hello');
        });

        testBothModes('returns null literal', fn => {
            const f = fn(ctx => ctx.lit(null));
            expect(f()).toBe(null);
        });

        testBothModes('returns undefined literal', fn => {
            const f = fn(ctx => ctx.lit(undefined));
            expect(f()).toBe(undefined);
        });

        testBothModes('passes through argument', fn => {
            const f = fn(jit.arg<number>(), (ctx, x) => x);
            expect(f(123)).toBe(123);
        });

        testBothModes('passes through multiple arguments', fn => {
            const f = fn(jit.arg<number>(), jit.arg<string>(), (ctx, a, b) => {
                const result = ctx.let(ctx.arrExpr());
                ctx.push(result, a);
                ctx.push(result, b);
                return result;
            });
            expect(f(1, 'two')).toEqual([1, 'two']);
        });
    });

    describe('object operations', () => {
        testBothModes('creates empty object', fn => {
            const f = fn(ctx => ctx.let(ctx.objExpr()));
            expect(f()).toEqual({});
        });

        testBothModes('sets property with string key', fn => {
            const f = fn(ctx => {
                const obj = ctx.let(ctx.objExpr());
                ctx.set(obj, 'name', ctx.lit('John'));
                return obj;
            });
            expect(f()).toEqual({ name: 'John' });
        });

        testBothModes('sets property with slot key', fn => {
            const f = fn(jit.arg<string>(), (ctx, key) => {
                const obj = ctx.let(ctx.objExpr());
                ctx.set(obj, key, ctx.lit('value'));
                return obj;
            });
            expect(f('dynamic')).toEqual({ dynamic: 'value' });
        });

        testBothModes('gets property with string key', fn => {
            const f = fn(jit.arg<any>(), (ctx, input) => {
                return ctx.get(input, 'name');
            });
            expect(f({ name: 'Alice' })).toBe('Alice');
        });

        testBothModes('gets property with slot key', fn => {
            const f = fn(jit.arg<any>(), jit.arg<string>(), (ctx, input, key) => {
                return ctx.get(input, key);
            });
            expect(f({ foo: 'bar' }, 'foo')).toBe('bar');
        });

        testBothModes('checks property existence with has()', fn => {
            const f = fn(jit.arg<any>(), (ctx, input) => {
                return ctx.has(input, 'name');
            });
            expect(f({ name: 'test' })).toBe(true);
            expect(f({ other: 'test' })).toBe(false);
        });

        testBothModes('copies object properties', fn => {
            const f = fn(jit.arg<any>(), (ctx, input) => {
                const output = ctx.let(ctx.objExpr());
                ctx.set(output, 'id', ctx.get(input, 'id'));
                ctx.set(output, 'name', ctx.get(input, 'name'));
                return output;
            });
            expect(f({ id: 1, name: 'Test', extra: 'ignored' })).toEqual({ id: 1, name: 'Test' });
        });

        testBothModes('creates object with objFrom() using string keys', fn => {
            const f = fn(jit.arg<any>(), (ctx, input) => {
                return ctx.objFrom([
                    ['id', ctx.get(input, 'id')],
                    ['name', ctx.get(input, 'name')],
                ]);
            });
            expect(f({ id: 1, name: 'Test', extra: 'ignored' })).toEqual({ id: 1, name: 'Test' });
        });

        testBothModes('creates object with objFrom() using non-identifier keys', fn => {
            const f = fn(jit.arg<any>(), (ctx, input) => {
                return ctx.objFrom([
                    ['weird-key', ctx.get(input, 'a')],
                    ['123start', ctx.get(input, 'b')],
                ]);
            });
            expect(f({ a: 'valueA', b: 'valueB' })).toEqual({ 'weird-key': 'valueA', '123start': 'valueB' });
        });

        testBothModes('creates object with objFrom() using dynamic slot keys', fn => {
            const f = fn(jit.arg<any>(), jit.arg<string>(), (ctx, input, keyName) => {
                return ctx.objFrom([[keyName, ctx.get(input, 'value')]]);
            });
            expect(f({ value: 42 }, 'dynamic')).toEqual({ dynamic: 42 });
        });
    });

    describe('array operations', () => {
        testBothModes('creates empty array', fn => {
            const f = fn(ctx => ctx.let(ctx.arrExpr()));
            expect(f()).toEqual([]);
        });

        testBothModes('pushes to array', fn => {
            const f = fn(ctx => {
                const arr = ctx.let(ctx.arrExpr());
                ctx.push(arr, ctx.lit(1));
                ctx.push(arr, ctx.lit(2));
                ctx.push(arr, ctx.lit(3));
                return arr;
            });
            expect(f()).toEqual([1, 2, 3]);
        });

        testBothModes('gets array element with at()', fn => {
            const f = fn(jit.arg<number[]>(), (ctx, arr) => {
                return ctx.at(arr, ctx.lit(1));
            });
            expect(f([10, 20, 30])).toBe(20);
        });

        testBothModes('gets array element with dynamic index', fn => {
            const f = fn(jit.arg<number[]>(), jit.arg<number>(), (ctx, arr, idx) => {
                return ctx.at(arr, idx);
            });
            expect(f([10, 20, 30], 2)).toBe(30);
        });

        testBothModes('gets array length', fn => {
            const f = fn(jit.arg<any[]>(), (ctx, arr) => {
                return ctx.len(arr);
            });
            expect(f([1, 2, 3, 4, 5])).toBe(5);
            expect(f([])).toBe(0);
        });

        testBothModes('gets string length', fn => {
            const f = fn(jit.arg<string>(), (ctx, str) => {
                return ctx.len(str);
            });
            expect(f('hello')).toBe(5);
        });
    });

    describe('equality operations', () => {
        testBothModes('strict equality with eq()', fn => {
            const f = fn(jit.arg<any>(), jit.arg<any>(), (ctx, a, b) => {
                return ctx.eq(a, b);
            });
            expect(f(1, 1)).toBe(true);
            expect(f(1, '1')).toBe(false);
            expect(f(null, null)).toBe(true);
            expect(f(undefined, undefined)).toBe(true);
            expect(f(null, undefined)).toBe(false);
        });

        testBothModes('strict inequality with neq()', fn => {
            const f = fn(jit.arg<any>(), jit.arg<any>(), (ctx, a, b) => {
                return ctx.neq(a, b);
            });
            expect(f(1, 2)).toBe(true);
            expect(f(1, 1)).toBe(false);
            expect(f(1, '1')).toBe(true);
        });
    });

    describe('comparison operations', () => {
        testBothModes('less than with lt()', fn => {
            const f = fn(jit.arg<number>(), jit.arg<number>(), (ctx, a, b) => {
                return ctx.lt(a, b);
            });
            expect(f(1, 2)).toBe(true);
            expect(f(2, 2)).toBe(false);
            expect(f(3, 2)).toBe(false);
        });

        testBothModes('greater than with gt()', fn => {
            const f = fn(jit.arg<number>(), jit.arg<number>(), (ctx, a, b) => {
                return ctx.gt(a, b);
            });
            expect(f(3, 2)).toBe(true);
            expect(f(2, 2)).toBe(false);
            expect(f(1, 2)).toBe(false);
        });

        testBothModes('less than or equal with lte()', fn => {
            const f = fn(jit.arg<number>(), jit.arg<number>(), (ctx, a, b) => {
                return ctx.lte(a, b);
            });
            expect(f(1, 2)).toBe(true);
            expect(f(2, 2)).toBe(true);
            expect(f(3, 2)).toBe(false);
        });

        testBothModes('greater than or equal with gte()', fn => {
            const f = fn(jit.arg<number>(), jit.arg<number>(), (ctx, a, b) => {
                return ctx.gte(a, b);
            });
            expect(f(3, 2)).toBe(true);
            expect(f(2, 2)).toBe(true);
            expect(f(1, 2)).toBe(false);
        });
    });

    describe('logical operations', () => {
        testBothModes('negation with not()', fn => {
            const f = fn(jit.arg<boolean>(), (ctx, a) => {
                return ctx.not(a);
            });
            expect(f(true)).toBe(false);
            expect(f(false)).toBe(true);
        });

        testBothModes('logical AND with and()', fn => {
            const f = fn(jit.arg<boolean>(), jit.arg<boolean>(), (ctx, a, b) => {
                return ctx.and(a, b);
            });
            expect(f(true, true)).toBe(true);
            expect(f(true, false)).toBe(false);
            expect(f(false, true)).toBe(false);
            expect(f(false, false)).toBe(false);
        });

        testBothModes('logical OR with or()', fn => {
            const f = fn(jit.arg<boolean>(), jit.arg<boolean>(), (ctx, a, b) => {
                return ctx.or(a, b);
            });
            expect(f(true, true)).toBe(true);
            expect(f(true, false)).toBe(true);
            expect(f(false, true)).toBe(true);
            expect(f(false, false)).toBe(false);
        });
    });

    describe('type checks', () => {
        testBothModes('typeof check with isType()', fn => {
            const isString = fn(jit.arg<any>(), (ctx, v) => ctx.isType(v, 'string'));
            const isNumber = fn(jit.arg<any>(), (ctx, v) => ctx.isType(v, 'number'));
            const isObject = fn(jit.arg<any>(), (ctx, v) => ctx.isType(v, 'object'));
            const isFunction = fn(jit.arg<any>(), (ctx, v) => ctx.isType(v, 'function'));

            expect(isString('hello')).toBe(true);
            expect(isString(123)).toBe(false);
            expect(isNumber(123)).toBe(true);
            expect(isNumber('123')).toBe(false);
            expect(isObject({})).toBe(true);
            expect(isObject(null)).toBe(true); // typeof null === 'object'
            expect(isFunction(() => {})).toBe(true);
        });

        testBothModes('null check with isNull()', fn => {
            const f = fn(jit.arg<any>(), (ctx, v) => ctx.isNull(v));
            expect(f(null)).toBe(true);
            expect(f(undefined)).toBe(false);
            expect(f(0)).toBe(false);
            expect(f('')).toBe(false);
            expect(f({})).toBe(false);
        });

        testBothModes('nullish check with isNullish()', fn => {
            const f = fn(jit.arg<any>(), (ctx, v) => ctx.isNullish(v));
            expect(f(null)).toBe(true);
            expect(f(undefined)).toBe(true);
            expect(f(0)).toBe(false);
            expect(f('')).toBe(false);
            expect(f(false)).toBe(false);
        });
    });

    describe('function calls', () => {
        testBothModes('calls external function with call()', fn => {
            const double = (x: number) => x * 2;
            const f = fn(jit.arg<number>(), (ctx, x) => {
                return ctx.callExpr(double, x);
            });
            expect(f(5)).toBe(10);
            expect(f(21)).toBe(42);
        });

        testBothModes('calls function with multiple args', fn => {
            const add = (a: number, b: number, c: number) => a + b + c;
            const f = fn(jit.arg<number>(), jit.arg<number>(), jit.arg<number>(), (ctx, a, b, c) => {
                return ctx.callExpr(add, a, b, c);
            });
            expect(f(1, 2, 3)).toBe(6);
        });

        testBothModes('creates instance with new_()', fn => {
            class Point {
                constructor(
                    public x: number,
                    public y: number,
                ) {}
            }
            const f = fn(jit.arg<number>(), jit.arg<number>(), (ctx, x, y) => {
                return ctx.newExpr(Point, x, y);
            });
            const point = f(10, 20);
            expect(point).toBeInstanceOf(Point);
            expect(point.x).toBe(10);
            expect(point.y).toBe(20);
        });
    });

    describe('control flow - when()', () => {
        testBothModes('executes then branch when true', fn => {
            const f = fn(jit.arg<boolean>(), (ctx, cond) => {
                const result = ctx.let(ctx.objExpr());
                ctx.when(
                    cond,
                    () => {
                        ctx.set(result, 'branch', ctx.lit('then'));
                    },
                    () => {
                        ctx.set(result, 'branch', ctx.lit('else'));
                    },
                );
                return result;
            });
            expect(f(true)).toEqual({ branch: 'then' });
            expect(f(false)).toEqual({ branch: 'else' });
        });

        testBothModes('early return from then branch', fn => {
            const f = fn(jit.arg<any>(), (ctx, input) => {
                ctx.when(ctx.isNull(input), () => {
                    return ctx.lit('was null');
                });
                return ctx.lit('not null');
            });
            expect(f(null)).toBe('was null');
            expect(f('value')).toBe('not null');
        });

        testBothModes('early return from else branch', fn => {
            const f = fn(jit.arg<boolean>(), (ctx, cond) => {
                ctx.when(
                    cond,
                    () => {
                        return ctx.lit('from then');
                    },
                    () => {
                        return ctx.lit('from else');
                    },
                );
                return ctx.lit('never reached');
            });
            expect(f(true)).toBe('from then');
            expect(f(false)).toBe('from else');
        });

        testBothModes('nested when statements', fn => {
            const f = fn(jit.arg<number>(), (ctx, n) => {
                const result = ctx.let(ctx.objExpr());
                ctx.when(
                    ctx.lt(n, ctx.lit(0)),
                    () => {
                        ctx.set(result, 'sign', ctx.lit('negative'));
                    },
                    () => {
                        ctx.when(
                            ctx.gt(n, ctx.lit(0)),
                            () => {
                                ctx.set(result, 'sign', ctx.lit('positive'));
                            },
                            () => {
                                ctx.set(result, 'sign', ctx.lit('zero'));
                            },
                        );
                    },
                );
                return result;
            });
            expect(f(-5)).toEqual({ sign: 'negative' });
            expect(f(5)).toEqual({ sign: 'positive' });
            expect(f(0)).toEqual({ sign: 'zero' });
        });
    });

    describe('control flow - loop()', () => {
        testBothModes('iterates over array', fn => {
            const f = fn(jit.arg<number[]>(), (ctx, arr) => {
                const result = ctx.let(ctx.arrExpr());
                ctx.loop(arr, (elem, idx) => {
                    ctx.push(result, elem);
                });
                return result;
            });
            expect(f([1, 2, 3])).toEqual([1, 2, 3]);
        });

        testBothModes('provides correct index', fn => {
            const f = fn(jit.arg<string[]>(), (ctx, arr) => {
                const result = ctx.let(ctx.arrExpr());
                ctx.loop(arr, (elem, idx) => {
                    ctx.push(result, idx);
                });
                return result;
            });
            expect(f(['a', 'b', 'c'])).toEqual([0, 1, 2]);
        });

        testBothModes('transforms array elements', fn => {
            const double = (x: number) => x * 2;
            const f = fn(jit.arg<number[]>(), (ctx, arr) => {
                const result = ctx.let(ctx.arrExpr());
                ctx.loop(arr, (elem, idx) => {
                    ctx.push(result, ctx.callExpr(double, elem));
                });
                return result;
            });
            expect(f([1, 2, 3])).toEqual([2, 4, 6]);
        });

        testBothModes('handles empty array', fn => {
            const f = fn(jit.arg<any[]>(), (ctx, arr) => {
                const result = ctx.let(ctx.arrExpr());
                ctx.loop(arr, elem => {
                    ctx.push(result, elem);
                });
                return result;
            });
            expect(f([])).toEqual([]);
        });

        testBothModes('early return inside loop', fn => {
            const f = fn(jit.arg<number[]>(), (ctx, arr) => {
                const result = ctx.let(ctx.arrExpr());
                ctx.loop(arr, elem => {
                    ctx.when(ctx.eq(elem, ctx.lit(3)), () => {
                        return ctx.lit('found 3');
                    });
                    ctx.push(result, elem);
                });
                return result;
            });
            // Should return 'found 3' when encountering 3
            expect(f([1, 2, 3, 4, 5])).toBe('found 3');
            // Should return full array if 3 not present
            expect(f([1, 2, 4, 5])).toEqual([1, 2, 4, 5]);
        });
    });

    describe('control flow - map()', () => {
        testBothModes('maps array elements', fn => {
            const f = fn(jit.arg<number[]>(), (ctx, arr) => {
                return ctx.map(arr, (elem, idx) => elem);
            });
            expect(f([1, 2, 3])).toEqual([1, 2, 3]);
        });

        testBothModes('transforms elements with callback', fn => {
            const double = (x: number) => x * 2;
            const f = fn(jit.arg<number[]>(), (ctx, arr) => {
                return ctx.map(arr, elem => ctx.callExpr(double, elem));
            });
            expect(f([1, 2, 3])).toEqual([2, 4, 6]);
        });

        testBothModes('maps to object literals', fn => {
            const f = fn(jit.arg<any[]>(), (ctx, arr) => {
                return ctx.map(arr, elem => {
                    return ctx.objFrom([
                        ['id', ctx.get(elem, 'id')],
                        ['name', ctx.get(elem, 'name')],
                    ]);
                });
            });
            const input = [
                { id: 1, name: 'Alice' },
                { id: 2, name: 'Bob' },
            ];
            expect(f(input)).toEqual([
                { id: 1, name: 'Alice' },
                { id: 2, name: 'Bob' },
            ]);
        });

        testBothModes('provides correct index', fn => {
            const f = fn(jit.arg<string[]>(), (ctx, arr) => {
                return ctx.map(arr, (elem, idx) => idx);
            });
            expect(f(['a', 'b', 'c'])).toEqual([0, 1, 2]);
        });

        testBothModes('handles empty array', fn => {
            const f = fn(jit.arg<any[]>(), (ctx, arr) => {
                return ctx.map(arr, elem => elem);
            });
            expect(f([])).toEqual([]);
        });
    });

    describe('complex scenarios', () => {
        testBothModes('object serializer with property loop', fn => {
            const props = ['id', 'name', 'email'];
            const f = fn(jit.arg<any>(), (ctx, input) => {
                const output = ctx.let(ctx.objExpr());
                for (const prop of props) {
                    ctx.set(output, prop, ctx.get(input, prop));
                }
                return output;
            });
            expect(f({ id: 1, name: 'John', email: 'john@example.com', extra: 'ignored' })).toEqual({ id: 1, name: 'John', email: 'john@example.com' });
        });

        testBothModes('validator with error collection', fn => {
            const rules = [
                { prop: 'name', check: (v: any) => typeof v === 'string', msg: 'name must be string' },
                { prop: 'age', check: (v: any) => typeof v === 'number' && v >= 0, msg: 'age must be non-negative number' },
            ];
            const f = fn(jit.arg<any>(), (ctx, input) => {
                const errors = ctx.let(ctx.arrExpr());
                for (const rule of rules) {
                    const value = ctx.get(input, rule.prop);
                    const valid = ctx.callExpr(rule.check, value);
                    ctx.when(ctx.not(valid), () => {
                        ctx.push(errors, ctx.lit(rule.msg));
                    });
                }
                return errors;
            });
            expect(f({ name: 'John', age: 25 })).toEqual([]);
            expect(f({ name: 123, age: 25 })).toEqual(['name must be string']);
            expect(f({ name: 'John', age: -5 })).toEqual(['age must be non-negative number']);
            expect(f({ name: 123, age: -5 })).toEqual(['name must be string', 'age must be non-negative number']);
        });

        testBothModes('safe serializer with null guard', fn => {
            const f = fn(jit.arg<any>(), (ctx, input) => {
                ctx.when(ctx.isNullish(input), () => {
                    return ctx.lit(null);
                });
                const output = ctx.let(ctx.objExpr());
                ctx.set(output, 'value', ctx.get(input, 'value'));
                return output;
            });
            expect(f(null)).toBe(null);
            expect(f(undefined)).toBe(null);
            expect(f({ value: 42 })).toEqual({ value: 42 });
        });

        testBothModes('range validator', fn => {
            const constraints = [
                { prop: 'min', min: 0 },
                { prop: 'max', max: 100 },
                { prop: 'range', min: 10, max: 50 },
            ];
            const f = fn(jit.arg<any>(), (ctx, input) => {
                const errors = ctx.let(ctx.arrExpr());
                for (const c of constraints) {
                    const value = ctx.get(input, c.prop);
                    if (c.min !== undefined) {
                        ctx.when(ctx.lt(value, ctx.lit(c.min)), () => {
                            ctx.push(errors, ctx.lit(`${c.prop} must be >= ${c.min}`));
                        });
                    }
                    if (c.max !== undefined) {
                        ctx.when(ctx.gt(value, ctx.lit(c.max)), () => {
                            ctx.push(errors, ctx.lit(`${c.prop} must be <= ${c.max}`));
                        });
                    }
                }
                return errors;
            });
            expect(f({ min: 5, max: 50, range: 30 })).toEqual([]);
            expect(f({ min: -1, max: 50, range: 30 })).toEqual(['min must be >= 0']);
            expect(f({ min: 5, max: 150, range: 30 })).toEqual(['max must be <= 100']);
            expect(f({ min: 5, max: 50, range: 5 })).toEqual(['range must be >= 10']);
        });

        testBothModes('nested object serializer', fn => {
            interface Address {
                street: string;
                city: string;
            }
            interface User {
                name: string;
                address: Address;
            }

            const serializeAddress = fn(jit.arg<any>(), (ctx, input) => {
                const output = ctx.let(ctx.objExpr());
                ctx.set(output, 'street', ctx.get(input, 'street'));
                ctx.set(output, 'city', ctx.get(input, 'city'));
                return output;
            });

            const serializeUser = fn(jit.arg<any>(), (ctx, input) => {
                const output = ctx.let(ctx.objExpr());
                ctx.set(output, 'name', ctx.get(input, 'name'));
                const address = ctx.get(input, 'address');
                ctx.set(output, 'address', ctx.callExpr(serializeAddress, address));
                return output;
            });

            const user = {
                name: 'John',
                address: { street: '123 Main St', city: 'NYC' },
                extra: 'ignored',
            };
            expect(serializeUser(user)).toEqual({
                name: 'John',
                address: { street: '123 Main St', city: 'NYC' },
            });
        });
    });

    describe('JITContext specifics', () => {
        test('getCode returns generated code', () => {
            const ctx = new JITContext(1);
            const [input] = ctx.getArgSlots();
            const output = ctx.let(ctx.objExpr());
            ctx.set(output, 'name', ctx.get(input, 'name'));
            const code = ctx.getCode();

            expect(code).toContain('var s1={};');
            expect(code).toContain('s1.name=s0.name;'); // Uses expression directly, no intermediate slot
        });

        test('compile produces working function', () => {
            const ctx = new JITContext(1);
            const [input] = ctx.getArgSlots();
            const output = ctx.let(ctx.objExpr());
            ctx.set(output, 'value', ctx.get(input, 'value'));
            const fn = ctx.compile<(input: any) => any>(output);

            expect(fn({ value: 42 })).toEqual({ value: 42 });
        });

        test('externs are properly passed', () => {
            const ctx = new JITContext(1);
            const [input] = ctx.getArgSlots();
            const double = (x: number) => x * 2;
            const result = ctx.callExpr(double, input);
            const fn = ctx.compile<(x: number) => number>(result);

            expect(fn(21)).toBe(42);
        });

        test('map generates optimal arrow function for pure expressions', () => {
            const ctx = new JITContext(1);
            const [input] = ctx.getArgSlots();
            const result = ctx.map(input, elem => {
                return ctx.objFrom([
                    ['id', ctx.get(elem, 'id')],
                    ['name', ctx.get(elem, 'name')],
                ]);
            });
            ctx.compile(result);
            const code = ctx.getCode();

            // Should use arrow function with object literal wrapped in parens
            // Single param doesn't need parens: s1=>({...})
            expect(code).toContain('.map(s');
            expect(code).toContain('=>({id:');
            expect(code).toContain(',name:');
        });

        test('map generates arrow function when callback is pure expression', () => {
            const ctx = new JITContext(1);
            const [input] = ctx.getArgSlots();
            function double(x: number) {
                return x * 2;
            }
            const result = ctx.map(input, elem => {
                // callExpr returns inline expression - no statements emitted
                return ctx.callExpr(double, elem);
            });
            ctx.compile(result);
            const code = ctx.getCode();

            // Should use arrow function since callExpr doesn't emit statements
            expect(code).toContain('.map(s');
            expect(code).toContain('=>double_0(');
        });

        test('map generates function body when callback has statements', () => {
            const ctx = new JITContext(1);
            const [input] = ctx.getArgSlots();
            const double = (x: number) => x * 2;
            const result = ctx.map(input, elem => {
                // let() creates a statement (var assignment)
                const doubled = ctx.let(ctx.callExpr(double, elem));
                return doubled;
            });
            ctx.compile(result);
            const code = ctx.getCode();

            // Should use function body with return statement
            expect(code).toContain('.map(function(');
            expect(code).toContain('return');
        });
    });

    describe('ExecContext specifics', () => {
        test('direct value flow', () => {
            const ctx = new ExecContext();
            const obj = ctx.let(ctx.objExpr<{ name: string }>());
            ctx.set(obj, 'name', ctx.lit('test') as Slot);

            // In exec mode, obj is an ExecSlot wrapping the actual object
            expect((obj as ExecSlot).value).toEqual({ name: 'test' });
        });

        test('early return flag', () => {
            const ctx = new ExecContext();
            expect(ctx.hasEarlyReturn).toBe(false);

            ctx.when(ctx.lit(true) as Slot<boolean>, () => {
                return ctx.lit('early');
            });

            expect(ctx.hasEarlyReturn).toBe(true);
            expect(ctx.earlyReturnValue).toBe('early');
        });

        test('operations no-op after early return', () => {
            const ctx = new ExecContext();

            // Trigger early return
            ctx.when(ctx.lit(true) as Slot<boolean>, () => {
                return ctx.lit('early');
            });

            // These should be no-ops
            const obj = ctx.let(ctx.objExpr());
            expect(obj).toBeUndefined();

            const arr = ctx.let(ctx.arrExpr());
            expect(arr).toBeUndefined();
        });
    });

    describe('mutable state - var_/setVar/getVar', () => {
        testBothModes('creates mutable variable and reads it back', fn => {
            const f = fn(ctx => {
                const counter = ctx.var_(0);
                return ctx.getVar(counter);
            });
            expect(f()).toBe(0);
        });

        testBothModes('sets and gets mutable variable', fn => {
            const f = fn(ctx => {
                const counter = ctx.var_(0);
                ctx.setVar(counter, ctx.lit(42));
                return ctx.getVar(counter);
            });
            expect(f()).toBe(42);
        });

        testBothModes('tracks state across conditionals', fn => {
            const f = fn(jit.arg<boolean>(), (ctx, shouldChange) => {
                const state = ctx.var_(false);
                ctx.when(shouldChange, () => {
                    ctx.setVar(state, ctx.lit(true));
                });
                return ctx.getVar(state);
            });
            expect(f(true)).toBe(true);
            expect(f(false)).toBe(false);
        });

        testBothModes('multiple mutations', fn => {
            const f = fn(ctx => {
                const counter = ctx.var_(0);
                ctx.setVar(counter, ctx.lit(1));
                ctx.setVar(counter, ctx.lit(2));
                ctx.setVar(counter, ctx.lit(3));
                return ctx.getVar(counter);
            });
            expect(f()).toBe(3);
        });

        testBothModes('initializes from slot', fn => {
            const f = fn(jit.arg<number>(), (ctx, initialValue) => {
                const counter = ctx.var_(initialValue);
                return ctx.getVar(counter);
            });
            expect(f(100)).toBe(100);
        });

        testBothModes('multiple independent variables', fn => {
            const f = fn(ctx => {
                const a = ctx.var_(1);
                const b = ctx.var_(2);
                ctx.setVar(a, ctx.lit(10));
                ctx.setVar(b, ctx.lit(20));
                const arr = ctx.let(ctx.arrExpr());
                ctx.push(arr, ctx.getVar(a));
                ctx.push(arr, ctx.getVar(b));
                return arr;
            });
            expect(f()).toEqual([10, 20]);
        });

        testBothModes('variable state persists in loop', fn => {
            const f = fn(jit.arg<number[]>(), (ctx, arr) => {
                const sum = ctx.var_(0);
                ctx.loop(arr, (elem, idx) => {
                    const current = ctx.getVar(sum);
                    const add = (a: number, b: number) => a + b;
                    ctx.setVar(sum, ctx.callExpr(add, current, elem));
                });
                return ctx.getVar(sum);
            });
            expect(f([1, 2, 3, 4, 5])).toBe(15);
        });

        testBothModes('change detection pattern', fn => {
            const f = fn(jit.arg<any>(), jit.arg<any>(), (ctx, oldObj, newObj) => {
                const changed = ctx.var_(false);
                ctx.when(ctx.neq(ctx.get(oldObj, 'name'), ctx.get(newObj, 'name')), () => {
                    ctx.setVar(changed, ctx.lit(true));
                });
                ctx.when(ctx.neq(ctx.get(oldObj, 'age'), ctx.get(newObj, 'age')), () => {
                    ctx.setVar(changed, ctx.lit(true));
                });
                return ctx.getVar(changed);
            });
            expect(f({ name: 'John', age: 30 }, { name: 'John', age: 30 })).toBe(false);
            expect(f({ name: 'John', age: 30 }, { name: 'Jane', age: 30 })).toBe(true);
            expect(f({ name: 'John', age: 30 }, { name: 'John', age: 31 })).toBe(true);
        });
    });

    describe('switch statement - switch_', () => {
        testBothModes('matches case and returns', fn => {
            const f = fn(jit.arg<string>(), (ctx, kind) => {
                ctx.switch_(kind, [
                    ['string', () => ctx.lit('is string')],
                    ['number', () => ctx.lit('is number')],
                    ['boolean', () => ctx.lit('is boolean')],
                ]);
                return ctx.lit('unknown');
            });
            expect(f('string')).toBe('is string');
            expect(f('number')).toBe('is number');
            expect(f('boolean')).toBe('is boolean');
            expect(f('other')).toBe('unknown');
        });

        testBothModes('matches default case', fn => {
            const f = fn(jit.arg<number>(), (ctx, n) => {
                ctx.switch_(
                    n,
                    [
                        [1, () => ctx.lit('one')],
                        [2, () => ctx.lit('two')],
                    ],
                    () => ctx.lit('other'),
                );
                return ctx.lit('never');
            });
            expect(f(1)).toBe('one');
            expect(f(2)).toBe('two');
            expect(f(3)).toBe('other');
        });

        testBothModes('executes case body without return', fn => {
            const f = fn(jit.arg<string>(), (ctx, action) => {
                const result = ctx.let(ctx.objExpr());
                ctx.switch_(action, [
                    [
                        'add',
                        () => {
                            ctx.set(result, 'op', ctx.lit('addition'));
                        },
                    ],
                    [
                        'sub',
                        () => {
                            ctx.set(result, 'op', ctx.lit('subtraction'));
                        },
                    ],
                ]);
                return result;
            });
            expect(f('add')).toEqual({ op: 'addition' });
            expect(f('sub')).toEqual({ op: 'subtraction' });
            expect(f('other')).toEqual({});
        });

        testBothModes('handles numeric cases', fn => {
            const f = fn(jit.arg<number>(), (ctx, kind) => {
                ctx.switch_(kind, [
                    [1, () => ctx.lit('type 1')],
                    [2, () => ctx.lit('type 2')],
                    [42, () => ctx.lit('type 42')],
                ]);
                return ctx.lit('unknown type');
            });
            expect(f(1)).toBe('type 1');
            expect(f(2)).toBe('type 2');
            expect(f(42)).toBe('type 42');
            expect(f(999)).toBe('unknown type');
        });

        testBothModes('type dispatch pattern', fn => {
            const serialize = fn(jit.arg<any>(), jit.arg<string>(), (ctx, value, typeName) => {
                ctx.switch_(typeName, [
                    ['string', () => value],
                    ['number', () => ctx.callExpr(String, value)],
                    ['boolean', () => ctx.ternary(value, ctx.lit('true'), ctx.lit('false'))],
                ]);
                return ctx.lit(null);
            });
            expect(serialize('hello', 'string')).toBe('hello');
            expect(serialize(42, 'number')).toBe('42');
            expect(serialize(true, 'boolean')).toBe('true');
            expect(serialize(false, 'boolean')).toBe('false');
            expect(serialize(undefined, 'unknown')).toBe(null);
        });
    });

    describe('ternary expression', () => {
        testBothModes('returns then value when true', fn => {
            const f = fn(jit.arg<boolean>(), (ctx, cond) => {
                return ctx.ternary(cond, ctx.lit('yes'), ctx.lit('no'));
            });
            expect(f(true)).toBe('yes');
            expect(f(false)).toBe('no');
        });

        testBothModes('works with slots from input', fn => {
            const f = fn(jit.arg<any>(), (ctx, input) => {
                return ctx.ternary(ctx.get(input, 'enabled'), ctx.get(input, 'a'), ctx.get(input, 'b'));
            });
            expect(f({ enabled: true, a: 'first', b: 'second' })).toBe('first');
            expect(f({ enabled: false, a: 'first', b: 'second' })).toBe('second');
        });

        testBothModes('nested ternary', fn => {
            const f = fn(jit.arg<number>(), (ctx, n) => {
                return ctx.ternary(ctx.lt(n, ctx.lit(0)), ctx.lit('negative'), ctx.ternary(ctx.gt(n, ctx.lit(0)), ctx.lit('positive'), ctx.lit('zero')));
            });
            expect(f(-5)).toBe('negative');
            expect(f(5)).toBe('positive');
            expect(f(0)).toBe('zero');
        });

        testBothModes('ternary with object creation', fn => {
            const f = fn(jit.arg<boolean>(), (ctx, useAlt) => {
                return ctx.ternary(useAlt, ctx.objFrom([['value', ctx.lit('alternative')]]), ctx.objFrom([['value', ctx.lit('default')]]));
            });
            expect(f(true)).toEqual({ value: 'alternative' });
            expect(f(false)).toEqual({ value: 'default' });
        });

        testBothModes('ternary in combination with var_', fn => {
            const f = fn(jit.arg<number>(), (ctx, n) => {
                const result = ctx.var_(ctx.lit(''));
                ctx.setVar(result, ctx.ternary(ctx.gt(n, ctx.lit(10)), ctx.lit('big'), ctx.lit('small')));
                return ctx.getVar(result);
            });
            expect(f(15)).toBe('big');
            expect(f(5)).toBe('small');
        });
    });

    describe('instance check - isInstance', () => {
        testBothModes('checks Date instance', fn => {
            const f = fn(jit.arg<any>(), (ctx, value) => {
                return ctx.isInstance(value, Date);
            });
            expect(f(new Date())).toBe(true);
            expect(f('2024-01-01')).toBe(false);
            expect(f({})).toBe(false);
        });

        testBothModes('checks Array instance', fn => {
            const f = fn(jit.arg<any>(), (ctx, value) => {
                return ctx.isInstance(value, Array);
            });
            expect(f([1, 2, 3])).toBe(true);
            expect(f({ length: 3 })).toBe(false);
            expect(f('array')).toBe(false);
        });

        testBothModes('checks custom class instance', fn => {
            class MyClass {
                constructor(public value: number) {}
            }
            const f = fn(jit.arg<any>(), (ctx, value) => {
                return ctx.isInstance(value, MyClass);
            });
            expect(f(new MyClass(42))).toBe(true);
            expect(f({ value: 42 })).toBe(false);
            expect(f(null)).toBe(false);
        });

        testBothModes('checks Error instance', fn => {
            const f = fn(jit.arg<any>(), (ctx, value) => {
                return ctx.isInstance(value, Error);
            });
            expect(f(new Error('test'))).toBe(true);
            expect(f(new TypeError('test'))).toBe(true); // TypeError extends Error
            expect(f({ message: 'test' })).toBe(false);
        });

        testBothModes('uses isInstance in conditional', fn => {
            const f = fn(jit.arg<any>(), (ctx, value) => {
                ctx.when(ctx.isInstance(value, Date), () => {
                    return ctx.lit('is date');
                });
                ctx.when(ctx.isInstance(value, Array), () => {
                    return ctx.lit('is array');
                });
                return ctx.lit('unknown');
            });
            expect(f(new Date())).toBe('is date');
            expect(f([1, 2, 3])).toBe('is array');
            expect(f('string')).toBe('unknown');
        });

        testBothModes('combines isInstance with other type checks', fn => {
            const f = fn(jit.arg<any>(), (ctx, value) => {
                ctx.when(ctx.isNullish(value), () => {
                    return ctx.lit('nullish');
                });
                ctx.when(ctx.isInstance(value, Date), () => {
                    return ctx.lit('date');
                });
                ctx.when(ctx.isType(value, 'string'), () => {
                    return ctx.lit('string');
                });
                return ctx.lit('other');
            });
            expect(f(null)).toBe('nullish');
            expect(f(undefined)).toBe('nullish');
            expect(f(new Date())).toBe('date');
            expect(f('hello')).toBe('string');
            expect(f(42)).toBe('other');
        });
    });

    describe('edge cases', () => {
        testBothModes('handles special string values', fn => {
            const f = fn(ctx => {
                const obj = ctx.let(ctx.objExpr());
                ctx.set(obj, 'quote', ctx.lit('say "hello"'));
                ctx.set(obj, 'newline', ctx.lit('line1\nline2'));
                ctx.set(obj, 'backslash', ctx.lit('path\\to\\file'));
                return obj;
            });
            expect(f()).toEqual({
                quote: 'say "hello"',
                newline: 'line1\nline2',
                backslash: 'path\\to\\file',
            });
        });

        testBothModes('handles numeric edge cases', fn => {
            const f = fn(ctx => {
                const obj = ctx.let(ctx.objExpr());
                ctx.set(obj, 'inf', ctx.lit(Infinity));
                ctx.set(obj, 'negInf', ctx.lit(-Infinity));
                ctx.set(obj, 'zero', ctx.lit(0));
                ctx.set(obj, 'negZero', ctx.lit(-0));
                return obj;
            });
            const result = f();
            expect(result.inf).toBe(Infinity);
            expect(result.negInf).toBe(-Infinity);
            expect(result.zero).toBe(0);
            expect(Object.is(result.negZero, -0)).toBe(true);
        });

        testBothModes('handles NaN', fn => {
            const f = fn(ctx => ctx.lit(NaN));
            expect(Number.isNaN(f())).toBe(true);
        });

        testBothModes('handles complex objects as literals', fn => {
            const complexObj = { nested: { deep: [1, 2, 3] }, fn: () => 42 };
            const f = fn(ctx => ctx.lit(complexObj));
            const result = f();
            expect(result).toBe(complexObj); // Same reference
            expect(result.fn()).toBe(42);
        });

        testBothModes('handles symbols', fn => {
            const sym = Symbol('test');
            const f = fn(ctx => ctx.lit(sym));
            expect(f()).toBe(sym);
        });
    });

    describe('IR-style expression semantics', () => {
        describe('expressions inline without variables', () => {
            test('objExpr returns inline expression', () => {
                const ctx = new JITContext(1);
                const [input] = ctx.getArgSlots();
                // objExpr doesn't create a variable - just returns "{}"
                ctx.set(input, 'result', ctx.objExpr());
                const code = ctx.getCode();
                // Should directly assign {} without intermediate variable
                expect(code).toBe('s0.result={};\n');
            });

            test('arrExpr returns inline expression', () => {
                const ctx = new JITContext(1);
                const [input] = ctx.getArgSlots();
                // arrExpr doesn't create a variable - just returns "[]"
                ctx.set(input, 'result', ctx.arrExpr());
                const code = ctx.getCode();
                // Should directly assign [] without intermediate variable
                expect(code).toBe('s0.result=[];\n');
            });

            test('callExpr returns inline expression', () => {
                const ctx = new JITContext(1);
                const [input] = ctx.getArgSlots();
                function double(x: number) {
                    return x * 2;
                }
                // callExpr doesn't create a variable - inlines the call
                ctx.set(input, 'result', ctx.callExpr(double, input.get('x')));
                const code = ctx.getCode();
                // Should directly assign function call without intermediate variable
                expect(code).toBe('s0.result=double_0(s0.x);\n');
            });

            test('newExpr returns inline expression', () => {
                const ctx = new JITContext(1);
                const [input] = ctx.getArgSlots();
                class Point {
                    constructor(
                        public x: number,
                        public y: number,
                    ) {}
                }
                // newExpr doesn't create a variable - inlines the constructor call
                ctx.set(input, 'result', ctx.newExpr(Point, input.get('x'), input.get('y')));
                const code = ctx.getCode();
                // Should directly assign new expression without intermediate variable
                expect(code).toBe('s0.result=new Point_0(s0.x,s0.y);\n');
            });
        });

        describe('let() creates explicit bindings', () => {
            test('let() creates variable for objExpr', () => {
                const ctx = new JITContext(1);
                const [input] = ctx.getArgSlots();
                const obj = ctx.let(ctx.objExpr());
                ctx.set(obj, 'name', input.get('name'));
                const code = ctx.getCode();
                // Should create variable for object
                expect(code).toContain('var s1={};');
                expect(code).toContain('s1.name=s0.name;');
            });

            test('let() creates variable for arrExpr', () => {
                const ctx = new JITContext(1);
                const [input] = ctx.getArgSlots();
                const arr = ctx.let(ctx.arrExpr());
                ctx.push(arr, input.get('x'));
                const code = ctx.getCode();
                // Should create variable for array
                expect(code).toContain('var s1=[];');
                expect(code).toContain('s1.push(s0.x);');
            });

            test('let() creates variable for callExpr when used multiple times', () => {
                const ctx = new JITContext(1);
                const [input] = ctx.getArgSlots();
                function validate(x: any) {
                    return x !== null;
                }
                const result = ctx.let(ctx.callExpr(validate, input));
                ctx.set(input, 'a', result);
                ctx.set(input, 'b', result);
                const code = ctx.getCode();
                // Should create variable to avoid duplicate calls
                expect(code).toContain('var s1=validate_0(s0);');
                expect(code).toContain('s0.a=s1;');
                expect(code).toContain('s0.b=s1;');
            });
        });

        describe('generated code comparison', () => {
            test('inline expressions produce fewer variables', () => {
                const ctx = new JITContext(1);
                const [input] = ctx.getArgSlots();
                const output = ctx.let(ctx.objExpr());
                ctx.set(output, 'id', input.get('id'));
                ctx.set(output, 'name', input.get('name'));
                function parseInt(x: string) {
                    return Number(x);
                }
                ctx.set(output, 'count', ctx.callExpr(parseInt, input.get('countStr')));
                ctx.compile(output);
                const code = ctx.getCode();
                // Optimal code: only one variable for output, callExpr inlined
                expect(code).toBe('var s1={};\n' + 's1.id=s0.id;\n' + 's1.name=s0.name;\n' + 's1.count=parseInt_0(s0.countStr);\n' + 'return s1;\n');
            });

            test('objFrom() returns inline object literal', () => {
                const ctx = new JITContext(1);
                const [input] = ctx.getArgSlots();
                const result = ctx.objFrom({
                    id: input.get('id'),
                    name: input.get('name'),
                });
                ctx.compile(result);
                const code = ctx.getCode();
                // Should return inline object literal - no intermediate variable
                expect(code).toBe('return {id:s0.id,name:s0.name};\n');
            });
        });
    });

    describe('tiered execution', () => {
        const originalThreshold = getJitThreshold();

        afterEach(() => {
            // Restore original threshold after each test
            setJitThreshold(originalThreshold);
        });

        test('getJitThreshold returns default value', () => {
            expect(getJitThreshold()).toBe(10);
        });

        test('setJitThreshold changes threshold', () => {
            setJitThreshold(5);
            expect(getJitThreshold()).toBe(5);
        });

        test('threshold 0 immediately JIT compiles', () => {
            setJitThreshold(0);
            let callCount = 0;
            const fn = jit.fn(jit.arg<number>(), (ctx, n) => {
                callCount++;
                return n;
            });

            // Body should only be called once (during JIT compilation)
            expect(callCount).toBe(1);

            // Calling the function doesn't re-run the body
            fn(1);
            fn(2);
            fn(3);
            expect(callCount).toBe(1);
        });

        test('tiered execution starts with Exec mode', () => {
            setJitThreshold(5);
            let bodyCallCount = 0;
            const fn = jit.fn(jit.arg<number>(), (ctx, n) => {
                bodyCallCount++;
                return ctx.lit(42);
            });

            // Body not called during creation (deferred)
            expect(bodyCallCount).toBe(0);

            // First call runs body in Exec mode
            expect(fn(1)).toBe(42);
            expect(bodyCallCount).toBe(1);

            // Each call before threshold runs body again (Exec mode)
            fn(2);
            expect(bodyCallCount).toBe(2);
            fn(3);
            expect(bodyCallCount).toBe(3);
            fn(4);
            expect(bodyCallCount).toBe(4);
        });

        test('switches to JIT after threshold', () => {
            setJitThreshold(3);
            let bodyCallCount = 0;
            const fn = jit.fn(jit.arg<number>(), (ctx, n) => {
                bodyCallCount++;
                return n;
            });

            // Calls 1 and 2: Exec mode (body runs each time)
            fn(1);
            fn(2);
            expect(bodyCallCount).toBe(2);

            // Call 3: Threshold reached, JIT compiles (body runs once more)
            fn(3);
            expect(bodyCallCount).toBe(3);

            // Calls 4+: JIT mode (body never runs again)
            fn(4);
            fn(5);
            fn(6);
            expect(bodyCallCount).toBe(3);
        });

        test('JIT compiled function produces correct results', () => {
            setJitThreshold(2);
            const fn = jit.fn(jit.arg<number>(), (ctx, n) => {
                // Double the input
                const result = ctx.let(ctx.objExpr<{ doubled: number }>());
                ctx.set(
                    result,
                    'doubled',
                    ctx.callExpr((x: number) => x * 2, n),
                );
                return result;
            });

            // Exec mode calls
            expect(fn(5)).toEqual({ doubled: 10 });

            // Triggers JIT compilation
            expect(fn(7)).toEqual({ doubled: 14 });

            // JIT mode calls
            expect(fn(10)).toEqual({ doubled: 20 });
            expect(fn(100)).toEqual({ doubled: 200 });
        });

        test('each jit.fn() has independent call counter', () => {
            setJitThreshold(3);
            let fn1BodyCalls = 0;
            let fn2BodyCalls = 0;

            const fn1 = jit.fn(jit.arg<number>(), (ctx, n) => {
                fn1BodyCalls++;
                return n;
            });

            const fn2 = jit.fn(jit.arg<number>(), (ctx, n) => {
                fn2BodyCalls++;
                return n;
            });

            // Call fn1 past threshold
            fn1(1);
            fn1(2);
            fn1(3); // JIT compiles
            fn1(4); // JIT mode

            // fn2 should still be in Exec mode
            fn2(1);
            expect(fn1BodyCalls).toBe(3);
            expect(fn2BodyCalls).toBe(1);

            fn2(2);
            fn2(3); // JIT compiles
            fn2(4); // JIT mode
            expect(fn2BodyCalls).toBe(3);
        });

        test('fnJIT bypasses tiered execution', () => {
            setJitThreshold(100); // High threshold
            let bodyCallCount = 0;

            const fn = jit.fnJIT(jit.arg<number>(), (ctx, n) => {
                bodyCallCount++;
                return n;
            });

            // Body called once during immediate JIT compilation
            expect(bodyCallCount).toBe(1);

            // Multiple calls don't re-run body
            fn(1);
            fn(2);
            fn(3);
            expect(bodyCallCount).toBe(1);
        });

        test('fnExec always uses Exec mode regardless of threshold', () => {
            setJitThreshold(1); // Low threshold
            let bodyCallCount = 0;

            const fn = jit.fnExec(jit.arg<number>(), (ctx, n) => {
                bodyCallCount++;
                return n;
            });

            // Body runs on every call (Exec mode)
            fn(1);
            fn(2);
            fn(3);
            fn(4);
            fn(5);
            expect(bodyCallCount).toBe(5);
        });
    });
});
