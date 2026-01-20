/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

/**
 * Unified JIT function builder API that supports both JIT compilation and
 * direct execution for CSP-restricted environments.
 *
 * @example
 * ```typescript
 * import { jit } from '@deepkit/core';
 *
 * const serialize = jit.fn(jit.arg<User>(), (ctx, input) => {
 *     const output = ctx.obj();
 *     ctx.set(output, 'name', ctx.get(input, 'name'));
 *     return output;
 * });
 * ```
 *
 * In JIT mode (Node.js, Deno, Bun): Compiles to optimized `new Function()` code
 * In Exec mode (Cloudflare Workers, CSP): Runs callback directly with actual values
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Opaque Slot type - at runtime it's either:
 * - JIT mode: number (slot index for code generation)
 * - Exec mode: actual value T (direct value flow)
 */
declare const SlotBrand: unique symbol;
export type Slot<T = any> = (number | T) & { [SlotBrand]: T };

/**
 * Marker type for function arguments declared with jit.arg()
 */
export type Arg<T> = { __brand: 'arg'; __type?: T };

/**
 * Context interface for building JIT functions.
 * All primitives are methods on the context passed to your callback.
 */
export interface Context {
    // Create values
    obj<T>(): Slot<T>;
    objFrom<T>(entries: Array<[string | Slot<string>, Slot]>): Slot<T>;
    arr<T>(): Slot<T[]>;
    lit<T>(value: T): Slot<T>;

    // Property access
    get<T>(target: Slot, key: string | Slot<string>): Slot<T>;
    set(target: Slot, key: string | Slot<string>, value: Slot): void;
    at<T>(arr: Slot, index: Slot<number>): Slot<T>;
    has(target: Slot, key: string | Slot<string>): Slot<boolean>;

    // Array operations
    push(arr: Slot, value: Slot): void;
    len(target: Slot): Slot<number>;

    // Equality
    eq(a: Slot, b: Slot): Slot<boolean>;
    neq(a: Slot, b: Slot): Slot<boolean>;

    // Comparison
    lt(a: Slot, b: Slot): Slot<boolean>;
    gt(a: Slot, b: Slot): Slot<boolean>;
    lte(a: Slot, b: Slot): Slot<boolean>;
    gte(a: Slot, b: Slot): Slot<boolean>;

    // Logical
    not(a: Slot): Slot<boolean>;
    and(a: Slot, b: Slot): Slot<boolean>;
    or(a: Slot, b: Slot): Slot<boolean>;

    // Type checks
    isType(value: Slot, type: string): Slot<boolean>;
    isNull(value: Slot): Slot<boolean>;
    isNullish(value: Slot): Slot<boolean>;

    // Calls (escape hatch for everything else)
    call<T>(fn: Function, ...args: Slot[]): Slot<T>;
    new_<T>(ctor: new (...args: any[]) => T, ...args: Slot[]): Slot<T>;

    // Control flow
    loop(arr: Slot, fn: (elem: Slot, idx: Slot) => void): void;
    when(cond: Slot<boolean>, then: () => Slot | void, else_?: () => Slot | void): void;
}

// ============================================================================
// Helpers
// ============================================================================

const identifierRegex = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Check if a string is a valid JavaScript identifier (can use dot notation).
 */
function isValidIdentifier(key: string): boolean {
    return identifierRegex.test(key);
}

// ============================================================================
// Runtime Detection
// ============================================================================

export interface RuntimeCapabilities {
    newFunction: boolean;
    runtime: 'node' | 'deno' | 'bun' | 'cloudflare' | 'browser' | 'unknown';
    trustedTypes: boolean;
    webAssembly: boolean;
}

let _capabilities: RuntimeCapabilities | undefined;

export function getRuntimeCapabilities(): RuntimeCapabilities {
    if (_capabilities) return _capabilities;

    _capabilities = {
        newFunction: detectNewFunction(),
        runtime: detectRuntime(),
        trustedTypes: typeof (globalThis as any).trustedTypes !== 'undefined',
        webAssembly: typeof (globalThis as any).WebAssembly !== 'undefined',
    };

    return _capabilities;
}

function detectNewFunction(): boolean {
    try {
        new Function('return true')();
        return true;
    } catch {
        return false;
    }
}

