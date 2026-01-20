import { describe, expect, test } from '@jest/globals';

import { Context, ExecContext, JITContext, Slot, canJIT, getRuntimeCapabilities, jit } from '../src/jit.js';

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
                const result = ctx.arr();
                ctx.push(result, a);
                ctx.push(result, b);
                return result;
            });
            expect(f(1, 'two')).toEqual([1, 'two']);
        });
    });

    describe('object operations', () => {
        testBothModes('creates empty object', fn => {
            const f = fn(ctx => ctx.obj());
            expect(f()).toEqual({});
        });

        testBothModes('sets property with string key', fn => {
            const f = fn(ctx => {
                const obj = ctx.obj();
                ctx.set(obj, 'name', ctx.lit('John'));
                return obj;
            });
            expect(f()).toEqual({ name: 'John' });
        });

        testBothModes('sets property with slot key', fn => {
            const f = fn(jit.arg<string>(), (ctx, key) => {
                const obj = ctx.obj();
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
                const output = ctx.obj();
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
            const f = fn(ctx => ctx.arr());
            expect(f()).toEqual([]);
        });

        testBothModes('pushes to array', fn => {
            const f = fn(ctx => {
                const arr = ctx.arr();
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
                return ctx.call(double, x);
            });
            expect(f(5)).toBe(10);
            expect(f(21)).toBe(42);
        });

        testBothModes('calls function with multiple args', fn => {
            const add = (a: number, b: number, c: number) => a + b + c;
            const f = fn(jit.arg<number>(), jit.arg<number>(), jit.arg<number>(), (ctx, a, b, c) => {
                return ctx.call(add, a, b, c);
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
                return ctx.new_(Point, x, y);
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
                const result = ctx.obj();
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
                const result = ctx.obj();
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
                const result = ctx.arr();
                ctx.loop(arr, (elem, idx) => {
                    ctx.push(result, elem);
                });
                return result;
            });
            expect(f([1, 2, 3])).toEqual([1, 2, 3]);
        });

        testBothModes('provides correct index', fn => {
            const f = fn(jit.arg<string[]>(), (ctx, arr) => {
                const result = ctx.arr();
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
                const result = ctx.arr();
                ctx.loop(arr, (elem, idx) => {
                    ctx.push(result, ctx.call(double, elem));
                });
                return result;
            });
            expect(f([1, 2, 3])).toEqual([2, 4, 6]);
        });

        testBothModes('handles empty array', fn => {
            const f = fn(jit.arg<any[]>(), (ctx, arr) => {
                const result = ctx.arr();
                ctx.loop(arr, elem => {
                    ctx.push(result, elem);
                });
                return result;
            });
            expect(f([])).toEqual([]);
        });

        testBothModes('early return inside loop', fn => {
            const f = fn(jit.arg<number[]>(), (ctx, arr) => {
                const result = ctx.arr();
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

    describe('complex scenarios', () => {
        testBothModes('object serializer with property loop', fn => {
            const props = ['id', 'name', 'email'];
            const f = fn(jit.arg<any>(), (ctx, input) => {
                const output = ctx.obj();
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
                const errors = ctx.arr();
                for (const rule of rules) {
                    const value = ctx.get(input, rule.prop);
                    const valid = ctx.call(rule.check, value);
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
                const output = ctx.obj();
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
                const errors = ctx.arr();
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
                const output = ctx.obj();
                ctx.set(output, 'street', ctx.get(input, 'street'));
                ctx.set(output, 'city', ctx.get(input, 'city'));
                return output;
            });

            const serializeUser = fn(jit.arg<any>(), (ctx, input) => {
                const output = ctx.obj();
                ctx.set(output, 'name', ctx.get(input, 'name'));
                const address = ctx.get(input, 'address');
                ctx.set(output, 'address', ctx.call(serializeAddress, address));
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
            const output = ctx.obj();
            ctx.set(output, 'name', ctx.get(input, 'name'));
            const code = ctx.getCode();

            expect(code).toContain('var s1={};');
            expect(code).toContain('s1.name=s2;'); // Uses dot notation for valid identifiers
        });

        test('compile produces working function', () => {
            const ctx = new JITContext(1);
            const [input] = ctx.getArgSlots();
            const output = ctx.obj();
            ctx.set(output, 'value', ctx.get(input, 'value'));
            const fn = ctx.compile<(input: any) => any>(output);

            expect(fn({ value: 42 })).toEqual({ value: 42 });
        });

        test('externs are properly passed', () => {
            const ctx = new JITContext(1);
            const [input] = ctx.getArgSlots();
            const double = (x: number) => x * 2;
            const result = ctx.call(double, input);
            const fn = ctx.compile<(x: number) => number>(result);

            expect(fn(21)).toBe(42);
        });
    });

    describe('ExecContext specifics', () => {
        test('direct value flow', () => {
            const ctx = new ExecContext();
            const obj = ctx.obj<{ name: string }>();
            ctx.set(obj, 'name', ctx.lit('test') as Slot);

            // In exec mode, obj IS the actual object
            expect(obj).toEqual({ name: 'test' });
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
            const obj = ctx.obj();
            expect(obj).toBeUndefined();

            const arr = ctx.arr();
            expect(arr).toBeUndefined();
        });
    });

    describe('edge cases', () => {
        testBothModes('handles special string values', fn => {
            const f = fn(ctx => {
                const obj = ctx.obj();
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
                const obj = ctx.obj();
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
});
