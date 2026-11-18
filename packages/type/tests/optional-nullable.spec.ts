import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { ReflectionClass, cast, deserialize, parametersToTuple, serialize, typeOf } from '@deepkit/type';

/**
 * `x?: T | null` is the shape of a PATCH: an absent member means "leave it", `null` means "clear
 * it". The two must survive both directions of the JSON serializer.
 *
 * The bug this pins down (found 2026-11-18): deserialize filled EVERY absent nullable member with
 * `null`, optional or not. An RPC action taking `{ status?: string | null }` could not tell a
 * caller who left `status` out from one who cleared it — a patch of one field cleared the others —
 * and serialize wrote an explicit `undefined` as `null`, which did the same from the sending side.
 */

interface Patch {
    status?: string | null;
    role?: 'read' | 'write' | null;
    at?: Date | null;
    nested?: { note?: string | null };
    /** Optional, NOT nullable. */
    plain?: string;
    /** Nullable, NOT optional. */
    required: string | null;
}

test('deserialize: an absent optional-nullable member stays absent', () => {
    const patch = deserialize<Patch>({ required: 'x' });
    expect('status' in patch).toBe(false);
    expect('role' in patch).toBe(false);
    expect('at' in patch).toBe(false);
    expect('nested' in patch).toBe(false);
    expect(patch).toEqual({ required: 'x' });

    expect(cast<Patch>({ required: 'x' })).toEqual({ required: 'x' });
    expect(cast<Patch>({ required: 'x' }, { loosely: false })).toEqual({ required: 'x' });
});

test('deserialize: null stays null, a value stays a value — nested too', () => {
    const cleared = deserialize<Patch>({ required: null, status: null, role: null, at: null, nested: { note: null } });
    expect(cleared).toEqual({ required: null, status: null, role: null, at: null, nested: { note: null } });

    const set = deserialize<Patch>({ required: 'x', status: 'open', role: 'write', at: '2026-01-02T03:04:05.006Z', nested: { note: 'n' } });
    expect(set.status).toBe('open');
    expect(set.role).toBe('write');
    expect(set.at).toBeInstanceOf(Date);
    expect(set.nested).toEqual({ note: 'n' });

    const inner = deserialize<Patch>({ required: 'x', nested: {} });
    expect(inner.nested).toEqual({});
    expect('note' in (inner.nested ?? {})).toBe(false);
});

test('deserialize: an explicit undefined is not turned into null', () => {
    const patch = deserialize<Patch>({ required: 'x', status: undefined } as any);
    expect(patch.status).toBe(undefined);
    expect(patch.status === null).toBe(false);
});

test('deserialize: a nullable member that is REQUIRED still reads absence as null', () => {
    // Unchanged: `null` is the only value that satisfies the type (a missing DB column / JSON key).
    expect(deserialize<Patch>({} as any).required).toBe(null);
    expect(deserialize<Patch>({ required: undefined } as any).required).toBe(null);
});

test('deserialize: an optional member that is NOT nullable still reads null as undefined', () => {
    // Unchanged: null is not a value of `plain?: string`.
    const patch = deserialize<Patch>({ required: 'x', plain: null } as any);
    expect(patch.plain).toBe(undefined);
});

test('serialize: an undefined optional-nullable member is left out, null is kept', () => {
    const out = serialize<Patch>({ required: 'x', status: undefined, role: undefined, at: undefined, nested: { note: undefined } });
    expect('status' in out).toBe(false);
    expect('role' in out).toBe(false);
    expect('at' in out).toBe(false);
    expect(out.nested).toEqual({});
    expect(out).toEqual({ required: 'x', nested: {} });

    expect(serialize<Patch>({ required: null, status: null, role: null, at: null, nested: { note: null } })).toEqual({
        required: null,
        status: null,
        role: null,
        at: null,
        nested: { note: null },
    });
    expect(serialize<Patch>({ required: 'x' })).toEqual({ required: 'x' });
});

test('serialize: members that are only optional, or only nullable, are written as before', () => {
    // Unchanged: on these the difference between `undefined` and `null` carries no meaning.
    expect(serialize<Patch>({ required: 'x', plain: undefined }).plain).toBe(null);
    expect(serialize<Patch>({ required: undefined } as any).required).toBe(null);
});

test('a patch round-trips through JSON text with absent, null and set apart', () => {
    const through = (patch: Patch): Patch => deserialize<Patch>(JSON.parse(JSON.stringify(serialize<Patch>(patch))));
    expect(through({ required: 'x' })).toEqual({ required: 'x' });
    expect(through({ required: 'x', status: undefined })).toEqual({ required: 'x' });
    expect(through({ required: 'x', status: null })).toEqual({ required: 'x', status: null });
    expect(through({ required: 'x', status: 'open', nested: {} })).toEqual({ required: 'x', status: 'open', nested: {} });
});

interface PatchApi {
    patch(input: Patch): Promise<void>;
}

test('an action parameter tuple — what an RPC call is cast through — keeps them apart', () => {
    const method = ReflectionClass.from(typeOf<PatchApi>()).getMethod('patch');
    const tuple = parametersToTuple(method.getParameters().map(parameter => parameter.parameter));

    const sent = serialize<unknown>([{ required: 'x', status: undefined }], undefined, undefined, undefined, tuple);
    expect(sent).toEqual([{ required: 'x' }]);

    const received = cast<any>(JSON.parse(JSON.stringify(sent)), { loosely: false }, undefined, undefined, tuple);
    expect(received[0]).toEqual({ required: 'x' });
    expect('status' in received[0]).toBe(false);

    const cleared = cast<any>([{ required: 'x', status: null }], { loosely: false }, undefined, undefined, tuple);
    expect(cleared[0].status).toBe(null);
});

class PlainPatch {
    status?: string | null;
    required: string | null = null;
}

class ConstructedPatch {
    constructor(
        public required: string | null,
        public status?: string | null,
    ) {}
    note?: string | null;
}

test('classes: properties and constructor arguments keep absence apart from null', () => {
    const plain = deserialize<PlainPatch>({ required: 'x' });
    expect(plain).toBeInstanceOf(PlainPatch);
    expect(plain.status).toBe(undefined);
    expect(deserialize<PlainPatch>({ required: 'x', status: null }).status).toBe(null);
    expect(deserialize<PlainPatch>({}).required).toBe(null);

    const constructed = deserialize<ConstructedPatch>({ required: 'x' });
    expect(constructed).toBeInstanceOf(ConstructedPatch);
    expect(constructed.status).toBe(undefined);
    expect(constructed.note).toBe(undefined);

    const cleared = deserialize<ConstructedPatch>({ required: null, status: null, note: null });
    expect(cleared.status).toBe(null);
    expect(cleared.note).toBe(null);
    expect(cleared.required).toBe(null);
});
