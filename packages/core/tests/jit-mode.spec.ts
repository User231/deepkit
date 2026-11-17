/**
 * The JIT's mode switch.
 *
 * Where code generation is allowed a function is compiled, where it is blocked (a strict CSP) it is
 * interpreted — so on a machine that can compile, the interpreter a browser runs is never
 * executed. `DEEPKIT_JIT_MODE=interpreted` / `setJitMode('interpreted')` makes the entry points
 * that have a choice take the interpreted branch, the same branch a blocked environment takes,
 * without blocking code generation for everything else in the process.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { Builder, type JitMode, Ref, arg, canJIT, compilesFunctions, fn, fnExec, fnJIT, fnJITTop, getJitMode, setJitMode, setJitThreshold } from '../src/jit.js';

/** The mode this process started in: a whole suite may be running under `DEEPKIT_JIT_MODE`. */
const STARTED_IN: JitMode = getJitMode();
// Building compiled functions is the subject here; where the environment blocks it there is no switch to test.
const needsCodeGeneration = { skip: !canJIT };

/** Count the compilations a block of code causes: every one goes through `new Function`. */
function compilationsDuring(run: () => void): number {
    let built = 0;
    const NativeFunction = globalThis.Function;
    globalThis.Function = new Proxy(NativeFunction, {
        construct(target, args) {
            built++;
            return Reflect.construct(target, args);
        },
    });
    try {
        run();
    } finally {
        globalThis.Function = NativeFunction;
    }
    return built;
}

const double = (b: Builder, n: Ref) => b.mul(n, b.lit(2));

describe('jit mode', () => {
    afterEach(() => {
        setJitMode(STARTED_IN);
        setJitThreshold(0);
    });

    test('the mode a process starts in is its environment`s, or auto', () => {
        expect(STARTED_IN).toBe(process.env.DEEPKIT_JIT_MODE ?? 'auto');
        expect(compilesFunctions()).toBe(canJIT && STARTED_IN === 'auto');
    });

    test('auto: fn and fnJITTop compile', needsCodeGeneration, () => {
        setJitMode('auto');
        let f: (n: number) => number = () => 0;
        let g: (n: number) => number = () => 0;
        expect(
            compilationsDuring(() => {
                f = fn(arg(), double);
                g = fnJITTop(arg(), double);
            }),
        ).toBe(2);
        expect([f(4), g(4)]).toEqual([8, 8]);
    });

    test('interpreted: fn and fnJITTop build no code, and answer the same', needsCodeGeneration, () => {
        setJitMode('interpreted');
        expect(compilesFunctions()).toBe(false);
        let f: (n: number) => number = () => 0;
        let g: (n: number) => number = () => 0;
        expect(
            compilationsDuring(() => {
                f = fn(arg(), double);
                g = fnJITTop(arg(), double);
                f(4);
                g(4);
            }),
        ).toBe(0);
        expect([f(4), g(4)]).toEqual([8, 8]);
    });

    test('interpreted: a function nested in another is interpreted with it', needsCodeGeneration, () => {
        setJitMode('interpreted');
        let outer: (list: number[]) => number[] = () => [];
        expect(
            compilationsDuring(() => {
                outer = fn(arg(), (b: Builder, list: Ref) => {
                    const inner = fn(arg(), double);
                    return b.map(list, e => b.call(inner, e));
                });
                outer([1, 2]);
            }),
        ).toBe(0);
        expect(outer([1, 2, 3])).toEqual([2, 4, 6]);
    });

    test('interpreted: a threshold never turns into a compilation', needsCodeGeneration, () => {
        setJitMode('interpreted');
        setJitThreshold(3);
        expect(
            compilationsDuring(() => {
                const f = fn(arg(), double);
                for (let i = 0; i < 10; i++) f(i);
            }),
        ).toBe(0);
    });

    test('the mode is read when a function is built, not when it is called', needsCodeGeneration, () => {
        setJitMode('interpreted');
        const interpreted = fn(arg(), double);
        setJitMode('auto');
        expect(compilationsDuring(() => interpreted(4))).toBe(0);
        const compiled = fn(arg(), double);
        setJitMode('interpreted');
        expect(compiled(4)).toBe(8);
    });

    test('fnJIT is an explicit request to compile and fnExec one to interpret: neither reads the mode', needsCodeGeneration, () => {
        setJitMode('interpreted');
        expect(compilationsDuring(() => fnJIT(arg(), double))).toBe(1);
        setJitMode('auto');
        expect(compilationsDuring(() => fnExec(arg(), double)(4))).toBe(0);
    });

    test('an unknown mode is refused, and leaves the mode as it was', () => {
        expect(() => setJitMode('compiled' as JitMode)).toThrow(TypeError);
        expect(() => setJitMode('' as JitMode)).toThrow(TypeError);
        expect(getJitMode()).toBe(STARTED_IN);
    });
});

