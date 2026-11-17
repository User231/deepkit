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

import { ObjectId } from '@deepkit/bson';
import { Database } from '@deepkit/orm';
import { AutoIncrement, MongoId, PrimaryKey, Reference, UUID, uuid } from '@deepkit/type';

import { MongoDatabaseAdapter } from '../src/adapter.js';

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

// A count is of what the caller can READ. The server answers the `count` command from the
// collection's metadata whenever it can reduce the predicate to nothing, and that number
// includes what an open transaction has inserted and not committed. An exact count used to
// keep away from that path with a predicate added to an empty query (`{<pk>: {$nin: []}}`);
// MongoDB 8 reduces that one to nothing as well, so `various:transactionSimple` of the shared
// ORM suite read 3 where nothing was committed. An exact count is an aggregation now.
test('a count beside an open transaction does not count what it has not committed', async () => {
    class Entry {
        id: number & PrimaryKey & AutoIncrement = 0;
        constructor(public label: string) {}
    }

    const database = new Database(new MongoDatabaseAdapter(`mongodb://127.0.0.1:${process.env.MONGO_PORT || 27117}/deepkit_mig_test`), [Entry]);
    databases.push(database);
    await database.query(Entry).deleteMany();
    await database.persist(new Entry('committed'));

    const session = database.createSession();
    session.useTransaction();
    session.add(new Entry('open 1'), new Entry('open 2'), new Entry('open 3'));
    await session.flush();

    // inside the transaction: its own writes
    assert.strictEqual(await session.query(Entry).count(), 4);

    // outside it: only what is committed — with no predicate, and with predicates the server
    // reduces to none (an empty exclusion list is what a caller's own filter often is)
    assert.strictEqual(await database.query(Entry).count(), 1);
    assert.strictEqual(
        await database
            .query(Entry)
            .filter({ id: { $nin: [] } })
            .count(),
        1,
    );
    assert.strictEqual(
        await database
            .query(Entry)
            .filter({ label: { $nin: [] } })
            .count(),
        1,
    );
    assert.strictEqual(await database.query(Entry).has(), true);

    // a page and an order are not part of a count
    assert.strictEqual(await database.query(Entry).sort({ label: 'desc' }).limit(1).skip(5).count(), 1);
    assert.strictEqual(await database.query(Entry).filter({ label: 'committed' }).count(), 1);
    assert.strictEqual(await database.query(Entry).filter({ label: 'open 1' }).count(), 0);

    await session.rollback();
    assert.strictEqual(await database.query(Entry).count(), 1);

    await database.transaction(async session => {
        session.add(new Entry('second'), new Entry('third'));
    });
    assert.strictEqual(await database.query(Entry).count(), 3);
    assert.strictEqual(
        await database
            .query(Entry)
            .filter({ label: { $in: ['second', 'third'] } })
            .count(),
        2,
    );

    // An estimate is still the `count` command: the number in the collection's metadata.
    assert.strictEqual(await database.query(Entry).withOptions({ estimateCount: true }).count(), 3);
    assert.strictEqual(await database.query(Entry).withOptions({ estimateCount: true }).filter({ label: 'second' }).count(), 1);
});
