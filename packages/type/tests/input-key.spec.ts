/**
 * A key from the input never runs a setter.
 *
 * `target['__proto__'] = value` is not a write of a property: it runs the setter `Object.prototype`
 * holds and replaces the prototype of `target`. A decoder that copies the keys of an index
 * signature with a plain assignment therefore lets the INPUT choose the prototype of the result —
 * every property of the value it sends is inherited by the decoded object, and `Object.keys()`
 * lists none of them. Until 2026-11-24 that is what `deserialize` and `cast` did for every type
 * with an index signature.
 *
 * The rule (`setInputKey`, `src/serializer/input-key.ts`): `"__proto__"` is an ordinary own
 * property, exactly as `JSON.parse` makes it, and the result keeps the prototype its type gives it.
 * `@deepkit/bson` decodes by the same helper (`bson/tests/input-key.spec.ts`).
 *
 * Both modes of the JIT are held: this file runs in the mode of the process, and its last test runs
 * the file again with `DEEPKIT_JIT_MODE=interpreted`.
 */
import { execFileSync } from 'node:child_process';
import { describe, test } from 'node:test';

import { getJitMode } from '@deepkit/core';
import { expect } from '@deepkit/run/expect';

import { buildChanges, getChangeDetector } from '../src/change-detector.js';
import { Changes, ItemChanges } from '../src/changes.js';
import { ReflectionClass, typeOf } from '../src/reflection/reflection.js';
import { cast, deserialize, serialize } from '../src/serializer-facade.js';
import { ValidationError } from '../src/serializer/errors.js';
import { createSnapshot } from '../src/snapshot.js';
import { is } from '../src/typeguard.js';
import { validate } from '../src/validator.js';

/** What a request body is: `JSON.parse` makes `__proto__` an own property of the object it returns. */
const attack = (): any => JSON.parse('{"__proto__": {"isAdmin": true}, "a": 1}');

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

/**
 * The decoded object has the prototype its type gives it, holds `__proto__` as a key like any
 * other, and inherits nothing the input sent.
 */
function expectOrdinaryKey(result: any, prototype: object = Object.prototype): void {
    expect(Object.getPrototypeOf(result)).toBe(prototype);
    expect(hasOwn(result, '__proto__')).toBe(true);
    expect(Object.keys(result)).toContain('__proto__');
    expect(result.isAdmin).toBe(undefined);
    expect('isAdmin' in result).toBe(false);
}

describe('input keys: deserialize and cast', () => {
    test('Record<string, any>', () => {
        const result = deserialize<Record<string, any>>(attack());
        expectOrdinaryKey(result);
        expect(Object.getOwnPropertyDescriptor(result, '__proto__')).toEqual({
            value: { isAdmin: true },
            writable: true,
            enumerable: true,
            configurable: true,
        });
        expect(result.a).toBe(1);
    });

    test('cast<Record<string, any>>', () => {
        expectOrdinaryKey(cast<Record<string, any>>(attack()));
    });

    test('a value type the sent prototype satisfies', () => {
        const result = deserialize<Record<string, { isAdmin: boolean } | number>>(attack());
        expectOrdinaryKey(result);
        expectOrdinaryKey(cast<Record<string, { isAdmin: boolean } | number>>(attack()));
    });

    test('a record nested in a property', () => {
        const result = deserialize<{ m: Record<string, any> }>({ m: attack() });
        expectOrdinaryKey(result.m);
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });

    test('a record nested in a record and in an array', () => {
        expectOrdinaryKey(deserialize<Record<string, Record<string, any>>>({ outer: attack() }).outer);
        expectOrdinaryKey(deserialize<Record<string, any>[]>([attack()])[0]);
    });

    test('named properties beside an index signature', () => {
        const result = deserialize<{ a: number; [k: string]: any }>(attack());
        expectOrdinaryKey(result);
        expect(result.a).toBe(1);
    });

    test('an optional named property is not answered by the sent prototype', () => {
        const input = JSON.parse('{"__proto__": {"role": "admin"}}');
        const result = deserialize<{ role?: string; [k: string]: any }>(input);
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

        const result = deserialize<Bag>(attack());
        expectOrdinaryKey(result, Bag.prototype);
        expect(result instanceof Bag).toBe(true);
        expect(result.label()).toBe('bag 1');
    });

    test('an index signature whose keys are numbers or a template', () => {
        // The key matches neither signature. Such a key is written as `undefined`, like any other
        // key that does not match, and the prototype stays.
        const numeric = deserialize<{ [index: number]: any }>(attack());
        expect(Object.getPrototypeOf(numeric)).toBe(Object.prototype);
        expect(numeric.isAdmin).toBe(undefined);

        const template = deserialize<{ [key: `x-${string}`]: any }>(attack());
        expect(Object.getPrototypeOf(template)).toBe(Object.prototype);
        expect((template as any).isAdmin).toBe(undefined);
    });

    test('a null or absent value under the key', () => {
        const nulled = deserialize<Record<string, any>>(JSON.parse('{"__proto__": null, "a": 1}'));
        expect(Object.getPrototypeOf(nulled)).toBe(Object.prototype);
        expect(nulled.a).toBe(1);

        const strict = deserialize<Record<string, number>>(JSON.parse('{"__proto__": 5, "a": 1}'));
        expect(Object.getPrototypeOf(strict)).toBe(Object.prototype);
        expect(Object.getOwnPropertyDescriptor(strict, '__proto__')?.value).toBe(5);
    });

    test('any: the input object is passed through as it is', () => {
        const result = deserialize<any>(attack());
        expectOrdinaryKey(result);
    });

    test('the value under the key is converted and validated like any other value', () => {
        const result = deserialize<Record<string, { at: Date }>>(JSON.parse('{"__proto__": {"at": "2026-11-24T00:00:00.000Z"}}'));
        const value = Object.getOwnPropertyDescriptor(result, '__proto__')?.value;
        expect(value.at instanceof Date).toBe(true);

        expect(() => cast<Record<string, number>>(attack())).toThrow(ValidationError);
    });

    test('what was decoded is what is encoded again', () => {
        const result = deserialize<Record<string, any>>(attack());
        expect(JSON.stringify(result)).toBe('{"__proto__":{"isAdmin":true},"a":1}');
    });

    test('Object.prototype is untouched', () => {
        deserialize<Record<string, any>>(attack());
        cast<Record<string, any>>(attack());
        expect(({} as any).isAdmin).toBe(undefined);
    });
});

