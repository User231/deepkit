/**
 * A whole HTTP application where `new Function()` is blocked (a strict CSP, an edge runtime,
 * --disallow-code-generation-from-strings): the kernel, a request's workflow, the router and its
 * parameter loaders, the injector, a middleware, a listener and the type converters must all run
 * interpreted, and nothing on the way may build code from a string.
 *
 * `npm run test:interpreted` runs every suite through the mode switch, which leaves code
 * generation available to whatever else wants it. This is the complement: a process that really
 * cannot, where a generator that was forgotten would throw.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

test('an HTTP application serves requests with code generation disallowed', () => {
    const fixture = join(__dirname, 'csp-fallback.fixture.ts');
    // Strip the parent runner's test-protocol vars — inherited, they make the
    // child node behave as a test-runner child.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined && !k.startsWith('NODE_TEST')) env[k] = v;
    }
    const out = execFileSync(process.execPath, ['--disallow-code-generation-from-strings', '--import', '@deepkit/run', fixture], { encoding: 'utf8', env });
    expect(out.trim()).toBe('ok');
});
