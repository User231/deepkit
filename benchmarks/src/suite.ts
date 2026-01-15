/**
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { performance } from 'perf_hooks';
import Benchmark from 'benchmark';
import { isAsyncFunction, getMemorySnapshot, forceGC, MemorySnapshot } from './utils';

// Extended Benchmark interface to match actual runtime behavior
interface BenchmarkInstance extends Benchmark {
    name: string;
    fn: Function;
    options?: Benchmark.Options;
}

/**
 * Benchmark priority categories
 * - p0: Critical path benchmarks, always run
 * - p1: Important benchmarks, run in normal mode
 * - p2: Comprehensive benchmarks, run in full mode
 */
export type BenchmarkCategory = 'p0' | 'p1' | 'p2';

/**
 * Result of a single benchmark run
 */
export interface BenchResult {
    /** Operations per second */
    hz: number;
    /** Total elapsed time in seconds */
    elapsed: number;
    /** Relative margin of error (as percentage) */
    rme: number;
    /** Mean time per operation in seconds */
    mean: number;
    /** Memory usage delta during benchmark */
    memory?: MemorySnapshot;
}

/**
 * Options for adding a benchmark
 */
export interface BenchmarkOptions {
    /** Maximum time to run the benchmark in seconds */
    maxTime?: number;
    /** Number of parallel executions (async only) */
    parallel?: number;
    /** Benchmark category for filtering */
    category?: BenchmarkCategory;
}

/**
 * Results grouped by benchmark name
 */
export type BenchSuiteResult = { [name: string]: BenchResult };

/**
 * Grouped results by category
 */
export interface GroupedBenchResults {
    [group: string]: Array<{ name: string } & BenchResult>;
}

// ANSI color codes
const Reset = '\x1b[0m';
const FgGreen = '\x1b[32m';
const FgYellow = '\x1b[33m';
const FgCyan = '\x1b[36m';
const FgRed = '\x1b[31m';

function green(text: string): string {
    return `${FgGreen}${text}${Reset}`;
}

function yellow(text: string): string {
    return `${FgYellow}${text}${Reset}`;
}

function cyan(text: string): string {
    return `${FgCyan}${text}${Reset}`;
}

function red(text: string): string {
    return `${FgRed}${text}${Reset}`;
}

function print(...args: unknown[]): void {
    process.stdout.write(args.join(' ') + '\n');
}

const blocks = ['\u2581', '\u2582', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];

function getBlocks(stats: number[]): string {
    const max = Math.max(...stats);
    let res = '';
    for (const n of stats) {
        const cat = Math.ceil((n / max) * 6);
        res += blocks[cat - 1] || blocks[0];
    }
    return res;
}

/**
 * Formats operations per second
 */
export function formatHz(v: number): string {
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Formats mean time in milliseconds
 */
export function formatMean(v: number): string {
    return (v * 1000).toLocaleString(undefined, { minimumFractionDigits: 9, maximumFractionDigits: 9 });
}

/**
 * Formats relative margin of error
 */
export function formatRme(v: number): string {
    return v.toFixed(2);
}

/**
 * Formats ops/sec with padding
 */
function ops(opsPerSec: number): string {
    let text = opsPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 });
    text = text.padStart(12, ' ');
    return `${FgGreen}${text}${Reset} ops/s`;
}

/**
 * Prints benchmark results in a formatted table
 */
export function printResults(results: GroupedBenchResults): void {
    let hzMaxLen = 0;
    let meanMaxLen = 0;
    let maxRmeLen = 0;

    for (const group of Object.values(results)) {
        for (const r of group) {
            hzMaxLen = Math.max(hzMaxLen, formatHz(r.hz).length);
            meanMaxLen = Math.max(meanMaxLen, formatMean(r.mean).length);
            maxRmeLen = Math.max(maxRmeLen, formatRme(r.rme).length);
        }
    }

    for (const [group, result] of Object.entries(results)) {
        print('Benchmark:', group);
        result.sort((a, b) => b.hz - a.hz);

        const fastest = result[0];

        for (const r of result) {
            const factorSlowerThanFastest = fastest.hz / r.hz;

            print(
                '  ',
                green(formatHz(r.hz).padStart(hzMaxLen, ' ')), 'ops/sec,',
                yellow(formatMean(r.mean).padStart(meanMaxLen, ' ')), 'ms/op,',
                '\xb1' + formatRme(r.rme).padStart(maxRmeLen, ' ') + '%,',
                'x', factorSlowerThanFastest.toFixed(2),
                green(r.name),
            );
        }
    }
}

