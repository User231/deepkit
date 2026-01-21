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
 *     return ctx.objFrom({
 *         name: input.get('name'),
 *         email: input.get('email'),
 *     });
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
 * Slot interface with chainable methods for property access.
 * In JIT mode: SlotExpr that builds code strings
 * In Exec mode: ExecSlot that wraps actual values
 */
export interface Slot<T = any> {
    /** Get a property value */
    get<K extends keyof T>(key: K): Slot<T[K]>;
    get(key: string | Slot<string>): Slot<any>;

    /** Get array element by index */
    at(index: number | Slot<number>): Slot<any>;

    /** Get length of array or string */
    len(): Slot<number>;
}

/**
 * Marker type for function arguments declared with jit.arg()
 */
export type Arg<T> = { __brand: 'arg'; __type?: T };

/**
 * Context interface for building JIT functions.
 */
export interface Context {
    // Create values
    obj<T extends object = any>(): Slot<T>;
    objFrom<T extends object = any>(entries: Record<string, Slot> | Array<[string | Slot<string>, Slot]>): Slot<T>;
    arr<T = any>(): Slot<T[]>;
    lit<T>(value: T): Slot<T>;

    // Property access (still available, prefer slot.get())
    get<T>(target: Slot, key: string | Slot<string>): Slot<T>;
    set(target: Slot, key: string | Slot<string>, value: Slot): void;
    at<T>(arr: Slot, index: number | Slot<number>): Slot<T>;
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

    // Calls
    call<T>(fn: Function, ...args: Slot[]): Slot<T>;
    new_<T>(ctor: new (...args: any[]) => T, ...args: Slot[]): Slot<T>;

    // Control flow
    loop(arr: Slot, fn: (elem: Slot, idx: Slot) => void): void;
    map<T>(arr: Slot, fn: (elem: Slot, idx: Slot) => Slot<T>): Slot<T[]>;
    when(cond: Slot<boolean>, then: () => Slot | void, else_?: () => Slot | void): void;

    // Mutable state (for tracking changes across conditionals)
    /**
     * Create a mutable reference cell with an initial value.
     * Returns a slot that can be passed to setVar/getVar.
     * JIT mode: generates `var sN={c:initialValue};`
     * Exec mode: wraps {c: value} in ExecSlot
     */
    var_<T>(initialValue: T | Slot<T>): Slot<{ c: T }>;

    /**
     * Set a mutable reference's value.
     * JIT mode: generates `${slot}.c=${value};`
     * Exec mode: updates slot.value.c
     */
    setVar<T>(ref: Slot<{ c: T }>, value: Slot<T>): void;

    /**
     * Get a mutable reference's current value.
     * JIT mode: returns expression `${slot}.c`
     * Exec mode: returns ExecSlot(slot.value.c)
     */
    getVar<T>(ref: Slot<{ c: T }>): Slot<T>;

    // Switch statement (for type dispatch)
    /**
     * Switch statement with cases.
     * JIT mode: generates `switch(${value}) { case ${literal}: ${code}; break; ... }`
     * Exec mode: executes matching case
     */
    switch_<T>(value: Slot, cases: Array<[any, () => Slot<T> | void]>, defaultCase?: () => Slot<T> | void): void;

    // Ternary expression (inline conditional)
    /**
     * Ternary conditional expression.
     * JIT mode: generates `${cond} ? ${then} : ${else_}`
     * Exec mode: evaluates condition and returns appropriate branch
     */
    ternary<T>(cond: Slot<boolean>, then: Slot<T>, else_: Slot<T>): Slot<T>;

    // Instance check
    /**
     * Check if value is instance of constructor.
     * JIT mode: generates `${value} instanceof ${ctor}`
     * Exec mode: actual instanceof check
     */
    isInstance(value: Slot, ctor: Function): Slot<boolean>;

    // Throw
    /**
     * Throw an error.
     * JIT mode: generates `throw ${error};`
     * Exec mode: throws the unwrapped error value
     */
    throw_(error: Slot): void;

    // Object iteration
    /**
     * Iterate over object's own enumerable properties.
     * JIT mode: generates `for(var k in obj){...}`
     * Exec mode: uses for-in loop directly
     */
    forIn(obj: Slot, fn: (key: Slot<string>, value: Slot) => void): void;

