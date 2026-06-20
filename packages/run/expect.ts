/**
 * Lightweight expect() shim over node:assert for migrating Jest tests to node:test.
 *
 * Covers all matchers used across deepkit tests:
 *   toBe, toEqual, toContain, toMatchObject, toMatch,
 *   toThrow/toThrowError, toBeInstanceOf, toBeCloseTo,
 *   toBeDefined, toBeUndefined,
 *   toBeGreaterThan, toBeGreaterThanOrEqual,
 *   toBeLessThan, toBeLessThanOrEqual,
 *   toHaveBeenCalledTimes,
 *   not.*
 *
 * Also exports fn() as a lightweight jest.fn() replacement.
 *
 * toEqual uses structural comparison (like Jest) — ignores constructors,
 * compares Dates by getTime(), Maps/Sets by entries, etc.
 */
import { strict as assert } from 'node:assert';

// Fix BigInt serialization issue (was in jest-setup.ts)
if (typeof BigInt === 'function' && !(BigInt.prototype as any).toJSON) {
    (BigInt.prototype as any).toJSON = function () {
        return this.toString();
    };
}

/**
 * Jest-compatible structural deep equality.
 * Ignores constructor identity (PilotId{value:34} == {value:34}).
 * Compares Dates by getTime(), Maps/Sets by entries, RegExps by toString().
 */
function jestDeepEqual(a: unknown, b: unknown, seen = new Set<object>()): boolean {
    // Asymmetric matchers (expect.any, expect.objectContaining, …) on either side
    if (isAsymmetric(b)) return (b as AsymmetricMatcher).$$match(a);
    if (isAsymmetric(a)) return (a as AsymmetricMatcher).$$match(b);
    // Identical values (handles NaN via Object.is)
    if (Object.is(a, b)) return true;

    // Both must be non-null objects
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;

    // Circular reference guard
    if (seen.has(a as object)) return true;
    seen.add(a as object);

    // Date
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();

    // RegExp
    if (a instanceof RegExp && b instanceof RegExp) return a.toString() === b.toString();

    // TypedArray / Buffer
    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
        const av = new Uint8Array((a as Uint8Array).buffer, (a as Uint8Array).byteOffset, (a as Uint8Array).byteLength);
        const bv = new Uint8Array((b as Uint8Array).buffer, (b as Uint8Array).byteOffset, (b as Uint8Array).byteLength);
        if (av.length !== bv.length) return false;
        for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
        return true;
    }

    // Map
    if (a instanceof Map && b instanceof Map) {
        if (a.size !== b.size) return false;
        for (const [key, val] of a) {
            let found = false;
            for (const [bKey, bVal] of b) {
                if (jestDeepEqual(key, bKey, seen) && jestDeepEqual(val, bVal, seen)) {
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }
        return true;
    }

    // Set
    if (a instanceof Set && b instanceof Set) {
        if (a.size !== b.size) return false;
        for (const val of a) {
            let found = false;
            for (const bVal of b) {
                if (jestDeepEqual(val, bVal, seen)) {
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }
        return true;
    }

    // Array
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!jestDeepEqual(a[i], b[i], seen)) return false;
        }
        return true;
    }

    // One is array, other is not
    if (Array.isArray(a) !== Array.isArray(b)) return false;

    // Plain objects / class instances — compare own enumerable keys
    // Jest ignores undefined-valued properties: {v: undefined} equals {}
    const aKeys = Object.keys(a).filter(k => (a as any)[k] !== undefined);
    const bKeys = Object.keys(b).filter(k => (b as any)[k] !== undefined);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        if ((b as any)[key] === undefined) return false;
        if (!jestDeepEqual((a as any)[key], (b as any)[key], seen)) return false;
    }
    return true;
}

/**
 * Jest-compatible partial object match.
 * Every key in `expected` must exist and match in `actual`, but `actual` may have extra keys.
 */