/**
 * BenchSuite - A benchmark suite for running performance tests
 *
 * Enhanced version with memory tracking, categories, and cleaner TypeScript types.
 */
export class BenchSuite {
    private suite: Benchmark.Suite;
    private hasAsync = false;
    private fixResult: BenchSuiteResult = {};
    private benchmarkCategories: Map<string, BenchmarkCategory> = new Map();
    private trackMemory = false;
    private memorySnapshots: Map<string, { before: MemorySnapshot; after: MemorySnapshot }> = new Map();

    /** Global callback when suite completes */
    static onComplete?: (name: string, result: BenchSuiteResult) => void;

    /**
     * Creates a new benchmark suite
     *
     * @param name - Name of the benchmark suite
     * @param maxTime - Maximum time per benchmark in seconds (default: 1)
     * @param options - Additional options
     */
    constructor(
        public readonly name: string,
        protected maxTime: number = 1,
        protected options: { trackMemory?: boolean; category?: BenchmarkCategory } = {}
    ) {
        this.trackMemory = options.trackMemory ?? false;
        this.suite = new Benchmark.Suite();

        this.suite.on('complete', () => {
            const benchmarks = (this.suite as any).slice() as BenchmarkInstance[];
            const filtered = (this.suite as any).filter('fastest') as BenchmarkInstance[];
            const fastest = filtered[0];
            const result: BenchSuiteResult = {};

            for (const benchmark of benchmarks) {
                const benchName = benchmark.name ?? '';
                const memoryData = this.memorySnapshots.get(benchName);
                result[benchName] = {
                    hz: benchmark.hz,
                    elapsed: benchmark.times.elapsed,
                    rme: benchmark.stats.rme,
                    mean: benchmark.stats.mean,
                    memory: memoryData ? {
                        rss: memoryData.after.rss - memoryData.before.rss,
                        heapTotal: memoryData.after.heapTotal - memoryData.before.heapTotal,
                        heapUsed: memoryData.after.heapUsed - memoryData.before.heapUsed,
                        external: memoryData.after.external - memoryData.before.external,
                        arrayBuffers: memoryData.after.arrayBuffers - memoryData.before.arrayBuffers,
                    } : undefined,
                };
            }

            if (BenchSuite.onComplete) {
                BenchSuite.onComplete(this.name, result);
            }

            print(' Fastest:', green(fastest?.name ?? 'unknown'));
        }).on('cycle', (event: Benchmark.Event) => {
            const target = event.target as BenchmarkInstance;
            print(
                ' ',
                'x', green(target.hz.toLocaleString(undefined, { maximumFractionDigits: 2 })), 'ops/sec',
                '\xb1' + target.stats.rme.toFixed(2) + '%',
                yellow(target.stats.mean.toLocaleString(undefined, { maximumFractionDigits: 16 })), 'sec/op',
                '\t' + getBlocks(target.stats.sample),
                green(target.name ?? ''),
            );
        });
    }

    /**
     * Gets the category of a benchmark
     */
    getCategory(name: string): BenchmarkCategory | undefined {
        return this.benchmarkCategories.get(name);
    }

    /**
     * Adds an async benchmark
     *
     * @param title - Benchmark name
     * @param fn - Async function to benchmark
     * @param options - Benchmark options
     */
    addAsync(title: string, fn: () => Promise<void>, options: BenchmarkOptions = {}): void {
        this.hasAsync = true;
        this.benchmarkCategories.set(title, options.category ?? 'p1');

        let benchFn = fn;
        if (options.parallel) {
            const parallel = options.parallel;
            const old = fn;
            benchFn = async () => {
                const promises: Promise<void>[] = [];
                for (let i = 0; i < parallel; i++) {
                    promises.push(old());
                }
                await Promise.all(promises);
            };
        }

        if (this.trackMemory) {
            const self = this;
            const originalFn = benchFn;
            benchFn = async function() {
                forceGC();
                const before = getMemorySnapshot();
                await originalFn();
                const after = getMemorySnapshot();
                self.memorySnapshots.set(title, { before, after });
            };
        }

        this.suite.add(title, {
            defer: true,
            maxTime: options.maxTime ?? this.maxTime,
            fn: function(deferred: { resolve: () => void }) {
                benchFn().then(() => deferred.resolve());
            }
        });
    }

