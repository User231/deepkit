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
 * A program the Builder refuses: one that neither mode could run as written, or that the two
 * would run differently. Thrown while the function is DECLARED, by the call that makes the program
 * unrunnable — never at the first call of the built function, and never by one mode only.
 */
export class InvalidProgramError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidProgramError';
    }
}

/** The `decl` of an expression that reads no input and no variable: it means the same anywhere. */
const NO_DECL = -1;

/** The id of the next declaration: every Builder is one. */
let _nextDecl = 0;

/**
 * Whose an expression over two operands is. Each was taken through `Builder.own()`, so it reads
 * that Builder's declaration or none: the expression reads the declaration when either does.
 */
function declOf(a: Ref, b: Ref): number {
    return a.decl === NO_DECL ? b.decl : a.decl;
}

function declOfAll(refs: readonly Ref[]): number {
    for (let i = 0; i < refs.length; i++) {
        if (refs[i].decl !== NO_DECL) return refs[i].decl;
    }
    return NO_DECL;
}

function refuseForeign(): never {
    throw new InvalidProgramError(
        `An expression that reads an input or a variable of another declaration was used here. ` +
            `A function sees its own arguments and variables only — a nested function and a subFn body ` +
            `are functions of their own. Pass the value in as an argument.`,
    );
}

/**
 * Expression reference returned by builder methods.
 * This is a lightweight wrapper that holds an Expr, and which declaration the Expr belongs to.
 */
export class Ref<T = any> {
    constructor(
        public readonly expr: Expr,
        /**
         * The declaration whose inputs or variables the expression reads: the `decl` of the
         * Builder that made it, or -1 when it reads none (a literal, an expression over
         * literals). A Builder takes operands of its own declaration and operands that read
         * none; anything else it refuses ({@link InvalidProgramError}).
         */
        public readonly decl: number = NO_DECL,
    ) {}

    /** Get property by key */
    get<K extends keyof T>(key: K): Ref<T[K]>;
    get(key: string | Ref<string>): Ref<any>;
    get(key: string | Ref<string>): Ref<any> {
        if (typeof key === 'string') return new Ref({ kind: 'get', obj: this.expr, key }, this.decl);
        return new Ref({ kind: 'get', obj: this.expr, key: key.expr }, this.with(key));
    }

    /** Get array element by index */
    at(index: number | Ref<number>): Ref<any> {
        if (typeof index === 'number') return new Ref({ kind: 'at', arr: this.expr, index }, this.decl);
        return new Ref({ kind: 'at', arr: this.expr, index: index.expr }, this.with(index));
    }

    /** Get length */
    len(): Ref<number> {
        return new Ref({ kind: 'len', value: this.expr }, this.decl);
    }

    /** The declaration of an expression made of this one and `other`: they must not be two. */
    private with(other: Ref): number {
        if (this.decl === NO_DECL) return other.decl;
        if (other.decl !== NO_DECL && other.decl !== this.decl) refuseForeign();
        return this.decl;
    }
}

/**
 * Mutable variable reference
 */
