import { test } from 'node:test';
import ts from 'typescript';

import { expect } from '@deepkit/run/expect';

import { transform } from './utils.js';

/**
 * Tests for GitHub issue #509: "Node InferType did not pass test 'isEntityName'"
 *
 * When generic type parameters are passed between functions, the type-compiler
 * was crashing because it was replacing an Identifier with an InferTypeNode
 * inside a TypeReferenceNode's typeName property. TypeScript expects typeName
 * to be an EntityName (Identifier or QualifiedName), not an InferTypeNode.
 *
 * The fix replaces the entire TypeReferenceNode with an InferTypeNode instead
 * of just the identifier inside it.
 */

// TypeScript's visitEachChild only asserts node shapes when NODE_ENV=development
// (e.g. under vite dev). Enable them here so a malformed AST fails these tests
// instead of only crashing in consumers' dev servers.
(ts as any).Debug.setAssertionLevel(1);

test('generic type parameter passing between functions', () => {
    // This was the original failing case from issue #509
    const res = transform({
        app: `
            function a<T>(t: T): T {
                return b<T>(t);
            }
            function b<T>(t: T): T {
                return t;
            }
            a(1);
        `,
    });

    // Should compile without errors
    expect(res.app).toContain('a.__type');
    expect(res.app).toContain('b.__type');
});

test('generic type parameter in nested function calls', () => {
    const res = transform({
        app: `
            function outer<T>(value: T): T {
                return middle<T>(value);
            }
            function middle<T>(value: T): T {
                return inner<T>(value);
            }
            function inner<T>(value: T): T {
                return value;
            }
            outer('test');
        `,
    });

    expect(res.app).toContain('outer.__type');
    expect(res.app).toContain('middle.__type');
    expect(res.app).toContain('inner.__type');
});

test('generic type parameter with constraints', () => {
    const res = transform({
        app: `
            function process<T extends object>(data: T): T {
                return transform<T>(data);
            }
            function transform<T extends object>(data: T): T {
                return data;
            }
        `,
    });

    expect(res.app).toContain('process.__type');
    expect(res.app).toContain('transform.__type');
});

test('generic type parameter in arrow functions', () => {
    const res = transform({
        app: `
            const wrapper = <T>(value: T): T => {
                return identity<T>(value);
            };
            const identity = <T>(value: T): T => value;
        `,
    });

    // Arrow functions should also work
    expect(res.app).toBeDefined();
});

test('generic type parameter with multiple type parameters', () => {
    const res = transform({
        app: `
            function map<T, U>(value: T, fn: (v: T) => U): U {
                return apply<T, U>(value, fn);
            }
            function apply<T, U>(value: T, fn: (v: T) => U): U {
                return fn(value);
            }
        `,
    });

    expect(res.app).toContain('map.__type');
    expect(res.app).toContain('apply.__type');
});

test('generic type parameter in class methods', () => {
    const res = transform({
        app: `
            class Processor {
                process<T>(value: T): T {
                    return this.transform<T>(value);
                }
                transform<T>(value: T): T {
                    return value;
                }
            }
        `,
    });

    expect(res.app).toContain('Processor');
});

test('generic type parameter with default type', () => {
    const res = transform({
        app: `
            function create<T = string>(value: T): T {
                return process<T>(value);
            }
            function process<T = string>(value: T): T {
                return value;
            }
        `,
    });

    expect(res.app).toContain('create.__type');
    expect(res.app).toContain('process.__type');
});

test('generic type parameter in type reference with type arguments', () => {
    const res = transform({
        app: `
            function wrap<T>(value: T): Array<T> {
                return makeArray<T>(value);
            }
            function makeArray<T>(value: T): Array<T> {
                return [value];
            }
        `,
    });

    expect(res.app).toContain('wrap.__type');
    expect(res.app).toContain('makeArray.__type');
});

test('nested arrow function referencing enclosing generic parameters', () => {
    // The parameter of the inner arrow references A of the enclosing function, so the
    // compiler resolves A by inferring from `fn: (...args: A) => R`. Replacing the `A`
    // identifier (instead of its whole TypeReferenceNode) with `infer A` crashed
    // visitEachChild's isEntityName assertion.
    const res = transform({
        app: `
            function useRef<T>(v: T): { current: T } { return { current: v }; }
            export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
                const latest = useRef(fn);
                latest.current = fn;
                const stable = useRef((...args: A) => latest.current(...args));
                return stable.current;
            }
        `,
    });

    expect(res.app).toContain('useStableCallback.__type');
    //the inner arrow function must carry a type referencing `typeof fn` for inference
    expect(res.app).toContain('() => fn');
});

test('generic type parameter in union types', () => {
    const res = transform({
        app: `
            function maybe<T>(value: T | undefined): T | undefined {
                return process<T>(value);
            }
            function process<T>(value: T | undefined): T | undefined {
                return value;
            }
        `,
    });

    expect(res.app).toContain('maybe.__type');
    expect(res.app).toContain('process.__type');
});

test('generic type parameter in intersection types', () => {
    const res = transform({
        app: `
            interface Named { name: string }
            function extend<T>(value: T): T & Named {
                return addName<T>(value);
            }
            function addName<T>(value: T): T & Named {
                return { ...value, name: 'test' } as T & Named;
            }
        `,
    });

    expect(res.app).toContain('extend.__type');
    expect(res.app).toContain('addName.__type');
});
