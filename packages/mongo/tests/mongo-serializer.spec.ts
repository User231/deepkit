/**
 * DB-free tests for {@link mongoSerializer}: the serializer that prepares MongoDB filter /
 * update documents. It must wrap MongoId / UUID / BinaryBigInt values in a {@link BSONValue}
 * (so the BSON `any` path encodes them as ObjectId / binary), reduce `& Reference` properties
 * to their foreign key, and pass everything else through as native JS.
 *
 * Runs via `node --import @deepkit/run --test` (no MongoDB required).
 */
import * as officialBson from 'bson';
import assert from 'node:assert';
import { test } from 'node:test';

import { BSONValue, getBSONDeserializer, getBSONSerializer } from '@deepkit/bson';
import {
    BinaryBigInt,
    MongoId,
    PrimaryKey,
    Reference,
    UUID,
    getPartialSerializeFunction,
    serialize,
    typeOf,
} from '@deepkit/type';

import { mongoSerializer } from '../src/mongo-serializer.js';

test('wraps MongoId / UUID / BinaryBigInt leaf values into BSONValue', () => {
    const mongoId: any = serialize('5f1a2b3c4d5e6f7a8b9c0d1e', undefined, mongoSerializer, undefined, typeOf<string & MongoId>());
    assert.ok(mongoId instanceof BSONValue, 'MongoId should be wrapped in BSONValue');

    const uuid: any = serialize('0d4c97f2-1b3c-4d5e-8f7a-8b9c0d1e2f3a', undefined, mongoSerializer, undefined, typeOf<string & UUID>());
    assert.ok(uuid instanceof BSONValue, 'UUID should be wrapped in BSONValue');

    const big: any = serialize(42n, undefined, mongoSerializer, undefined, typeOf<bigint & BinaryBigInt>());
    assert.ok(big instanceof BSONValue, 'BinaryBigInt should be wrapped in BSONValue');
});

test('passes plain values through untouched (no JSON transforms)', () => {
    const date = new Date('2020-01-02T03:04:05.678Z');
    const d: any = serialize(date, undefined, mongoSerializer, undefined, typeOf<Date>());
    assert.ok(d instanceof Date, 'Date must stay a native Date (BSON encodes it natively), got ' + typeof d);

    const n: any = serialize(7, undefined, mongoSerializer, undefined, typeOf<number>());
    assert.strictEqual(n, 7);

    const s: any = serialize('hello', undefined, mongoSerializer, undefined, typeOf<string>());
    assert.strictEqual(s, 'hello');
});

class User {
    _id: string & MongoId & PrimaryKey = '';
}

class Post {
    _id: string & MongoId & PrimaryKey = '';
    token: string & UUID = '';
    author!: User & Reference;
    views: number = 0;
}

test('partial serialize wraps ids and reduces references to their FK', () => {
    const partial = getPartialSerializeFunction(typeOf<Post>() as any, mongoSerializer.serializeRegistry);
    const doc: any = partial({
        _id: '5f1a2b3c4d5e6f7a8b9c0d1e',
        token: '0d4c97f2-1b3c-4d5e-8f7a-8b9c0d1e2f3a',
        author: { _id: 'aa1a2b3c4d5e6f7a8b9c0d1e' },
        views: 7,
    });

    assert.ok(doc._id instanceof BSONValue, '_id wrapped');
    assert.ok(doc.token instanceof BSONValue, 'token (uuid) wrapped');
    assert.strictEqual(doc.views, 7, 'plain number passthrough');
    // reference → foreign key; the FK is itself a MongoId, so it is wrapped too
    assert.ok(doc.author instanceof BSONValue, 'reference reduced to (wrapped) FK');
    assert.strictEqual(doc.author.value, 'aa1a2b3c4d5e6f7a8b9c0d1e', 'FK is the author primary key');
});

test('serialized filter/update doc encodes through BSON as ObjectId / UUID and roundtrips', () => {
    const partial = getPartialSerializeFunction(typeOf<Post>() as any, mongoSerializer.serializeRegistry);
    const set: any = partial({ _id: '5f1a2b3c4d5e6f7a8b9c0d1e', token: '0d4c97f2-1b3c-4d5e-8f7a-8b9c0d1e2f3a', views: 7 });

    interface Update {
        q: any;
        u: any;
    }
    const result = getBSONSerializer<Update>()({ q: { _id: set._id }, u: { $set: { token: set.token, views: set.views } } });
    const bytes = result[0].slice(0, result[1]);

    // byte-for-byte identical to the official BSON encoding (ObjectId + UUID binary), proving the
    // ids are encoded as ObjectId/binary rather than plain strings.
    const expected = officialBson.serialize({
        q: { _id: new officialBson.ObjectId('5f1a2b3c4d5e6f7a8b9c0d1e') },
        u: { $set: { token: new officialBson.Binary(Buffer.from('0d4c97f21b3c4d5e8f7a8b9c0d1e2f3a', 'hex'), 4), views: 7 } },
    });
    assert.deepStrictEqual(Array.from(bytes), Array.from(expected), 'update doc must match official BSON ObjectId/UUID encoding');

    const out: any = getBSONDeserializer<Update>()(bytes);
    assert.strictEqual(out.q._id, '5f1a2b3c4d5e6f7a8b9c0d1e', 'q._id roundtrips as ObjectId hex');
    assert.strictEqual(out.u.$set.token, '0d4c97f2-1b3c-4d5e-8f7a-8b9c0d1e2f3a', 'u.$set.token roundtrips as UUID');
    assert.strictEqual(out.u.$set.views, 7, 'plain value roundtrips');
});