    // Else-if chains
    /**
     * Else-if chain for multiple conditions.
     * JIT mode: generates `if(c1){...}else if(c2){...}else{...}`
     * Exec mode: evaluates conditions in order
     */
    cond(cases: Array<[Slot<boolean>, () => Slot | void]>, else_?: () => Slot | void): void;

    // String concatenation
    /**
     * Concatenate multiple values as strings.
     * JIT mode: generates `a+b+c`
     * Exec mode: concatenates unwrapped values
     */
    concat(...slots: Slot[]): Slot<string>;

    // Typeof
    /**
     * Get the typeof a value as a Slot.
     * JIT mode: generates `typeof ${value}`
     * Exec mode: returns typeof the unwrapped value
     */
    typeof_(value: Slot): Slot<string>;
}

// ============================================================================
// Helpers
// ============================================================================

const identifierRegex = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

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

export const canJIT = detectNewFunction();

// ============================================================================
// SlotExpr - JIT Mode Slot Implementation
// ============================================================================

/**
 * SlotExpr represents a code expression in JIT mode.
 * Has chainable methods for property access that return new SlotExpr instances.
 */
export class SlotExpr<T = any> implements Slot<T> {
    constructor(public readonly e: string) {}

    get(key: string | Slot<string>): Slot<any> {
        if (key instanceof SlotExpr) {
            return new SlotExpr(`${this.e}[${key.e}]`);
        }
        if (typeof key === 'string') {
            if (isValidIdentifier(key)) {
                return new SlotExpr(`${this.e}.${key}`);
            }
            return new SlotExpr(`${this.e}[${JSON.stringify(key)}]`);
        }
        // ExecSlot in mixed scenario - shouldn't happen but handle gracefully
        return new SlotExpr(`${this.e}[${String(key)}]`);
    }

    at(index: number | Slot<number>): Slot<any> {
        if (index instanceof SlotExpr) {
            return new SlotExpr(`${this.e}[${index.e}]`);
        }
        return new SlotExpr(`${this.e}[${index}]`);
    }

    len(): Slot<number> {
        return new SlotExpr(`${this.e}.length`);
    }
}

// ============================================================================
// ExecSlot - Exec Mode Slot Implementation
// ============================================================================

/**
 * ExecSlot wraps an actual value in Exec mode.
 * Has the same chainable methods as SlotExpr but operates on real values.
 */
export class ExecSlot<T = any> implements Slot<T> {
    constructor(public readonly value: T) {}

    get(key: string | Slot<string>): Slot<any> {
        const k = typeof key === 'string' ? key : (key as ExecSlot<string>).value;
        return new ExecSlot((this.value as any)[k]);
    }

    at(index: number | Slot<number>): Slot<any> {
        const i = typeof index === 'number' ? index : (index as ExecSlot<number>).value;
        return new ExecSlot((this.value as any)[i]);
    }

    len(): Slot<number> {
        return new ExecSlot((this.value as any).length);
    }
}

// ============================================================================
// JITContext - Code Generation Mode
// ============================================================================

export class JITContext implements Context {
    private code = '';
    private slot = 0;
    private externs = new Map<string, any>();
    private reservedNames = new Set<string>();
    private variableContext: { [name: string]: any } = {};
    private argCount: number;
    private maxReservedVariable = 10_000;

    constructor(argCount: number) {
        this.argCount = argCount;
        this.slot = argCount;
        // Add variable context for monomorphic undefined values
        this.externs.set('_context', this.variableContext);
    }

    /**
     * Generate a unique variable name based on a prefix.
     * Returns names like: Date_0, Date_1, isNumeric_0, etc.
     */
    private reserveName(name: string): string {
        for (let i = 0; i < this.maxReservedVariable; i++) {
            const candidate = name + '_' + i;
            if (!this.reservedNames.has(candidate)) {
                this.reservedNames.add(candidate);
                return candidate;
            }
        }
        throw new Error(`Too many context variables (max ${this.maxReservedVariable})`);
    }

    /**
     * Add an external value and get its named reference.
     * For undefined values, uses _context.name pattern for monomorphic optimization.
     */
    addExtern(value: any, name: string = 'ext'): string {
        if (value === undefined) {
            // For undefined values, use _context.varName to get monomorphic types
            const freeName = this.reserveName(name);
            return '_context.' + freeName;
        }
        const freeName = this.reserveName(name);
        this.externs.set(freeName, value);
        return freeName;
    }

