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

// Prefix for JIT slot expressions to distinguish from literal strings
const SLOT_PREFIX = '\0$:';

function isSlotExpr(value: unknown): boolean {
    return typeof value === 'string' && (value as string).startsWith(SLOT_PREFIX);
}

function slotExpr(expr: string): string {
    return SLOT_PREFIX + expr;
}

function getExpr(slot: unknown): string {
    const s = slot as string;
    return s.startsWith(SLOT_PREFIX) ? s.slice(SLOT_PREFIX.length) : s;
}

/**
 * JIT context that accumulates code strings and compiles them with `new Function()`.
 * Uses expression strings to avoid unnecessary intermediate variables.
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
        return Array.from({ length: this.argCount }, (_, i) => slotExpr(`s${i}`) as unknown as Slot);
    }

    private nextSlot(): string {
        return `s${this.slot++}`;
    }

    private expr(slot: Slot): string {
        return getExpr(slot);
    }

    private slot_<T>(expr: string): Slot<T> {
        return slotExpr(expr) as unknown as Slot<T>;
    }

    // Create
    obj<T>(): Slot<T> {
        const s = this.nextSlot();
        this.code += `var ${s}={};\n`;
        return this.slot_<T>(s);
    }

    objFrom<T>(entries: Array<[string | Slot<string>, Slot]>): Slot<T> {
        // Returns object literal expression directly - no intermediate variable
        const props: string[] = [];
        for (const [key, value] of entries) {
            const v = this.expr(value);
            // Check if key is a slot (JITExpr) or literal string
            if (isSlotExpr(key)) {
                // Dynamic key - use computed property
                props.push(`[${getExpr(key)}]:${v}`);
            } else if (typeof key === 'string') {
                // Literal string key
                if (isValidIdentifier(key)) {
                    props.push(`${key}:${v}`);
                } else {
                    props.push(`${JSON.stringify(key)}:${v}`);
                }
            }
        }
        return this.slot_<T>(`{${props.join(',')}}`);
    }

    arr<T>(): Slot<T[]> {
        const s = this.nextSlot();
        this.code += `var ${s}=[];\n`;
        return this.slot_<T[]>(s);
    }

    lit<T>(value: T): Slot<T> {
        // For simple primitives, return inline; for complex values, use extern
        if (value === null) return this.slot_<T>('null');
        if (value === undefined) return this.slot_<T>('undefined');
        if (typeof value === 'boolean') return this.slot_<T>(String(value));
        if (typeof value === 'number') {
            if (Number.isNaN(value)) return this.slot_<T>('NaN');
            if (value === Infinity) return this.slot_<T>('Infinity');
            if (value === -Infinity) return this.slot_<T>('-Infinity');
            if (Object.is(value, -0)) return this.slot_<T>('(-0)');
            return this.slot_<T>(String(value));
        }
        if (typeof value === 'string') return this.slot_<T>(JSON.stringify(value));
        // Complex values need extern slot
        const s = this.nextSlot();
        const extIdx = this.externs.push(value) - 1;
        this.code += `var ${s}=e[${extIdx}];\n`;
        return this.slot_<T>(s);
    }

    // Access - returns expression without creating variable
    get<T>(target: Slot, key: string | Slot<string>): Slot<T> {
        const t = this.expr(target);
        if (isSlotExpr(key)) {
            // Dynamic key from slot
            return this.slot_<T>(`${t}[${getExpr(key)}]`);
        } else if (typeof key === 'string') {
            if (isValidIdentifier(key)) {
                return this.slot_<T>(`${t}.${key}`);
            } else {
                return this.slot_<T>(`${t}[${JSON.stringify(key)}]`);
            }
        }
        return this.slot_<T>(`${t}[${this.expr(key)}]`);
    }

    set(target: Slot, key: string | Slot<string>, value: Slot): void {
        const t = this.expr(target);
        const v = this.expr(value);
        if (isSlotExpr(key)) {
            // Dynamic key from slot
            this.code += `${t}[${getExpr(key)}]=${v};\n`;
        } else if (typeof key === 'string') {
            if (isValidIdentifier(key)) {
                this.code += `${t}.${key}=${v};\n`;
            } else {
                this.code += `${t}[${JSON.stringify(key)}]=${v};\n`;
            }
        } else {
            this.code += `${t}[${this.expr(key)}]=${v};\n`;
        }
    }

    at<T>(arr: Slot, index: Slot<number>): Slot<T> {
        // Return expression without creating variable
        return this.slot_<T>(`${this.expr(arr)}[${this.expr(index)}]`);
    }

    has(target: Slot, key: string | Slot<string>): Slot<boolean> {
        const t = this.expr(target);
        if (isSlotExpr(key)) {
            return this.slot_<boolean>(`(${getExpr(key)} in ${t})`);
        }
        const k = typeof key === 'string' ? JSON.stringify(key) : this.expr(key);
        return this.slot_<boolean>(`(${k} in ${t})`);
    }

    // Array
    push(arr: Slot, value: Slot): void {
        this.code += `${this.expr(arr)}.push(${this.expr(value)});\n`;
    }

    len(target: Slot): Slot<number> {
        return this.slot_<number>(`${this.expr(target)}.length`);
    }

    // Equality - return expressions
    eq(a: Slot, b: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(a)}===${this.expr(b)})`);
    }

    neq(a: Slot, b: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(a)}!==${this.expr(b)})`);
    }

    // Comparison - return expressions
    lt(a: Slot, b: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(a)}<${this.expr(b)})`);
    }

    gt(a: Slot, b: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(a)}>${this.expr(b)})`);
    }

    lte(a: Slot, b: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(a)}<=${this.expr(b)})`);
    }

    gte(a: Slot, b: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(a)}>=${this.expr(b)})`);
    }

    // Logical - return expressions
    not(a: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(!${this.expr(a)})`);
    }

    and(a: Slot, b: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(a)}&&${this.expr(b)})`);
    }

    or(a: Slot, b: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(a)}||${this.expr(b)})`);
    }

    // Type checks - return expressions
    isType(value: Slot, type: string): Slot<boolean> {
        return this.slot_<boolean>(`(typeof ${this.expr(value)}===${JSON.stringify(type)})`);
    }

    isNull(value: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(value)}===null)`);
    }

    isNullish(value: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(value)}==null)`);
    }

    // Calls - need slots for results
    call<T>(fn: Function, ...args: Slot[]): Slot<T> {
        const s = this.nextSlot();
        const extIdx = this.externs.push(fn) - 1;
        const argsCode = args.map(a => this.expr(a)).join(',');
        this.code += `var ${s}=e[${extIdx}](${argsCode});\n`;
        return this.slot_<T>(s);
    }

    new_<T>(ctor: new (...args: any[]) => T, ...args: Slot[]): Slot<T> {
        const s = this.nextSlot();
        const extIdx = this.externs.push(ctor) - 1;
        const argsCode = args.map(a => this.expr(a)).join(',');
        this.code += `var ${s}=new e[${extIdx}](${argsCode});\n`;
        return this.slot_<T>(s);
    }

    // Control flow
    when(cond: Slot<boolean>, then: () => Slot | void, else_?: () => Slot | void): void {
        this.code += `if(${this.expr(cond)}){\n`;
        const thenResult = then();
        if (thenResult !== undefined) {
            this.code += `return ${this.expr(thenResult)};\n`;
        }
        if (else_) {
            this.code += `}else{\n`;
            const elseResult = else_();
            if (elseResult !== undefined) {
                this.code += `return ${this.expr(elseResult)};\n`;
            }
        }
        this.code += `}\n`;
    }

    loop(arr: Slot, fn: (elem: Slot, idx: Slot) => void): void {
        const idx = this.nextSlot();
        const elem = this.nextSlot();
        const a = this.expr(arr);
        this.code += `for(var ${idx}=0;${idx}<${a}.length;${idx}++){\n`;
        this.code += `var ${elem}=${a}[${idx}];\n`;
        fn(this.slot_(elem), this.slot_(idx));
        this.code += `}\n`;
    }

    compile<T extends Function>(returnSlot?: Slot): T {
        if (returnSlot !== undefined) {
            this.code += `return ${this.expr(returnSlot)};\n`;
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
