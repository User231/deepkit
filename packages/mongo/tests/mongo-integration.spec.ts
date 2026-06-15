/**
 * Live integration test for the migrated MongoDB client/serializer, run via
 * `node --import @deepkit/run --test` against a real mongod replica set on
 * 127.0.0.1:27017. Exercises the full path: command framing (sendMessage →
 * getBSONSerializer tuple), response parsing (BSONStreamReader + deserializer),
 * insert (typed), query/update by MongoId & UUID (mongoSerializer → BSONValue),
 * and `& Reference` → foreign key.
 */
import assert from 'node:assert';
import { after, test } from 'node:test';

import { Database } from '@deepkit/orm';
import { AutoIncrement, MongoId, PrimaryKey, Reference, UUID, uuid } from '@deepkit/type';

import { MongoDatabaseAdapter } from '../src/adapter.js';
import { ObjectId } from '@deepkit/bson';

class Group {
    _id: MongoId & PrimaryKey = '';
    constructor(public name: string) {}
}

class User {
    _id: MongoId & PrimaryKey = '';
    token: UUID = uuid();
    created: Date = new Date();
    logins: number = 0;
    group?: Group & Reference;
    constructor(public name: string) {}
}

const databases: Database[] = [];
function db(): Database {
    const d = new Database(new MongoDatabaseAdapter(`mongodb://127.0.0.1:${process.env.MONGO_PORT || 27117}/deepkit_mig_test`));
    d.register(User, Group);
    databases.push(d);
    return d;
}

after(async () => {
    for (const d of databases) await d.disconnect(true);
});

test('insert + query by MongoId _id (ObjectId on the wire)', async () => {
    const database = db();
    await database.query(User).deleteMany();

    const u = new User('alice');
    u._id = ObjectId.generate();
    await database.persist(u);

    const back = await database.query(User).filter({ _id: u._id }).findOne();
    assert.strictEqual(back.name, 'alice');
    assert.strictEqual(back._id, u._id);
    assert.strictEqual(typeof back.token, 'string');
    assert.match(back.token, /^[0-9a-f-]{36}$/);
});

test('query by UUID field', async () => {
    const database = db();
    await database.query(User).deleteMany();

    const u = new User('bob');
    u._id = ObjectId.generate();
    const token = uuid();
    u.token = token;
    await database.persist(u);

    const found = await database.query(User).filter({ token }).findOne();
    assert.strictEqual(found.name, 'bob');
    assert.strictEqual(found.token, token);
});

test('update (patch) by _id — partial serialize wraps ids', async () => {
    const database = db();
    await database.query(User).deleteMany();

    const u = new User('carol');
    u._id = ObjectId.generate();
    await database.persist(u);

    await database.query(User).filter({ _id: u._id }).patchOne({ logins: 5 });
    const back = await database.query(User).filter({ _id: u._id }).findOne();
    assert.strictEqual(back.logins, 5);
});

// A hydrated `& Reference` (full instance) is persisted as its foreign key. The ORM's
// doPersist runs `validate(item, schema.type)`; @deepkit/type's reference guard accepts
// either a hydrated instance (carrying the PK) or the FK value itself — see the
// `guardReferenceFast` fix in packages/type/src/serializer/handlers.ts (it emits each
// branch's guard conditionally so the non-matching branch can't push spurious errors).
test('reference (& Reference) stored as foreign key and joined back', async () => {
    const database = db();
    await database.query(User).deleteMany();
    await database.query(Group).deleteMany();

    const g = new Group('admins');
    g._id = ObjectId.generate();
    await database.persist(g);

    const u = new User('dave');
    u._id = ObjectId.generate();
    u.group = g;
    await database.persist(u);

    const back = await database.query(User).filter({ _id: u._id }).joinWith('group').findOne();
    assert.ok(back.group, 'group joined');
    assert.strictEqual(back.group._id, g._id, 'FK resolves to the group ObjectId');
    assert.strictEqual(back.group.name, 'admins');
});
