/**
 * The JIT's two modes, measured side by side: what `@deepkit/type` and `@deepkit/bson` cost
 * COMPILED (a server, a dev server) and INTERPRETED (a browser under a strict CSP).
 *
 * Nothing else measures the interpreter, and it is the mode production browsers run.
 *
 *   cd packages/bson
 *   node --import @deepkit/run benchmarks/modes.ts              # measure and print
 *   node --import @deepkit/run benchmarks/modes.ts --compare    # … and compare with the baseline
 *   node --import @deepkit/run benchmarks/modes.ts --save       # … and store it as the baseline
 *
 * A mode is fixed when a function is built, so each mode is measured in a process of its own
 * (`DEEPKIT_JIT_MODE`). The processes ALTERNATE for `--rounds` rounds (default 3) and each
 * operation keeps its best time: one run each way measures the machine's mood, not the code.
 *
 * The baseline (`benchmarks/baselines/modes.json`) is this machine's — times do not travel
 * between machines or Node versions, and `--compare` says so when either differs. Its use is
 * before-and-after on one machine: save, change the generator, compare.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';

import { getJitMode } from '@deepkit/core';
import { deserialize, is, serialize, validate } from '@deepkit/type';

import { getBSONDeserializer, getBSONSerializer } from '../index.js';

// ── What is measured ─────────────────────────────────────────────────────────

interface Tag {
    id: number;
    label: string;
}
interface Model {
    id: number;
    name: string;
    active: boolean;
    score?: number;
    created: Date;
    tags: Tag[];
    meta: Record<string, string | number>;
    kind: 'a' | 'b' | 'c';
}
interface Page {
    rows: Model[];
}

const MODEL: Model = {
    id: 12,
    name: 'hello world',
    active: true,
    score: 1.5,
    created: new Date(1705314600000),
    tags: [
        { id: 1, label: 'x' },
        { id: 2, label: 'y' },
        { id: 3, label: 'z' },
    ],
    meta: { a: 'b', c: 2, d: 'e' },
    kind: 'b',
};
const PAGE: Page = {
    rows: Array.from({ length: 50 }, (_, i) => ({ ...MODEL, id: i, created: new Date(1705314600000 + i) })),
};

function operations(): Record<string, () => unknown> {
    const serializeBson = getBSONSerializer<Model>();
    const deserializeBson = getBSONDeserializer<Model>();
    const serializePage = getBSONSerializer<Page>();
    const deserializePage = getBSONDeserializer<Page>();
    const bytesOf = <T>(f: (value: T) => [Uint8Array, number], value: T) => {
        const [buffer, size] = f(value);
        return buffer.slice(0, size);
    };
    const modelBytes = bytesOf(serializeBson, MODEL);
    const pageBytes = bytesOf(serializePage, PAGE);
    const modelJson = serialize<Model>(MODEL);
    const pageJson = serialize<Page>(PAGE);
    return {
        'type serialize, one object': () => serialize<Model>(MODEL),
        'type deserialize, one object': () => deserialize<Model>(modelJson),
        'type guard, one object': () => is<Model>(MODEL),
        'type validate, one object': () => validate<Model>(MODEL),
        'bson serialize, one object': () => serializeBson(MODEL),
        'bson deserialize, one object': () => deserializeBson(modelBytes),
        'type deserialize, page of 50': () => deserialize<Page>(pageJson),
        'bson serialize, page of 50': () => serializePage(PAGE),
        'bson deserialize, page of 50': () => deserializePage(pageBytes),
    };
}

// ── One process, one mode ────────────────────────────────────────────────────

/** Nanoseconds per call: the best of several timed batches, after a warm-up. */
function measure(f: () => unknown): number {
    // Size the batch so one takes about 40 ms in either mode (the interpreter is up to 100x slower).
    let batch = 1;
    for (;;) {
        const t = performance.now();
        for (let i = 0; i < batch; i++) f();
        if (performance.now() - t > 8 || batch >= 1 << 22) break;
        batch *= 2;
    }
    batch *= 4;
    let best = Infinity;
    for (let round = 0; round < 7; round++) {
        const t = performance.now();
        for (let i = 0; i < batch; i++) f();
        best = Math.min(best, ((performance.now() - t) * 1e6) / batch);
    }
    return best;
}

type Times = Record<string, number>;

function measureThisProcess(): Times {
    const times: Times = {};
    for (const [name, f] of Object.entries(operations())) times[name] = measure(f);
    return times;
}

// ── The driver: both modes, alternating ──────────────────────────────────────

type Mode = 'compiled' | 'interpreted';
const MODES: Mode[] = ['compiled', 'interpreted'];

interface Baseline {
    savedAt: string;
    node: string;
    cpu: string;
    rounds: number;
    /** Nanoseconds per call. */
    times: Record<Mode, Times>;
}

