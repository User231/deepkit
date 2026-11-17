/**
 * Every function the fork builds from a string runs in STRICT mode.
 *
 * Source text handed to `new Function` is sloppy unless the text says otherwise, while every
 * hand-written file is a module and therefore strict. A generated function that forgets the
 * directive drops a refused write in silence and turns a write to an undeclared name into a global.
 * The new JIT ran that way until 2026-11-16, while its interpreter threw on the same tree.
 *
 * Two holds:
 *  - an inventory: every place in the shipped source that builds code from a string is listed
 *    below with HOW it is strict; a site that is not listed, or a listed count that changed, fails;
 *  - behaviour: the builders reachable from this package refuse a write a frozen object refuses.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { CompilerContext } from '../src/compiler.js';
import { Builder, Ref, arg, canJIT, fnJIT } from '../src/jit.js';

const PACKAGES = join(__dirname, '..', '..');

/** A call that turns a string into code. A method call (`redis.eval(...)`) is not one. */
const GENERATES = /(?<![.\w])(?:new\s+(?:Async)?Function\s*\(|eval\s*\()/;

type How =
    /** The generated text opens with `'use strict'`: it must appear in the lines around the call. */
    | 'directive'
    /** The text is only a class, and a class body is always strict. */
    | 'class body'
    /** A direct `eval` inside a module evaluates as strict code. */
    | 'direct eval in a module'
    /** `return true`, built once to learn whether code generation is allowed at all. */
    | 'capability probe';

const SITES: Record<string, { count: number; how: How }[]> = {
    'core/src/compiler.ts': [{ count: 3, how: 'directive' }],
    'core/src/core.ts': [{ count: 2, how: 'class body' }],
    'core/src/jit.ts': [
        { count: 1, how: 'capability probe' },
        { count: 1, how: 'directive' },
    ],
    'sql/src/sql-builder.ts': [{ count: 1, how: 'directive' }],
    'bench/index.ts': [{ count: 2, how: 'directive' }],
    'postgres/src/postgres-schema-parser.ts': [{ count: 1, how: 'direct eval in a module' }],
    'sqlite/src/sqlite-schema-parser.ts': [{ count: 1, how: 'direct eval in a module' }],
};

/**
 * Where the directive may sit relative to the call: the text is either assembled a few lines above
 * it, or written as one of its arguments on the lines below.
 */
const LINES_ABOVE = 30;
const LINES_BELOW = 6;

function shippedSources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === 'tests' || name === 'benchmarks' || name.startsWith('.')) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) shippedSources(path, out);
        else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.spec.ts')) out.push(path);
    }
    return out;
}

interface Site {
    line: number;
    text: string;
    /** The lines around the call in which the text it builds is written. */
    around: string;
}

function sitesOf(path: string): Site[] {
    const lines = readFileSync(path, 'utf8').split('\n');
    const found: Site[] = [];
    lines.forEach((text, index) => {
        const code = text.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        if (!GENERATES.test(text)) return;
        found.push({ line: index + 1, text: code, around: lines.slice(Math.max(0, index - LINES_ABOVE), index + 1 + LINES_BELOW).join('\n') });
    });
    return found;
}

describe('generated code is strict: the inventory', () => {
    const found = new Map<string, Site[]>();
    for (const path of shippedSources(PACKAGES)) {
        const sites = sitesOf(path);
        if (sites.length) found.set(relative(PACKAGES, path).split('\\').join('/'), sites);
    }

    test('every site that builds code from a string is listed', () => {
        const unlisted = [...found.keys()].filter(file => !(file in SITES));
        expect(unlisted).toEqual([]);
    });

    test('every listed file still has the sites the list counts', () => {
        const drift: string[] = [];
        for (const [file, rows] of Object.entries(SITES)) {
            const expected = rows.reduce((sum, row) => sum + row.count, 0);
            const actual = found.get(file)?.length ?? 0;
            if (actual !== expected) drift.push(`${file}: listed ${expected}, found ${actual}`);
        }
        expect(drift).toEqual([]);
    });

    test('a site listed as strict by directive has the directive in the text it builds', () => {
        const missing: string[] = [];
        for (const [file, rows] of Object.entries(SITES)) {
            const wanted = rows.filter(row => row.how === 'directive').reduce((sum, row) => sum + row.count, 0);
            if (!wanted) continue;
            const withDirective = (found.get(file) ?? []).filter(site => site.around.includes(`'use strict'`));
            if (withDirective.length < wanted) missing.push(`${file}: ${wanted} listed, ${withDirective.length} with the directive`);
        }
        expect(missing).toEqual([]);
    });
});

describe('generated code is strict: behaviour', () => {
    const frozen = () => Object.freeze({ k: 0 });
    // These build compiled functions on purpose; where code generation is blocked there is nothing to
    // check (`CompilerContext` cannot build at all, and the JIT's interpreter is a strict module).
    const needsCodeGeneration = { skip: !canJIT };

    test('CompilerContext.build', needsCodeGeneration, () => {
        const write = new CompilerContext().build('target.k = 1; return "survived";', 'target');
        expect(() => write(frozen())).toThrow(TypeError);
    });

    test('CompilerContext.buildAsync', needsCodeGeneration, async () => {
        const write = new CompilerContext().buildAsync('target.k = 1; return "survived";', 'target');
        await expect(write(frozen())).rejects.toThrow(TypeError);
    });

    test('CompilerContext.raw', needsCodeGeneration, () => {
        const write = new CompilerContext().raw('return function(target){ target.k = 1; return "survived"; }');
        expect(() => write(frozen())).toThrow(TypeError);
    });

    test('the JIT, with and without nested functions beside the main one', needsCodeGeneration, () => {
        const plain = fnJIT(arg(), (b: Builder, target: Ref) => {
            b.set(target, 'k', b.lit(1));
            return b.lit('survived');
        });
        expect(() => plain(frozen())).toThrow(TypeError);

        const nested = fnJIT(arg(), (b: Builder, target: Ref) => {
            const inner = fnJIT(arg(), (bb: Builder, t: Ref) => {
                bb.set(t, 'k', bb.lit(1));
                return bb.lit('survived');
            });
            return b.call(inner, target);
        });
        expect(() => nested(frozen())).toThrow(TypeError);
    });

    test('a write to a name nobody declared is an error, not a new global', needsCodeGeneration, () => {
        const leak = new CompilerContext().build('__generatedCodeLeak = 1;');
        expect(() => leak()).toThrow(ReferenceError);
        expect('__generatedCodeLeak' in globalThis).toBe(false);
    });
});