describe('input keys: serialize', () => {
    test('an own __proto__ key of the value stays a key of the output', () => {
        const result = serialize<Record<string, any>>(attack());
        expectOrdinaryKey(result);
        expect(JSON.stringify(result)).toBe('{"__proto__":{"isAdmin":true},"a":1}');
    });

    test('a class with an index signature', () => {
        class Bag {
            a: number = 0;
            [k: string]: any;
        }

        const result = serialize<Bag>(deserialize<Bag>(attack()));
        expectOrdinaryKey(result);
        expect(result.a).toBe(1);
    });
});

describe('input keys: validate and is', () => {
    test('the key is checked against the value type like any other key', () => {
        expect(is<Record<string, any>>(attack())).toBe(true);
        expect(is<Record<string, { isAdmin: boolean } | number>>(attack())).toBe(true);
        expect(is<Record<string, number>>(attack())).toBe(false);

        expect(validate<Record<string, any>>(attack())).toEqual([]);
        const errors = validate<Record<string, number>>(attack());
        expect(errors.length).toBe(1);
        expect(errors[0].path).toBe('__proto__');
    });

    test('they read the value and leave it as it was', () => {
        const input = attack();
        is<Record<string, any>>(input);
        validate<Record<string, any>>(input);
        expectOrdinaryKey(input);
    });
});

describe('input keys: snapshot and change detection', () => {
    // The index signature of a PROPERTY: that is the one a snapshot walks key by key.
    class Entity {
        id: number = 0;
        meta: { [k: string]: any } = {};
    }

    const own = (value: unknown) => ({ value, writable: true, enumerable: true, configurable: true });

    test('the snapshot of an item that holds the key keeps it as a key', () => {
        const item = deserialize<Entity>({ id: 1, meta: attack() });
        expectOrdinaryKey(item.meta);

        const snapshot: any = createSnapshot(ReflectionClass.from(typeOf<Entity>()), item);
        expectOrdinaryKey(snapshot.meta);
        expect(Object.getOwnPropertyDescriptor(snapshot.meta, '__proto__')?.value).toEqual({ isAdmin: true });
    });

    test('a change under the key is a change of the property', () => {
        const reflection = ReflectionClass.from(typeOf<Entity>());
        const item = deserialize<Entity>({ id: 1, meta: attack() });
        const snapshot = createSnapshot(reflection, item);
        expect(buildChanges(reflection, snapshot, item).empty).toBe(true);

        Object.defineProperty(item.meta, '__proto__', own({ isAdmin: false }));
        const changes = buildChanges(reflection, snapshot, item);
        expect(changes.fieldNames).toEqual(['meta']);
        const meta: any = changes.$set?.meta;
        expectOrdinaryKey(meta);
        expect(Object.getOwnPropertyDescriptor(meta, '__proto__')?.value).toEqual({ isAdmin: false });
    });

    test('a changed key of the item itself is reported under the key', () => {
        // The keys of a class's own index signature are compared between two snapshots.
        class Bag {
            id: number = 0;
            [k: string]: any;
        }

        const reflection = ReflectionClass.from(typeOf<Bag>());
        const item = deserialize<Bag>({ id: 1 });
        const last: any = { id: 1 };
        const current: any = { id: 1 };
        Object.defineProperty(current, '__proto__', own({ isAdmin: true }));
        Object.defineProperty(item, '__proto__', own({ isAdmin: true }));

        const set: any = getChangeDetector(reflection)(last, current, item)?.$set;
        expectOrdinaryKey(set);
        expect(Object.getOwnPropertyDescriptor(set, '__proto__')?.value).toEqual({ isAdmin: true });
    });
});

describe('input keys: Changes', () => {
    test('a change recorded under the key is a key of the change set', () => {
        const changes = new Changes<Record<string, any>>();
        changes.set('__proto__', { isAdmin: true });
        expectOrdinaryKey(changes.$set);
        changes.unset('__proto__');
        expect(Object.getPrototypeOf(changes.$unset)).toBe(Object.prototype);
        expect(hasOwn(changes.$unset!, '__proto__')).toBe(true);

        const merged = new Changes<Record<string, any>>();
        merged.mergeSet(attack());
        expectOrdinaryKey(merged.$set);
    });

    test('a change applied to the item is a key of the item', () => {
        const item: Record<string, any> = {};
        new ItemChanges<Record<string, any>>({}, item).set('__proto__', { isAdmin: true });
        expectOrdinaryKey(item);
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
