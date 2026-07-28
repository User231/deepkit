/**
 * CSP compliance regression: BSON's JIT entry points must fall back to the
 * closure executor where `new Function()` is blocked (strict CSP, Cloudflare
 * Workers, --disallow-code-generation-from-strings). Guards the CHANGELOG
 * claim; the historical bug was fnJITTop() compiling unconditionally, which
 * made getBSONDeserializer() throw EvalError in exactly those environments.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

test('getBSONDeserializer/getBSONSerializer work with code generation disallowed', () => {
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