describe('jit mode: from the environment', () => {
    const fixture = join(__dirname, 'jit-mode.fixture.ts');

    function child(env: Record<string, string>, nodeArgs: string[] = []): { mode: string; canJIT: boolean; compiles: boolean; built: number; answers: number[] } {
        // Strip the parent runner's test-protocol vars — inherited, they make the child a test-runner child.
        const base: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
            if (v !== undefined && !k.startsWith('NODE_TEST') && k !== 'DEEPKIT_JIT_MODE' && k !== 'NODE_OPTIONS') base[k] = v;
        }
        const out = execFileSync(process.execPath, [...nodeArgs, '--import', '@deepkit/run', fixture], { encoding: 'utf8', env: { ...base, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
        return JSON.parse(out.trim().split('\n').pop()!);
    }

    test('unset: auto, both functions compiled', needsCodeGeneration, () => {
        expect(child({})).toEqual({ mode: 'auto', canJIT: true, compiles: true, built: 2, answers: [8, 12] });
    });

    test('DEEPKIT_JIT_MODE=interpreted: nothing compiled, same answers', needsCodeGeneration, () => {
        expect(child({ DEEPKIT_JIT_MODE: 'interpreted' })).toEqual({ mode: 'interpreted', canJIT: true, compiles: false, built: 0, answers: [8, 12] });
    });

    test('the switch takes the branch a blocked environment takes', () => {
        const blocked = child({}, ['--disallow-code-generation-from-strings']);
        expect(blocked).toEqual({ mode: 'auto', canJIT: false, compiles: false, built: 0, answers: [8, 12] });
    });

    test('a misspelt DEEPKIT_JIT_MODE stops the process instead of running compiled', () => {
        let message = '';
        try {
            child({ DEEPKIT_JIT_MODE: 'interpret' });
        } catch (error) {
            message = String((error as { stderr?: string }).stderr ?? error);
        }
        expect(message).toContain('DEEPKIT_JIT_MODE: unknown JIT mode "interpret"');
    });
});

describe('jit mode: what it does not cover', () => {
    // The switch governs the entry points that choose. `fnJIT` never chooses, so a shipped call to
    // it would compile under the switch and throw in a browser: the interpreted suites would pass
    // and the deployed app would not. No shipped package may call it.
    test('no shipped source calls fnJIT', () => {
        const packages = join(__dirname, '..', '..');
        const callers: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                if (name === 'node_modules' || name === 'dist' || name === 'tests' || name === 'benchmarks' || name.startsWith('.')) continue;
                const path = join(dir, name);
                if (statSync(path).isDirectory()) walk(path);
                else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.spec.ts')) {
                    const file = relative(packages, path).split('\\').join('/');
                    // Where it is declared.
                    if (file === 'core/src/jit/entry.ts') continue;
                    readFileSync(path, 'utf8')
                        .split('\n')
                        .forEach((line, index) => {
                            const code = line.trim();
                            if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
                            if (/(?<![.\w])fnJIT\s*(<[^>]*>)?\s*\(/.test(line)) callers.push(`${file}:${index + 1}`);
                        });
                }
            }
        };
        walk(packages);
        expect(callers).toEqual([]);
    });
});
