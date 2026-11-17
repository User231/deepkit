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
 * How a tree is written: `Builder` and the references (`Ref`, `VarRef`) its methods hand out.
 * It imports the tree and nothing else: how a tree is run is not its business.
 */
import { Block, Expr, NestedFnDef, Stmt } from './nodes.js';

// ============================================================================
// Builder - Constructs Expression Trees
// ============================================================================

/**
 * Global function ID counter — ensures unique names across all Builder instances
 * for both subFn helpers and nested function definitions.
 */
let _globalFnId = 0;

/**
 * Expression reference returned by builder methods.
 * This is a lightweight wrapper that just holds an Expr.
 */
export class Ref<T = any> {
    constructor(public readonly expr: Expr) {}

    /** Get property by key */
    get<K extends keyof T>(key: K): Ref<T[K]>;
    get(key: string | Ref<string>): Ref<any>;
    get(key: string | Ref<string>): Ref<any> {
        const keyExpr = typeof key === 'string' ? key : key.expr;
        return new Ref({ kind: 'get', obj: this.expr, key: keyExpr });
    }

    /** Get array element by index */
    at(index: number | Ref<number>): Ref<any> {
        const indexExpr = typeof index === 'number' ? index : index.expr;
        return new Ref({ kind: 'at', arr: this.expr, index: indexExpr });
    }

    /** Get length */
    len(): Ref<number> {
        return new Ref({ kind: 'len', value: this.expr });
    }
}

/**
 * Mutable variable reference
 */
export class VarRef<T = any> {
    constructor(
        public readonly id: number,
        public readonly name?: string,
    ) {}
}

/**
 * Builder for constructing expression trees.
 * Single unified API for both JIT and Exec modes.
 */
export class Builder {
    private nextId: number;
    private stmts: Stmt[] = [];
    private stmtStack: Stmt[][] = [];
    readonly argCount: number;

    constructor(argCount: number) {
        this.argCount = argCount;
        this.nextId = argCount; // Reserve IDs 0..argCount-1 for inputs
    }

    private allocId(): number {
        return this.nextId++;
    }

    private pushStmt(stmt: Stmt): void {
        this.stmts.push(stmt);
    }

    private saveStmts(): void {
        this.stmtStack.push(this.stmts);
        this.stmts = [];
    }

    private restoreStmts(): Stmt[] {
        const saved = this.stmts;
        this.stmts = this.stmtStack.pop()!;
        return saved;
    }

    // ========== Input Access ==========

    /** Get input argument by index */
    input(index: number): Ref {
        return new Ref({ kind: 'input', index });
    }

    // ========== Literals & Values ==========

    /** Create a literal value */
    lit<T>(value: T): Ref<T> {
        return new Ref({ kind: 'lit', value });
    }

    /** Create an empty object */
    emptyObj<T extends object = any>(): Ref<T> {
        return new Ref({ kind: 'obj', entries: [] });
    }

    /** Create an empty array */
    emptyArr<T = any>(): Ref<T[]> {
        return new Ref({ kind: 'arr', elements: [] });
    }

    /** Create object from entries */
    obj<T extends object = any>(entries: Record<string, Ref> | Array<[string | Ref<string>, Ref]>): Ref<T> {
        const entryList: [string | Expr, Expr][] = Array.isArray(entries)
            ? entries.map(([k, v]) => [typeof k === 'string' ? k : k.expr, v.expr])
            : Object.entries(entries).map(([k, v]) => [k, v.expr]);
        return new Ref({ kind: 'obj', entries: entryList });
    }

    /** Create array from elements */
    arr<T>(...elements: Ref<T>[]): Ref<T[]> {
        return new Ref({ kind: 'arr', elements: elements.map(e => e.expr) });
    }

    // ========== Property Access ==========

    /** Get property */
    get<T>(obj: Ref, key: string | Ref<string>): Ref<T> {
        return obj.get(key) as Ref<T>;
    }

    /** Set property (statement) */
    set(obj: Ref, key: string | Ref<string>, value: Ref): void {
        this.pushStmt({
            kind: 'set',
            obj: obj.expr,
            key: typeof key === 'string' ? key : key.expr,
            value: value.expr,
        });
    }

    /** Check if key exists in object */
    has(obj: Ref, key: string | Ref<string>): Ref<boolean> {
        return new Ref({
            kind: 'has',
            obj: obj.expr,
            key: typeof key === 'string' ? key : key.expr,
        });
    }

    /** Get array element by index */
    at<T>(arr: Ref, index: number | Ref<number>): Ref<T> {
        return arr.at(index) as Ref<T>;
    }

