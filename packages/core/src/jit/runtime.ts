/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

/*
 * What the environment allows and how the JIT is configured: whether code can be generated at all
 * (`canJIT`), the mode switch, the threshold of tiered execution, the debug flag.
 *
 * `jitThreshold` and `jitDebug` are exported as live bindings for the other modules of this folder
 * to READ; they are written only here, by their setters, and are not part of the package surface
 * (`index.ts` lists what is).
 */

// ============================================================================
// Runtime Detection
// ============================================================================

export interface RuntimeCapabilities {
    newFunction: boolean;
    runtime: 'node' | 'deno' | 'bun' | 'cloudflare' | 'browser' | 'unknown';
}

let _capabilities: RuntimeCapabilities | undefined;

function detectNewFunction(): boolean {
    try {
        new Function('return true')();
        return true;
    } catch {
        return false;
    }
}

function detectRuntime(): RuntimeCapabilities['runtime'] {
    if (typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process.versions?.node) return 'node';
    if (typeof (globalThis as any).Deno !== 'undefined') return 'deno';
    if (typeof (globalThis as any).Bun !== 'undefined') return 'bun';
    const nav = (globalThis as any).navigator;
    if (typeof nav !== 'undefined') {
        if (nav.userAgent?.includes('Cloudflare-Workers')) return 'cloudflare';
        return 'browser';
    }
    return 'unknown';
}

export function getRuntimeCapabilities(): RuntimeCapabilities {
    if (_capabilities) return _capabilities;
    _capabilities = {
        newFunction: detectNewFunction(),
        runtime: detectRuntime(),
    };
    return _capabilities;
}

export const canJIT = detectNewFunction();

// ============================================================================
// Configuration
// ============================================================================

export let jitThreshold = (() => {
    if (typeof process !== 'undefined' && process.env?.DEEPKIT_JIT_THRESHOLD) {
        const val = process.env.DEEPKIT_JIT_THRESHOLD;
        if (val === 'Infinity') return Infinity;
        const num = parseInt(val, 10);
        if (!isNaN(num)) return num;
    }
    return 0;
})();

export let jitDebug = false;

/**
 * Which way a function is run when the entry point has a choice ({@link fn}, {@link fnJITTop}).
 *
 * - `'auto'` (the default): compiled where the environment allows code generation
 *   ({@link canJIT}), interpreted where it does not (a strict CSP).
 * - `'interpreted'`: interpreted, as in such an environment, although this one could compile.
 *
 * `'interpreted'` exists for TESTS: the interpreter is what a browser under a strict CSP runs, and
 * a suite that only ever compiles never executes it. Blocking code generation for a whole process
 * (`--disallow-code-generation-from-strings`) does the same and more — it also stops everything
 * else that builds code from a string (`CompilerContext`, a benchmark harness, a test's own
 * tooling) — so a suite that needs those beside it uses this switch instead.
 *
 * It decides when a function is BUILT; functions are cached per type, so set it before the first
 * one: `DEEPKIT_JIT_MODE=interpreted` in the environment, or {@link setJitMode} at the top of a
 * test setup. {@link fnJIT} is an explicit request to compile and ignores it — no shipped
 * package calls it. There is no `'compiled'` mode to force: where code generation is blocked
 * nothing can.
 */
export type JitMode = 'auto' | 'interpreted';

const JIT_MODES: readonly JitMode[] = ['auto', 'interpreted'];

function jitModeOf(value: string, source: string): JitMode {
    const mode = JIT_MODES.find(candidate => candidate === value);
    // A misspelt mode must not quietly run the suite compiled and report the interpreter tested.
    if (!mode)
        throw new TypeError(
            `${source}: unknown JIT mode ${JSON.stringify(value)} (expected ${JIT_MODES.map(m => `'${m}'`).join(' or ')})`,
        );
    return mode;
}

let jitMode: JitMode = (() => {
    const fromEnv = typeof process !== 'undefined' ? process.env?.DEEPKIT_JIT_MODE : undefined;
    return fromEnv ? jitModeOf(fromEnv, 'DEEPKIT_JIT_MODE') : 'auto';
})();

export function setJitMode(mode: JitMode): void {
    jitMode = jitModeOf(mode, 'setJitMode');
}

export function getJitMode(): JitMode {
    return jitMode;
}

/** Whether a function built NOW is compiled: the environment allows it and the mode does not forbid it. */
export function compilesFunctions(): boolean {
    return canJIT && jitMode !== 'interpreted';
}

export function setJitThreshold(threshold: number): void {
    jitThreshold = threshold;
}

export function setJitDebug(debug: boolean): void {
    jitDebug = debug;
}

export function getJitThreshold(): number {
    return jitThreshold;
}