function jestMatchObject(actual: unknown, expected: unknown, seen = new Set<object>()): boolean {
    if (isAsymmetric(expected)) return (expected as AsymmetricMatcher).$$match(actual);
    if (Object.is(actual, expected)) return true;
    if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') {
        return jestDeepEqual(actual, expected, seen);
    }

    if (seen.has(actual as object)) return true;
    seen.add(actual as object);

    if (Array.isArray(expected)) {
        if (!Array.isArray(actual)) return false;
        for (let i = 0; i < expected.length; i++) {
            if (!jestMatchObject(actual[i], expected[i], seen)) return false;
        }
        return true;
    }

    for (const key of Object.keys(expected)) {
        if (!jestMatchObject((actual as any)[key], (expected as any)[key], seen)) return false;
    }
    return true;
}

function formatValue(v: unknown): string {
    try {
        return JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? val.toString() + 'n' : val), 2) ?? String(v);
    } catch {
        return String(v);
    }
}

// --- Asymmetric matchers (expect.any, expect.objectContaining, …) ---------

interface AsymmetricMatcher {
    $$asymmetric: true;
    $$match(actual: unknown): boolean;
    toString(): string;
}

function isAsymmetric(v: unknown): v is AsymmetricMatcher {
    return typeof v === 'object' && v !== null && (v as any).$$asymmetric === true;
}

function asymmetric(label: string, match: (actual: unknown) => boolean): AsymmetricMatcher {
    return { $$asymmetric: true, $$match: match, toString: () => label };
}

const asymmetricMatchers = {
    any(ctor: Function): AsymmetricMatcher {
        return asymmetric(`Any<${(ctor as any).name}>`, actual => {
            if (ctor === String) return typeof actual === 'string' || actual instanceof String;
            if (ctor === Number) return typeof actual === 'number' || actual instanceof Number;
            if (ctor === Boolean) return typeof actual === 'boolean';
            if (ctor === BigInt) return typeof actual === 'bigint';
            if (ctor === Symbol) return typeof actual === 'symbol';
            if (ctor === Function) return typeof actual === 'function';
            if (ctor === Object) return typeof actual === 'object' && actual !== null;
            return actual instanceof (ctor as any);
        });
    },
    anything(): AsymmetricMatcher {
        return asymmetric('Anything', actual => actual !== null && actual !== undefined);
    },
    objectContaining(expected: object): AsymmetricMatcher {
        return asymmetric('ObjectContaining', actual => jestMatchObject(actual, expected));
    },
    arrayContaining(expected: unknown[]): AsymmetricMatcher {
        return asymmetric('ArrayContaining', actual => {
            if (!Array.isArray(actual)) return false;
            return expected.every(e => actual.some(a => jestDeepEqual(a, e)));
        });
    },
    stringContaining(expected: string): AsymmetricMatcher {
        return asymmetric('StringContaining', actual => typeof actual === 'string' && actual.includes(expected));
    },
    stringMatching(expected: string | RegExp): AsymmetricMatcher {
        return asymmetric('StringMatching', actual => {
            if (typeof actual !== 'string') return false;
            return typeof expected === 'string' ? actual.includes(expected) : expected.test(actual);
        });
    },
};

interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toMatchObject(expected: object): void;
    toMatch(expected: string | RegExp): void;
    toThrow(expected?: string | RegExp | Error | Function): void;
    toThrowError(expected?: string | RegExp | Error | Function): void;
    toBeInstanceOf(expected: Function): void;
    toBeCloseTo(expected: number, numDigits?: number): void;
    toBeDefined(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNull(): void;
    toHaveLength(expected: number): void;
    toHaveProperty(path: string, value?: unknown): void;
    toBeUndefined(): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toHaveBeenCalledTimes(expected: number): void;
    toHaveBeenCalled(): void;
    toHaveBeenCalledWith(...args: unknown[]): void;
}

interface AsyncMatchers {
    toBe(expected: unknown): Promise<void>;
    toEqual(expected: unknown): Promise<void>;
    toMatchObject(expected: object): Promise<void>;
    toContain(expected: unknown): Promise<void>;
    toBeInstanceOf(expected: Function): Promise<void>;
    toThrow(expected?: string | RegExp | Error | Function): Promise<void>;
    toThrowError(expected?: string | RegExp | Error | Function): Promise<void>;
    toHaveProperty(path: string, value?: unknown): Promise<void>;
}

