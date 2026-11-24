/**
 * A key of a BSON document never runs a setter — the rule `@deepkit/type` decodes by
 * (`setInputKey`; the reasons are in `type/tests/input-key.spec.ts`).
 *
 * Until 2026-11-24 the typed decoder collected the keys of an index signature in an object WITHOUT
 * a prototype. That protected a record and nothing else: the copy onto a class instance was a plain
 * assignment, so a `__proto__` field of the document replaced the prototype of the instance — it
 * stopped being an instance of its class. And the record came back without `toString` and
 * `hasOwnProperty`, a different kind of object from the one `deserialize` returns for the same type.
 * Now the collector is a plain object and the key is an own property of it.
 *
 * The untyped parser (`parseDocumentToObject`, what a value typed `any` is decoded by) drops the
 * key. That is held here as it is.
 *
 * Both modes of the JIT are held: this file runs in the mode of the process, and its last test runs
 * the file again with `DEEPKIT_JIT_MODE=interpreted`.
 */
import { execFileSync } from 'node:child_process';
import { describe, test } from 'node:test';

import { getJitMode } from '@deepkit/core';
import { expect } from '@deepkit/run/expect';

import { deserializeBSON, deserializeBSONWithoutOptimiser, serializeBSON, serializeBSONWithoutOptimiser } from '../index.js';

/** A document with a `__proto__` field, as bytes. `JSON.parse` makes the key an own property. */
const attack = (): any => JSON.parse('{"__proto__": {"isAdmin": true}, "a": 1}');
const bytes = (): Uint8Array => serializeBSONWithoutOptimiser(attack());
const nestedBytes = (): Uint8Array => serializeBSONWithoutOptimiser({ m: attack() });

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function expectOrdinaryKey(result: any, prototype: object = Object.prototype): void {
    expect(Object.getPrototypeOf(result)).toBe(prototype);
    expect(hasOwn(result, '__proto__')).toBe(true);
    expect(Object.keys(result)).toContain('__proto__');
    expect(result.isAdmin).toBe(undefined);
    expect('isAdmin' in result).toBe(false);
}

describe('input keys: the typed BSON decoder', () => {
    test('the document holds the key', () => {
        expect(Buffer.from(bytes()).includes('__proto__')).toBe(true);
    });

    test('Record<string, any>', () => {
        const result = deserializeBSON<Record<string, any>>(bytes());
        expectOrdinaryKey(result);
        expect(Object.getOwnPropertyDescriptor(result, '__proto__')).toEqual({
            value: { isAdmin: true },
            writable: true,
            enumerable: true,
            configurable: true,
        });
        expect(result.a).toBe(1);
    });

    test('a record is a plain object', () => {
        const result = deserializeBSON<Record<string, number>>(serializeBSONWithoutOptimiser({ a: 1 }));
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
        expect(result instanceof Object).toBe(true);
        expect(String(result)).toBe('[object Object]');
        expect(result.hasOwnProperty('a')).toBe(true);
        expect(result).toEqual({ a: 1 });
    });

    test('a value type the sent prototype satisfies', () => {
        expectOrdinaryKey(deserializeBSON<Record<string, { isAdmin: boolean } | number>>(bytes()));
    });

    test('a record nested in a property', () => {
        const result = deserializeBSON<{ m: Record<string, any> }>(nestedBytes());
        expectOrdinaryKey(result.m);
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });

    test('named properties beside an index signature', () => {
        const result = deserializeBSON<{ a: number; [k: string]: any }>(bytes());
        expectOrdinaryKey(result);
        expect(result.a).toBe(1);
    });

    test('an optional named property is not answered by the sent prototype', () => {
        const document = serializeBSONWithoutOptimiser(JSON.parse('{"__proto__": {"role": "admin"}}'));
        const result = deserializeBSON<{ role?: string; [k: string]: any }>(document);
        expect(result.role).toBe(undefined);
        expect(hasOwn(result, 'role')).toBe(false);
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });

    test('a class with an index signature stays an instance of its class', () => {
        class Bag {
            a: number = 0;
            [k: string]: any;

            label(): string {
                return 'bag ' + this.a;
            }
        }

        const result = deserializeBSON<Bag>(bytes());
        expectOrdinaryKey(result, Bag.prototype);
        expect(result instanceof Bag).toBe(true);
        expect(result.label()).toBe('bag 1');

        const typed = deserializeBSON<{ m: Bag }>(nestedBytes()).m;
        expectOrdinaryKey(typed, Bag.prototype);
        expect(typed.label()).toBe('bag 1');
    });

    test('a class whose index signature has a value type', () => {
        class Flags {
            a: number = 0;
            [k: string]: { isAdmin: boolean } | number;
        }

        const result = deserializeBSON<Flags>(bytes());
        expectOrdinaryKey(result, Flags.prototype);
        expect(result instanceof Flags).toBe(true);
    });

    test('what was decoded is what is encoded again', () => {
        const decoded = deserializeBSON<Record<string, any>>(bytes());
        const again = deserializeBSON<Record<string, any>>(serializeBSON<Record<string, any>>(decoded));
        expectOrdinaryKey(again);
        expect(JSON.stringify(again)).toBe('{"__proto__":{"isAdmin":true},"a":1}');
    });

    test('Object.prototype is untouched', () => {
        deserializeBSON<Record<string, any>>(bytes());
        expect(({} as any).isAdmin).toBe(undefined);
    });
});

describe('input keys: the untyped BSON parser', () => {
    test('the key is dropped', () => {
        const result = deserializeBSONWithoutOptimiser(bytes());
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
        expect(Object.keys(result)).toEqual(['a']);
        expect(result.isAdmin).toBe(undefined);
    });

    test('a value typed any is decoded by it', () => {
        const result = deserializeBSON<{ m: any }>(nestedBytes()).m;
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
        expect(Object.keys(result)).toEqual(['a']);
        expect(result.isAdmin).toBe(undefined);
    });
});

test('input keys: the same holds interpreted', { skip: getJitMode() === 'interpreted' }, () => {
    // Without the parent runner's test-protocol variables: inherited, they make the child node
    // behave as a child of this run.
    const env: Record<string, string> = { DEEPKIT_JIT_MODE: 'interpreted' };
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && !key.startsWith('NODE_TEST') && key !== 'DEEPKIT_JIT_MODE') env[key] = value;
    }
    try {
        execFileSync(process.execPath, ['--import', '@deepkit/run', '--test', __filename], { encoding: 'utf8', env, stdio: 'pipe' });
    } catch (error: any) {
        // The child's report is the reason; without it the failure reads "Command failed".
        expect(String(error.stdout ?? '') + String(error.stderr ?? '')).toBe('');
    }
});
