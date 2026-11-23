import { after, afterEach, test } from 'node:test';

import { LoggerLevel, MemoryLogger } from '@deepkit/logger';
import { expect } from '@deepkit/run/expect';

import { PostgresConnection, PostgresDatabaseAdapter } from '../src/postgres-adapter.js';

/**
 * A connection the SERVER ends — an administrator's `pg_terminate_backend`, a
 * failover, a proxy in front of the server restarting — must never be an
 * uncaught exception of the process that holds the pool. The driver reports it
 * as an `error` event, and an `error` event nobody listens to is thrown by Node:
 *
 *  - on the POOL, for a client that sits idle in it (pg-pool's idle listener
 *    removes the client and re-emits the error on the pool);
 *  - on the CLIENT, for one that is checked out (pg-pool takes its own listener
 *    off for the time of the checkout), whether it is between two queries or in
 *    the middle of one.
 *
 * Every test here kills a real backend from a second connection and asserts on
 * what the process saw.
 */

const uncaught: unknown[] = [];
process.on('uncaughtException', error => {
    uncaught.push(error);
});

const database = process.env.POSTGRES_DB || 'postgres';
const password = process.env.POSTGRES_PASSWORD || undefined;

let poolSequence = 0;
const opened: PostgresDatabaseAdapter[] = [];

/** An adapter whose sessions carry a name of their own, so `pg_stat_activity` can tell them from every other test's. */
function openAdapter(label: string): { adapter: PostgresDatabaseAdapter; logger: MemoryLogger; sessions: string } {
    const sessions = `pool-errors-${process.pid}-${++poolSequence}-${label}`;
    const adapter = new PostgresDatabaseAdapter({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '15432', 10),
        database,
        user: process.env.POSTGRES_USER || 'postgres',
        password,
        application_name: sessions,
    });
    const logger = new MemoryLogger();
    adapter.setLogger(logger);
    opened.push(adapter);
    return { adapter, logger, sessions };
}

const admin = openAdapter('admin').adapter;

async function query<T = any>(adapter: PostgresDatabaseAdapter, sql: string, params: any[] = []): Promise<T[]> {
    const connection = await adapter.connectionPool.getConnection();
    try {
        return await connection.execAndReturnAll(sql, params);
    } finally {
        connection.release();
    }
}

async function backendPid(connection: PostgresConnection): Promise<number> {
    return (await connection.execAndReturnSingle('SELECT pg_backend_pid() AS pid')).pid;
}

/** The backends of one pool, as the server lists them. */
async function sessionsOf(sessions: string): Promise<{ pid: number; state: string }[]> {
    return query(admin, 'SELECT pid, state FROM pg_stat_activity WHERE application_name = $1', [sessions]);
}

/** Kill every backend of one pool from the second connection. */
async function terminate(sessions: string): Promise<number[]> {
    const rows = await query<{ pid: number }>(admin, 'SELECT pid, pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1', [sessions]);
    return rows.map(row => row.pid);
}

