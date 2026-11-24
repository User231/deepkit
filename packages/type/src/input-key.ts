/*
 * Deepkit Framework
 * Copyright (c) Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import type { Builder, Ref } from '@deepkit/core';

/**
 * The one key a plain assignment does not treat as a key: `target['__proto__'] = value` runs the
 * setter that `Object.prototype` holds and replaces the prototype of `target` with `value`.
 */
const PROTO_KEY = '__proto__';

/**
 * Makes `__proto__` an OWN data property of `target`, so the assignment that follows writes that
 * property instead of running the inherited setter. An own property always wins the lookup.
 */
function ownProtoKey(target: object): void {
    Object.defineProperty(target, PROTO_KEY, {
        value: undefined,
        writable: true,
        enumerable: true,
        configurable: true,
    });
}

/**
 * `target[key] = value` for a key that comes from DATA — an index-signature key of a decoded
 * document, of an entity, of a snapshot.
 *
 * The rule, one for every decoder of `@deepkit/type` and `@deepkit/bson`: a key from the input never
 * runs a setter. `"__proto__"` becomes an ordinary own property, exactly as `JSON.parse` makes it,
 * and the object keeps the prototype its type gives it. Written with a plain assignment the same key
 * lets the input choose the prototype of the result: every property of the value it sends is then
 * inherited by the decoded object, and none of them is listed by `Object.keys()`.
 *
 * What it costs is one comparison of the key per write. The value is written by the same assignment
 * as before, so its expression appears once in the generated function.
 *
 * A key the generator knows (a literal) is decided while the function is built.
 *
 * {@link assignInputKey} is the same rule for a write done in plain JavaScript.
 */
export function setInputKey(b: Builder, target: Ref, key: Ref<string>, value: Ref): void {
    if (key.expr.kind === 'lit') {
        if (key.expr.value === PROTO_KEY) b.exec(b.call(ownProtoKey, target));
    } else {
        b.if_(b.eq(key, b.lit(PROTO_KEY)), () => {
            b.exec(b.call(ownProtoKey, target));
        });
    }
    b.set(target, key, value);
}

/**
 * `target[key] = value` for a key that comes from data, in plain JavaScript: what
 * {@link setInputKey} writes into a generated function.
 */
export function assignInputKey(target: object, key: PropertyKey, value: unknown): void {
    if (key === PROTO_KEY) ownProtoKey(target);
    (target as Record<PropertyKey, unknown>)[key] = value;
}
