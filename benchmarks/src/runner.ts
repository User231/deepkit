/**
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { BenchSuite, BenchSuiteResult, BenchmarkCategory } from './suite';
import { JsonReporter } from './reporter/json';
import { ConsoleReporter } from './reporter/console';
import { ComparisonReporter, saveBaseline, compareWithBaseline } from './reporter/comparison';
import { forceGC } from './utils';

/**
 * Runner configuration options
 */
export interface RunnerOptions {
    /** Directory containing benchmark files */
    benchmarkDir?: string;
    /** Glob pattern for benchmark files */
    pattern?: string;
    /** Category to run (p0, p1, p2) */
    category?: BenchmarkCategory;
    /** Output JSON results to file */
    jsonOutput?: string;
    /** Save results as baseline */
    saveBaseline?: boolean;
    /** Compare against baseline */
    compareBaseline?: boolean;
    /** Baseline directory */
    baselineDir?: string;
    /** Filter benchmarks by name pattern */
    filter?: string;
    /** Run in verbose mode */
    verbose?: boolean;
    /** Maximum time per benchmark */
    maxTime?: number;
    /** Track memory usage */
    trackMemory?: boolean;
}

/**
 * Benchmark module export interface
 */
export interface BenchmarkModule {
    /** Default export should be a function that returns BenchSuite or void */
    default?: () => BenchSuite | Promise<BenchSuite> | void | Promise<void>;
    /** Or a suite export */
    suite?: BenchSuite;
    /** Or a run function */
    run?: () => Promise<void> | void;
}

/**
 * Benchmark Runner - Discovers and runs benchmark files
 */
export class BenchmarkRunner {
    private options: RunnerOptions;
    private results: { [suiteName: string]: BenchSuiteResult } = {};
    private jsonReporter: JsonReporter;
    private consoleReporter: ConsoleReporter;

    constructor(options: RunnerOptions = {}) {
        this.options = {
            benchmarkDir: options.benchmarkDir ?? path.join(process.cwd(), 'benchmarks'),
            pattern: options.pattern ?? '**/*.bench.ts',
            category: options.category,
            jsonOutput: options.jsonOutput,
            saveBaseline: options.saveBaseline ?? false,
            compareBaseline: options.compareBaseline ?? false,
            baselineDir: options.baselineDir ?? path.join(process.cwd(), 'benchmarks', 'baselines'),
            filter: options.filter,
            verbose: options.verbose ?? false,
            maxTime: options.maxTime ?? 1,
            trackMemory: options.trackMemory ?? false,
        };

        this.jsonReporter = new JsonReporter();
        this.consoleReporter = new ConsoleReporter({
            showMemory: this.options.trackMemory,
            colors: true,
        });
    }

    /**
     * Discovers benchmark files in the benchmark directory
     */
    async discoverBenchmarks(): Promise<string[]> {
        const searchPath = path.join(this.options.benchmarkDir!, this.options.pattern!);

        if (this.options.verbose) {
            console.log(`Searching for benchmarks: ${searchPath}`);
        }

        const files = await glob(searchPath, {
            absolute: true,
            nodir: true,
        });

        if (this.options.filter) {
            const filterRegex = new RegExp(this.options.filter, 'i');
            return files.filter(f => filterRegex.test(f));
        }

        return files;
    }

