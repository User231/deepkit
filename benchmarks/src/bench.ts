/**
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

/**
 * Zero-dependency benchmark utility with Braille bar charts and colored output.
 * Designed for both CI benchmarking and interactive debugging.
 */

declare var global: any;

const AsyncFunction = (async () => { }).constructor as { new(...args: string[]): Function };

// ══════════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════════

export type BenchmarkCategory = 'p0' | 'p1' | 'p2';

export interface BenchResult {
    /** Operations per second */
    hz: number;
    /** Total elapsed time in seconds */
    elapsed: number;
    /** Relative margin of error (as percentage) */
    rme: number;
    /** Mean time per operation in milliseconds */
    mean: number;
    /** Number of iterations run */
    iterations: number;
    /** Sample timings for visualization */
    samples: number[];
    /** Heap memory difference */
    heapDiff: number;
    /** Whether this is async */
    async: boolean;
}

export type BenchSuiteResult = { [name: string]: BenchResult };

export interface BenchmarkOptions {
    /** Maximum time to run in seconds (default: 1) */
    maxTime?: number;
    /** Benchmark category for filtering */
    category?: BenchmarkCategory;
}

interface BenchmarkEntry {
    name: string;
    fn: () => void | Promise<void>;
    options: BenchmarkOptions;
}

// ══════════════════════════════════════════════════════════════════════════════
// ANSI COLORS
// ══════════════════════════════════════════════════════════════════════════════

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255)
    ];
}

