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
 * The entry points: `fn`, `fnJIT`, `fnJITTop`, `fnExec`, and the async twin of each. Each runs a
 * declaration through a `Builder` and decides which mode runs the tree it built.
 */
import { Builder, Ref } from './builder.js';
import { CodeGenerator } from './codegen.js';
import { createExecutor } from './exec.js';
import { NestedFnDef } from './nodes.js';
import { compilesFunctions, jitThreshold } from './runtime.js';

// ============================================================================
// Public API
// ============================================================================

/**
 * Active parent builder context. When set, fn()/fnJIT() calls register as
 * nested function definitions in the parent instead of creating separate
 * new Function() compilation units. This enables V8 to inline nested functions.
 */
let _activeBuilder: Builder | null = null;

/**
 * Whether a function is being declared right now: the call is made inside the body callback of
 * `fn()` or one of its siblings.
 *
 * It matters to code that asks for OTHER generated functions — a converter, a validator of
 * `@deepkit/type`: built during a declaration, such a function becomes a nested function of that
 * declaration, and whoever else holds it (a cache per type) holds a marker. That works, and costs
 * every later caller the marker's indirection. A builder that needs such functions gets them
 * first and declares afterwards, and can refuse to be called the wrong way round with this.
 */
export function isDeclaring(): boolean {
    return _activeBuilder !== null;
}

/** Marker type for function arguments */
export type Arg<T> = { __brand: 'arg'; __type?: T; name?: string; defaultValue?: T };

/**
 * Declare a function argument with its type and optional name. A `defaultValue` is what the
 * argument is when the caller leaves it out or passes `undefined` — in every execution mode.
 * It is the value itself, not an expression evaluated per call: a default that is an object is
 * the same object in every call.
 */
export function arg<T>(name?: string, defaultValue?: T): Arg<T> {
    return { __brand: 'arg', name, defaultValue } as Arg<T>;
}

/** A function as its declaration built it: the tree, and what its arguments are called and default to. */
interface FnDefinition extends NestedFnDef {
    /** The Builder whose body callback this declaration ran in, if any. */
    readonly parent: Builder | null;
}

/**
 * Run a declaration's body callback and return the tree it built. Every entry point starts here,
 * so they cannot disagree on what a declaration means.
 *
 * While the callback runs this declaration is the active one: an `fn()` / `fnJIT()` called inside
 * it becomes its nested function. The previous one is restored however the callback ends — a
 * callback that throws must not leave a dead Builder active, or every function declared afterwards
 * would be taken for its nested function and run interpreted.
 */
function declare(args: any[], isAsync: boolean): FnDefinition {
    const body = args.pop() as (b: Builder, ...inputs: Ref[]) => Ref | void;
    const argCount = args.length;
    const inputNames = args.map((a: Arg<any>, i: number) => a.name || `v${i}`);
    const inputDefaults = args.map((a: Arg<any>) => a.defaultValue);

    const builder = new Builder(argCount, { async: isAsync });
    const parent = _activeBuilder;
    _activeBuilder = builder;
    let result: Ref | void;
    try {
        result = body(builder, ...Array.from({ length: argCount }, (_, i) => builder.input(i)));
    } finally {
        _activeBuilder = parent;
    }
    return { block: builder.build(result || undefined), inputNames, inputDefaults, async: isAsync, parent };
}

type Compiled<R> = (...args: any[]) => R;

function compileDefinition<R>(def: NestedFnDef): Compiled<R> {
    const gen = new CodeGenerator(def.inputNames.length, def.inputNames, undefined, def.inputDefaults, def.async);
    return gen.compile<Compiled<R>>(def.block);
}

function interpretDefinition<R>(def: NestedFnDef): Compiled<R> {
    return createExecutor<R>(def.block, def.inputDefaults, def.async);
}