    /**
     * Adds a benchmark (auto-detects sync vs async)
     *
     * @param title - Benchmark name
     * @param fn - Function to benchmark
     * @param options - Benchmark options
     */
    add(title: string, fn: () => unknown | Promise<unknown>, options: BenchmarkOptions = {}): void {
        if (isAsyncFunction(fn)) {
            return this.addAsync(title, fn as () => Promise<void>, options);
        }

        this.benchmarkCategories.set(title, options.category ?? 'p1');
        const benchOptions = { maxTime: options.maxTime ?? this.maxTime };

        if (this.trackMemory) {
            const self = this;
            const originalFn = fn;
            const wrappedFn = function() {
                forceGC();
                const before = getMemorySnapshot();
                const result = originalFn();
                const after = getMemorySnapshot();
                self.memorySnapshots.set(title, { before, after });
                return result;
            };
            this.suite.add(title, wrappedFn, benchOptions);
        } else {
            this.suite.add(title, fn, benchOptions);
        }
    }

    /**
     * Adds a pipelining benchmark for high-concurrency async testing
     *
     * @param title - Benchmark name
     * @param fn - Async function to benchmark
     * @param options - Pipelining options
     */
    pipelining(
        title: string,
        fn: () => Promise<unknown>,
        options: { concurrent?: number; total?: number; category?: BenchmarkCategory } = {}
    ): void {
        const total = options.total ?? 10000;
        const concurrent = options.concurrent ?? 200;

        this.addAsync(
            `${title} (pipelining ${total} total, ${concurrent} concurrent)`,
            async () => {
                let done = 0;
                let failed = 0;

                await new Promise<void>((resolve, reject) => {
                    function next() {
                        fn().then(() => {
                            done++;
                            if (failed || done >= total) {
                                resolve();
                                return;
                            }
                            next();
                        }, (error) => {
                            console.log(`Failed at ${done}`, error);
                            failed++;
                            reject(`Failed at ${done}: ${error}`);
                        });
                    }

                    for (let i = 0; i < concurrent; i++) {
                        next();
                    }
                });
            },
            { category: options.category }
        );
    }

    /**
     * Runs synchronous benchmarks
     *
     * @param options - Benchmark.js run options
     */
    run(options: object = {}): void {
        if (this.hasAsync) {
            throw new Error('This benchmark has async functions. Use runAsync() instead.');
        }
        print('Start benchmark', green(this.name));
        this.suite.run(options);
    }

    /**
     * Runs a fixed number of async iterations with timing
     *
     * @param count - Number of iterations
     * @param title - Benchmark name
     * @param fn - Async function to benchmark
     * @param parallel - Number of parallel executions
     */
    async runAsyncFix(count: number, title: string, fn: () => Promise<void>, parallel: number = 0): Promise<void> {
        const took = await bench(count, title, fn, parallel);
        if (this.fixResult[title]) {
            // We don't report slower results as they might be outliers
            if (this.fixResult[title].mean < took / count) return;
        }
        this.fixResult[title] = {
            hz: (1000 / took) * count,
            elapsed: took,
            rme: 0,
            mean: took / count,
        };
        if (BenchSuite.onComplete) {
            BenchSuite.onComplete(this.name, this.fixResult);
        }
    }

    /**
     * Runs all benchmarks asynchronously
     */
    async runAsync(): Promise<void> {
        print('Start benchmark', green(this.name));
        await new Promise<void>((resolve, reject) => {
            this.suite.run({ async: true });
            this.suite.on('error', (event: Benchmark.Event) => {
                reject(event.target);
            });
            this.suite.on('complete', () => {
                resolve();
            });
        });
    }

