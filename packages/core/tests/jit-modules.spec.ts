/**
 * The JIT's modules import only what they are allowed to.
 *
 * `src/jit/index.ts` says which module holds what and that each imports only the ones before it.
 * A comment does not hold that; this does. The two that matter most:
 *
 *  - `builder.ts` imports the tree and nothing else — the Builder writes trees and knows nothing
 *    of how they are run (until 2026-11-17 it imported both modes for the nested-function marker);
 *  - neither mode imports the other: `codegen.ts` and `exec.ts` meet only in `entry.ts`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

const DIR = join(__dirname, '..', 'src', 'jit');

/** What each module may import from its own folder. Nothing in the folder imports from outside it. */
const ALLOWED: Record<string, string[]> = {
    'nodes.ts': [],
    'runtime.ts': [],
    'codegen.ts': ['nodes', 'runtime'],
    'exec.ts': ['nodes'],
    'builder.ts': ['nodes'],
    'entry.ts': ['nodes', 'runtime', 'codegen', 'exec', 'builder'],
    'index.ts': ['nodes', 'runtime', 'codegen', 'builder', 'entry'],
};

function importsOf(file: string): string[] {
    const source = readFileSync(join(DIR, file), 'utf8');
    return [...source.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/gms)].map(match => match[1]);
}

test('every module of src/jit is listed', () => {
    expect(readdirSync(DIR).sort()).toEqual(Object.keys(ALLOWED).sort());
});

test('a module imports only the modules it is allowed to', () => {
    const wrong: string[] = [];
    for (const [file, allowed] of Object.entries(ALLOWED)) {
        for (const from of importsOf(file)) {
            const local = /^\.\/(\w+)\.js$/.exec(from);
            if (!local) wrong.push(`${file} imports ${from}: not a module of this folder`);
            else if (!allowed.includes(local[1])) wrong.push(`${file} imports ${local[1]}`);
        }
    }
    expect(wrong).toEqual([]);
});

test('the check sees the imports it is about', () => {
    // A pattern that matched nothing would pass everything.
    expect(importsOf('entry.ts').sort()).toEqual(['./builder.js', './codegen.js', './exec.js', './nodes.js', './runtime.js']);
    expect(importsOf('builder.ts')).toEqual(['./nodes.js']);
    expect(importsOf('index.ts').length).toBeGreaterThan(4);
});