    getArgSlots(): Slot[] {
        return Array.from({ length: this.argCount }, (_, i) => new SlotExpr(`s${i}`));
    }

    private nextSlot(): string {
        return `s${this.slot++}`;
    }

    private expr(slot: Slot): string {
        if (slot instanceof SlotExpr) return slot.e;
        if (slot instanceof ExecSlot) return String(slot.value);
        return String(slot);
    }

    private slot_<T>(expr: string): Slot<T> {
        return new SlotExpr(expr) as Slot<T>;
    }

    // Create
    obj<T extends object = any>(): Slot<T> {
        const s = this.nextSlot();
        this.code += `var ${s}={};\n`;
        return new SlotExpr(s) as Slot<T>;
    }

    objFrom<T extends object = any>(entries: Record<string, Slot> | Array<[string | Slot<string>, Slot]>): Slot<T> {
        const props: string[] = [];

        if (Array.isArray(entries)) {
            // Array of tuples - supports dynamic keys
            for (const [key, value] of entries) {
                const v = this.expr(value);
                if (key instanceof SlotExpr) {
                    props.push(`[${key.e}]:${v}`);
                } else if (typeof key === 'string') {
                    if (isValidIdentifier(key)) {
                        props.push(`${key}:${v}`);
                    } else {
                        props.push(`${JSON.stringify(key)}:${v}`);
                    }
                }
            }
        } else {
            // Object syntax - static keys only
            for (const [key, value] of Object.entries(entries)) {
                const v = this.expr(value);
                if (isValidIdentifier(key)) {
                    props.push(`${key}:${v}`);
                } else {
                    props.push(`${JSON.stringify(key)}:${v}`);
                }
            }
        }

        return new SlotExpr(`{${props.join(',')}}`) as Slot<T>;
    }

    arr<T = any>(): Slot<T[]> {
        const s = this.nextSlot();
        this.code += `var ${s}=[];\n`;
        return new SlotExpr(s) as Slot<T[]>;
    }

    lit<T>(value: T): Slot<T> {
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
        // Complex values use named extern
        const name = this.addExtern(value, 'const');
        return new SlotExpr(name) as Slot<T>;
    }

    // Property access (ctx.get still available for backwards compat)
    get<T>(target: Slot, key: string | Slot<string>): Slot<T> {
        return target.get(key) as Slot<T>;
    }

