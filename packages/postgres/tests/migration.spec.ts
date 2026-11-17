import { test } from 'node:test';

import { DatabaseEntityRegistry } from '@deepkit/orm';
import { expect } from '@deepkit/run/expect';
import { schemaMigrationRoundTrip } from '@deepkit/sql';
import { AutoIncrement, Entity, Postgres, PrimaryKey, Reference, ReflectionClass, Unique, float32, int8, int16, int32, integer, typeOf, uint8, uint16, uint32 } from '@deepkit/type';

import { PostgresDatabaseAdapter } from '../src/postgres-adapter.js';

test('custom type', async () => {
    class post {
        id: number & AutoIncrement & PrimaryKey = 0;
        slug: string & Postgres<{ type: 'VARCHAR(255)' }> = '';
        content: string = '';
    }

    const reflection = ReflectionClass.from(post);
    reflection.getProperty('slug');
    const adapter = new PostgresDatabaseAdapter({
        host: process.env.POSTGRES_HOST || '127.0.0.1',
        port: parseInt(process.env.POSTGRES_PORT || '15432', 10),
        database: process.env.POSTGRES_DB || 'postgres',
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || undefined,
    });
    const [postTable] = adapter.platform.createTables(DatabaseEntityRegistry.from([post]));
    expect(postTable.getColumn('slug').type).toBe('varchar');
    expect(postTable.getColumn('slug').size).toBe(255);

    expect(postTable.getColumn('content').type).toBe('text');

    await schemaMigrationRoundTrip([post], adapter);
});

test('default expression', async () => {
    class post {
        id: number & AutoIncrement & PrimaryKey = 0;
        str: string & Postgres<{ type: 'VARCHAR(255)'; default: 'abc' }> = '';
        no: number & Postgres<{ default: 34.5 }> = 3;
        json: any & Postgres<{ default: { a: true } }> = {};
        jsonAuto: any = { a: true };
        created: Date & Postgres<{ defaultExpr: `now()` }> = new Date();
        createdAuto: Date = new Date(); //this is detected as datetime('now')
        opt?: boolean;
    }

    const adapter = new PostgresDatabaseAdapter({
        host: process.env.POSTGRES_HOST || '127.0.0.1',
        port: parseInt(process.env.POSTGRES_PORT || '15432', 10),
        database: process.env.POSTGRES_DB || 'postgres',
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || undefined,
    });
    const [postTable] = adapter.platform.createTables(DatabaseEntityRegistry.from([post]));

    expect(postTable.getColumn('str').defaultValue).toBe('abc');
    expect(postTable.getColumn('no').defaultValue).toBe(34.5);
    expect(postTable.getColumn('json').defaultValue).toEqual({ a: true });
    expect(postTable.getColumn('jsonAuto').defaultValue).toEqual({ a: true });
    expect(postTable.getColumn('created').defaultExpression).toBe(`now()`);
    expect(postTable.getColumn('createdAuto').defaultExpression).toBe(`now()`);

    await schemaMigrationRoundTrip([post], adapter);
});

test('numbers', async () => {
    class post {
        id: integer & AutoIncrement & PrimaryKey = 0;
        int8: int8 = 0;
        uint8: uint8 = 0;
        int16: int16 = 0;
        uint16: uint16 = 0;
        int32: int32 = 0;
        uint32: uint32 = 0;
        float32: float32 = 0;
        default: number = 0;
    }

    const adapter = new PostgresDatabaseAdapter({
        host: process.env.POSTGRES_HOST || '127.0.0.1',
        port: parseInt(process.env.POSTGRES_PORT || '15432', 10),
        database: process.env.POSTGRES_DB || 'postgres',
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || undefined,
    });
    const [postTable] = adapter.platform.createTables(DatabaseEntityRegistry.from([post]));

    const DDL = await schemaMigrationRoundTrip([post], adapter);

    expect(DDL).toContain(`CREATE TABLE "post" (
    "id" SERIAL,
    "int8" smallint NOT NULL DEFAULT 0,
    "uint8" smallint NOT NULL DEFAULT 0,
    "int16" smallint NOT NULL DEFAULT 0,
    "uint16" smallint NOT NULL DEFAULT 0,
    "int32" integer NOT NULL DEFAULT 0,
    "uint32" integer NOT NULL DEFAULT 0,
    "float32" real NOT NULL DEFAULT 0,
    "default" double precision NOT NULL DEFAULT 0,
    PRIMARY KEY ("id")
)`);
});