async function until(what: string, condition: () => boolean | Promise<boolean>): Promise<void> {
    const deadline = performance.now() + 5_000;
    while (!(await condition())) {
        if (performance.now() > deadline) throw new Error(`Timed out waiting until ${what}`);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

/** What a pool logged about connections it lost: level and text. */
function lossesIn(logger: MemoryLogger): [LoggerLevel, string][] {
    return logger.memory.messages.filter(message => message.message.includes('connection lost')).map(message => [message.level, message.message]);
}

/** Long enough for the socket's last events (`error`, then `end`) to reach the process. */
const settled = () => new Promise(resolve => setTimeout(resolve, 150));

afterEach(() => {
    uncaught.length = 0;
});

after(() => {
    for (const adapter of opened) adapter.disconnect();
});

test('an idle pooled connection the server kills is dropped by the pool, not thrown at the process', async () => {
    const { adapter, logger, sessions } = openAdapter('idle');

    const [{ pid: before }] = await query(adapter, 'SELECT pg_backend_pid() AS pid');
    expect(adapter.connectionPool.getStats()).toMatchObject({ total: 1, idle: 1 });
    expect((await sessionsOf(sessions)).map(row => row.pid)).toEqual([before]);

    expect(await terminate(sessions)).toEqual([before]);
    await until('the pool has dropped the client', () => adapter.connectionPool.getStats().total === 0);
    await settled();

    expect(uncaught).toEqual([]);

    // The next query is served by a connection of its own.
    const [{ pid: next }] = await query(adapter, 'SELECT pg_backend_pid() AS pid');
    expect(next).not.toBe(before);
    expect(adapter.connectionPool.getStats()).toMatchObject({ total: 1, idle: 1 });

    // It is on the record, by the database's name — and with nothing of the connection's secrets.
    expect(lossesIn(logger)).toEqual([[LoggerLevel.warning, `Postgres connection lost (database "${database}", idle): 57P01 terminating connection due to administrator command`]]);
    if (password) expect(logger.getOutput()).not.toContain(password);
});

test('a checked-out connection the server kills between two queries fails its next query, not the process', async () => {
    const { adapter, logger, sessions } = openAdapter('checked-out');

    const connection = await adapter.connectionPool.getConnection();
    const before = await backendPid(connection);

    expect(await terminate(sessions)).toEqual([before]);
    await until('the server lists the backend no more', async () => (await sessionsOf(sessions)).length === 0);
    await settled();

    expect(uncaught).toEqual([]);
    // The client reports twice (the server's last word, the socket closing); it is ONE loss.
    expect(lossesIn(logger)).toEqual([[LoggerLevel.warning, `Postgres connection lost (database "${database}", checked out): 57P01 terminating connection due to administrator command`]]);

    // The holder learns it from the query it runs next ...
    await expect(connection.execAndReturnSingle('SELECT 1 AS one')).rejects.toThrow();
    connection.release();

    // ... and the pool does not hand the dead client out again.
    await until('the pool has dropped the client', () => adapter.connectionPool.getStats().total === 0);
    const [{ pid: next }] = await query(adapter, 'SELECT pg_backend_pid() AS pid');
    expect(next).not.toBe(before);
    expect(uncaught).toEqual([]);
});

test('a connection the server kills in the middle of a query rejects that query, not the process', async () => {
    const { adapter, sessions } = openAdapter('mid-query');

    const connection = await adapter.connectionPool.getConnection();
    const before = await backendPid(connection);
    const running = connection.execAndReturnSingle('SELECT pg_sleep(30)').then(
        () => undefined,
        (error: any) => error,
    );
    await until('the query runs', async () => (await sessionsOf(sessions)).some(row => row.state === 'active'));

    expect(await terminate(sessions)).toEqual([before]);
    const error = await running;
    expect(String(error?.message ?? error)).toContain('terminating connection due to administrator command');

    // The socket closes after the server's last word; that is a second error of the same client.
    await settled();
    expect(uncaught).toEqual([]);

    connection.release();
    await until('the pool has dropped the client', () => adapter.connectionPool.getStats().total === 0);
    const [{ pid: next }] = await query(adapter, 'SELECT pg_backend_pid() AS pid');
    expect(next).not.toBe(before);
    expect(uncaught).toEqual([]);
});

test('a connection inside a transaction the server kills ends the transaction with an error', async () => {
    const { adapter, sessions } = openAdapter('transaction');

    const transaction = adapter.createTransaction(undefined as any);
    const connection = await adapter.connectionPool.getConnection(transaction);
    const before = await backendPid(connection);

    expect(await terminate(sessions)).toEqual([before]);
    await until('the server lists the backend no more', async () => (await sessionsOf(sessions)).length === 0);
    await settled();
    expect(uncaught).toEqual([]);

    // Neither way of ending it can reach the server; either one gives the client back.
    await expect(transaction.rollback()).rejects.toThrow();
    await until('the pool has dropped the client', () => adapter.connectionPool.getStats().total === 0);
    expect(uncaught).toEqual([]);
});

test('a client that errors while disconnect() is closing it is not thrown at the process', async () => {
    const { adapter, logger } = openAdapter('closing');
    logger.level = LoggerLevel.debug;

    const connection = await adapter.connectionPool.getConnection();
    const client = connection.connection;
    await backendPid(connection);
    connection.release();

    // disconnect() only STARTS the close: the client has been told to end, and its
    // socket is still open. What the server says in that window — a forced DROP
    // DATABASE terminating the session, as the release gate saw on 2026-11-20 —
    // arrives as an `error` of that client.
    adapter.disconnect();
    const lastWord = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' });
    expect(() => client.emit('error', lastWord)).not.toThrow();
    await settled();

    expect(uncaught).toEqual([]);
    // On the record, quietly: the connection was on its way out anyway.
    expect(lossesIn(logger)).toEqual([[LoggerLevel.debug, `Postgres connection lost (database "${database}", closing): 57P01 ${lastWord.message}`]]);
});

test('close() resolves when the server has no session of the pool left', async () => {
    for (let round = 0; round < 10; round++) {
        const { adapter, sessions } = openAdapter(`close-${round}`);

        // Three connections at once, all back in the pool.
        const held = await Promise.all([1, 2, 3].map(() => adapter.connectionPool.getConnection()));
        await Promise.all(held.map(connection => backendPid(connection)));
        for (const connection of held) connection.release();
        expect((await sessionsOf(sessions)).length).toBe(3);

        await adapter.close();
        expect(await sessionsOf(sessions)).toEqual([]);
        expect(adapter.connectionPool.getStats().total).toBe(0);
    }
});

test('close() waits for a connection that is still checked out, and is safe to call twice', async () => {
    const { adapter, sessions } = openAdapter('close-held');

    const connection = await adapter.connectionPool.getConnection();
    await backendPid(connection);

    let closed = false;
    const closing = adapter.close().then(() => {
        closed = true;
    });
    await settled();
    expect(closed).toBe(false);
    expect((await sessionsOf(sessions)).length).toBe(1);

    connection.release();
    await closing;
    await adapter.close();
    expect(await sessionsOf(sessions)).toEqual([]);
});

test('disconnect() followed by close() waits for the same close', async () => {
    const { adapter, sessions } = openAdapter('close-after-disconnect');
    await query(adapter, 'SELECT 1');

    adapter.disconnect();
    await adapter.close();
    expect(await sessionsOf(sessions)).toEqual([]);
});
