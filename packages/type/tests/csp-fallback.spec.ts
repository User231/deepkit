/**
 * `@deepkit/type` where `new Function()` is blocked (a strict CSP, Cloudflare Workers,
 * --disallow-code-generation-from-strings): serialize, deserialize, cast, validate and the type
 * guard must fall back to the interpreter, and the package must need no code generation of its own.
 *
 * The whole suite runs interpreted through the mode switch (`npm run test:interpreted`,
 * `DEEPKIT_JIT_MODE`), which leaves code generation available to the tests' own tooling. This is
 * the complement: a real blocked process, where anything else in the package that built code from
 * a string would throw.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

test('serialize / deserialize / cast / validate / is work with code generation disallowed', () => {
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