/**
 * Tiered execution: `interpreted` for the first calls, the compiled function from the call that
 * reaches the threshold on ({@link setJitThreshold}, `DEEPKIT_JIT_THRESHOLD`). With a threshold of
 * 0 or 1 the first call compiles; with `Infinity` none does. The threshold is read per call.
 */
function tiered<R>(def: NestedFnDef, interpreted: Compiled<R>): Compiled<R> {
    let compiled: Compiled<R> | undefined;
    let calls = 0;
    return (...args: any[]) => {
        if (compiled) return compiled(...args);
        if (++calls < jitThreshold) return interpreted(...args);
        compiled = compileDefinition<R>(def);
        return compiled(...args);
    };
}

/**
 * What stands, in the enclosing function's tree, for a function declared inside its declaration:
 * the marker. Who calls it decides how it runs:
 *
 *  - generated code never calls it: the generator sees `__nestedFnId` and emits a call to
 *    `_nfn_<id>`, compiled in the same unit (`__nestedFnDef` travels with the marker so that a
 *    unit which did not register it — a sub-function cached per type and reused — can still
 *    emit it);
 *  - the interpreter calls `__nestedFnExecutor`, the interpreted body (`interpretedValue`);
 *  - PLAIN JAVASCRIPT — a closure, a cache, a handle that holds it — calls the marker itself.
 *
 * Until 2026-11-16 the marker WAS the interpreted body, so a marker that some plain JavaScript
 * called ran interpreted in a process that compiles, with nothing to say so — a BSON decode 50x
 * slower than the same rows on a compiled path. Where functions are compiled, the first call from
 * plain JavaScript now compiles the definition as a unit of its own, after the threshold's
 * interpreted calls when one is set ({@link tiered}). Where they are not (a strict CSP, the
 * `'interpreted'` mode), the marker is the interpreted body, as it has to be. The mode is read
 * when the function is built.
 *
 * A function that is MEANT to be called from plain JavaScript is better built with
 * {@link fnJITTop}: it is compiled at once, and called without the argument spread this pays.
 */
function nestedFunction<R>(parent: Builder, def: NestedFnDef): Compiled<R> {
    const id = parent.registerNestedFn(def);
    const executor = interpretDefinition<R>(def);
    const marker: any = compilesFunctions() ? tiered<R>(def, executor) : executor;
    marker.__nestedFnId = id;
    marker.__nestedFnDef = def;
    marker.__nestedFnExecutor = executor;
    return marker;
}

/**
 * What the entry points differ in — the whole of it. Everything else they do is {@link define}.
 */
interface Policy {
    /** Inside another function's declaration, the function becomes that one's nested function. */
    readonly nests: boolean;
    /**
     * `'chosen'`: compiled where functions are compiled ({@link compilesFunctions}: the environment
     * allows it and the mode does not forbid it), interpreted where they are not.
     * `'compiled'`: compiled, whatever the mode says — it throws where code generation is blocked.
     * `'interpreted'`: interpreted, always.
     */
    readonly runs: 'chosen' | 'compiled' | 'interpreted';
    /** A compiled function is interpreted for its first calls when a threshold is set. */
    readonly tiers: boolean;
}

const POLICIES = {
    fn: { nests: true, runs: 'chosen', tiers: true },
    fnJIT: { nests: true, runs: 'compiled', tiers: false },
    fnJITTop: { nests: false, runs: 'chosen', tiers: false },
    fnExec: { nests: false, runs: 'interpreted', tiers: false },
} satisfies Record<string, Policy>;

/** Every entry point: run the declaration, then let the policy say what the tree becomes. */
function define<R>(policy: Policy, args: any[], isAsync = false): Compiled<R> {
    const def = declare(args, isAsync);
    if (policy.nests && def.parent) return nestedFunction<R>(def.parent, def);
    if (policy.runs === 'interpreted' || (policy.runs === 'chosen' && !compilesFunctions())) {
        return interpretDefinition<R>(def);
    }
    if (policy.tiers && jitThreshold !== 0) return tiered<R>(def, interpretDefinition<R>(def));
    return compileDefinition<R>(def);
}

