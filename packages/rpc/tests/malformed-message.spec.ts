import { test } from 'node:test';

import { Logger, MemoryLoggerTransport } from '@deepkit/logger';
import { expect } from '@deepkit/run/expect';

import { RpcKernel } from '../src/server/kernel.js';

/**
 * A connection whose peer sends bytes the reader cannot parse must lose ITS connection and
 * nothing else. Transports call `feed()` from inside a socket event handler, so a throw that
 * escapes it is an uncaught exception on the event loop — it takes the whole server process
 * down, from any peer, before authentication.
 */
function createConnection() {
    const memory = new MemoryLoggerTransport();
    const kernel = new RpcKernel(undefined, new Logger([memory]));
    let closed = 0;

    const connection = kernel.createConnection({
        writeBinary() {},
        close() {
            closed++;
        },
        clientAddress: () => '127.0.0.1',
    });

    return { connection, memory, closed: () => closed };
}

test('an unreadable message closes the connection instead of throwing', () => {
    const { connection, memory, closed } = createConnection();

    // A BSON document size of 0 — what a text frame's character codes also decode to.
    expect(() => connection.feed(new Uint8Array([0, 0, 0, 0]))).not.toThrow();

    expect(connection.closed).toBe(true);
    expect(closed()).toBe(1);
    expect(memory.messageStrings.some(m => m.includes('127.0.0.1') && m.includes('unreadable'))).toBe(true);
});

test('a negative document size closes the connection instead of throwing', () => {
    const { connection } = createConnection();

    expect(() => connection.feed(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).not.toThrow();
    expect(connection.closed).toBe(true);
});

test('feeding an already closed connection stays harmless', () => {
    const { connection, closed } = createConnection();

    connection.feed(new Uint8Array([0, 0, 0, 0]));
    expect(() => connection.feed(new Uint8Array([0, 0, 0, 0]))).not.toThrow();
    // close() is idempotent — the transport is torn down once.
    expect(closed()).toBe(1);
});

test('a well-formed message is still read', () => {
    const { connection } = createConnection();

    // Not a complete document yet: the reader buffers it and must not close anything.
    connection.feed(new Uint8Array([16, 0, 0, 0, 1, 2, 3]));
    expect(connection.closed).toBe(false);
});