function measureIn(mode: Mode): Times {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'DEEPKIT_JIT_MODE') env[k] = v;
    if (mode === 'interpreted') env.DEEPKIT_JIT_MODE = 'interpreted';
    env.DEEPKIT_MODES_CHILD = mode;
    const out = execFileSync(process.execPath, ['--import', '@deepkit/run', __filename], {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    return JSON.parse(out.trim().split('\n').pop()!);
}

function format(ns: number): string {
    if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)} ms`;
    if (ns >= 1e3) return `${(ns / 1e3).toFixed(2)} µs`;
    return `${ns.toFixed(0)} ns`;
}

function main(): void {
    const args = process.argv.slice(2);
    const flag = (name: string) => args.includes(name);
    const option = (name: string, fallback: number) => {
        const at = args.indexOf(name);
        return at >= 0 ? Number(args[at + 1]) : fallback;
    };
    const rounds = option('--rounds', 3);
    /** How much slower than the baseline an operation may be before `--compare` fails. */
    const tolerance = option('--tolerance', 0.15);
    const baselineFile = join(__dirname, 'baselines', 'modes.json');

    const best: Record<Mode, Times> = { compiled: {}, interpreted: {} };
    for (let round = 1; round <= rounds; round++) {
        for (const mode of MODES) {
            process.stderr.write(`round ${round}/${rounds}, ${mode}…\n`);
            for (const [name, ns] of Object.entries(measureIn(mode)))
                best[mode][name] = Math.min(best[mode][name] ?? Infinity, ns);
        }
    }

    const current: Baseline = {
        savedAt: new Date().toISOString(),
        node: process.version,
        cpu: cpus()[0]?.model ?? 'unknown',
        rounds,
        times: best,
    };
    const baseline: Baseline | undefined = flag('--compare')
        ? existsSync(baselineFile)
            ? JSON.parse(readFileSync(baselineFile, 'utf8'))
            : undefined
        : undefined;
    if (flag('--compare') && !baseline) {
        console.error(`no baseline at ${baselineFile}: run with --save first`);
        process.exit(2);
    }

    const names = Object.keys(best.compiled);
    const width = Math.max(...names.map(n => n.length));
    const change = (mode: Mode, name: string) => (baseline ? best[mode][name] / baseline.times[mode][name] - 1 : 0);
    const withChange = (mode: Mode, name: string) => {
        const text = format(best[mode][name]).padStart(10);
        if (!baseline) return text;
        const c = change(mode, name);
        return `${text} ${`${c >= 0 ? '+' : ''}${(c * 100).toFixed(0)}%`.padStart(5)}`;
    };
    console.log(
        `${'operation'.padEnd(width)}  ${'compiled'.padStart(baseline ? 16 : 10)}  ${'interpreted'.padStart(baseline ? 16 : 10)}  ${'slower'.padStart(7)}`,
    );
    for (const name of names) {
        console.log(
            `${name.padEnd(width)}  ${withChange('compiled', name)}  ${withChange('interpreted', name)}  ${`${(best.interpreted[name] / best.compiled[name]).toFixed(0)}x`.padStart(7)}`,
        );
    }

    if (baseline) {
        if (baseline.node !== current.node || baseline.cpu !== current.cpu) {
            console.log(
                `\nThe baseline was saved on ${baseline.cpu}, Node ${baseline.node}; this is ${current.cpu}, Node ${current.node}. The percentages compare machines, not code.`,
            );
        }
        const slower = MODES.flatMap(mode =>
            names
                .filter(name => change(mode, name) > tolerance)
                .map(name => `${mode}: ${name} is ${(change(mode, name) * 100).toFixed(0)}% slower`),
        );
        if (slower.length) {
            console.error(
                `\nSlower than the baseline of ${baseline.savedAt} by more than ${(tolerance * 100).toFixed(0)}%:\n  ${slower.join('\n  ')}`,
            );
            process.exit(1);
        }
        console.log(
            `\nNothing is more than ${(tolerance * 100).toFixed(0)}% slower than the baseline of ${baseline.savedAt}.`,
        );
    }

    if (flag('--save')) {
        mkdirSync(join(__dirname, 'baselines'), { recursive: true });
        writeFileSync(baselineFile, JSON.stringify(current, null, 2) + '\n');
        console.log(`\nSaved ${baselineFile}`);
    }
}

if (process.env.DEEPKIT_MODES_CHILD) {
    const expected = process.env.DEEPKIT_MODES_CHILD === 'interpreted' ? 'interpreted' : 'auto';
    if (getJitMode() !== expected) throw new Error(`this process should run ${expected}, and runs ${getJitMode()}`);
    console.log(JSON.stringify(measureThisProcess()));
} else {
    main();
}