    /**
     * Filters benchmarks by category and runs only those
     *
     * @param category - Category to run ('p0', 'p1', or 'p2')
     */
    async runByCategory(category: BenchmarkCategory): Promise<void> {
        const filteredSuite = new Benchmark.Suite();
        const benchmarks = (this.suite as any).slice() as BenchmarkInstance[];

        for (const benchmark of benchmarks) {
            const benchName = benchmark.name ?? '';
            const benchCategory = this.benchmarkCategories.get(benchName);
            if (benchCategory === category ||
                (category === 'p1' && benchCategory === 'p0') ||
                (category === 'p2')) {
                filteredSuite.add(benchName, benchmark.fn, benchmark.options ?? {});
            }
        }

        const self = this;
        print('Start benchmark', green(this.name), cyan(`[${category}]`));
        await new Promise<void>((resolve, reject) => {
            filteredSuite.on('cycle', (event: Benchmark.Event) => {
                const target = event.target as BenchmarkInstance;
                print(
                    ' ',
                    'x', green(target.hz.toLocaleString(undefined, { maximumFractionDigits: 2 })), 'ops/sec',
                    '\xb1' + target.stats.rme.toFixed(2) + '%',
                    yellow(target.stats.mean.toLocaleString(undefined, { maximumFractionDigits: 16 })), 'sec/op',
                    '\t' + getBlocks(target.stats.sample),
                    green(target.name ?? ''),
                );
            });
            filteredSuite.on('error', (event: Benchmark.Event) => {
                reject(event.target);
            });
            filteredSuite.on('complete', () => {
                const runBenchmarks = (filteredSuite as any).slice() as BenchmarkInstance[];
                const filtered = (filteredSuite as any).filter('fastest') as BenchmarkInstance[];
                const fastest = filtered[0];
                const result: BenchSuiteResult = {};

                for (const benchmark of runBenchmarks) {
                    const benchName = benchmark.name ?? '';
                    const memoryData = self.memorySnapshots.get(benchName);
                    result[benchName] = {
                        hz: benchmark.hz,
                        elapsed: benchmark.times.elapsed,
                        rme: benchmark.stats.rme,
                        mean: benchmark.stats.mean,
                        memory: memoryData ? {
                            rss: memoryData.after.rss - memoryData.before.rss,
                            heapTotal: memoryData.after.heapTotal - memoryData.before.heapTotal,
                            heapUsed: memoryData.after.heapUsed - memoryData.before.heapUsed,
                            external: memoryData.after.external - memoryData.before.external,
                            arrayBuffers: memoryData.after.arrayBuffers - memoryData.before.arrayBuffers,
                        } : undefined,
                    };
                }

                if (BenchSuite.onComplete) {
                    BenchSuite.onComplete(self.name, result);
                }

                print(' Fastest:', green(fastest?.name ?? 'unknown'));
                resolve();
            });
            filteredSuite.run({ async: true });
        });
    }
}

/**
 * Executes a benchmark function multiple times and measures performance.
 *
 * @param times - Number of iterations
 * @param title - Benchmark name
 * @param exec - Function to execute
 * @param parallel - Number of parallel executions (0 for sequential)
 * @returns Total time taken in milliseconds
 */
export async function bench(
    times: number,
    title: string,
    exec: () => void | Promise<void>,
    parallel: number = 0,
): Promise<number> {
    let took = 0;

    if (parallel) {
        const firstResult = exec();
        const isAsync = firstResult instanceof Promise;
        if (firstResult instanceof Promise) {
            await firstResult;
        }

        if (!isAsync) {
            throw new Error('Parallel execution only works with async functions');
        }

        let done = 0;
        let active = 0;
        let error = false;

        await new Promise<void>((resolve, reject) => {
            const start = performance.now();

            function check() {
                if (error) return;
                if (done === times) {
                    took = performance.now() - start;
                    resolve();
                }
                while (active < parallel && done + active < times) {
                    active++;
                    (exec() as Promise<void>).then(() => {
                        done++;
                        active--;
                        check();
                    }).catch((x) => {
                        reject(x);
                        error = true;
                    });
                }
            }

            check();
        });
    } else {
        const start = performance.now();
        for (let i = 0; i < times; i++) {
            await exec();
        }
        took = performance.now() - start;
    }

    const memUsage = process.memoryUsage();
    process.stdout.write([
        times.toLocaleString(), 'ops:',
        ops((1000 / took) * times),
        green(title),
        took.toLocaleString(undefined, { maximumFractionDigits: 17 }), 'ms,',
        (took / times).toLocaleString(undefined, { maximumFractionDigits: 17 }), 'ms per op',
        (memUsage.rss / 1024 / 1024).toFixed(2), 'MB memory'
    ].join(' ') + '\n');

    return took;
}