function detectRuntime(): RuntimeCapabilities['runtime'] {
    // Check for specific runtimes
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

/**
 * Returns true if JIT compilation via `new Function()` is available.
 * Cached at module load time.
 */
export const canJIT = detectNewFunction();

// ============================================================================
// JITContext - Code Generation Mode
// ============================================================================

/**
 * JIT context that accumulates code strings and compiles them with `new Function()`.
 * Used when `canJIT` is true (Node.js, Deno, Bun, browsers without strict CSP).
 */
export class JITContext implements Context {
    private code = '';
    private slot = 0;
    private externs: any[] = [];
    private argCount: number;

    constructor(argCount: number) {
        this.argCount = argCount;
        this.slot = argCount; // Args occupy first slots (s0, s1, ...)
    }

    getArgSlots(): Slot[] {
        return Array.from({ length: this.argCount }, (_, i) => i as Slot);
    }

    private nextSlot(): number {
        return this.slot++;
    }

    // Create
    obj<T>(): Slot<T> {
        const s = this.nextSlot();
        this.code += `var s${s}={};\n`;
        return s as Slot<T>;
    }

    objFrom<T>(entries: Array<[string | Slot<string>, Slot]>): Slot<T> {
        const s = this.nextSlot();
        const props: string[] = [];
        for (const [key, value] of entries) {
            if (typeof key === 'string') {
                if (isValidIdentifier(key)) {
                    props.push(`${key}:s${value}`);
                } else {
                    props.push(`${JSON.stringify(key)}:s${value}`);
                }
            } else {
                props.push(`[s${key}]:s${value}`);
            }
        }
        this.code += `var s${s}={${props.join(',')}};\n`;
        return s as Slot<T>;
    }

    arr<T>(): Slot<T[]> {
        const s = this.nextSlot();
        this.code += `var s${s}=[];\n`;
        return s as Slot<T[]>;
    }

    lit<T>(value: T): Slot<T> {
        const s = this.nextSlot();
        const extIdx = this.externs.push(value) - 1;
        this.code += `var s${s}=e[${extIdx}];\n`;
        return s as Slot<T>;
    }

    // Access
    get<T>(target: Slot, key: string | Slot<string>): Slot<T> {
        const s = this.nextSlot();
        if (typeof key === 'string') {
            if (isValidIdentifier(key)) {
                this.code += `var s${s}=s${target}.${key};\n`;
            } else {
                this.code += `var s${s}=s${target}[${JSON.stringify(key)}];\n`;
            }
        } else {
            this.code += `var s${s}=s${target}[s${key}];\n`;
        }
        return s as Slot<T>;
    }

    set(target: Slot, key: string | Slot<string>, value: Slot): void {
        if (typeof key === 'string') {
            if (isValidIdentifier(key)) {
                this.code += `s${target}.${key}=s${value};\n`;
            } else {
                this.code += `s${target}[${JSON.stringify(key)}]=s${value};\n`;
            }
        } else {
            this.code += `s${target}[s${key}]=s${value};\n`;
        }
    }

    at<T>(arr: Slot, index: Slot<number>): Slot<T> {
        const s = this.nextSlot();
        // Always treat index as a slot reference in JIT mode
        this.code += `var s${s}=s${arr}[s${index}];\n`;
        return s as Slot<T>;
    }

    has(target: Slot, key: string | Slot<string>): Slot<boolean> {
        const s = this.nextSlot();
        const k = typeof key === 'string' ? JSON.stringify(key) : `s${key}`;
        this.code += `var s${s}=${k} in s${target};\n`;
        return s as Slot<boolean>;
    }

    // Array
    push(arr: Slot, value: Slot): void {
        this.code += `s${arr}.push(s${value});\n`;
    }

    len(target: Slot): Slot<number> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${target}.length;\n`;
        return s as Slot<number>;
    }

    // Equality
    eq(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}===s${b};\n`;
        return s as Slot<boolean>;
    }

    neq(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}!==s${b};\n`;
        return s as Slot<boolean>;
    }

    // Comparison
    lt(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}<s${b};\n`;
        return s as Slot<boolean>;
    }

    gt(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}>s${b};\n`;
        return s as Slot<boolean>;
    }

    lte(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}<=s${b};\n`;
        return s as Slot<boolean>;
    }

    gte(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}>=s${b};\n`;
        return s as Slot<boolean>;
    }

    // Logical
    not(a: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=!s${a};\n`;
        return s as Slot<boolean>;
    }

    and(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}&&s${b};\n`;
        return s as Slot<boolean>;
    }

    or(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}||s${b};\n`;
        return s as Slot<boolean>;
    }

    // Type checks
    isType(value: Slot, type: string): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=typeof s${value}===${JSON.stringify(type)};\n`;
        return s as Slot<boolean>;
    }

    isNull(value: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${value}===null;\n`;
        return s as Slot<boolean>;
    }

    isNullish(value: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${value}==null;\n`;
        return s as Slot<boolean>;
    }

    // Calls
    call<T>(fn: Function, ...args: Slot[]): Slot<T> {
        const s = this.nextSlot();
        const extIdx = this.externs.push(fn) - 1;
        const argsCode = args.map(a => `s${a}`).join(',');
        this.code += `var s${s}=e[${extIdx}](${argsCode});\n`;
        return s as Slot<T>;
    }

    new_<T>(ctor: new (...args: any[]) => T, ...args: Slot[]): Slot<T> {
        const s = this.nextSlot();
        const extIdx = this.externs.push(ctor) - 1;
        const argsCode = args.map(a => `s${a}`).join(',');
        this.code += `var s${s}=new e[${extIdx}](${argsCode});\n`;
        return s as Slot<T>;
    }

    // Control flow
    when(cond: Slot<boolean>, then: () => Slot | void, else_?: () => Slot | void): void {
        this.code += `if(s${cond}){\n`;
        const thenResult = then();
        if (thenResult !== undefined) {
            this.code += `return s${thenResult};\n`;
        }
        if (else_) {
            this.code += `}else{\n`;
            const elseResult = else_();
            if (elseResult !== undefined) {
                this.code += `return s${elseResult};\n`;
            }
        }
        this.code += `}\n`;
    }

    loop(arr: Slot, fn: (elem: Slot, idx: Slot) => void): void {
        const idx = this.nextSlot();
        const elem = this.nextSlot();
        this.code += `for(var s${idx}=0;s${idx}<s${arr}.length;s${idx}++){\n`;
        this.code += `var s${elem}=s${arr}[s${idx}];\n`;
        fn(elem as Slot, idx as Slot);
        this.code += `}\n`;
    }

    compile<T extends Function>(returnSlot?: Slot): T {
        if (returnSlot !== undefined) {
            this.code += `return s${returnSlot};\n`;
        }
        const argNames = Array.from({ length: this.argCount }, (_, i) => `s${i}`).join(',');
        const fn = new Function('e', `'use strict';return function(${argNames}){'use strict';\n${this.code}}`);
        return fn(this.externs) as T;
    }

    /**
     * Returns the generated code for debugging purposes.
     */
    getCode(): string {
        return this.code;
    }
}

// ============================================================================
// ExecContext - Direct Execution Mode
// ============================================================================

/**
 * Exec context that executes operations directly with actual values.
 * Used when `canJIT` is false (Cloudflare Workers, browsers with strict CSP).
 * Provides full debuggability - breakpoints work, stack traces are real.
 */
export class ExecContext implements Context {
    hasEarlyReturn = false;
    earlyReturnValue: any;

    // Create
    obj<T>(): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        return {} as Slot<T>;
    }

    objFrom<T>(entries: Array<[string | Slot<string>, Slot]>): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        const result: any = {};
        for (const [key, value] of entries) {
            const k = typeof key === 'string' ? key : (key as unknown as string);
            result[k] = value;
        }
        return result as Slot<T>;
    }

    arr<T>(): Slot<T[]> {
        if (this.hasEarlyReturn) return undefined as any;
        return [] as unknown as Slot<T[]>;
    }

    lit<T>(value: T): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        return value as Slot<T>;
    }

    // Access
    get<T>(target: Slot, key: string | Slot<string>): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        const k = typeof key === 'string' ? key : (key as unknown as string);
        return (target as any)[k] as Slot<T>;
    }

    set(target: Slot, key: string | Slot<string>, value: Slot): void {
        if (this.hasEarlyReturn) return;
        const k = typeof key === 'string' ? key : (key as unknown as string);
        (target as any)[k] = value;
    }

    at<T>(arr: Slot, index: Slot<number>): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        // In exec mode, index IS the actual number value
        return (arr as any)[index as unknown as number] as Slot<T>;
    }

    has(target: Slot, key: string | Slot<string>): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        const k = typeof key === 'string' ? key : (key as unknown as string);
        return (k in (target as any)) as Slot<boolean>;
    }

    // Array
    push(arr: Slot, value: Slot): void {
        if (this.hasEarlyReturn) return;
        (arr as any).push(value);
    }

    len(target: Slot): Slot<number> {
        if (this.hasEarlyReturn) return undefined as any;
        return (target as any).length as Slot<number>;
    }

    // Equality
    eq(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return (a === b) as Slot<boolean>;
    }

    neq(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return (a !== b) as Slot<boolean>;
    }

    // Comparison
    lt(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return ((a as any) < (b as any)) as Slot<boolean>;
    }

    gt(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return ((a as any) > (b as any)) as Slot<boolean>;
    }

    lte(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return ((a as any) <= (b as any)) as Slot<boolean>;
    }

    gte(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return ((a as any) >= (b as any)) as Slot<boolean>;
    }

    // Logical
    not(a: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return !a as Slot<boolean>;
    }

    and(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return (a && b) as Slot<boolean>;
    }

    or(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return (a || b) as Slot<boolean>;
    }

    // Type checks
    isType(value: Slot, type: string): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return (typeof value === type) as Slot<boolean>;
    }

    isNull(v: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return (v === null) as Slot<boolean>;
    }

    isNullish(v: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return (v == null) as Slot<boolean>;
    }

    // Calls
    call<T>(fn: Function, ...args: Slot[]): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        return fn(...args) as Slot<T>;
    }

    new_<T>(ctor: new (...args: any[]) => T, ...args: Slot[]): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ctor(...args) as Slot<T>;
    }

    // Control flow
    when(cond: Slot<boolean>, then: () => Slot | void, else_?: () => Slot | void): void {
        if (this.hasEarlyReturn) return;

        if (cond) {
            const result = then();
            if (result !== undefined) {
                this.hasEarlyReturn = true;
                this.earlyReturnValue = result;
            }
        } else if (else_) {
            const result = else_();
            if (result !== undefined) {
                this.hasEarlyReturn = true;
                this.earlyReturnValue = result;
            }
        }
    }

    loop(arr: Slot, fn: (elem: Slot, idx: Slot) => void): void {
        if (this.hasEarlyReturn) return;
        const array = arr as unknown as any[];
        for (let i = 0; i < array.length; i++) {
            if (this.hasEarlyReturn) break;
            fn(array[i] as Slot, i as Slot);
        }
    }
}

// ============================================================================
// jit Namespace - Public API
// ============================================================================

/**
 * Unified function builder namespace.
 *
 * @example
 * ```typescript
 * // Build a serializer
 * const serialize = jit.fn(jit.arg<User>(), (ctx, input) => {
 *     const output = ctx.obj();
 *     ctx.set(output, 'name', ctx.get(input, 'name'));
 *     ctx.set(output, 'email', ctx.get(input, 'email'));
 *     return output;
 * });
 *
 * // Use it
 * serialize({ name: 'John', email: 'john@example.com' });
 * // Returns: { name: 'John', email: 'john@example.com' }
 * ```
 */
export const jit = {
    /**
     * Declare a function argument with its type.
     * Use this to define the parameters your JIT function will receive.
     *
     * @example
     * ```typescript
     * jit.fn(
     *     jit.arg<User>(),        // First arg: User
     *     jit.arg<number>(),      // Second arg: number
     *     (ctx, user, count) => { ... }
     * );
     * ```
     */
    arg<T>(): Arg<T> {
        return { __brand: 'arg' } as Arg<T>;
    },

    /**
     * Build a function using the unified context API.
     *
     * In JIT mode: Runs callback ONCE to generate code, compiles with `new Function()`.
     * In Exec mode: Re-runs callback each time with actual values.
     *
     * @example
     * ```typescript
     * const fn = jit.fn(jit.arg<any>(), (ctx, input) => {
     *     const output = ctx.obj();
     *     ctx.set(output, 'value', ctx.get(input, 'value'));
     *     return output;
     * });
     * ```
     */
    fn<R>(...args: any[]): (...args: any[]) => R {
        const body = args.pop() as Function;
        const argCount = args.length;

        if (canJIT) {
            // JIT mode: run body ONCE to generate code, then compile
            const ctx = new JITContext(argCount);
            const argSlots = ctx.getArgSlots();
            const returnSlot = body(ctx, ...argSlots);
            return ctx.compile(returnSlot);
        } else {
            // Exec mode: re-run body each time with actual values
            return ((...runtimeArgs: any[]) => {
                const ctx = new ExecContext();
                const returnValue = body(ctx, ...runtimeArgs);
                return ctx.hasEarlyReturn ? ctx.earlyReturnValue : returnValue;
            }) as any;
        }
    },

    /**
     * Force JIT mode (for testing or when you know it's available).
     * Throws if `new Function()` is not available.
     */
    fnJIT<R>(...args: any[]): (...args: any[]) => R {
        const body = args.pop() as Function;
        const argCount = args.length;

        const ctx = new JITContext(argCount);
        const argSlots = ctx.getArgSlots();
        const returnSlot = body(ctx, ...argSlots);
        return ctx.compile(returnSlot);
    },

    /**
     * Force Exec mode (for testing or debugging).
     * Always uses direct execution regardless of `canJIT`.
     */
    fnExec<R>(...args: any[]): (...args: any[]) => R {
        const body = args.pop() as Function;
        const argCount = args.length;

        return ((...runtimeArgs: any[]) => {
            const ctx = new ExecContext();
            const returnValue = body(ctx, ...runtimeArgs);
            return ctx.hasEarlyReturn ? ctx.earlyReturnValue : returnValue;
        }) as any;
    },
};