interface Expect extends Matchers {
    not: Matchers;
    /** Awaits the promise, asserts it resolves, applies the matcher to the resolved value. */
    resolves: AsyncMatchers;
    /** Awaits the promise (or calls the fn), asserts it rejects, applies the matcher to the error. */
    rejects: AsyncMatchers;
}

function expectImpl(actual: unknown): Expect {
    const matchers: Matchers = {
        toBe(expected: unknown) {
            assert.strictEqual(actual, expected);
        },
        toEqual(expected: unknown) {
            if (!jestDeepEqual(actual, expected)) {
                assert.fail(
                    `Expected values to be structurally equal:\nActual:   ${formatValue(actual)}\nExpected: ${formatValue(expected)}`,
                );
            }
        },
        toContain(expected: unknown) {
            if (typeof actual === 'string') {
                assert.ok(actual.includes(expected as string), `Expected string to contain "${expected}":\n${actual}`);
            } else if (Array.isArray(actual)) {
                const found = actual.some(item => Object.is(item, expected) || jestDeepEqual(item, expected));
                assert.ok(found, `Expected array to contain ${formatValue(expected)}:\n${formatValue(actual)}`);
            } else {
                assert.fail(`toContain called on non-string, non-array: ${typeof actual}`);
            }
        },
        toMatchObject(expected: object) {
            if (!jestMatchObject(actual, expected)) {
                assert.fail(
                    `Expected object to match:\nActual:   ${formatValue(actual)}\nExpected: ${formatValue(expected)}`,
                );
            }
        },
        toMatch(expected: string | RegExp) {
            const str = actual as string;
            if (typeof expected === 'string') {
                assert.ok(str.includes(expected), `Expected "${str}" to match "${expected}"`);
            } else {
                assert.match(str, expected);
            }
        },
        toThrow(expected?: string | RegExp | Error | Function) {
            if (expected === undefined) {
                assert.throws(actual as () => void);
            } else if (typeof expected === 'string') {
                // Jest's toThrow('str') checks message.includes(str)
                assert.throws(actual as () => void, (err: any) => {
                    if (!err.message?.includes(expected)) {
                        assert.fail(`Expected error message to contain "${expected}", got "${err.message}"`);
                    }
                    return true;
                });
            } else {
                // RegExp (message match), Error subclass constructor (instanceof check),
                // or an Error instance (message+name) — node:assert handles all three.
                assert.throws(actual as () => void, expected as any);
            }
        },
        toThrowError(expected?: string | RegExp | Error | Function) {
            // Jest alias
            matchers.toThrow(expected);
        },
        toBeInstanceOf(expected: Function) {
            assert.ok(actual instanceof expected, `Expected instance of ${expected.name}, got ${actual}`);
        },
        toBeCloseTo(expected: number, numDigits = 2) {
            const precision = Math.pow(10, -numDigits) / 2;
            assert.ok(
                Math.abs((actual as number) - expected) < precision,
                `Expected ${actual} to be close to ${expected} (precision ${numDigits})`,
            );
        },
        toBeDefined() {
            assert.notStrictEqual(actual, undefined);
        },
        toBeUndefined() {
            assert.strictEqual(actual, undefined);
        },
        toBeGreaterThan(expected: number) {
            assert.ok((actual as number) > expected, `Expected ${actual} > ${expected}`);
        },
        toBeGreaterThanOrEqual(expected: number) {
            assert.ok((actual as number) >= expected, `Expected ${actual} >= ${expected}`);
        },
        toBeLessThan(expected: number) {
            assert.ok((actual as number) < expected, `Expected ${actual} < ${expected}`);
        },
        toBeLessThanOrEqual(expected: number) {
            assert.ok((actual as number) <= expected, `Expected ${actual} <= ${expected}`);
        },
        toHaveBeenCalledTimes(expected: number) {
            const mock = actual as MockFunction;
            assert.ok(mock._isMock, 'toHaveBeenCalledTimes called on non-mock. Use fn() to create a mock.');
            assert.strictEqual(mock.calls.length, expected, `Expected ${expected} calls, got ${mock.calls.length}`);
        },
        toHaveBeenCalled() {
            const mock = actual as MockFunction;
            assert.ok(mock._isMock, 'toHaveBeenCalled called on non-mock. Use fn()/spyOn() to create a mock.');
            assert.ok(mock.calls.length > 0, 'Expected mock to have been called at least once');
        },
        toHaveBeenCalledWith(...args: unknown[]) {
            const mock = actual as MockFunction;
            assert.ok(mock._isMock, 'toHaveBeenCalledWith called on non-mock. Use fn()/spyOn() to create a mock.');
            const found = mock.calls.some(call => jestDeepEqual(call, args));
            assert.ok(
                found,
                `Expected mock to have been called with:\n${formatValue(args)}\nActual calls:\n${formatValue(mock.calls)}`,
            );
        },
        toBeTruthy() {
            assert.ok(actual, `Expected ${formatValue(actual)} to be truthy`);
        },
        toBeFalsy() {
            assert.ok(!actual, `Expected ${formatValue(actual)} to be falsy`);
        },
        toBeNull() {
            assert.strictEqual(actual, null);
        },
        toHaveLength(expected: number) {
            const len = (actual as any).length;
            assert.strictEqual(len, expected, `Expected length ${expected}, got ${len}`);
        },
        toHaveProperty(path: string, value?: unknown) {
            const parts = path.split('.');
            let obj: any = actual;
            for (const part of parts) {
                assert.ok(obj != null && part in obj, `Expected property "${path}" to exist`);
                obj = obj[part];
            }
            if (arguments.length >= 2) {
                if (!jestDeepEqual(obj, value)) {
                    assert.fail(`Expected property "${path}" to equal ${formatValue(value)}, got ${formatValue(obj)}`);
                }
            }
        },
    };

    const negated: Matchers = {
        toBe(expected: unknown) {
            assert.notStrictEqual(actual, expected);
        },
        toEqual(expected: unknown) {
            if (jestDeepEqual(actual, expected)) {
                assert.fail(`Expected values NOT to be structurally equal:\nValue: ${formatValue(actual)}`);
            }
        },
        toContain(expected: unknown) {
            if (typeof actual === 'string') {
                assert.ok(!actual.includes(expected as string), `Expected string NOT to contain "${expected}"`);
            } else if (Array.isArray(actual)) {
                const found = actual.some(item => Object.is(item, expected) || jestDeepEqual(item, expected));
                assert.ok(!found, `Expected array NOT to contain ${formatValue(expected)}`);
            } else {
                assert.fail(`not.toContain called on non-string, non-array: ${typeof actual}`);
            }
        },
        toMatchObject(expected: object) {
            if (jestMatchObject(actual, expected)) {
                assert.fail(`Expected object NOT to match:\nValue: ${formatValue(actual)}`);
            }
        },
        toMatch(expected: string | RegExp) {
            const str = actual as string;
            if (typeof expected === 'string') {
                assert.ok(!str.includes(expected), `Expected "${str}" NOT to match "${expected}"`);
            } else {
                assert.doesNotMatch(str, expected);
            }
        },
        toThrow() {
            assert.doesNotThrow(actual as () => void);
        },
        toThrowError() {
            negated.toThrow();
        },
        toBeInstanceOf(expected: Function) {
            assert.ok(!(actual instanceof expected), `Expected NOT instance of ${expected.name}`);
        },
        toBeCloseTo(expected: number, numDigits = 2) {
            const precision = Math.pow(10, -numDigits) / 2;
            assert.ok(
                Math.abs((actual as number) - expected) >= precision,
                `Expected ${actual} NOT to be close to ${expected}`,
            );
        },
        toBeDefined() {
            assert.strictEqual(actual, undefined);
        },
        toBeUndefined() {
            assert.notStrictEqual(actual, undefined);
        },
        toBeGreaterThan(expected: number) {
            assert.ok(!((actual as number) > expected), `Expected ${actual} NOT > ${expected}`);
        },
        toBeGreaterThanOrEqual(expected: number) {
            assert.ok(!((actual as number) >= expected), `Expected ${actual} NOT >= ${expected}`);
        },
        toBeLessThan(expected: number) {
            assert.ok(!((actual as number) < expected), `Expected ${actual} NOT < ${expected}`);
        },
        toBeLessThanOrEqual(expected: number) {
            assert.ok(!((actual as number) <= expected), `Expected ${actual} NOT <= ${expected}`);
        },
        toHaveBeenCalledTimes(expected: number) {
            const mock = actual as MockFunction;
            assert.ok(mock._isMock, 'not.toHaveBeenCalledTimes called on non-mock.');
            assert.notStrictEqual(mock.calls.length, expected, `Expected NOT ${expected} calls, but got exactly that`);
        },
        toHaveBeenCalled() {
            const mock = actual as MockFunction;
            assert.ok(mock._isMock, 'not.toHaveBeenCalled called on non-mock.');
            assert.strictEqual(mock.calls.length, 0, `Expected mock NOT to have been called, but it was ${mock.calls.length}x`);
        },
        toHaveBeenCalledWith(...args: unknown[]) {
            const mock = actual as MockFunction;
            assert.ok(mock._isMock, 'not.toHaveBeenCalledWith called on non-mock.');
            const found = mock.calls.some(call => jestDeepEqual(call, args));
            assert.ok(!found, `Expected mock NOT to have been called with:\n${formatValue(args)}`);
        },
        toBeTruthy() {
            assert.ok(!actual, `Expected ${formatValue(actual)} NOT to be truthy`);
        },
        toBeFalsy() {
            assert.ok(actual, `Expected ${formatValue(actual)} NOT to be falsy`);
        },
        toBeNull() {
            assert.notStrictEqual(actual, null);
        },
        toHaveLength(expected: number) {
            const len = (actual as any).length;
            assert.notStrictEqual(len, expected, `Expected length NOT ${expected}`);
        },
        toHaveProperty(path: string) {
            const parts = path.split('.');
            let obj: any = actual;
            let exists = true;
            for (const part of parts) {
                if (obj == null || !(part in obj)) {
                    exists = false;
                    break;
                }
                obj = obj[part];
            }
            assert.ok(!exists, `Expected property "${path}" NOT to exist`);
        },
    };

    const settle = (): Promise<{ ok: boolean; value?: unknown; error?: any }> =>
        Promise.resolve(typeof actual === 'function' ? (actual as Function)() : actual).then(
            value => ({ ok: true, value }),
            error => ({ ok: false, error }),
        );

    function asyncMatchers(mode: 'resolves' | 'rejects'): AsyncMatchers {
        const apply =
            (name: keyof Matchers) =>
            async (...args: any[]) => {
                const res = await settle();
                if (mode === 'resolves') {
                    if (!res.ok) {
                        assert.fail(`Expected promise to resolve, but it rejected with: ${res.error?.stack || res.error}`);
                    }
                    (expectImpl(res.value) as any)[name](...args);
                    return;
                }
                // rejects
                if (res.ok) {
                    assert.fail(`Expected promise to reject, but it resolved with: ${formatValue(res.value)}`);
                }
                const err = res.error;
                if (name === 'toThrow' || name === 'toThrowError') {
                    const expected = args[0];
                    if (expected === undefined) return; // it rejected — that's all toThrow() asserts
                    const msg = String(err?.message ?? err);
                    if (typeof expected === 'string') {
                        assert.ok(msg.includes(expected), `Expected rejection message to contain "${expected}", got "${msg}"`);
                    } else if (expected instanceof RegExp) {
                        assert.ok(expected.test(msg), `Expected rejection message to match ${expected}, got "${msg}"`);
                    } else if (typeof expected === 'function') {
                        assert.ok(err instanceof (expected as any), `Expected rejection to be instance of ${(expected as any).name}, got ${err}`);
                    } else {
                        assert.ok(msg.includes(String((expected as any)?.message ?? expected)));
                    }
                    return;
                }
                (expectImpl(err) as any)[name](...args);
            };
        return {
            toBe: apply('toBe'),
            toEqual: apply('toEqual'),
            toMatchObject: apply('toMatchObject'),
            toContain: apply('toContain'),
            toBeInstanceOf: apply('toBeInstanceOf'),
            toThrow: apply('toThrow'),
            toThrowError: apply('toThrowError'),
            toHaveProperty: apply('toHaveProperty'),
        };
    }

    return { ...matchers, not: negated, resolves: asyncMatchers('resolves'), rejects: asyncMatchers('rejects') };
}