    set(target: Slot, key: string | Slot<string>, value: Slot): void {
        const t = this.expr(target);
        const v = this.expr(value);
        if (key instanceof SlotExpr) {
            this.code += `${t}[${key.e}]=${v};\n`;
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

    at<T>(arr: Slot, index: number | Slot<number>): Slot<T> {
        return arr.at(index) as Slot<T>;
    }

    has(target: Slot, key: string | Slot<string>): Slot<boolean> {
        const t = this.expr(target);
        if (key instanceof SlotExpr) {
            return this.slot_<boolean>(`(${key.e} in ${t})`);
        }
        const k = typeof key === 'string' ? JSON.stringify(key) : this.expr(key);
        return this.slot_<boolean>(`(${k} in ${t})`);
    }

    // Array
    push(arr: Slot, value: Slot): void {
        this.code += `${this.expr(arr)}.push(${this.expr(value)});\n`;
    }

    len(target: Slot): Slot<number> {
        return target.len();
    }

    // Equality
    eq(a: Slot, b: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(a)}===${this.expr(b)})`);
    }

    neq(a: Slot, b: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(a)}!==${this.expr(b)})`);
    }

    // Comparison
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

    // Logical
    not(a: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(!${this.expr(a)})`);
    }

    and(a: Slot, b: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(a)}&&${this.expr(b)})`);
    }

    or(a: Slot, b: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(a)}||${this.expr(b)})`);
    }

    // Type checks
    isType(value: Slot, type: string): Slot<boolean> {
        return this.slot_<boolean>(`(typeof ${this.expr(value)}===${JSON.stringify(type)})`);
    }

    isNull(value: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(value)}===null)`);
    }

    isNullish(value: Slot): Slot<boolean> {
        return this.slot_<boolean>(`(${this.expr(value)}==null)`);
    }

    // Calls
    call<T>(fn: Function, ...args: Slot[]): Slot<T> {
        const s = this.nextSlot();
        const fnName = this.addExtern(fn, fn.name || 'fn');
        const argsCode = args.map(a => this.expr(a)).join(',');
        this.code += `var ${s}=${fnName}(${argsCode});\n`;
        return new SlotExpr(s) as Slot<T>;
    }

    new_<T>(ctor: new (...args: any[]) => T, ...args: Slot[]): Slot<T> {
        const s = this.nextSlot();
        const ctorName = this.addExtern(ctor, ctor.name || 'Ctor');
        const argsCode = args.map(a => this.expr(a)).join(',');
        this.code += `var ${s}=new ${ctorName}(${argsCode});\n`;
        return new SlotExpr(s) as Slot<T>;
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
        fn(new SlotExpr(elem), new SlotExpr(idx));
        this.code += `}\n`;
    }

    map<T>(arr: Slot, fn: (elem: Slot, idx: Slot) => Slot<T>): Slot<T[]> {
        const a = this.expr(arr);
        const elem = this.nextSlot();
        const idx = this.nextSlot();

        const startCode = this.code;
        this.code = '';

        const result = fn(new SlotExpr(elem), new SlotExpr(idx));
        const bodyCode = this.code;
        const returnExpr = this.expr(result);

        this.code = startCode;

        const idxUsed = bodyCode.includes(idx) || returnExpr.includes(idx);

        if (bodyCode.trim()) {
            const resultSlot = this.nextSlot();
            const params = idxUsed ? `(${elem},${idx})` : `(${elem})`;
            this.code += `var ${resultSlot}=${a}.map(function${params}{\n${bodyCode}return ${returnExpr};\n});\n`;
            return new SlotExpr(resultSlot) as Slot<T[]>;
        } else {
            const needsParens = returnExpr.startsWith('{');
            const exprWrapped = needsParens ? `(${returnExpr})` : returnExpr;
            const params = idxUsed ? `(${elem},${idx})` : elem;
            return new SlotExpr(`${a}.map(${params}=>${exprWrapped})`) as Slot<T[]>;
        }
    }

    // Mutable state
    var_<T>(initialValue: T | Slot<T>): Slot<{ c: T }> {
        const s = this.nextSlot();
        const value =
            initialValue instanceof SlotExpr || initialValue instanceof ExecSlot
                ? this.expr(initialValue as Slot<T>)
                : this.expr(this.lit(initialValue));
        this.code += `var ${s}={c:${value}};\n`;
        return new SlotExpr(s) as Slot<{ c: T }>;
    }

    setVar<T>(ref: Slot<{ c: T }>, value: Slot<T>): void {
        this.code += `${this.expr(ref)}.c=${this.expr(value)};\n`;
    }

    getVar<T>(ref: Slot<{ c: T }>): Slot<T> {
        return new SlotExpr(`${this.expr(ref)}.c`) as Slot<T>;
    }

    // Switch statement
    switch_<T>(value: Slot, cases: Array<[any, () => Slot<T> | void]>, defaultCase?: () => Slot<T> | void): void {
        this.code += `switch(${this.expr(value)}){\n`;
        for (const [literal, caseBody] of cases) {
            const literalCode = typeof literal === 'string' ? JSON.stringify(literal) : String(literal);
            this.code += `case ${literalCode}:{\n`;
            const result = caseBody();
            if (result !== undefined) {
                this.code += `return ${this.expr(result)};\n`;
            }
            this.code += `break;}\n`;
        }
        if (defaultCase) {
            this.code += `default:{\n`;
            const result = defaultCase();
            if (result !== undefined) {
                this.code += `return ${this.expr(result)};\n`;
            }
            this.code += `break;}\n`;
        }
        this.code += `}\n`;
    }

    // Ternary expression
    ternary<T>(cond: Slot<boolean>, then: Slot<T>, else_: Slot<T>): Slot<T> {
        return this.slot_<T>(`(${this.expr(cond)}?${this.expr(then)}:${this.expr(else_)})`);
    }

    // Instance check
    isInstance(value: Slot, ctor: Function): Slot<boolean> {
        const ctorName = this.addExtern(ctor, ctor.name || 'Ctor');
        return this.slot_<boolean>(`(${this.expr(value)} instanceof ${ctorName})`);
    }

    // Throw
    throw_(error: Slot): void {
        this.code += `throw ${this.expr(error)};\n`;
    }

    // Object iteration
    forIn(obj: Slot, fn: (key: Slot<string>, value: Slot) => void): void {
        const key = this.nextSlot();
        const o = this.expr(obj);
        this.code += `for(var ${key} in ${o}){\n`;
        fn(new SlotExpr(key), new SlotExpr(`${o}[${key}]`));
        this.code += `}\n`;
    }

    // Else-if chains
    cond(cases: Array<[Slot<boolean>, () => Slot | void]>, else_?: () => Slot | void): void {
        for (let i = 0; i < cases.length; i++) {
            const [condSlot, body] = cases[i];
            if (i === 0) {
                this.code += `if(${this.expr(condSlot)}){\n`;
            } else {
                this.code += `}else if(${this.expr(condSlot)}){\n`;
            }
            const result = body();
            if (result !== undefined) {
                this.code += `return ${this.expr(result)};\n`;
            }
        }
        if (else_) {
            this.code += `}else{\n`;
            const result = else_();
            if (result !== undefined) {
                this.code += `return ${this.expr(result)};\n`;
            }
        }
        if (cases.length > 0) {
            this.code += `}\n`;
        }
    }

    // String concatenation
    concat(...slots: Slot[]): Slot<string> {
        if (slots.length === 0) return this.slot_<string>('""');
        if (slots.length === 1) return this.slot_<string>(`(${this.expr(slots[0])}+"")`);
        return this.slot_<string>(`(${slots.map(s => this.expr(s)).join('+')})`);
    }

    // Typeof
    typeof_(value: Slot): Slot<string> {
        return this.slot_<string>(`(typeof ${this.expr(value)})`);
    }

    compile<T extends Function>(returnSlot?: Slot): T {
        if (returnSlot !== undefined) {
            this.code += `return ${this.expr(returnSlot)};\n`;
        }
        const argNames = Array.from({ length: this.argCount }, (_, i) => `s${i}`).join(',');
        // Use spread on Map keys/values for named parameters
        const externNames = [...this.externs.keys()];
        const externValues = [...this.externs.values()];
        const fn = new Function(
            ...externNames,
            `'use strict';return function(${argNames}){'use strict';\n${this.code}}`,
        );
        return fn(...externValues) as T;
    }

    getCode(): string {
        return this.code;
    }
}

