/**
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { BenchSuiteResult, BenchResult, formatHz, formatMean, formatRme } from '../suite';
import { formatBytes, MemorySnapshot } from '../utils';

// ANSI color codes
const Reset = '\x1b[0m';
const Bold = '\x1b[1m';
const Dim = '\x1b[2m';
const FgRed = '\x1b[31m';
const FgGreen = '\x1b[32m';
const FgYellow = '\x1b[33m';
const FgBlue = '\x1b[34m';
const FgMagenta = '\x1b[35m';
const FgCyan = '\x1b[36m';
const FgWhite = '\x1b[37m';

function colorize(text: string, color: string): string {
    return `${color}${text}${Reset}`;
}

function green(text: string): string {
    return colorize(text, FgGreen);
}

function yellow(text: string): string {
    return colorize(text, FgYellow);
}

function red(text: string): string {
    return colorize(text, FgRed);
}

function cyan(text: string): string {
    return colorize(text, FgCyan);
}

function blue(text: string): string {
    return colorize(text, FgBlue);
}

function bold(text: string): string {
    return colorize(text, Bold);
}

function dim(text: string): string {
    return colorize(text, Dim);
}

/**
 * Options for console output
 */
export interface ConsoleReporterOptions {
    /** Show memory usage information */
    showMemory?: boolean;
    /** Show detailed statistics */
    showDetails?: boolean;
    /** Use colors in output */
    colors?: boolean;
    /** Sort results by ops/sec (descending) */
    sortBySpeed?: boolean;
}

/**
 * Console Reporter - Outputs benchmark results to the console
 */
export class ConsoleReporter {
    private options: ConsoleReporterOptions;

    constructor(options: ConsoleReporterOptions = {}) {
        this.options = {
            showMemory: options.showMemory ?? false,
            showDetails: options.showDetails ?? true,
            colors: options.colors ?? true,
            sortBySpeed: options.sortBySpeed ?? true,
        };
    }

    /**
     * Prints a horizontal line separator
     */
    private printSeparator(char: string = '-', length: number = 80): void {
        console.log(char.repeat(length));
    }