// expect() with asymmetric matchers attached as static helpers:
// expect.any(String), expect.objectContaining({…}), … . A typed const + Object.assign is used
// instead of function+namespace merging, which the per-file transpile loader can't represent.
interface ExpectFn {
    (actual: unknown): Expect;
    any(ctor: Function): AsymmetricMatcher;
    anything(): AsymmetricMatcher;
    objectContaining(expected: object): AsymmetricMatcher;
    arrayContaining(expected: unknown[]): AsymmetricMatcher;
    stringContaining(expected: string): AsymmetricMatcher;
    stringMatching(expected: string | RegExp): AsymmetricMatcher;
}

export const expect: ExpectFn = Object.assign(expectImpl, asymmetricMatchers);

/**
 * Lightweight jest.fn() replacement.
 * Records calls and arguments. Supports mockImplementation.
 */
interface MockFunction {
    (...args: any[]): any;
    _isMock: true;
    calls: any[][];
    mock: { calls: any[][] };
    mockImplementation(impl: (...args: any[]) => any): MockFunction;
    mockReturnValue(value: any): MockFunction;
    mockClear(): void;
    mockReset(): void;
    mockRestore(): void;
}

// Per-process registry so jest.clearAllMocks()/restoreAllMocks() work (each node:test file is its own process).
const allMocks: MockFunction[] = [];