function colorHSV(text: string, h: number, s = 1, v = 1): string {
    const [r, g, b] = hsvToRgb(h, s, v);
    return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

const Reset = '\x1b[0m';
const Bold = '\x1b[1m';
const Dim = '\x1b[2m';
const FgGreen = '\x1b[32m';
const FgYellow = '\x1b[33m';
const FgCyan = '\x1b[36m';
const FgMagenta = '\x1b[35m';
const FgRed = '\x1b[31m';
const FgGray = '\x1b[90m';

function green(text: string): string { return `${FgGreen}${text}${Reset}`; }
function yellow(text: string): string { return `${FgYellow}${text}${Reset}`; }
function cyan(text: string): string { return `${FgCyan}${text}${Reset}`; }
function magenta(text: string): string { return `${FgMagenta}${text}${Reset}`; }
function red(text: string): string { return `${FgRed}${text}${Reset}`; }
function gray(text: string): string { return `${FgGray}${text}${Reset}`; }
function bold(text: string): string { return `${Bold}${text}${Reset}`; }
function dim(text: string): string { return `${Dim}${text}${Reset}`; }

// ══════════════════════════════════════════════════════════════════════════════
// BRAILLE VISUALIZATION
// ══════════════════════════════════════════════════════════════════════════════

const BLOCK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function getBlockBar(values: number[], width: number = 20): string {
    if (values.length === 0) return '';

    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;

    // Sample down to width
    const step = Math.max(1, Math.floor(values.length / width));
    let result = '';

    for (let i = 0; i < width && i * step < values.length; i++) {
        const v = values[i * step];
        const norm = (v - min) / range;
        const idx = Math.min(7, Math.floor(norm * 8));
        const hue = 120 - Math.round(norm * 60); // green → yellow gradient
        result += colorHSV(BLOCK_CHARS[idx], hue, 0.8, 1);
    }

    return result;
}

function getBrailleBar(values: number[]): string {
    if (values.length === 0) return '';

    const max = Math.max(...values);
    const min = Math.min(...values);
    const norm = values.map(v => (v - min) / (max - min || 1));

    const BRAILLE_BASE = 0x2800;
    let result = '';

    for (let i = 0; i < norm.length; i += 2) {
        const top = norm[i];
        const bottom = norm[i + 1] ?? norm[i];
        const dots = (Math.round(top * 3) << 0) | (Math.round(bottom * 3) << 3);
        const char = String.fromCharCode(BRAILLE_BASE + dots);
        const ratio = (top + bottom) / 2;
        const hue = 180 - Math.round(ratio * 180);
        result += colorHSV(char, hue, 1, 1);
    }

    return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// FORMATTING
// ══════════════════════════════════════════════════════════════════════════════

export function formatHz(v: number): string {
    if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + 'B';
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
    if (v >= 1_000) return (v / 1_000).toFixed(2) + 'K';
    return v.toFixed(2);
}

export function formatHzFull(v: number): string {
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatMean(ms: number): string {
    if (ms < 0.001) return (ms * 1000000).toFixed(3) + ' ns';
    if (ms < 1) return (ms * 1000).toFixed(3) + ' µs';
    if (ms < 1000) return ms.toFixed(3) + ' ms';
    return (ms / 1000).toFixed(3) + ' s';
}

export function formatRme(v: number): string {
    return '±' + v.toFixed(2) + '%';
}

function formatBytes(bytes: number): string {
    if (Math.abs(bytes) < 1024) return bytes + ' B';
    if (Math.abs(bytes) < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function mean(arr: number[]): number {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function variance(arr: number[], m: number): number {
    return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
}

const callGc = typeof global !== 'undefined' && global.gc ? global.gc : () => undefined;

function getHeapUsed(): number {
    return typeof process !== 'undefined' ? process.memoryUsage().heapUsed : 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// EXECUTORS (JIT-optimized loop unrolling)
// ══════════════════════════════════════════════════════════════════════════════

function getExecutor(times: number): (fn: Function) => number {
    let code = '';
    for (let i = 0; i < times; i++) code += 'fn();';
    return new Function('fn', code + `; return ${times}`) as (fn: Function) => number;
}

function getAsyncExecutor(times: number): (fn: Function) => Promise<number> {
    let code = '';
    for (let i = 0; i < times; i++) code += 'await fn();';
    return new AsyncFunction('fn', code + `; return ${times}`) as (fn: Function) => Promise<number>;
}

// ══════════════════════════════════════════════════════════════════════════════
// BENCHSUITE CLASS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * BenchSuite - A zero-dependency benchmark suite for performance testing.
 *
 * Features:
 * - Automatic sync/async detection
 * - Category filtering (p0, p1, p2)
 * - Braille/block bar visualization
 * - Memory tracking
 * - Relative comparison between benchmarks
 * - JSON export for CI
 */
export class BenchSuite {
    private benchmarks: BenchmarkEntry[] = [];
    private results: BenchSuiteResult = {};

    /** Global callback when suite completes */
    static onComplete?: (name: string, result: BenchSuiteResult) => void;

    constructor(
        public readonly name: string,
        private defaultMaxTime: number = 1
    ) { }

    /**
     * Add a benchmark to the suite
     */
    add(name: string, fn: () => void | Promise<void>, options: BenchmarkOptions = {}): this {
        this.benchmarks.push({ name, fn, options });
        return this;
    }

    /**
     * Run all benchmarks synchronously (blocking)
     */
    run(options: { category?: BenchmarkCategory; verbose?: boolean } = {}): void {
        this.runAsync(options).then(() => { });
    }

    /**
     * Run all benchmarks asynchronously
     */
    async runAsync(options: { category?: BenchmarkCategory; verbose?: boolean } = {}): Promise<BenchSuiteResult> {
        const { category, verbose = true } = options;

        const filtered = category
            ? this.benchmarks.filter(b => {
                const cat = b.options.category ?? 'p1';
                return cat === category ||
                    (category === 'p1' && cat === 'p0') ||
                    (category === 'p2');
            })
            : this.benchmarks;

        if (filtered.length === 0) {
            if (verbose) console.log(gray(`No benchmarks to run in suite "${this.name}"`));
            return {};
        }

        // Calculate max name length for alignment
        const maxNameLen = Math.max(...filtered.map(b => b.name.length));

        if (verbose) {
            console.log();
            console.log(bold(`━━━ ${green(this.name)} ━━━`));
            if (category) console.log(gray(`  Category: ${category}`));
            console.log();
        }

        for (const bench of filtered) {
            try {
                const result = await this.runBenchmark(bench, verbose, maxNameLen);
                this.results[bench.name] = result;
            } catch (err) {
                if (verbose) console.error(red(`  ✗ ${bench.name} failed:`), err);
            }
        }

        if (verbose) {
            this.printSummary();
        }

        if (BenchSuite.onComplete) {
            BenchSuite.onComplete(this.name, this.results);
        }

        return this.results;
    }

    /**
     * Run by category filter
     */
    async runByCategory(category: BenchmarkCategory): Promise<BenchSuiteResult> {
        return this.runAsync({ category });
    }

    /**
     * Get results as JSON-serializable object
     */
    getResults(): BenchSuiteResult {
        return this.results;
    }

    // ────────────────────────────────────────────────────────────────────────────
    // PRIVATE
    // ────────────────────────────────────────────────────────────────────────────

    private async runBenchmark(bench: BenchmarkEntry, verbose: boolean, maxNameLen: number = 20): Promise<BenchResult> {
        const maxTime = bench.options.maxTime ?? this.defaultMaxTime;
        const isAsync = bench.fn instanceof AsyncFunction ||
            (bench.fn as any).constructor?.name === 'AsyncFunction';

        const result = isAsync
            ? await this.testAsync(bench.fn as () => Promise<void>, maxTime)
            : this.testSync(bench.fn as () => void, maxTime);

        result.async = isAsync;

        if (verbose) {
            this.printResult(bench.name, result, maxNameLen, isAsync);
        }

        return result;
    }

    private testSync(fn: () => void, seconds: number): BenchResult {
        // Find optimal executor (auto-calibrate)
        const executors = [1, 10, 100, 1000, 10000, 100000].map(getExecutor);
        let executor = executors[0];
        for (const ex of executors) {
            const start = performance.now();
            ex(fn);
            const t = performance.now() - start;
            if (t > 5) break;
            executor = ex;
        }

        // Warmup
        for (let i = 0; i < 50; i++) executor(fn);

        // Run
        const maxMs = seconds * 1000;
        let consumed = 0;
        let iterations = 0;
        const samples: number[] = [];

        callGc();
        const beforeHeap = getHeapUsed();
        const startTotal = performance.now();

        while (consumed < maxMs) {
            const start = performance.now();
            const r = executor(fn);
            const t = performance.now() - start;
            consumed += t;
            samples.push(t / r);
            iterations += r;
        }

        const elapsed = (performance.now() - startTotal) / 1000;
        const heapDiff = getHeapUsed() - beforeHeap;

        return this.collectResult(samples, iterations, elapsed, heapDiff);
    }

    private async testAsync(fn: () => Promise<void>, seconds: number): Promise<BenchResult> {
        // Find optimal executor (auto-calibrate)
        const executors = [1, 10, 100, 1000, 10000].map(getAsyncExecutor);
        let executor = executors[0];
        for (const ex of executors) {
            const start = performance.now();
            await ex(fn);
            const t = performance.now() - start;
            if (t > 5) break;
            executor = ex;
        }

        // Warmup
        for (let i = 0; i < 20; i++) await executor(fn);

        // Run
        const maxMs = seconds * 1000;
        let consumed = 0;
        let iterations = 0;
        const samples: number[] = [];

        callGc();
        const beforeHeap = getHeapUsed();
        const startTotal = performance.now();

        while (consumed < maxMs) {
            const start = performance.now();
            const r = await executor(fn);
            const t = performance.now() - start;
            consumed += t;
            samples.push(t / r);
            iterations += r;
        }

        const elapsed = (performance.now() - startTotal) / 1000;
        const heapDiff = getHeapUsed() - beforeHeap;

        return this.collectResult(samples, iterations, elapsed, heapDiff);
    }

    private collectResult(samples: number[], iterations: number, elapsed: number, heapDiff: number): BenchResult {
        const avg = mean(samples);
        const varr = variance(samples, avg);
        const rme = (Math.sqrt(varr) / avg) * 100;
        const hz = 1000 / avg;

        return {
            hz,
            elapsed,
            rme: isFinite(rme) ? rme : 0,
            mean: avg,
            iterations,
            samples: samples.slice(0, 50),
            heapDiff,
            async: false,
        };
    }

    private printResult(name: string, result: BenchResult, maxNameLen: number, isAsync: boolean): void {
        const bar = getBlockBar(result.samples, 20);
        const hzStr = green(formatHzFull(result.hz).padStart(18));
        const meanStr = yellow(formatMean(result.mean).padStart(12));
        const rmeStr = gray(formatRme(result.rme).padStart(8));
        const asyncTag = isAsync ? dim(' (async)') : '';

        console.log(`  ${bar} ${hzStr} ops/sec ${meanStr}/op ${rmeStr}  ${name}${asyncTag}`);
    }

    private printSummary(): void {
        const entries = Object.entries(this.results);
        if (entries.length === 0) return;

        // Sort by ops/sec descending
        entries.sort((a, b) => b[1].hz - a[1].hz);
        const fastest = entries[0];
        const maxNameLen = Math.max(...entries.map(([name]) => name.length));

        console.log();
        console.log(bold('  Summary:'));

        for (let i = 0; i < entries.length; i++) {
            const [name, result] = entries[i];
            const isFastest = i === 0;
            const factor = fastest[1].hz / result.hz;

            // Performance bar (relative to fastest)
            const barWidth = 15;
            const filled = Math.round((result.hz / fastest[1].hz) * barWidth);
            const bar = green('█'.repeat(filled)) + gray('░'.repeat(barWidth - filled));

            const hzStr = cyan(formatHz(result.hz).padStart(10));
            const factorStr = isFastest
                ? green(bold('fastest'))
                : dim(`x${factor.toFixed(2).padStart(6)}`);

            const nameStr = isFastest ? bold(green(name)) : name;

            console.log(`  ${bar} ${hzStr} ops/sec ${factorStr}  ${nameStr}`);
        }

        console.log();
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// SIMPLE API (for quick benchmarks)
// ══════════════════════════════════════════════════════════════════════════════

const defaultSuite = new BenchSuite('Default');

/**
 * Quick benchmark function for simple cases
 */
export function benchmark(name: string, fn: () => void | Promise<void>, options?: BenchmarkOptions): void {
    defaultSuite.add(name, fn, options);
}

/**
 * Run all benchmarks added via benchmark()
 */
export async function runBenchmarks(seconds: number = 1): Promise<BenchSuiteResult> {
    return defaultSuite.runAsync({ verbose: true });
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

export { getBlockBar, getBrailleBar };