    /**
     * Formats a number with fixed decimal places and padding
     */
    private formatNumber(value: number, decimals: number = 2, pad: number = 0): string {
        const formatted = value.toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        });
        return pad > 0 ? formatted.padStart(pad, ' ') : formatted;
    }

    /**
     * Reports results for a single benchmark suite
     *
     * @param suiteName - Name of the benchmark suite
     * @param results - Results from the suite
     */
    reportSuite(suiteName: string, results: BenchSuiteResult): void {
        console.log();
        console.log(this.options.colors ? bold(`Benchmark: ${suiteName}`) : `Benchmark: ${suiteName}`);
        this.printSeparator();

        // Convert to array and sort
        const entries = Object.entries(results).map(([name, result]) => ({
            name,
            ...result,
        }));

        if (this.options.sortBySpeed) {
            entries.sort((a, b) => b.hz - a.hz);
        }

        // Calculate padding widths
        const hzMaxLen = Math.max(...entries.map(e => formatHz(e.hz).length));
        const meanMaxLen = Math.max(...entries.map(e => formatMean(e.mean).length));
        const rmeMaxLen = Math.max(...entries.map(e => formatRme(e.rme).length));
        const nameMaxLen = Math.max(...entries.map(e => e.name.length));

        const fastest = entries[0];

        for (const entry of entries) {
            const factor = fastest.hz / entry.hz;
            const isFastest = factor === 1;

            // Build the output line
            let line = '  ';

            // Ops/sec
            const hzStr = formatHz(entry.hz).padStart(hzMaxLen, ' ');
            line += this.options.colors ? green(hzStr) : hzStr;
            line += ' ops/sec  ';

            // Mean time
            const meanStr = formatMean(entry.mean).padStart(meanMaxLen, ' ');
            line += this.options.colors ? yellow(meanStr) : meanStr;
            line += ' ms/op  ';

            // RME
            const rmeStr = '\xb1' + formatRme(entry.rme).padStart(rmeMaxLen, ' ') + '%';
            line += rmeStr;
            line += '  ';

            // Factor
            const factorStr = `x${factor.toFixed(2)}`;
            if (isFastest) {
                line += this.options.colors ? green(factorStr.padStart(6, ' ')) : factorStr.padStart(6, ' ');
            } else {
                line += this.options.colors ? dim(factorStr.padStart(6, ' ')) : factorStr.padStart(6, ' ');
            }
            line += '  ';

            // Name
            const nameStr = entry.name;
            if (isFastest) {
                line += this.options.colors ? bold(green(nameStr)) : `* ${nameStr}`;
            } else {
                line += nameStr;
            }

            console.log(line);

            // Memory info (if available and enabled)
            if (this.options.showMemory && entry.memory) {
                this.printMemoryInfo(entry.memory);
            }
        }

        this.printSeparator();
        const fastestLabel = this.options.colors
            ? `Fastest: ${bold(green(fastest.name))}`
            : `Fastest: ${fastest.name}`;
        console.log(fastestLabel);
        console.log();
    }

    /**
     * Prints memory information
     */
    private printMemoryInfo(memory: MemorySnapshot): void {
        const parts = [
            `heap: ${formatBytes(memory.heapUsed)}`,
            `rss: ${formatBytes(memory.rss)}`,
        ];

        const memLine = this.options.colors
            ? `    ${dim('Memory:')} ${dim(parts.join(', '))}`
            : `    Memory: ${parts.join(', ')}`;
        console.log(memLine);
    }

    /**
     * Reports results for multiple suites
     *
     * @param suites - Map of suite names to results
     */
    reportAll(suites: { [suiteName: string]: BenchSuiteResult }): void {
        console.log();
        console.log(this.options.colors
            ? bold('='.repeat(80))
            : '='.repeat(80));
        console.log(this.options.colors
            ? bold('                         BENCHMARK RESULTS')
            : '                         BENCHMARK RESULTS');
        console.log(this.options.colors
            ? bold('='.repeat(80))
            : '='.repeat(80));

        for (const [suiteName, results] of Object.entries(suites)) {
            this.reportSuite(suiteName, results);
        }
    }

    /**
     * Prints a summary table of all suites
     *
     * @param suites - Map of suite names to results
     */
    printSummary(suites: { [suiteName: string]: BenchSuiteResult }): void {
        console.log();
        console.log(this.options.colors ? bold('Summary:') : 'Summary:');
        this.printSeparator('=');

        for (const [suiteName, results] of Object.entries(suites)) {
            const entries = Object.entries(results).map(([name, result]) => ({
                name,
                ...result,
            }));
            entries.sort((a, b) => b.hz - a.hz);

            const fastest = entries[0];
            const slowest = entries[entries.length - 1];

            console.log(`  ${this.options.colors ? cyan(suiteName) : suiteName}`);
            console.log(`    Fastest: ${this.options.colors ? green(fastest.name) : fastest.name} (${formatHz(fastest.hz)} ops/sec)`);
            console.log(`    Slowest: ${this.options.colors ? red(slowest.name) : slowest.name} (${formatHz(slowest.hz)} ops/sec)`);
            console.log(`    Difference: ${(fastest.hz / slowest.hz).toFixed(2)}x`);
            console.log();
        }
    }
}

/**
 * Creates a simple console reporter and reports results
 */
export function reportToConsole(
    suiteName: string,
    results: BenchSuiteResult,
    options?: ConsoleReporterOptions
): void {
    const reporter = new ConsoleReporter(options);
    reporter.reportSuite(suiteName, results);
}

/**
 * Creates a simple console reporter and reports all suites
 */
export function reportAllToConsole(
    suites: { [suiteName: string]: BenchSuiteResult },
    options?: ConsoleReporterOptions
): void {
    const reporter = new ConsoleReporter(options);
    reporter.reportAll(suites);
}
