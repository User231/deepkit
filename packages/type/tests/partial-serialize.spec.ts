import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { deserialize, integer, serialize, typeOf } from '@deepkit/type';

import { getPartialSerializeFunction, serializer } from '../src/serializer/serializer.js';

/**
 * Partial serialization is the ORM's patch path (`buildSetFromChanges`): the emitted keys become
 * the SET clause of an UPDATE, so a key that was NOT in the input must never appear in the output.
 * The bug this pins down: absent nullable members were serialized as `null` (the absent-input
 * branch filled nullable members unconditionally), so `patchMany({status})` nulled every untouched
 * nullable column — found via a bot-outbox row losing its unique `dedupe_key` (the replay
 * idempotency key) the moment the delivery worker recorded an outcome.
 */

class Row {
    id: integer = 0;
    status: string = 'pending';
    attempts: integer = 0;
    dedupeKey: string | null = null;
    sentAt: Date | null = null;
}

const partial = getPartialSerializeFunction(typeOf<Row>() as any, serializer.serializeRegistry);

test('partial serialize emits ONLY the given properties — absent nullable members stay absent', () => {
    expect(Object.keys(partial({ status: 'dead' }))).toEqual(['status']);
    expect(Object.keys(partial({ attempts: 3, status: 'pending' })).sort()).toEqual(['attempts', 'status']);
});

test('partial serialize keeps explicit values for nullable members, including explicit null', () => {
    expect(partial({ dedupeKey: 'key-1' })).toEqual({ dedupeKey: 'key-1' });
    expect(partial({ dedupeKey: null })).toEqual({ dedupeKey: null });
});

test('full serialize of a plain object still fills a missing non-optional nullable with null', () => {
    // Unchanged semantics: on the FULL type the member is not optional, so absence reads as null
    // (a class instance always carries the property; a bare object literal serializes the same).
    const full = serialize<Row>({ id: 1, status: 'x', attempts: 0 } as any);
    expect(full.dedupeKey).toBe(null);
});

test('deserialize still fills an absent nullable member with null', () => {
    // Unchanged semantics: a missing DB column/JSON key IS null for the target.
    const row = deserialize<Row>({ id: 1, status: 'x', attempts: 0 });
    expect(row.dedupeKey).toBe(null);
    expect(row.sentAt).toBe(null);
});