/**
 * Build a function using the unified expression tree.
 *
 * Where code generation is allowed the function is compiled — at once by default, or, when a
 * threshold is set ({@link setJitThreshold}, `DEEPKIT_JIT_THRESHOLD`), interpreted for its first
 * calls and compiled when it reaches the threshold. Where `new Function` is blocked (a strict
 * CSP), or the mode is `'interpreted'` ({@link JitMode}), it is always interpreted.
 *
 * Called inside another function's declaration, it is that function's nested function.
 */
export function fn<R>(...args: any[]): (...args: any[]) => R {
    return define<R>(POLICIES.fn, args);
}

/**
 * Force immediate JIT compilation, bypassing tiered execution and the mode.
 *
 * WARNING: This will throw in CSP environments where `new Function()` is blocked.
 *
 * Called inside another function's declaration, it is that function's nested function, as with
 * {@link fn} — and runs as the enclosing function does.
 */
export function fnJIT<R>(...args: any[]): (...args: any[]) => R {
    return define<R>(POLICIES.fnJIT, args);
}

/**
 * Force a separate JIT compilation unit, even when called inside another fn()/fnJIT(): the
 * enclosing declaration, if any, is ignored. Use this when a large function would poison V8
 * optimization of sibling functions in the same compilation unit, or for a function that plain
 * JavaScript will call.
 *
 * Where functions are not compiled (a strict CSP, the `'interpreted'` mode) there are no
 * compilation units to keep apart, and the function is interpreted like any other.
 */
export function fnJITTop<R>(...args: any[]): (...args: any[]) => R {
    return define<R>(POLICIES.fnJITTop, args);
}

/**
 * Force Exec mode using closure-based compilation.
 * This compiles the expression tree to nested closures at build time,
 * eliminating switch statements and object lookups at runtime.
 *
 * Never a nested function, like {@link fnJITTop}: the point is that THIS function is
 * interpreted. The functions declared inside its body are its nested functions, and so
 * interpreted too.
 * @internal
 */
export function fnExec<R>(...args: any[]): (...args: any[]) => R {
    return define<R>(POLICIES.fnExec, args);
}

// ============================================================================
// Async functions
// ============================================================================
//
// An async function answers a promise and its statements may wait (`Builder.await_()`). Whether a
// function is async is a fact of its DECLARATION, as in JavaScript — a function with no `await`
// in it still answers a promise — so it is said by the entry point, and each of the four has its
// async twin with the same policy.

/**
 * {@link fn}, for an async function: compiled as `async function`, interpreted by closures that
 * wait where the tree does. Called inside another function's declaration, it is that function's
 * nested function — an async one.
 */
export function fnAsync<R>(...args: any[]): (...args: any[]) => Promise<R> {
    return define<Promise<R>>(POLICIES.fn, args, true);
}

/** {@link fnJIT}, for an async function. */
export function fnAsyncJIT<R>(...args: any[]): (...args: any[]) => Promise<R> {
    return define<Promise<R>>(POLICIES.fnJIT, args, true);
}

/** {@link fnJITTop}, for an async function. */
export function fnAsyncJITTop<R>(...args: any[]): (...args: any[]) => Promise<R> {
    return define<Promise<R>>(POLICIES.fnJITTop, args, true);
}

/**
 * {@link fnExec}, for an async function.
 * @internal
 */
export function fnAsyncExec<R>(...args: any[]): (...args: any[]) => Promise<R> {
    return define<Promise<R>>(POLICIES.fnExec, args, true);
}

// ============================================================================
// Compatibility Layer (for tests using old API)
// ============================================================================

/**
 * @deprecated Use the direct exports (fn, fnJIT, fnExec, etc.) instead.
 * This namespace is provided for backward compatibility with tests.
 */
export const jit = {
    fn,
    fnJIT,
    fnExec,
    arg,
};

// Default export
export { fn as default };