// ============================================================================
// ExecContext - Direct Execution Mode
// ============================================================================

export class ExecContext implements Context {
    hasEarlyReturn = false;
    earlyReturnValue: any;

    private unwrap<T>(slot: Slot<T>): T {
        return slot instanceof ExecSlot ? slot.value : (slot as T);
    }

    // Create
    obj<T extends object = any>(): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot({} as T);
    }

    objFrom<T extends object = any>(entries: Record<string, Slot> | Array<[string | Slot<string>, Slot]>): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        const result: any = {};

        if (Array.isArray(entries)) {
            for (const [key, value] of entries) {
                const k = typeof key === 'string' ? key : this.unwrap(key);
                result[k] = this.unwrap(value);
            }
        } else {
            for (const [key, value] of Object.entries(entries)) {
                result[key] = this.unwrap(value);
            }
        }

        return new ExecSlot(result as T);
    }

    arr<T = any>(): Slot<T[]> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot([] as T[]);
    }

    lit<T>(value: T): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot(value);
    }

    // Property access
    get<T>(target: Slot, key: string | Slot<string>): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        return target.get(key) as Slot<T>;
    }

    set(target: Slot, key: string | Slot<string>, value: Slot): void {
        if (this.hasEarlyReturn) return;
        const obj = this.unwrap(target);
        const k = typeof key === 'string' ? key : this.unwrap(key);
        const v = this.unwrap(value);
        (obj as any)[k] = v;
    }

    at<T>(arr: Slot, index: number | Slot<number>): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        return arr.at(index) as Slot<T>;
    }

    has(target: Slot, key: string | Slot<string>): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        const obj = this.unwrap(target);
        const k = typeof key === 'string' ? key : this.unwrap(key);
        return new ExecSlot(k in (obj as any));
    }

    // Array
    push(arr: Slot, value: Slot): void {
        if (this.hasEarlyReturn) return;
        const a = this.unwrap(arr) as any[];
        a.push(this.unwrap(value));
    }

    len(target: Slot): Slot<number> {
        if (this.hasEarlyReturn) return undefined as any;
        return target.len();
    }

    // Equality
    eq(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot(this.unwrap(a) === this.unwrap(b));
    }

    neq(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot(this.unwrap(a) !== this.unwrap(b));
    }

    // Comparison
    lt(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot((this.unwrap(a) as any) < (this.unwrap(b) as any));
    }

    gt(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot((this.unwrap(a) as any) > (this.unwrap(b) as any));
    }

    lte(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot((this.unwrap(a) as any) <= (this.unwrap(b) as any));
    }

    gte(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot((this.unwrap(a) as any) >= (this.unwrap(b) as any));
    }

    // Logical
    not(a: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot(!this.unwrap(a));
    }

    and(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot(this.unwrap(a) && this.unwrap(b));
    }

    or(a: Slot, b: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot(this.unwrap(a) || this.unwrap(b));
    }

    // Type checks
    isType(value: Slot, type: string): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot(typeof this.unwrap(value) === type);
    }

    isNull(v: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot(this.unwrap(v) === null);
    }

    isNullish(v: Slot): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot(this.unwrap(v) == null);
    }

    // Calls
    call<T>(fn: Function, ...args: Slot[]): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot(fn(...args.map(a => this.unwrap(a))));
    }

    new_<T>(ctor: new (...args: any[]) => T, ...args: Slot[]): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot(new ctor(...args.map(a => this.unwrap(a))));
    }

    // Control flow
    when(cond: Slot<boolean>, then: () => Slot | void, else_?: () => Slot | void): void {
        if (this.hasEarlyReturn) return;

        if (this.unwrap(cond)) {
            const result = then();
            if (result !== undefined) {
                this.hasEarlyReturn = true;
                this.earlyReturnValue = this.unwrap(result);
            }
        } else if (else_) {
            const result = else_();
            if (result !== undefined) {
                this.hasEarlyReturn = true;
                this.earlyReturnValue = this.unwrap(result);
            }
        }
    }

    loop(arr: Slot, fn: (elem: Slot, idx: Slot) => void): void {
        if (this.hasEarlyReturn) return;
        const array = this.unwrap(arr) as any[];
        for (let i = 0; i < array.length; i++) {
            if (this.hasEarlyReturn) break;
            fn(new ExecSlot(array[i]), new ExecSlot(i));
        }
    }

    map<T>(arr: Slot, fn: (elem: Slot, idx: Slot) => Slot<T>): Slot<T[]> {
        if (this.hasEarlyReturn) return undefined as any;
        const array = this.unwrap(arr) as any[];
        return new ExecSlot(array.map((elem, idx) => this.unwrap(fn(new ExecSlot(elem), new ExecSlot(idx)))));
    }

    // Mutable state
    var_<T>(initialValue: T | Slot<T>): Slot<{ c: T }> {
        if (this.hasEarlyReturn) return undefined as any;
        const value =
            initialValue instanceof ExecSlot || initialValue instanceof SlotExpr
                ? this.unwrap(initialValue as Slot<T>)
                : initialValue;
        return new ExecSlot({ c: value });
    }

    setVar<T>(ref: Slot<{ c: T }>, value: Slot<T>): void {
        if (this.hasEarlyReturn) return;
        const cell = this.unwrap(ref) as { c: T };
        cell.c = this.unwrap(value);
    }

    getVar<T>(ref: Slot<{ c: T }>): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        const cell = this.unwrap(ref) as { c: T };
        return new ExecSlot(cell.c);
    }

    // Switch statement
    switch_<T>(value: Slot, cases: Array<[any, () => Slot<T> | void]>, defaultCase?: () => Slot<T> | void): void {
        if (this.hasEarlyReturn) return;
        const val = this.unwrap(value);

        for (const [literal, caseBody] of cases) {
            if (val === literal) {
                const result = caseBody();
                if (result !== undefined) {
                    this.hasEarlyReturn = true;
                    this.earlyReturnValue = this.unwrap(result);
                }
                return;
            }
        }

        if (defaultCase) {
            const result = defaultCase();
            if (result !== undefined) {
                this.hasEarlyReturn = true;
                this.earlyReturnValue = this.unwrap(result);
            }
        }
    }

    // Ternary expression
    ternary<T>(cond: Slot<boolean>, then: Slot<T>, else_: Slot<T>): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        return this.unwrap(cond) ? then : else_;
    }

    // Instance check
    isInstance(value: Slot, ctor: Function): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot(this.unwrap(value) instanceof ctor);
    }

    // Throw
    throw_(error: Slot): void {
        throw this.unwrap(error);
    }

    // Object iteration
    forIn(obj: Slot, fn: (key: Slot<string>, value: Slot) => void): void {
        if (this.hasEarlyReturn) return;
        const o = this.unwrap(obj) as any;
        for (const key in o) {
            if (this.hasEarlyReturn) break;
            fn(new ExecSlot(key), new ExecSlot(o[key]));
        }
    }

    // Else-if chains
    cond(cases: Array<[Slot<boolean>, () => Slot | void]>, else_?: () => Slot | void): void {
        if (this.hasEarlyReturn) return;

        for (const [condSlot, body] of cases) {
            if (this.unwrap(condSlot)) {
                const result = body();
                if (result !== undefined) {
                    this.hasEarlyReturn = true;
                    this.earlyReturnValue = this.unwrap(result);
                }
                return;
            }
        }

        if (else_) {
            const result = else_();
            if (result !== undefined) {
                this.hasEarlyReturn = true;
                this.earlyReturnValue = this.unwrap(result);
            }
        }
    }

    // String concatenation
    concat(...slots: Slot[]): Slot<string> {
        if (this.hasEarlyReturn) return undefined as any;
        if (slots.length === 0) return new ExecSlot('');
        return new ExecSlot(slots.map(s => this.unwrap(s)).join(''));
    }

    // Typeof
    typeof_(value: Slot): Slot<string> {
        if (this.hasEarlyReturn) return undefined as any;
        return new ExecSlot(typeof this.unwrap(value));
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
 * // Build a serializer with chainable API
 * const serialize = jit.fn(jit.arg<User>(), (ctx, input) => {
 *     return ctx.objFrom({
 *         name: input.get('name'),
 *         street: input.get('address').get('street'),
 *     });
 * });
 *
 * serialize({ name: 'John', address: { street: '123 Main' } });
 * // Returns: { name: 'John', street: '123 Main' }
 * ```
 */
export const jit = {
    /**
     * Declare a function argument with its type.
     */
    arg<T>(): Arg<T> {
        return { __brand: 'arg' } as Arg<T>;
    },

    /**
     * Build a function using the unified context API.
     */
    fn<R>(...args: any[]): (...args: any[]) => R {
        const body = args.pop() as Function;
        const argCount = args.length;

        if (canJIT) {
            const ctx = new JITContext(argCount);
            const argSlots = ctx.getArgSlots();
            const returnSlot = body(ctx, ...argSlots);
            return ctx.compile(returnSlot);
        } else {
            return ((...runtimeArgs: any[]) => {
                const ctx = new ExecContext();
                const wrappedArgs = runtimeArgs.map(a => new ExecSlot(a));
                const returnValue = body(ctx, ...wrappedArgs);
                if (ctx.hasEarlyReturn) return ctx.earlyReturnValue;
                return returnValue instanceof ExecSlot ? returnValue.value : returnValue;
            }) as any;
        }
    },

    /**
     * Force JIT mode (for testing or when you know it's available).
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
     */
    fnExec<R>(...args: any[]): (...args: any[]) => R {
        const body = args.pop() as Function;
        const argCount = args.length;

        return ((...runtimeArgs: any[]) => {
            const ctx = new ExecContext();
            const wrappedArgs = runtimeArgs.map(a => new ExecSlot(a));
            const returnValue = body(ctx, ...wrappedArgs);
            if (ctx.hasEarlyReturn) return ctx.earlyReturnValue;
            return returnValue instanceof ExecSlot ? returnValue.value : returnValue;
        }) as any;
    },
};
