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
 * V8 optimization status flags returned by %GetOptimizationStatus
 */
export interface OptimizationStatus {
    /** The result refers to a JS function */
    function?: true;
    /** The function was never optimized */
    neverOptimised?: true;
    /** The function is always optimized (intrinsic) */
    alwaysOptimised?: true;
    /** The function may have been deoptimized */
    maybeDeoptimized?: true;
    /** The function is currently optimized */
    optimized?: true;
    /** The function was optimized by TurboFan */
    optimizedByTurboFan?: true;
    /** The function is currently interpreted */
    interpreted?: true;
    /** The function is marked for optimization */
    markedForOptimization?: true;
    /** The function is marked for concurrent optimization */
    markedForConcurrentOptimization?: true;
    /** The function is being optimized concurrently */
    optimizingConcurrently?: true;
    /** The function is currently executing */
    executing?: true;
    /** The function has been TurboFanned */
    turboFanned?: true;
    /** Raw binary representation of the status */
    binary: string;
}

/**
 * Memory usage snapshot
 */
export interface MemorySnapshot {
    /** Resident Set Size - total memory allocated for the process */
    rss: number;
    /** Total size of the allocated heap */
    heapTotal: number;
    /** Actual memory used during execution */
    heapUsed: number;
    /** Memory used by C++ objects bound to JavaScript objects */
    external: number;
    /** Memory allocated for ArrayBuffers and SharedArrayBuffers */
    arrayBuffers: number;
}

/**
 * Warms up a function by executing it multiple times.
 * This helps V8 optimize the function before benchmarking.
 *
 * @param cb - The callback function to warm up
 * @param times - Number of iterations (default: 100,000)
 */
export function warmup(cb: () => unknown, times: number = 100_000): void {
    for (let i = 0; i < times; i++) {
        cb();
    }
}

/**
 * Async version of warmup for async functions.
 *
 * @param cb - The async callback function to warm up
 * @param times - Number of iterations (default: 1,000)
 */
export async function warmupAsync(cb: () => Promise<unknown>, times: number = 1_000): Promise<void> {
    for (let i = 0; i < times; i++) {
        await cb();
    }
}

/**
 * Calls a V8 native runtime function.
 * Requires Node.js to be started with --allow-natives-syntax flag.
 *
 * @see https://chromium.googlesource.com/external/v8/+/95fef17346bb1ca4e29e5d28115046f52d78af51/src/runtime/runtime.h
 */
export function NativeRuntimeCall(name: string, ...args: unknown[]): unknown | undefined {
    try {
        const a = args.map((_, i) => 'args[' + i + ']').join(', ');
        // eslint-disable-next-line no-eval
        return eval('%' + name + '(' + a + ')');
    } catch (e) {
        // Native syntax not available - likely --allow-natives-syntax not enabled
        return undefined;
    }
}

/**
 * Checks if an array has fast SMI (Small Integer) elements.
 * SMI arrays are the most optimized in V8.
 */
export function HasFastSmiElements(obj: unknown): boolean | undefined {
    return NativeRuntimeCall('HasFastSmiElements', obj) as boolean | undefined;
}

/**
 * Checks if an array has fast object elements.
 */
export function HasFastObjectElements(obj: unknown): boolean | undefined {
    return NativeRuntimeCall('HasFastObjectElements', obj) as boolean | undefined;
}

/**
 * Checks if an array has fast holey elements (sparse array optimization).
 */
export function HasFastHoleyElements(obj: unknown): boolean | undefined {
    return NativeRuntimeCall('HasFastHoleyElements', obj) as boolean | undefined;
}

/**
 * Checks if an object has fast properties (inline caching optimization).
 */
export function HasFastProperties(obj: unknown): boolean | undefined {
    return NativeRuntimeCall('HasFastProperties', obj) as boolean | undefined;
}

/**
 * Tells V8 to optimize the function on the next call.
 * Useful for forcing optimization before benchmarking.
 */
export function OptimizeFunctionOnNextCall(fn: Function): void {
    NativeRuntimeCall('OptimizeFunctionOnNextCall', fn);
}

/**
 * Prepares a function for optimization by marking it.
 */
export function PrepareFunctionForOptimization(fn: Function): void {
    NativeRuntimeCall('PrepareFunctionForOptimization', fn);
}

/**
 * Gets the V8 optimization status of a function.
 *
 * @see https://gist.github.com/naugtur/4b03a9f9f72346a9f79d7969728a849f
 */
export function GetOptimizationStatus(fn: Function): OptimizationStatus | undefined {
    const status = NativeRuntimeCall('GetOptimizationStatus', fn);
    if (status === undefined) return undefined;

    const statusNum = status as number;
    const res: OptimizationStatus = { binary: statusNum.toString(2).padStart(12, '0') };

    if (statusNum & (1 << 0)) {
        res.function = true;
    }

    if (statusNum & (1 << 1)) {
        res.neverOptimised = true;
    }

    if (statusNum & (1 << 2)) {
        res.alwaysOptimised = true;
    }

    if (statusNum & (1 << 3)) {
        res.maybeDeoptimized = true;
    }

    if (statusNum & (1 << 4)) {
        res.optimized = true;
    }

    if (statusNum & (1 << 5)) {
        res.optimizedByTurboFan = true;
    }

    if (statusNum & (1 << 6)) {
        res.interpreted = true;
    }

    if (statusNum & (1 << 7)) {
        res.markedForOptimization = true;
    }

    if (statusNum & (1 << 8)) {
        res.markedForConcurrentOptimization = true;
    }

    if (statusNum & (1 << 9)) {
        res.optimizingConcurrently = true;
    }

    if (statusNum & (1 << 10)) {
        res.executing = true;
    }

    if (statusNum & (1 << 11)) {
        res.turboFanned = true;
    }

    return res;
}

/**
 * Captures current memory usage.
 */
export function getMemorySnapshot(): MemorySnapshot {
    const usage = process.memoryUsage();
    return {
        rss: usage.rss,
        heapTotal: usage.heapTotal,
        heapUsed: usage.heapUsed,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers,
    };
}

/**
 * Calculates the difference between two memory snapshots.
 */
export function getMemoryDelta(before: MemorySnapshot, after: MemorySnapshot): MemorySnapshot {
    return {
        rss: after.rss - before.rss,
        heapTotal: after.heapTotal - before.heapTotal,
        heapUsed: after.heapUsed - before.heapUsed,
        external: after.external - before.external,
        arrayBuffers: after.arrayBuffers - before.arrayBuffers,
    };
}

/**
 * Formats bytes to a human-readable string.
 */
export function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let value = Math.abs(bytes);

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }

    const sign = bytes < 0 ? '-' : '';
    return `${sign}${value.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Forces garbage collection if available.
 * Requires Node.js to be started with --expose-gc flag.
 */
export function forceGC(): void {
    if (typeof global !== 'undefined' && typeof (global as any).gc === 'function') {
        (global as any).gc();
    }
}

/**
 * Checks if async functions are supported.
 */
export function isAsyncFunction(fn: unknown): fn is (...args: unknown[]) => Promise<unknown> {
    return fn !== null &&
           fn !== undefined &&
           typeof fn === 'function' &&
           fn.constructor.name === 'AsyncFunction';
}