export function fn(impl?: (...args: any[]) => any): MockFunction {
    let implementation = impl || (() => undefined);
    const calls: any[][] = [];

    const mock = function (this: any, ...args: any[]) {
        calls.push(args);
        // forward the call-site receiver so spyOn-wrapped instance methods keep their `this`
        return implementation.apply(this, args);
    } as MockFunction;

    mock._isMock = true;
    mock.calls = calls;
    // jest exposes call records under `.mock.calls` too
    mock.mock = { calls };
    mock.mockImplementation = (newImpl: (...args: any[]) => any) => {
        implementation = newImpl;
        return mock;
    };
    mock.mockReturnValue = (value: any) => {
        implementation = () => value;
        return mock;
    };
    mock.mockClear = () => {
        calls.length = 0;
    };
    mock.mockReset = () => {
        calls.length = 0;
        implementation = () => undefined;
    };
    mock.mockRestore = () => {
        calls.length = 0;
    };

    allMocks.push(mock);
    return mock;
}

/**
 * jest.spyOn(obj, 'method') replacement: replaces the method with a mock that
 * calls through to the original by default, and can be restored via mockRestore().
 */
export function spyOn<T extends object>(obj: T, method: keyof T): MockFunction {
    const original = obj[method] as unknown as (...args: any[]) => any;
    // preserve the call-site receiver (instance), falling back to the spied object
    const mock = fn(function (this: any, ...args: any[]) {
        return original.apply(this ?? obj, args);
    });
    mock.mockRestore = () => {
        (obj as any)[method] = original;
    };
    (obj as any)[method] = mock;
    return mock;
}

/**
 * Minimal `jest` compatibility object for tests migrated to node:test.
 * `mock`/`requireActual` are not portable to node:test and throw with guidance.
 */
export const jest = {
    fn,
    spyOn,
    /** node:test has no default per-test timeout, so raising it (jest's 5s default) is a no-op. */
    setTimeout(_ms: number): void {},
    clearAllMocks(): void {
        for (const m of allMocks) m.calls.length = 0;
    },
    resetAllMocks(): void {
        for (const m of allMocks) m.mockReset();
    },
    restoreAllMocks(): void {
        for (const m of allMocks) m.mockRestore();
    },
    requireActual(_module: string): never {
        throw new Error('jest.requireActual is not supported under node:test — import the real module directly.');
    },
    mock(): never {
        throw new Error(
            'jest.mock() is not supported under node:test — refactor to dependency injection, or use node:test mock.module() with --experimental-test-module-mocks.',
        );
    },
};