// Unique table names so this migration round-trip doesn't race the shared orm-integration suite,
// which also maps a `User`→`user` table in the same Postgres database (the two run in parallel
// under `node --test` and would otherwise clobber each other's `user` schema).
interface User extends Entity<{ name: 'migration_user' }> {
    id: number & AutoIncrement & PrimaryKey;
    username: string & Unique;
    created: Date;
    deleted: boolean;
    logins: number;
}

interface Post extends Entity<{ name: 'migration_post' }> {
    id: number & AutoIncrement & PrimaryKey;
    user: User & Reference;
    created: Date;
    slag: string & Unique;
    title: string;
    content: string;
}

test('postgres', async () => {
    await schemaMigrationRoundTrip(
        [typeOf<User>(), typeOf<Post>()],
        new PostgresDatabaseAdapter({
            host: process.env.POSTGRES_HOST || 'localhost',
            port: parseInt(process.env.POSTGRES_PORT || '15432', 10),
            database: process.env.POSTGRES_DB || 'postgres',
            user: process.env.POSTGRES_USER || 'postgres',
            password: process.env.POSTGRES_PASSWORD || undefined,
        }),
    );
});

// A reference to an auto-increment key. The key is a SERIAL — an integer — and the DDL always
// wrote the reference as one, but the model called both `double precision` (the type of a plain
// `number`): once the comparator judged a column's type (2026-11-06), the reference read back as
// a modified column on every diff — the 'postgres' round trip above failed on exactly that.
interface Account extends Entity<{ name: 'migration_account' }> {
    id: number & AutoIncrement & PrimaryKey;
    name: string;
}

interface Invoice extends Entity<{ name: 'migration_invoice' }> {
    id: number & AutoIncrement & PrimaryKey;
    account: Account & Reference;
}

interface Ledger extends Entity<{ name: 'migration_ledger' }> {
    id: bigint & AutoIncrement & PrimaryKey;
    name: string;
}

interface Entry extends Entity<{ name: 'migration_entry' }> {
    id: number & AutoIncrement & PrimaryKey;
    ledger: Ledger & Reference;
}

function scratchAdapter() {
    return new PostgresDatabaseAdapter({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '15432', 10),
        database: process.env.POSTGRES_DB || 'postgres',
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || undefined,
    });
}

test('an auto-increment key and a reference to it are modelled as the integer they are', async () => {
    const adapter = scratchAdapter();
    const [account, invoice] = adapter.platform.createTables(DatabaseEntityRegistry.from([typeOf<Account>(), typeOf<Invoice>()]));

    expect(account.getColumn('id').type).toBe('integer');
    expect(invoice.getColumn('account').type).toBe('integer');
    expect(invoice.getColumn('account').isAutoIncrement).toBe(false);

    // A filter on the key is cast to the column's type — `::double precision` made Postgres
    // compare an integer column as a double, which no index on it serves.
    const keyType = ReflectionClass.from(typeOf<Account>()).getProperty('id').type;
    const referenceType = ReflectionClass.from(typeOf<Invoice>()).getProperty('account').type;
    expect(adapter.platform.getSqlTypeCaster(keyType)('$1')).toBe('$1::integer');
    expect(adapter.platform.getSqlTypeCaster(referenceType)('$1')).toBe('$1::integer');

    const DDL = await schemaMigrationRoundTrip([typeOf<Account>(), typeOf<Invoice>()], adapter);
    expect(DDL).toContain(`"id" SERIAL,`);
    expect(DDL).toContain(`"account" integer NOT NULL`);
});

test('a bigint auto-increment key is a BIGSERIAL and a reference to it a bigint', async () => {
    const adapter = scratchAdapter();
    const [ledger, entry] = adapter.platform.createTables(DatabaseEntityRegistry.from([typeOf<Ledger>(), typeOf<Entry>()]));

    expect(ledger.getColumn('id').type).toBe('bigint');
    expect(entry.getColumn('ledger').type).toBe('bigint');

    // Until 2026-11-17 the key was a 32-bit SERIAL and the reference an INTEGER whatever the
    // entity declared, so the reference read back as `bigint => integer` on every diff.
    const DDL = await schemaMigrationRoundTrip([typeOf<Ledger>(), typeOf<Entry>()], adapter);
    expect(DDL).toContain(`"id" BIGSERIAL,`);
    expect(DDL).toContain(`"ledger" bigint NOT NULL`);
});