export class VarRef<T = any> {
    constructor(
        public readonly id: number,
        /** The declaration that bound it: the `decl` of the Builder whose `var_()` made this. */
        public readonly decl: number,
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
    /** Which declaration this is. The expressions that read its inputs or variables carry it. */
    readonly decl = _nextDecl++;
    /** How many loops enclose the statements being written — within the current function. */
    private loopDepth = 0;
    private loopDepthStack: number[] = [];
    /** Whether this declaration is an async function: the only kind that may `await_()`. */
    readonly async: boolean;
    /** Whether the statements being written are the async function's own — not a `map` body's. */
    private awaits: boolean;
    private awaitsStack: boolean[] = [];

    constructor(argCount: number, options: { async?: boolean } = {}) {
        this.argCount = argCount;
        this.nextId = argCount; // Reserve IDs 0..argCount-1 for inputs
        this.async = options.async === true;
        this.awaits = this.async;
    }

    private allocId(): number {
        return this.nextId++;
    }

    private pushStmt(stmt: Stmt): void {
        this.stmts.push(stmt);
    }

    /**
     * Start the statements of a body. `'loop'`: a loop body, where `break_()` and `continue_()`
     * have a loop to act on. `'function'`: a function of its own (the body of `map`), where they
     * have none whatever encloses it. Left out: a branch (`if`, `switch`), which changes nothing.
     */
    private saveStmts(body?: 'loop' | 'function'): void {
        this.stmtStack.push(this.stmts);
        this.stmts = [];
        this.loopDepthStack.push(this.loopDepth);
        this.awaitsStack.push(this.awaits);
        if (body === 'loop') this.loopDepth++;
        else if (body === 'function') {
            this.loopDepth = 0;
            this.awaits = false;
        }
    }

    private restoreStmts(): Stmt[] {
        const saved = this.stmts;
        this.stmts = this.stmtStack.pop()!;
        this.loopDepth = this.loopDepthStack.pop()!;
        this.awaits = this.awaitsStack.pop()!;
        return saved;
    }

    // ========== What a function may read ==========
    //
    // A function reads its own inputs and variables only. Compiled, a nested function is emitted
    // beside the one that declared it, not inside it, and a `subFn` body is a helper of its own:
    // a name of another function is a ReferenceError there, at the first call. Interpreted, each
    // call has its own variable array: the same read answers `undefined`, silently. And an INPUT
    // of another declaration is read by index, so both modes agree — on the wrong argument.
    //
    // So every operand is taken through `own()`, which refuses one of another declaration at the
    // call that was handed it, and every expression says whose it is (`declOf`). There is no way
    // to a tree but through `own()`: nothing else in this class reads `ref.expr`.

    /** The tree of an operand — refused when it reads an input or a variable of another declaration. */
    private own(ref: Ref): Expr {
        if (ref.decl !== NO_DECL && ref.decl !== this.decl) refuseForeign();
        return ref.expr;
    }

    /** The Ref of a variable or an input of this declaration. */
    private mine<T>(expr: Expr): Ref<T> {
        return new Ref<T>(expr, this.decl);
    }

    /** `break_()` / `continue_()` need a loop of THIS function around them. */
    private requireLoop(call: string, does: string): void {
        if (this.loopDepth > 0) return;
        throw new InvalidProgramError(
            `${call} outside a loop: there is no loop to ${does}. ` +
                `The body of map() is a function of its own, so a loop around the map does not count.`,
        );
    }

    private requireOwnVar(ref: VarRef, call: string): void {
        if (ref.decl === this.decl) return;
        throw new InvalidProgramError(
            `${call} on a variable${ref.name ? ` (${ref.name})` : ''} of another declaration. ` +
                `A function sees its own variables only: pass the value in as an argument.`,
        );
    }

    // ========== Input Access ==========

    /** Get input argument by index */
    input(index: number): Ref {
        return this.mine({ kind: 'input', index });
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
            ? entries.map(([k, v]) => [typeof k === 'string' ? k : this.own(k), this.own(v)])
            : Object.entries(entries).map(([k, v]) => [k, this.own(v)]);
        let decl = NO_DECL;
        if (Array.isArray(entries)) {
            for (const [k, v] of entries) {
                if (typeof k !== 'string' && k.decl !== NO_DECL) decl = k.decl;
                if (v.decl !== NO_DECL) decl = v.decl;
            }
        } else {
            for (const key in entries) {
                if (entries[key].decl !== NO_DECL) decl = entries[key].decl;
            }
        }
        return new Ref({ kind: 'obj', entries: entryList }, decl);
    }

    /** Create array from elements */
    arr<T>(...elements: Ref<T>[]): Ref<T[]> {
        return new Ref({ kind: 'arr', elements: elements.map(e => this.own(e)) }, declOfAll(elements));
    }

    // ========== Property Access ==========

    /** Get property */
    get<T>(obj: Ref, key: string | Ref<string>): Ref<T> {
        this.own(obj);
        if (typeof key !== 'string') this.own(key);
        return obj.get(key) as Ref<T>;
    }

    /** Set property (statement) */
    set(obj: Ref, key: string | Ref<string>, value: Ref): void {
        this.pushStmt({
            kind: 'set',
            obj: this.own(obj),
            key: typeof key === 'string' ? key : this.own(key),
            value: this.own(value),
        });
    }

    /** Check if key exists in object */
    has(obj: Ref, key: string | Ref<string>): Ref<boolean> {
        return new Ref(
            {
                kind: 'has',
                obj: this.own(obj),
                key: typeof key === 'string' ? key : this.own(key),
            },
            typeof key === 'string' ? obj.decl : declOf(obj, key),
        );
    }

    /** Get array element by index */
    at<T>(arr: Ref, index: number | Ref<number>): Ref<T> {
        this.own(arr);
        if (typeof index !== 'number') this.own(index);
        return arr.at(index) as Ref<T>;
    }

    /** Get length of array or string */
    len(value: Ref): Ref<number> {
        this.own(value);
        return value.len();
    }

    // ========== Array Operations ==========

    /** Push element to array (statement) */
    push(arr: Ref, value: Ref): void {
        this.pushStmt({ kind: 'push', arr: this.own(arr), value: this.own(value) });
    }

    /** Map over array */
    map<T>(arr: Ref, fn: (elem: Ref, idx: Ref<number>) => Ref<T>): Ref<T[]> {
        const elemId = this.allocId();
        const indexId = this.allocId();

        this.saveStmts('function');
        const result = fn(this.mine({ kind: 'var', id: elemId }), this.mine({ kind: 'var', id: indexId }));
        const bodyStmts = this.restoreStmts();

        const block: Block = { stmts: bodyStmts, returnExpr: this.own(result) };
        // A map binds variables of this declaration: it belongs to it whatever the array is.
        return this.mine({ kind: 'map', arr: this.own(arr), elemId, indexId, body: block });
    }

    // ========== Function Calls ==========

    /** Call a function */
    call<T>(fn: Function, ...args: Ref[]): Ref<T> {
        return new Ref({ kind: 'call', fn, args: args.map(a => this.own(a)) }, declOfAll(args));
    }

    /** Construct a new instance */
    new_<T>(ctor: new (...args: any[]) => T, ...args: Ref[]): Ref<T> {
        return new Ref({ kind: 'new', ctor, args: args.map(a => this.own(a)) }, declOfAll(args));
    }

    // ========== Variable Binding ==========

    /** Bind expression to a variable (emits let statement) */
    let<T>(expr: Ref<T>, name?: string): Ref<T> {
        const id = this.allocId();
        this.pushStmt({ kind: 'let', id, expr: this.own(expr), name });
        return this.mine({ kind: 'var', id, name });
    }

    /** Create a mutable variable */
    var_<T>(initial: T | Ref<T>, name?: string): VarRef<T> {
        const id = this.allocId();
        const initialExpr = initial instanceof Ref ? this.own(initial) : { kind: 'lit' as const, value: initial };
        this.pushStmt({ kind: 'let', id, expr: initialExpr, name });
        return new VarRef(id, this.decl, name);
    }

    /** Set mutable variable value */
    setVar<T>(ref: VarRef<T>, value: Ref<T>): void {
        this.requireOwnVar(ref, 'setVar()');
        this.pushStmt({ kind: 'setVar', id: ref.id, value: this.own(value) });
    }

    /** Get mutable variable value */
    getVar<T>(ref: VarRef<T>): Ref<T> {
        this.requireOwnVar(ref, 'getVar()');
        return this.mine({ kind: 'var', id: ref.id, name: ref.name });
    }

    // ========== Comparisons ==========

    /** Strict equality (===) */
    eq(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'eq', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Strict inequality (!==) */
    neq(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'neq', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Less than (<) */
    lt(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'lt', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Greater than (>) */
    gt(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'gt', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Less than or equal (<=) */
    lte(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'lte', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Greater than or equal (>=) */
    gte(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'gte', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    // ========== Arithmetic Operations ==========

    /** Addition (a + b) */
    add(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'add', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Subtraction (a - b) */
    sub(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'sub', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Multiplication (a * b) */
    mul(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'mul', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Division (a / b) */
    div(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'div', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Modulo (a % b) */
    mod(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'mod', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    // ========== Bitwise Operations ==========

    /** Bitwise AND (a & b) */
    bitAnd(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'bitAnd', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Bitwise OR (a | b) */
    bitOr(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'bitOr', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Bitwise XOR (a ^ b) */
    bitXor(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'bitXor', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Left shift (a << b) */
    shl(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'shl', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Right shift (a >> b) */
    shr(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'shr', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Unsigned right shift (a >>> b) */
    ushr(a: Ref<number>, b: Ref<number>): Ref<number> {
        return new Ref({ kind: 'ushr', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    // ========== Method Calls ==========

    /** Call method on object: obj.method(args...) */
    method<T>(obj: Ref, method: string, ...args: Ref[]): Ref<T> {
        return new Ref(
            { kind: 'method', obj: this.own(obj), method, args: args.map(a => this.own(a)) },
            obj.decl !== NO_DECL ? obj.decl : declOfAll(args),
        );
    }

    // ========== Logical Operations ==========

    /** Logical NOT (!) */
    not(a: Ref): Ref<boolean> {
        return new Ref({ kind: 'not', a: this.own(a) }, a.decl);
    }

    /** Logical AND (&&) */
    and(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'and', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Logical OR (||) */
    or(a: Ref, b: Ref): Ref<boolean> {
        return new Ref({ kind: 'or', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    /** Nullish coalescing (??) */
    nullish<T>(a: Ref<T>, b: Ref<T>): Ref<T> {
        return new Ref({ kind: 'nullish', a: this.own(a), b: this.own(b) }, declOf(a, b));
    }

    // ========== Type Checks ==========

    /** typeof operator */
    typeof_(value: Ref): Ref<string> {
        return new Ref({ kind: 'typeof', value: this.own(value) }, value.decl);
    }

    /** typeof === type check */
    isType(value: Ref, type: string): Ref<boolean> {
        return new Ref({ kind: 'isType', value: this.own(value), type }, value.decl);
    }

    /** value === null */
    isNull(value: Ref): Ref<boolean> {
        return new Ref({ kind: 'isNull', value: this.own(value) }, value.decl);
    }

    /** value == null (null or undefined) */
    isNullish(value: Ref): Ref<boolean> {
        return new Ref({ kind: 'isNullish', value: this.own(value) }, value.decl);
    }

    /** value instanceof ctor */
    isInstance(value: Ref, ctor: Function): Ref<boolean> {
        return new Ref({ kind: 'instanceof', value: this.own(value), ctor }, value.decl);
    }

    // ========== Control Flow ==========

    /** Conditional (if/else) */
    if_(cond: Ref<boolean>, then: () => Ref | void, else_?: () => Ref | void): void {
        this.saveStmts();
        const thenResult = then();
        const thenStmts = this.restoreStmts();
        const thenBlock: Block = { stmts: thenStmts };
        if (thenResult !== undefined) {
            thenBlock.stmts.push({ kind: 'return', value: this.own(thenResult) });
        }

        let elseBlock: Block | undefined;
        if (else_) {
            this.saveStmts();
            const elseResult = else_();
            const elseStmts = this.restoreStmts();
            if (elseStmts.length > 0 || elseResult !== undefined) {
                elseBlock = { stmts: elseStmts };
                if (elseResult !== undefined) {
                    elseBlock.stmts.push({ kind: 'return', value: this.own(elseResult) });
                }
            }
        }

        this.pushStmt({ kind: 'if', cond: this.own(cond), then: thenBlock, else: elseBlock });
    }

    /** Ternary expression (cond ? then : else) */
    ternary<T>(cond: Ref<boolean>, then: Ref<T>, else_: Ref<T>): Ref<T> {
        return new Ref(
            { kind: 'ternary', cond: this.own(cond), then: this.own(then), else: this.own(else_) },
            declOfAll([cond, then, else_]),
        );
    }

    /** Loop over array with element and index */
    loop(arr: Ref, fn: (elem: Ref, idx: Ref<number>) => void, names?: { elem?: string; index?: string }): void {
        const elemId = this.allocId();
        const indexId = this.allocId();

        this.saveStmts('loop');
        fn(
            this.mine({ kind: 'var', id: elemId, name: names?.elem }),
            this.mine({ kind: 'var', id: indexId, name: names?.index }),
        );
        const bodyStmts = this.restoreStmts();

        // Store variable names in LoopStmt for use by code generator
        this.pushStmt({
            kind: 'loop',
            arr: this.own(arr),
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

        this.saveStmts('loop');
        fn(this.mine({ kind: 'var', id: indexId, name: indexName }), arr);
        const bodyStmts = this.restoreStmts();

        this.pushStmt({
            kind: 'loop',
            arr: this.own(arr),
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

        this.saveStmts('loop');
        const idxRef = this.mine<number>({ kind: 'var', id: indexId, name: options?.indexName });
        const elemRef = options?.arr ? this.mine({ kind: 'var', id: elemId, name: options?.elemName }) : undefined;
        fn(idxRef, elemRef);
        const bodyStmts = this.restoreStmts();

        this.pushStmt({
            kind: 'loop',
            start: this.own(start),
            end: this.own(end),
            indexId,
            elemId,
            body: { stmts: bodyStmts },
            indexName: options?.indexName,
            arr: options?.arr ? this.own(options.arr) : undefined,
            elemName: options?.elemName,
            skipElem: !options?.arr,
        });
    }

    /** Loop over object keys */
    forIn(obj: Ref, fn: (key: Ref<string>, value: Ref) => void, keyName?: string): void {
        const keyId = this.allocId();

        this.saveStmts('loop');
        const keyRef = this.mine<string>({ kind: 'var', id: keyId, name: keyName });
        fn(keyRef, this.mine({ kind: 'get', obj: this.own(obj), key: { kind: 'var', id: keyId, name: keyName } }));
        const bodyStmts = this.restoreStmts();

        this.pushStmt({ kind: 'forIn', obj: this.own(obj), keyId, body: { stmts: bodyStmts }, keyName });
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
            this.saveStmts('loop');
            const keyRef = this.mine({ kind: 'var', id: keyId, name: keyOrValueName });
            const valueRef = this.mine({ kind: 'var', id: valueId, name: valueName });
            (fn as (key: Ref, value: Ref) => void)(keyRef, valueRef);
            const bodyStmts = this.restoreStmts();
            this.pushStmt({
                kind: 'forOf',
                iterable: this.own(iterable),
                valueId,
                keyId,
                body: { stmts: bodyStmts },
                keyName: keyOrValueName,
                valueName,
            });
        } else {
            this.saveStmts('loop');
            const valueRef = this.mine({ kind: 'var', id: valueId, name: keyOrValueName });
            (fn as (value: Ref) => void)(valueRef);
            const bodyStmts = this.restoreStmts();
            this.pushStmt({
                kind: 'forOf',
                iterable: this.own(iterable),
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
                block.stmts.push({ kind: 'return', value: this.own(result) });
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
                defaultBlock.stmts.push({ kind: 'return', value: this.own(result) });
            }
        }

        this.pushStmt({ kind: 'switch', value: this.own(value), cases: caseBlocks, default: defaultBlock });
    }

    /** While loop */
    while_(cond: Ref<boolean>, body: () => void): void {
        this.saveStmts('loop');
        body();
        const bodyStmts = this.restoreStmts();
        this.pushStmt({ kind: 'while', cond: this.own(cond), body: { stmts: bodyStmts } });
    }

    /** Break out of enclosing while loop */
    break_(): void {
        this.requireLoop('break_()', 'leave');
        this.pushStmt({ kind: 'break' });
    }

    /** Continue to next iteration of enclosing while loop */
    continue_(): void {
        this.requireLoop('continue_()', 'continue');
        this.pushStmt({ kind: 'continue' });
    }

    /**
     * `try { body } catch (error) { … } finally { … }`, with a `catch`, a `finally`, or both. A
     * callback that returns a value returns it from the function, as the branches of `if_()` do.
     *
     * The caught value is the `catch` callback's argument. A `finally` that ends abruptly — a
     * return, a break, a throw — replaces what the `try` was ending with, as in JavaScript.
     */
    try_(
        body: () => Ref | void,
        handlers: { catch?: (error: Ref) => Ref | void; finally?: () => Ref | void; errorName?: string },
    ): void {
        if (!handlers.catch && !handlers.finally) {
            throw new InvalidProgramError(
                `try_() with neither a catch nor a finally: there is nothing to do with what the body throws.`,
            );
        }
        const branch = (write: () => Ref | void): Block => {
            this.saveStmts();
            const result = write();
            const block: Block = { stmts: this.restoreStmts() };
            if (result !== undefined) block.stmts.push({ kind: 'return', value: this.own(result) });
            return block;
        };

        const bodyBlock = branch(body);
        let errorId: number | undefined;
        let catchBlock: Block | undefined;
        if (handlers.catch) {
            const id = (errorId = this.allocId());
            const onCatch = handlers.catch;
            catchBlock = branch(() => onCatch(this.mine({ kind: 'var', id, name: handlers.errorName })));
        }
        const finallyBlock = handlers.finally ? branch(handlers.finally) : undefined;

        this.pushStmt({
            kind: 'try',
            body: bodyBlock,
            errorId,
            errorName: handlers.errorName,
            catch: catchBlock,
            finally: finallyBlock,
        });
    }

    /**
     * Wait for a promise: `await value`, bound to a variable. Only the statements of an async
     * function may wait — one declared with `fnAsync()`. The body of `map()` is a plain function
     * of its own and cannot, whatever encloses it.
     */
    await_<T = any>(value: Ref, name?: string): Ref<T> {
        if (!this.awaits) {
            throw new InvalidProgramError(
                this.async
                    ? `await_() inside the body of map(): that body is a plain function of its own and cannot wait. ` +
                          `Write a loop, whose body belongs to the async function.`
                    : `await_() in a function that is not async: declare it with fnAsync().`,
            );
        }
        const id = this.allocId();
        this.pushStmt({ kind: 'await', id, expr: this.own(value), name });
        return this.mine({ kind: 'var', id, name });
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
                    currentElse.stmts.push({ kind: 'return', value: this.own(result) });
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
                thenBlock.stmts.push({ kind: 'return', value: this.own(result) });
            }

            if (i === 0) {
                // First condition - emit the if statement
                this.pushStmt({ kind: 'if', cond: this.own(cond), then: thenBlock, else: currentElse });
            } else {
                // Middle conditions - wrap in else block
                currentElse = { stmts: [{ kind: 'if', cond: this.own(cond), then: thenBlock, else: currentElse }] };
            }
        }
    }

    // ========== Side Effects ==========

    /** Execute expression for side effects */
    exec(expr: Ref): void {
        this.pushStmt({ kind: 'exec', expr: this.own(expr) });
    }

    /** Return from the current function (void or with value) */
    return_(value?: Ref): void {
        this.pushStmt({ kind: 'return', value: value ? this.own(value) : undefined });
    }

    /** Throw an error */
    throw_(error: Ref): void {
        this.pushStmt({ kind: 'throw', error: this.own(error) });
    }

    // ========== String Operations ==========

    /** Concatenate strings */
    concat(...parts: Ref[]): Ref<string> {
        return new Ref({ kind: 'concat', parts: parts.map(p => this.own(p)) }, declOfAll(parts));
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
        // The body is ONE expression. A statement written while it was built (a `let`, a loop)
        // would be dropped, and the variable it binds read where nothing bound it.
        if (innerBuilder.stmts.length > 0) {
            const kinds = [...new Set(innerBuilder.stmts.map(stmt => stmt.kind))].join(', ');
            throw new InvalidProgramError(
                `subFn(): its body is one expression, and this one wrote ${innerBuilder.stmts.length} statement(s) (${kinds}) ` +
                    `that would be dropped. Declare a function with fn() where the body needs statements.`,
            );
        }
        // The body is a declaration of its own: it sees its one input, nothing of the function
        // around it. What the whole expression reads of THIS declaration is its argument.
        const bodyExpr = innerBuilder.own(bodyResult);
        return new Ref(
            {
                kind: 'subFn',
                arg: this.own(arg),
                body: bodyExpr,
                fnId,
            },
            arg.decl,
        );
    }

    // ========== Build ==========

    /** Build the block (for internal use) */
    build(returnExpr?: Ref): Block {
        return {
            stmts: this.stmts,
            returnExpr: returnExpr ? this.own(returnExpr) : undefined,
            nestedFunctions: this.nestedFnDefs.size > 0 ? new Map(this.nestedFnDefs) : undefined,
        };
    }
}
