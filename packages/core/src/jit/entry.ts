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
 * The entry points: `fn`, `fnJIT`, `fnJITTop`, `fnExec`. Each runs a declaration through a
 * `Builder` and decides which mode runs the tree it built.
 */
import { Builder, Ref } from './builder.js';
import { CodeGenerator } from './codegen.js';
import { createExecutor } from './exec.js';
import { Block } from './nodes.js';
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
interface FnDefinition {
    block: Block;
    inputNames: string[];
    inputDefaults: unknown[];
    /** The Builder whose body callback this declaration ran in, if any. */
    parent: Builder | null;
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
function declare(args: any[]): FnDefinition {
    const body = args.pop() as (b: Builder, ...inputs: Ref[]) => Ref | void;
    const argCount = args.length;
    const inputNames = args.map((a: Arg<any>, i: number) => a.name || `v${i}`);
    const inputDefaults = args.map((a: Arg<any>) => a.defaultValue);

    const builder = new Builder(argCount);
    const parent = _activeBuilder;
    _activeBuilder = builder;
    let result: Ref | void;
    try {
        result = body(builder, ...Array.from({ length: argCount }, (_, i) => builder.input(i)));
    } finally {
        _activeBuilder = parent;
    }
    return { block: builder.build(result || undefined), inputNames, inputDefaults, parent };
}

function compileDefinition<R>(def: FnDefinition): (...args: any[]) => R {
    const gen = new CodeGenerator(def.inputNames.length, def.inputNames, undefined, def.inputDefaults);
    return gen.compile<(...args: any[]) => R>(def.block);
}

function interpretDefinition<R>(def: FnDefinition): (...args: any[]) => R {
    return createExecutor<R>(def.block, def.inputDefaults);
}

/**
 * Build a function using the unified expression tree.
 *
 * Where code generation is allowed the function is compiled — at once by default, or, when a
 * threshold is set ({@link setJitThreshold}, `DEEPKIT_JIT_THRESHOLD`), interpreted for its first
 * calls and compiled when it reaches the threshold. Where `new Function` is blocked (a strict
 * CSP), or the mode is `'interpreted'` ({@link JitMode}), it is always interpreted.
 */
export function fn<R>(...args: any[]): (...args: any[]) => R {
    const def = declare(args);

    // If called inside another fn()/fnJIT(), register as nested function definition
    if (def.parent) {
        return def.parent.registerNestedFn(def.block, def.inputNames, def.inputDefaults) as any;
    }

    // Code generation is blocked, or the mode says interpret.
    if (!compilesFunctions()) {
        return interpretDefinition<R>(def);
    }

    // Immediate JIT if threshold is 0
    if (jitThreshold === 0) {
        return compileDefinition<R>(def);
    }

    // Tiered execution: interpret first, compile once the threshold is reached
    let callCount = 0;
    let compiledFn: ((...args: any[]) => R) | null = null;
    const executor = interpretDefinition<R>(def);

    return ((...runtimeArgs: any[]) => {
        if (compiledFn) {
            return compiledFn(...runtimeArgs);
        }

        callCount++;

        if (callCount >= jitThreshold) {
            compiledFn = compileDefinition<R>(def);
            return compiledFn(...runtimeArgs);
        }

        return executor(...runtimeArgs);
    }) as any;
}

/**
 * Force immediate JIT compilation, bypassing tiered execution.
 *
 * WARNING: This will throw in CSP environments where `new Function()` is blocked.
 */
export function fnJIT<R>(...args: any[]): (...args: any[]) => R {
    const def = declare(args);

    // If called inside another fn()/fnJIT(), register as nested function definition
    if (def.parent) {
        return def.parent.registerNestedFn(def.block, def.inputNames, def.inputDefaults) as any;
    }

    return compileDefinition<R>(def);
}

/**
 * Force a separate JIT compilation unit, even when called inside another fn()/fnJIT().
 * Use this when a large function would poison V8 optimization of sibling functions
 * in the same compilation unit.
 */
export function fnJITTop<R>(...args: any[]): (...args: any[]) => R {
    // Never registered as nested: the enclosing declaration, if any, is ignored.
    const def = declare(args);

    // CSP environment: compilation units don't exist in exec mode, so the
    // isolation this function provides is moot — fall back like fn() does.
    if (!compilesFunctions()) {
        return interpretDefinition<R>(def);
    }

    return compileDefinition<R>(def);
}

/**
 * Force Exec mode using closure-based compilation.
 * This compiles the expression tree to nested closures at build time,
 * eliminating switch statements and object lookups at runtime.
 * @internal
 */
export function fnExec<R>(...args: any[]): (...args: any[]) => R {
    // Never registered as nested, like fnJITTop: the point is that THIS function is interpreted.
    // The functions declared inside its body are its nested functions, and so interpreted too.
    return interpretDefinition<R>(declare(args));
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