    /** Get length of array or string */
    len(value: Ref): Ref<number> {
        return value.len();
    }

    // ========== Array Operations ==========

    /** Push element to array (statement) */
    push(arr: Ref, value: Ref): void {
        this.pushStmt({ kind: 'push', arr: arr.expr, value: value.expr });
    }

    /** Map over array */
    map<T>(arr: Ref, fn: (elem: Ref, idx: Ref<number>) => Ref<T>): Ref<T[]> {
        const elemId = this.allocId();
        const indexId = this.allocId();

        this.saveStmts();
        const result = fn(new Ref({ kind: 'var', id: elemId }), new Ref({ kind: 'var', id: indexId }));
        const bodyStmts = this.restoreStmts();

        const block: Block = { stmts: bodyStmts, returnExpr: result.expr };
        return new Ref({ kind: 'map', arr: arr.expr, elemId, indexId, body: block });
    }

    // ========== Function Calls ==========

    /** Call a function */
    call<T>(fn: Function, ...args: Ref[]): Ref<T> {
        return new Ref({ kind: 'call', fn, args: args.map(a => a.expr) });
    }

    /** Construct a new instance */
    new_<T>(ctor: new (...args: any[]) => T, ...args: Ref[]): Ref<T> {
        return new Ref({ kind: 'new', ctor, args: args.map(a => a.expr) });
    }

    // ========== Variable Binding ==========

    /** Bind expression to a variable (emits let statement) */
    let<T>(expr: Ref<T>, name?: string): Ref<T> {
        const id = this.allocId();
        this.pushStmt({ kind: 'let', id, expr: expr.expr, name });
        return new Ref({ kind: 'var', id, name });
    }

    /** Create a mutable variable */
    var_<T>(initial: T | Ref<T>, name?: string): VarRef<T> {
        const id = this.allocId();
        const initialExpr = initial instanceof Ref ? initial.expr : { kind: 'lit' as const, value: initial };
        this.pushStmt({ kind: 'let', id, expr: initialExpr, name });
        return new VarRef(id, name);
    }

    /** Set mutable variable value */
    setVar<T>(ref: VarRef<T>, value: Ref<T>): void {
        this.pushStmt({ kind: 'setVar', id: ref.id, value: value.expr });
    }

    /** Get mutable variable value */
    getVar<T>(ref: VarRef<T>): Ref<T> {
        return new Ref({ kind: 'var', id: ref.id, name: ref.name });
    }

    // ========== Comparisons ==========

