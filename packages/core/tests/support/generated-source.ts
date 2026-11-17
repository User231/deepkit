/**
 * Golden files for the source text the JIT generates.
 *
 * The differential tests hold what a generated function ANSWERS. These hold what it IS: a refactor
 * of the generator that is meant to change nothing must leave every golden file byte-identical,
 * and a change that is meant to change the text shows up as a reviewable diff of the files.
 *
 * Not a spec — imported by `core/tests/jit-differential.spec.ts` and, by relative path, by
 * `bson/tests/generated-source.spec.ts` (tests are outside every package's tsconfig).
 *
 * Regenerate after an intended change with `UPDATE_GOLDEN=1`, then read the diff.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';

export interface Compilation {
    /** The names the generated text refers to and receives from outside, in order. */
    externals: string[];
    source: string;
}

/**
 * Every compilation `build` causes, in order. Each one goes through `new Function`, so that is
 * where it is read — no hook in the generator, which is the code under test.
 */
export function compilationsOf(build: () => void): Compilation[] {
    const seen: Compilation[] = [];
    const NativeFunction = globalThis.Function;
    globalThis.Function = new Proxy(NativeFunction, {
        construct(target, args: string[]) {
            seen.push({ externals: args.slice(0, -1), source: args[args.length - 1] });
            return Reflect.construct(target, args);
        },
    });
    try {
        build();
    } finally {
        globalThis.Function = NativeFunction;
    }
    return seen;
}

/**
 * Nested functions and sub-function helpers are named after a counter shared by the whole
 * process (`_nfn_12`, `_fn_7`), so the number depends on what was built before. Renumber each
 * family by first appearance: the text then depends only on the program.
 */
function withStableIds(text: string): string {
    for (const family of ['_nfn_', '_fn_']) {
        const order = new Map<string, number>();
        text = text.replace(new RegExp(`(?<![\\w$])${family}(\\d+)\\b`, 'g'), (_match, id: string) => {
            if (!order.has(id)) order.set(id, order.size);
            return `${family}${order.get(id)}`;
        });
    }
    return text;
}

/** The text of everything `build` compiles, as it is stored in a golden file. */
export function generatedSource(build: () => void): string {
    const text = compilationsOf(build)
        .map(c => `// externals: ${c.externals.join(', ') || '(none)'}\n${c.source.trimEnd()}\n`)
        .join('\n');
    return withStableIds(text);
}

const UPDATE = process.env.UPDATE_GOLDEN === '1';

/** The first line that differs, with a little context: a whole-file diff of generated code is unreadable in a test report. */
function firstDifference(expected: string, actual: string): string {
    const a = expected.split('\n');
    const b = actual.split('\n');
    let line = 0;
    while (line < a.length && line < b.length && a[line] === b[line]) line++;
    const show = (lines: string[]) =>
        lines
            .slice(Math.max(0, line - 2), line + 3)
            .map((text, i) => `    ${Math.max(0, line - 2) + i + 1}: ${text}`)
            .join('\n');
    return `first difference at line ${line + 1} (${a.length} lines expected, ${b.length} generated)\n  golden:\n${show(a)}\n  generated:\n${show(b)}`;
}

/**
 * Compare generated text with a golden file. With `UPDATE_GOLDEN=1` the file is (re)written
 * instead. A missing file fails: a golden file nobody wrote would pass by being created.
 */
export function expectGolden(file: string, actual: string): void {
    const name = relative(process.cwd(), file);
    if (UPDATE) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, actual);
        return;
    }
    if (!existsSync(file))
        throw new Error(`${name} does not exist. Run with UPDATE_GOLDEN=1 to write it, and review what it holds.`);
    const expected = readFileSync(file, 'utf8');
    if (expected !== actual) {
        throw new Error(
            `${name}: the generated source changed — ${firstDifference(expected, actual)}\nIf the change is intended, rerun with UPDATE_GOLDEN=1 and review the diff.`,
        );
    }
}