    /**
     * Loads and runs a single benchmark file
     */
    async runBenchmarkFile(filePath: string): Promise<void> {
        if (this.options.verbose) {
            console.log(`Loading benchmark: ${filePath}`);
        }

        try {
            // Force GC before each benchmark file
            forceGC();

            const module = await import(filePath) as BenchmarkModule;

            // Handle different module export styles
            if (module.default && typeof module.default === 'function') {
                const result = await module.default();
                if (result instanceof BenchSuite) {
                    await this.runSuite(result);
                }
            } else if (module.suite instanceof BenchSuite) {
                await this.runSuite(module.suite);
            } else if (module.run && typeof module.run === 'function') {
                await module.run();
            } else {
                if (this.options.verbose) {
                    console.log(`No runnable export found in ${filePath}`);
                }
            }
        } catch (error) {
            console.error(`Error running benchmark ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Runs a BenchSuite and collects results
     */
    async runSuite(suite: BenchSuite): Promise<void> {
        // Set up result collection
        const originalOnComplete = BenchSuite.onComplete;
        BenchSuite.onComplete = (name, result) => {
            this.results[name] = result;
            this.jsonReporter.addSuiteResults(name, result);
            if (originalOnComplete) {
                originalOnComplete(name, result);
            }
        };

        try {
            if (this.options.category) {
                await suite.runByCategory(this.options.category);
            } else {
                await suite.runAsync();
            }
        } finally {
            BenchSuite.onComplete = originalOnComplete;
        }
    }

    /**
     * Runs all discovered benchmarks
     */
    async runAll(): Promise<void> {
        const files = await this.discoverBenchmarks();

        if (files.length === 0) {
            console.log('No benchmark files found.');
            console.log(`Searched in: ${this.options.benchmarkDir}`);
            console.log(`Pattern: ${this.options.pattern}`);
            return;
        }

        console.log(`Found ${files.length} benchmark file(s)`);
        console.log();

        for (const file of files) {
            await this.runBenchmarkFile(file);
        }

        // Report results
        this.consoleReporter.reportAll(this.results);

        // Save JSON output if requested
        if (this.options.jsonOutput) {
            this.jsonReporter.writeToFile(this.options.jsonOutput);
        }

        // Save as baseline if requested
        if (this.options.saveBaseline) {
            const baselinePath = saveBaseline(this.results, this.options.baselineDir!);
            console.log(`Baseline saved to: ${baselinePath}`);
        }

        // Compare against baseline if requested
        if (this.options.compareBaseline) {
            const exitCode = compareWithBaseline(
                this.results,
                this.options.baselineDir!
            );
            if (exitCode !== 0) {
                process.exitCode = exitCode;
            }
        }
    }

    /**
     * Gets collected results
     */
    getResults(): { [suiteName: string]: BenchSuiteResult } {
        return this.results;
    }
}

/**
 * Parse command line arguments
 */
function parseArgs(): RunnerOptions {
    const args = process.argv.slice(2);
    const options: RunnerOptions = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        switch (arg) {
            case '--dir':
            case '-d':
                options.benchmarkDir = args[++i];
                break;
            case '--pattern':
            case '-p':
                options.pattern = args[++i];
                break;
            case '--category':
            case '-c':
                options.category = args[++i] as BenchmarkCategory;
                break;
            case '--json':
            case '-j':
                options.jsonOutput = args[++i];
                break;
            case '--save-baseline':
                options.saveBaseline = true;
                break;
            case '--compare-baseline':
                options.compareBaseline = true;
                break;
            case '--baseline-dir':
                options.baselineDir = args[++i];
                break;
            case '--filter':
            case '-f':
                options.filter = args[++i];
                break;
            case '--verbose':
            case '-v':
                options.verbose = true;
                break;
            case '--max-time':
            case '-t':
                options.maxTime = parseFloat(args[++i]);
                break;
            case '--track-memory':
            case '-m':
                options.trackMemory = true;
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
                break;
            default:
                // If it's not a flag, treat it as a file path or pattern
                if (!arg.startsWith('-')) {
                    if (arg.includes('*')) {
                        options.pattern = arg;
                    } else if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
                        options.benchmarkDir = arg;
                    } else if (fs.existsSync(arg)) {
                        options.pattern = path.basename(arg);
                        options.benchmarkDir = path.dirname(arg);
                    } else {
                        options.filter = arg;
                    }
                }
        }
    }

    return options;
}

/**
 * Print help message
 */
function printHelp(): void {
    console.log(`
Deepkit Benchmark Runner

Usage: npx ts-node src/runner.ts [options] [path|pattern|filter]

Options:
  -d, --dir <path>          Directory containing benchmark files
  -p, --pattern <glob>      Glob pattern for benchmark files (default: **/*.bench.ts)
  -c, --category <cat>      Run only benchmarks of category (p0, p1, p2)
  -j, --json <path>         Output results to JSON file
  -f, --filter <regex>      Filter benchmarks by name
  -t, --max-time <sec>      Maximum time per benchmark in seconds
  -m, --track-memory        Track memory usage during benchmarks
  -v, --verbose             Verbose output
  --save-baseline           Save results as a new baseline
  --compare-baseline        Compare results against latest baseline
  --baseline-dir <path>     Directory for baseline files
  -h, --help                Show this help message

Examples:
  npx ts-node src/runner.ts                          # Run all benchmarks
  npx ts-node src/runner.ts -c p0                    # Run only P0 benchmarks
  npx ts-node src/runner.ts -f "serialize"           # Run benchmarks matching "serialize"
  npx ts-node src/runner.ts --save-baseline          # Save results as baseline
  npx ts-node src/runner.ts --compare-baseline       # Compare against baseline

Environment:
  For V8 introspection, run with: node --allow-natives-syntax
  For GC control, run with: node --expose-gc
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
    const options = parseArgs();
    const runner = new BenchmarkRunner(options);

    try {
        await runner.runAll();
    } catch (error) {
        console.error('Benchmark runner failed:', error);
        process.exit(1);
    }
}

// Export for programmatic use
export { BenchmarkRunner as Runner };
export * from './suite';
export * from './utils';
export * from './reporter/json';
export * from './reporter/console';
export * from './reporter/comparison';

// Run if executed directly
if (require.main === module) {
    main();
}