    /** Strict equality (===) */
    eq(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'eq', a: a.expr, b: b.expr });
    }

    /** Strict inequality (!==) */
    neq(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'neq', a: a.expr, b: b.expr });
    }

    /** Less than (<) */
    lt(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'lt', a: a.expr, b: b.expr });
    }

    /** Greater than (>) */
    gt(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'gt', a: a.expr, b: b.expr });
    }

    /** Less than or equal (<=) */
    lte(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'lte', a: a.expr, b: b.expr });
    }

    /** Greater than or equal (>=) */
    gte(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'gte', a: a.expr, b: b.expr });
    }

    // ========== Arithmetic Operations ==========

    /** Addition (a + b) */
    add(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'add', a: a.expr, b: b.expr });
    }

    /** Subtraction (a - b) */
    sub(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'sub', a: a.expr, b: b.expr });
    }

    /** Multiplication (a * b) */
    mul(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'mul', a: a.expr, b: b.expr });
    }

    /** Division (a / b) */
    div(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'div', a: a.expr, b: b.expr });
    }

    /** Modulo (a % b) */
    mod(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'mod', a: a.expr, b: b.expr });
    }

    // ========== Bitwise Operations ==========

    /** Bitwise AND (a & b) */
    bitAnd(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'bitAnd', a: a.expr, b: b.expr });
    }

    /** Bitwise OR (a | b) */
    bitOr(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'bitOr', a: a.expr, b: b.expr });
    }

    /** Bitwise XOR (a ^ b) */
    bitXor(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'bitXor', a: a.expr, b: b.expr });
    }

    /** Left shift (a << b) */
    shl(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'shl', a: a.expr, b: b.expr });
    }

    /** Right shift (a >> b) */
    shr(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'shr', a: a.expr, b: b.expr });
    }

    /** Unsigned right shift (a >>> b) */
    ushr(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'ushr', a: a.expr, b: b.expr });
    }

    // ========== Method Calls ==========

    /** Call method on object: obj.method(args...) */
    method<T>(obj: Ref, method: string, ...args: Ref[]): Ref<T> {
        return new Ref({ kind: 'method', obj: obj.expr, method, args: args.map(a => a.expr) });
    }

    // ========== Logical Operations ==========

    /** Logical NOT (!) */
    not(a: Ref): Ref<boolean> {
        return new Ref({ kind: 'not', a: a.expr });
    }

    /** Logical AND (&&) */
    and(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'and', a: a.expr, b: b.expr });
    }

    /** Logical OR (||) */
    or(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'or', a: a.expr, b: b.expr });
    }

    /** Nullish coalescing (??) */
    nullish<T>(a: Ref<T>, b: Ref<T>): Ref<T> {
        return new Ref({ kind: 'nullish', a: a.expr, b: b.expr });
    }

    // ========== Type Checks ==========

    /** typeof operator */
    typeof_(value: Ref): Ref<string> {
        return new Ref({ kind: 'typeof', value: value.expr });
    }

    /** typeof === type check */
    isType(value: Ref, type: string): Ref<boolean> {
        return new Ref({ kind: 'isType', value: value.expr, type });
    }

    /** value === null */
    isNull(value: Ref): Ref<boolean> {
        return new Ref({ kind: 'isNull', value: value.expr });
    }

    /** value == null (null or undefined) */
    isNullish(value: Ref): Ref<boolean> {
        return new Ref({ kind: 'isNullish', value: value.expr });
    }

    /** value instanceof ctor */
    isInstance(value: Ref, ctor: Function): Ref<boolean> {
        return new Ref({ kind: 'instanceof', value: value.expr, ctor });
    }

    // ========== Control Flow ==========

    /** Conditional (if/else) */
    if_(cond: Ref<boolean>, then: () => Ref | void, else_?: () => Ref | void): void {
        this.saveStmts();
        const thenResult = then();
        const thenStmts = this.restoreStmts();
        const thenBlock: Block = { stmts: thenStmts };
        if (thenResult !== undefined) {
            thenBlock.stmts.push({ kind: 'return', value: thenResult.expr });
        }

        let elseBlock: Block | undefined;
        if (else_) {
            this.saveStmts();
            const elseResult = else_();
            const elseStmts = this.restoreStmts();
            if (elseStmts.length > 0 || elseResult !== undefined) {
                elseBlock = { stmts: elseStmts };
                if (elseResult !== undefined) {
                    elseBlock.stmts.push({ kind: 'return', value: elseResult.expr });
                }
            }
        }

        this.pushStmt({ kind: 'if', cond: cond.expr, then: thenBlock, else: elseBlock });
    }

    /** Ternary expression (cond ? then : else) */
    ternary<T>(cond: Ref<boolean>, then: Ref<T>, else_: Ref<T>): Ref<T> {
        return new Ref({ kind: 'ternary', cond: cond.expr, then: then.expr, else: else_.expr });
    }

    /** Loop over array with element and index */
    loop(arr: Ref, fn: (elem: Ref, idx: Ref<number>) => void, names?: { elem?: string; index?: string }): void {
        const elemId = this.allocId();
        const indexId = this.allocId();

        this.saveStmts();
        fn(
            new Ref({ kind: 'var', id: elemId, name: names?.elem }),
            new Ref({ kind: 'var', id: indexId, name: names?.index }),
        );
        const bodyStmts = this.restoreStmts();

        // Store variable names in LoopStmt for use by code generator
        this.pushStmt({
            kind: 'loop',
            arr: arr.expr,
            elemId,
            indexId,
            body: { stmts: bodyStmts },
            elemName: names?.elem,
            indexName: names?.index,
        });
    }

    /** Loop over array with index only (no element variable generated) */
    loopIdx(arr: Ref, fn: (idx: Ref<number>, arr: Ref) => void, indexName?: string): void {
        const elemId = this.allocId(); // Still allocate but won't be used
        const indexId = this.allocId();

        this.saveStmts();
        fn(new Ref({ kind: 'var', id: indexId, name: indexName }), arr);
        const bodyStmts = this.restoreStmts();

        this.pushStmt({
            kind: 'loop',
            arr: arr.expr,
            elemId,
            indexId,
            body: { stmts: bodyStmts },
            indexName,
            skipElem: true,
        });
    }

    /**
     * Range-based for loop: for(i=start; i<end; i++)
     * Optionally provide an array to access elements from: arr[i]
     */
    forRange(
        start: Ref<number>,
        end: Ref<number>,
        fn: (idx: Ref<number>, elem?: Ref) => void,
        options?: { arr?: Ref; indexName?: string; elemName?: string },
    ): void {
        const indexId = this.allocId();
        const elemId = this.allocId();

        this.saveStmts();
        const idxRef = new Ref<number>({ kind: 'var', id: indexId, name: options?.indexName });
        const elemRef = options?.arr ? new Ref({ kind: 'var', id: elemId, name: options?.elemName }) : undefined;
        fn(idxRef, elemRef);
        const bodyStmts = this.restoreStmts();

        this.pushStmt({
            kind: 'loop',
            start: start.expr,
            end: end.expr,
            indexId,
            elemId,
            body: { stmts: bodyStmts },
            indexName: options?.indexName,
            arr: options?.arr?.expr,
            elemName: options?.elemName,
            skipElem: !options?.arr,
        });
    }

    /** Loop over object keys */
    forIn(obj: Ref, fn: (key: Ref<string>, value: Ref) => void, keyName?: string): void {
        const keyId = this.allocId();

        this.saveStmts();
        const keyRef = new Ref<string>({ kind: 'var', id: keyId, name: keyName });
        fn(keyRef, new Ref({ kind: 'get', obj: obj.expr, key: { kind: 'var', id: keyId, name: keyName } }));
        const bodyStmts = this.restoreStmts();

        this.pushStmt({ kind: 'forIn', obj: obj.expr, keyId, body: { stmts: bodyStmts }, keyName });
    }

    /**
     * Loop over an iterable (Set, Map entries, arrays).
     * For Map iteration, pass iterable as map (not map.entries()) - the callback receives [key, value].
     * For Set iteration, the callback receives just the value.
     */
    forOf<V>(iterable: Ref<Iterable<V>>, fn: (value: Ref<V>) => void, valueName?: string): void;
    forOf<K, V>(
        iterable: Ref<Map<K, V>>,
        fn: (key: Ref<K>, value: Ref<V>) => void,
        keyName?: string,
        valueName?: string,
    ): void;
    forOf(
        iterable: Ref,
        fn: ((value: Ref) => void) | ((key: Ref, value: Ref) => void),
        keyOrValueName?: string,
        valueName?: string,
    ): void {
        const valueId = this.allocId();
        // Check if fn expects 2 arguments (key, value) for Map iteration
        const isMapIteration = fn.length === 2;

        if (isMapIteration) {
            const keyId = this.allocId();
            this.saveStmts();
            const keyRef = new Ref({ kind: 'var', id: keyId, name: keyOrValueName });
            const valueRef = new Ref({ kind: 'var', id: valueId, name: valueName });
            (fn as (key: Ref, value: Ref) => void)(keyRef, valueRef);
            const bodyStmts = this.restoreStmts();
            this.pushStmt({
                kind: 'forOf',
                iterable: iterable.expr,
                valueId,
                keyId,
                body: { stmts: bodyStmts },
                keyName: keyOrValueName,
                valueName,
            });
        } else {
            this.saveStmts();
            const valueRef = new Ref({ kind: 'var', id: valueId, name: keyOrValueName });
            (fn as (value: Ref) => void)(valueRef);
            const bodyStmts = this.restoreStmts();
            this.pushStmt({
                kind: 'forOf',
                iterable: iterable.expr,
                valueId,
                body: { stmts: bodyStmts },
                valueName: keyOrValueName,
            });
        }
    }

    /** Switch statement */
    switch_<T>(value: Ref, cases: Array<[any, () => Ref<T> | void]>, defaultCase?: () => Ref<T> | void): void {
        const caseBlocks: [any, Block][] = [];

        for (const [literal, body] of cases) {
            this.saveStmts();
            const result = body();
            const stmts = this.restoreStmts();
            const block: Block = { stmts };
            if (result !== undefined) {
                block.stmts.push({ kind: 'return', value: result.expr });
            }
            caseBlocks.push([literal, block]);
        }

        let defaultBlock: Block | undefined;
        if (defaultCase) {
            this.saveStmts();
            const result = defaultCase();
            const stmts = this.restoreStmts();
            defaultBlock = { stmts };
            if (result !== undefined) {
                defaultBlock.stmts.push({ kind: 'return', value: result.expr });
            }
        }

        this.pushStmt({ kind: 'switch', value: value.expr, cases: caseBlocks, default: defaultBlock });
    }

    /** While loop */
    while_(cond: Ref<boolean>, body: () => void): void {
        this.saveStmts();
        body();
        const bodyStmts = this.restoreStmts();
        this.pushStmt({ kind: 'while', cond: cond.expr, body: { stmts: bodyStmts } });
    }

    /** Break out of enclosing while loop */
    break_(): void {
        this.pushStmt({ kind: 'break' });
    }

    /** Continue to next iteration of enclosing while loop */
    continue_(): void {
        this.pushStmt({ kind: 'continue' });
    }

    /** Multiple condition chain (if/else if/else) */
    cond(cases: Array<[Ref<boolean>, () => Ref | void]>, else_?: () => Ref | void): void {
        if (cases.length === 0) return;

        // Build from the end - each condition's else is the next condition
        let currentElse: Block | undefined;

        if (else_) {
            this.saveStmts();
            const result = else_();
            const stmts = this.restoreStmts();
            if (stmts.length > 0 || result !== undefined) {
                currentElse = { stmts };
                if (result !== undefined) {
                    currentElse.stmts.push({ kind: 'return', value: result.expr });
                }
            }
        }

        // Process conditions in reverse
        for (let i = cases.length - 1; i >= 0; i--) {
            const [cond, body] = cases[i];
            this.saveStmts();
            const result = body();
            const stmts = this.restoreStmts();
            const thenBlock: Block = { stmts };
            if (result !== undefined) {
                thenBlock.stmts.push({ kind: 'return', value: result.expr });
            }

            if (i === 0) {
                // First condition - emit the if statement
                this.pushStmt({ kind: 'if', cond: cond.expr, then: thenBlock, else: currentElse });
            } else {
                // Middle conditions - wrap in else block
                currentElse = { stmts: [{ kind: 'if', cond: cond.expr, then: thenBlock, else: currentElse }] };
            }
        }
    }

    // ========== Side Effects ==========

    /** Execute expression for side effects */
    exec(expr: Ref): void {
        this.pushStmt({ kind: 'exec', expr: expr.expr });
    }

    /** Return from the current function (void or with value) */
    return_(value?: Ref): void {
        this.pushStmt({ kind: 'return', value: value?.expr });
    }

    /** Throw an error */
    throw_(error: Ref): void {
        this.pushStmt({ kind: 'throw', error: error.expr });
    }

    // ========== String Operations ==========

    /** Concatenate strings */
    concat(...parts: Ref[]): Ref<string> {
        return new Ref({ kind: 'concat', parts: parts.map(p => p.expr) });
    }

    // ========== Nested Function Registration ==========

    /** Nested function definitions registered by child fn()/fnJIT() calls */
    private nestedFnDefs = new Map<number, NestedFnDef>();

    /**
     * Register a function declared inside this Builder's body callback as its nested function,
     * and answer the id the generator names it by (`_nfn_<id>`). What stands for the function in
     * the tree — the marker — is made by the entry points (`entry.ts`), which know how it will be
     * run: the Builder writes trees and knows nothing of the modes.
     */
    registerNestedFn(def: NestedFnDef): number {
        const id = _globalFnId++;
        this.nestedFnDefs.set(id, def);
        return id;
    }

    // ========== Helper Functions ==========

    /**
     * Create a helper function for better V8 optimization.
     * This follows the Typia pattern of extracting nested checks into separate functions.
     *
     * @param arg The argument to pass to the helper function
     * @param bodyFn A function that builds the body using the helper's input (input(0))
     * @returns A reference to the result of calling the helper function
     *
     * @example
     * // Instead of inlining nested object checks:
     * const nestedCheck = b.and(b.isType(input.get('foo'), 'string'), ...);
     *
     * // Use a helper function:
     * const nestedCheck = b.subFn(input.get('nested'), (b2, nestedInput) => {
     *     return b2.and(b2.isType(nestedInput.get('foo'), 'string'), ...);
     * });
     */
    subFn<T>(arg: Ref, bodyFn: (b: Builder, input: Ref) => Ref<T>): Ref<T> {
        const fnId = _globalFnId++;
        // Build the body with a fresh builder (1 arg for the input)
        const innerBuilder = new Builder(1);
        const innerInput = innerBuilder.input(0);
        const bodyResult = bodyFn(innerBuilder, innerInput);
        // Extract just the return expression - we only support simple expression bodies
        const bodyExpr = bodyResult.expr;
        return new Ref({
            kind: 'subFn',
            arg: arg.expr,
            body: bodyExpr,
            fnId,
        });
    }

    // ========== Build ==========

    /** Build the block (for internal use) */
    build(returnExpr?: Ref): Block {
        return {
            stmts: this.stmts,
            returnExpr: returnExpr?.expr,
            nestedFunctions: this.nestedFnDefs.size > 0 ? new Map(this.nestedFnDefs) : undefined,
        };
    }
}
