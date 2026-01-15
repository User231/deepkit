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
import { BenchSuite, BenchSuiteResult, BenchmarkCategory } from './bench';
import { JsonReporter } from './reporter/json';
import { saveBaseline, compareWithBaseline } from './reporter/comparison';

// ══════════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════════

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
    /** Maximum time per benchmark in seconds */
    maxTime?: number;
}

export interface BenchmarkModule {
    default?: () => BenchSuite | Promise<BenchSuite> | void | Promise<void>;
    suite?: BenchSuite;
    run?: () => Promise<void> | void;
}

// ══════════════════════════════════════════════════════════════════════════════
// COLORS
// ══════════════════════════════════════════════════════════════════════════════

const Reset = '\x1b[0m';
const Bold = '\x1b[1m';
const FgGreen = '\x1b[32m';
const FgCyan = '\x1b[36m';
const FgGray = '\x1b[90m';

function green(text: string): string { return `${FgGreen}${text}${Reset}`; }
function cyan(text: string): string { return `${FgCyan}${text}${Reset}`; }
function gray(text: string): string { return `${FgGray}${text}${Reset}`; }
function bold(text: string): string { return `${Bold}${text}${Reset}`; }

// ══════════════════════════════════════════════════════════════════════════════
// BENCHMARK RUNNER
// ══════════════════════════════════════════════════════════════════════════════

export class BenchmarkRunner {
    private options: Required<RunnerOptions>;
    private results: { [suiteName: string]: BenchSuiteResult } = {};
    private jsonReporter: JsonReporter;

    constructor(options: RunnerOptions = {}) {
        this.options = {
            benchmarkDir: options.benchmarkDir ?? path.join(process.cwd(), 'benchmarks'),
            pattern: options.pattern ?? '**/*.bench.ts',
            category: options.category as BenchmarkCategory,
            jsonOutput: options.jsonOutput ?? '',
            saveBaseline: options.saveBaseline ?? false,
            compareBaseline: options.compareBaseline ?? false,
            baselineDir: options.baselineDir ?? path.join(process.cwd(), 'benchmarks', 'baselines'),
            filter: options.filter ?? '',
            verbose: options.verbose ?? false,
            maxTime: options.maxTime ?? 1,
        };

        this.jsonReporter = new JsonReporter();
    }

    async discoverBenchmarks(): Promise<string[]> {
        const searchPath = path.join(this.options.benchmarkDir, this.options.pattern);

        if (this.options.verbose) {
            console.log(gray(`Searching: ${searchPath}`));
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

    async runBenchmarkFile(filePath: string): Promise<void> {
        if (this.options.verbose) {
            console.log(gray(`Loading: ${filePath}`));
        }

        try {
            // Force GC before each file
            if (typeof global !== 'undefined' && (global as any).gc) {
                (global as any).gc();
            }

            const module = await import(filePath) as BenchmarkModule;

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
                    console.log(gray(`  No runnable export in ${path.basename(filePath)}`));
                }
            }
        } catch (error) {
            console.error(`Error in ${filePath}:`, error);
            throw error;
        }
    }

    async runSuite(suite: BenchSuite): Promise<void> {
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

    async runAll(): Promise<void> {
        const files = await this.discoverBenchmarks();

        if (files.length === 0) {
            console.log('No benchmark files found.');
            console.log(`  Directory: ${this.options.benchmarkDir}`);
            console.log(`  Pattern: ${this.options.pattern}`);
            return;
        }

        console.log();
        console.log(bold(`╔${'═'.repeat(60)}╗`));
        console.log(bold(`║${' '.repeat(18)}${green('DEEPKIT BENCHMARKS')}${' '.repeat(22)}║`));
        console.log(bold(`╚${'═'.repeat(60)}╝`));
        console.log();
        console.log(gray(`  Node ${process.version} | ${process.platform} ${process.arch}`));
        console.log(gray(`  Found ${files.length} benchmark file(s)`));
        if (this.options.category) {
            console.log(gray(`  Category: ${this.options.category}`));
        }

        for (const file of files) {
            await this.runBenchmarkFile(file);
        }

        // Save JSON output
        if (this.options.jsonOutput) {
            this.jsonReporter.writeToFile(this.options.jsonOutput);
            console.log(green(`\n✓ Results saved to: ${this.options.jsonOutput}`));
        }

        // Save baseline
        if (this.options.saveBaseline) {
            const baselinePath = saveBaseline(this.results, this.options.baselineDir);
            console.log(green(`✓ Baseline saved to: ${baselinePath}`));
        }

        // Compare against baseline
        if (this.options.compareBaseline) {
            const exitCode = compareWithBaseline(this.results, this.options.baselineDir);
            if (exitCode !== 0) {
                process.exitCode = exitCode;
            }
        }

        console.log();
        console.log(bold(green('All benchmarks complete.')));
        console.log();
    }

    getResults(): { [suiteName: string]: BenchSuiteResult } {
        return this.results;
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// CLI
// ══════════════════════════════════════════════════════════════════════════════

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
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
                break;
            default:
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

function printHelp(): void {
    console.log(`
${bold('Deepkit Benchmark Runner')} ${gray('(zero dependencies)')}

${bold('Usage:')} npx ts-node src/runner.ts [options] [path|pattern|filter]

${bold('Options:')}
  -d, --dir <path>          Directory containing benchmark files
  -p, --pattern <glob>      Glob pattern for benchmark files (default: **/*.bench.ts)
  -c, --category <cat>      Run only benchmarks of category (p0, p1, p2)
  -j, --json <path>         Output results to JSON file
  -f, --filter <regex>      Filter benchmarks by name
  -t, --max-time <sec>      Maximum time per benchmark in seconds
  -v, --verbose             Verbose output
  --save-baseline           Save results as a new baseline
  --compare-baseline        Compare results against latest baseline
  --baseline-dir <path>     Directory for baseline files
  -h, --help                Show this help message

${bold('Examples:')}
  npx ts-node src/runner.ts                          # Run all benchmarks
  npx ts-node src/runner.ts -c p0                    # Run only P0 benchmarks
  npx ts-node src/runner.ts -f "serialize"           # Run benchmarks matching "serialize"
  npx ts-node src/runner.ts --save-baseline          # Save results as baseline
  npx ts-node src/runner.ts --compare-baseline       # Compare against baseline

${bold('Environment:')}
  For GC control, run with: node --expose-gc
`);
}

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

// Exports
export { BenchSuite, BenchSuiteResult, BenchmarkCategory } from './bench';
export * from './reporter/json';
export * from './reporter/comparison';
export * from './reporter/markdown';
export * from './reporter/svg';

// Run if executed directly
if (require.main === module) {
    main();
}
