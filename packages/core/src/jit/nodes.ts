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
 * The tree: every expression and statement kind a function can be built from, and the block that
 * holds them. Types only, plus the two runtime lists of kinds. Nothing here imports anything.
 */

// ============================================================================
// Expression Tree Types (Tagged Unions)
// ============================================================================

/** Literal value expression */
export interface LitExpr {
    readonly kind: 'lit';
    readonly value: any;
}

/** Input argument reference */
export interface InputExpr {
    readonly kind: 'input';
    readonly index: number;
}

/** Variable reference */
export interface VarExpr {
    readonly kind: 'var';
    readonly id: number;
    readonly name?: string;
}

/** Property access: obj.key or obj[key] */
export interface GetExpr {
    readonly kind: 'get';
    readonly obj: Expr;
    readonly key: string | Expr;
}

/** Array element access: arr[index] */
export interface AtExpr {
    readonly kind: 'at';
    readonly arr: Expr;
    readonly index: number | Expr;
}

/** Function call: fn(args...) */
export interface CallExpr {
    readonly kind: 'call';
    readonly fn: Function;
    readonly args: readonly Expr[];
}

/** Constructor call: new Ctor(args...) */
export interface NewExpr {
    readonly kind: 'new';
    readonly ctor: new (...args: any[]) => any;
    readonly args: readonly Expr[];
}

/** Object literal: { key: value, ... } */
export interface ObjExpr {
    readonly kind: 'obj';
    readonly entries: readonly (readonly [string | Expr, Expr])[];
}

/** Array literal: [elem, ...] */
export interface ArrExpr {
    readonly kind: 'arr';
    readonly elements: readonly Expr[];
}

/** Strict equality: a === b */
export interface EqExpr {
    readonly kind: 'eq';
    readonly a: Expr;
    readonly b: Expr;
}

/** Strict inequality: a !== b */
export interface NeqExpr {
    readonly kind: 'neq';
    readonly a: Expr;
    readonly b: Expr;
}

/** Less than: a < b */
export interface LtExpr {
    readonly kind: 'lt';
    readonly a: Expr;
    readonly b: Expr;
}

/** Greater than: a > b */
export interface GtExpr {
    readonly kind: 'gt';
    readonly a: Expr;
    readonly b: Expr;
}

/** Less than or equal: a <= b */
export interface LteExpr {
    readonly kind: 'lte';
    readonly a: Expr;
    readonly b: Expr;
}

/** Greater than or equal: a >= b */
export interface GteExpr {
    readonly kind: 'gte';
    readonly a: Expr;
    readonly b: Expr;
}

/** Logical NOT: !a */
export interface NotExpr {
    readonly kind: 'not';
    readonly a: Expr;
}

/** Logical AND: a && b */
export interface AndExpr {
    readonly kind: 'and';
    readonly a: Expr;
    readonly b: Expr;
}

/** Logical OR: a || b */
export interface OrExpr {
    readonly kind: 'or';
    readonly a: Expr;
    readonly b: Expr;
}

/** Nullish coalescing: a ?? b */
export interface NullishExpr {
    readonly kind: 'nullish';
    readonly a: Expr;
    readonly b: Expr;
}

/** typeof operator */
export interface TypeofExpr {
    readonly kind: 'typeof';
    readonly value: Expr;
}

/** typeof === type check */
export interface IsTypeExpr {
    readonly kind: 'isType';
    readonly value: Expr;
    readonly type: string;
}

/** value === null */
export interface IsNullExpr {
    readonly kind: 'isNull';
    readonly value: Expr;
}

/** value == null (null or undefined) */
export interface IsNullishExpr {
    readonly kind: 'isNullish';
    readonly value: Expr;
}

/** Property existence: key in obj */
export interface HasExpr {
    readonly kind: 'has';
    readonly obj: Expr;
    readonly key: string | Expr;
}

/** Length access: value.length */
export interface LenExpr {
    readonly kind: 'len';
    readonly value: Expr;
}

/** Ternary: cond ? then : else */
export interface TernaryExpr {
    readonly kind: 'ternary';
    readonly cond: Expr;
    readonly then: Expr;
    readonly else: Expr;
}

/** instanceof check */
export interface InstanceofExpr {
    readonly kind: 'instanceof';
    readonly value: Expr;
    readonly ctor: Function;
}

/** String concatenation: a + b + c */
export interface ConcatExpr {
    readonly kind: 'concat';
    readonly parts: readonly Expr[];
}

/** Addition: a + b (numeric) */
export interface AddExpr {
    readonly kind: 'add';
    readonly a: Expr;
    readonly b: Expr;
}

/** Subtraction: a - b */
export interface SubExpr {
    readonly kind: 'sub';
    readonly a: Expr;
    readonly b: Expr;
}

/** Multiplication: a * b */
export interface MulExpr {
    readonly kind: 'mul';
    readonly a: Expr;
    readonly b: Expr;
}

/** Division: a / b */
export interface DivExpr {
    readonly kind: 'div';
    readonly a: Expr;
    readonly b: Expr;
}

/** Modulo: a % b */
export interface ModExpr {
    readonly kind: 'mod';
    readonly a: Expr;
    readonly b: Expr;
}

/** Bitwise AND: a & b */
export interface BitAndExpr {
    readonly kind: 'bitAnd';
    readonly a: Expr;
    readonly b: Expr;
}

/** Bitwise OR: a | b */
export interface BitOrExpr {
    readonly kind: 'bitOr';
    readonly a: Expr;
    readonly b: Expr;
}

/** Bitwise XOR: a ^ b */
export interface BitXorExpr {
    readonly kind: 'bitXor';
    readonly a: Expr;
    readonly b: Expr;
}

/** Left shift: a << b */
export interface ShlExpr {
    readonly kind: 'shl';
    readonly a: Expr;
    readonly b: Expr;
}

/** Right shift: a >> b */
export interface ShrExpr {
    readonly kind: 'shr';
    readonly a: Expr;
    readonly b: Expr;
}

/** Unsigned right shift: a >>> b */
export interface UshrExpr {
    readonly kind: 'ushr';
    readonly a: Expr;
    readonly b: Expr;
}

/** Method call: obj.method(args...) */
export interface MethodExpr {
    readonly kind: 'method';
    readonly obj: Expr;
    readonly method: string;
    readonly args: readonly Expr[];
}

/** Array map: arr.map((elem, idx) => body) */
export interface MapExpr {
    readonly kind: 'map';
    readonly arr: Expr;
    readonly elemId: number;
    readonly indexId: number;
    readonly body: Block;
}

/**
 * Helper function call: generates a separate helper function for better V8 optimization.
 * This is used to extract nested object checks into separate functions like Typia does.
 *
 * Generated code pattern:
 *   const _fn_N = (v0) => body;
 *   ... _fn_N(arg) ...
 */
export interface SubFnExpr {
    readonly kind: 'subFn';
    /** The argument to pass to the helper function */
    readonly arg: Expr;
    /** The body expression (uses input(0) to refer to the arg) */
    readonly body: Expr;
    /** Unique ID for this helper function */
    readonly fnId: number;
}

/** Union of all expression types */
export type Expr =
    | LitExpr
    | InputExpr
    | VarExpr
    | GetExpr
    | AtExpr
    | CallExpr
    | NewExpr
    | ObjExpr
    | ArrExpr
    | EqExpr
    | NeqExpr
    | LtExpr
    | GtExpr
    | LteExpr
    | GteExpr
    | NotExpr
    | AndExpr
    | OrExpr
    | NullishExpr
    | TypeofExpr
    | IsTypeExpr
    | IsNullExpr
    | IsNullishExpr
    | HasExpr
    | LenExpr
    | TernaryExpr
    | InstanceofExpr
    | ConcatExpr
    | AddExpr
    | SubExpr
    | MulExpr
    | DivExpr
    | ModExpr
    | BitAndExpr
    | BitOrExpr
    | BitXorExpr
    | ShlExpr
    | ShrExpr
    | UshrExpr
    | MethodExpr
    | MapExpr
    | SubFnExpr;

// ============================================================================
// Statement Types
// ============================================================================

/** Variable declaration: let id = expr */
export interface LetStmt {
    readonly kind: 'let';
    readonly id: number;
    readonly expr: Expr;
    readonly name?: string;
}

/** Property assignment: obj.key = value or obj[key] = value */
export interface SetStmt {
    readonly kind: 'set';
    readonly obj: Expr;
    readonly key: string | Expr;
    readonly value: Expr;
}

/** Array push: arr.push(value) */
export interface PushStmt {
    readonly kind: 'push';
    readonly arr: Expr;
    readonly value: Expr;
}

/** Variable assignment: id = value */
export interface SetVarStmt {
    readonly kind: 'setVar';
    readonly id: number;
    readonly value: Expr;
}

/** Execute expression for side effects */
export interface ExecStmt {
    readonly kind: 'exec';
    readonly expr: Expr;
}

/** Early return */
export interface ReturnStmt {
    readonly kind: 'return';
    readonly value?: Expr;
}

/** Throw error */
export interface ThrowStmt {
    readonly kind: 'throw';
    readonly error: Expr;
}

/** If statement with optional else */
export interface IfStmt {
    readonly kind: 'if';
    readonly cond: Expr;
    readonly then: Block;
    readonly else?: Block;
}

/** For loop over array (optionally with custom start/end range) */
export interface LoopStmt {
    readonly kind: 'loop';
    /** Array to iterate over. Required unless start/end are both provided. */
    readonly arr?: Expr;
    readonly elemId: number;
    readonly indexId: number;
    readonly body: Block;
    readonly elemName?: string;
    readonly indexName?: string;
    /** If true, don't generate element variable (only index needed) */
    readonly skipElem?: boolean;
    /** Start index (default: 0) */
    readonly start?: Expr;
    /** End index (default: arr.length) */
    readonly end?: Expr;
}

/** For-in loop over object keys */
export interface ForInStmt {
    readonly kind: 'forIn';
    readonly obj: Expr;
    readonly keyId: number;
    readonly body: Block;
    readonly keyName?: string;
}

/** For-of loop over iterables (Map, Set, etc.) */
export interface ForOfStmt {
    readonly kind: 'forOf';
    /** The iterable expression (Map, Set, array, etc.) */
    readonly iterable: Expr;
    /** Variable ID for the iteration value */
    readonly valueId: number;
    /** Optional variable ID for destructured key (used with Map entries) */
    readonly keyId?: number;
    readonly body: Block;
    readonly valueName?: string;
    readonly keyName?: string;
}

/** Switch statement */
export interface SwitchStmt {
    readonly kind: 'switch';
    readonly value: Expr;
    readonly cases: readonly (readonly [any, Block])[];
    readonly default?: Block;
}

/** While loop */
export interface WhileStmt {
    readonly kind: 'while';
    readonly cond: Expr;
    readonly body: Block;
}

/** Break statement (exits enclosing while loop) */
export interface BreakStmt {
    readonly kind: 'break';
}

/** Continue statement (skips to next iteration of enclosing while loop) */
export interface ContinueStmt {
    readonly kind: 'continue';
}

/**
 * Wait for a promise and bind what it resolves to: `var id = await expr`. A statement, not an
 * expression: where a function waits is then a place in its statement list, the expressions of
 * both modes stay synchronous, and only an async function may hold one (the Builder refuses it
 * anywhere else).
 */
export interface AwaitStmt {
    readonly kind: 'await';
    readonly id: number;
    readonly expr: Expr;
    readonly name?: string;
}

/**
 * `try { body } catch (error) { catch } finally { finally }` — with a `catch`, a `finally`, or
 * both. The caught value is bound to the variable `errorId`. A `finally` block that ends abruptly
 * (a return, a break, a throw) replaces what the `try` was ending with, as in JavaScript.
 */
export interface TryStmt {
    readonly kind: 'try';
    readonly body: Block;
    readonly errorId?: number;
    readonly errorName?: string;
    readonly catch?: Block;
    readonly finally?: Block;
}

/** Union of all statement types */
export type Stmt =
    | LetStmt
    | SetStmt
    | PushStmt
    | SetVarStmt
    | ExecStmt
    | ReturnStmt
    | ThrowStmt
    | IfStmt
    | LoopStmt
    | ForInStmt
    | ForOfStmt
    | SwitchStmt
    | WhileStmt
    | BreakStmt
    | ContinueStmt
    | AwaitStmt
    | TryStmt;

/** Block of statements with optional return expression */
/** Nested function definition: a full function body to be emitted inside the parent's compilation unit */
export interface NestedFnDef {
    readonly block: Block;
    readonly inputNames: string[];
    /** Default per argument, `undefined` where there is none. */
    readonly inputDefaults?: readonly unknown[];
    /** An async function: it answers a promise, and its statements may `await`. */
    readonly async?: boolean;
}

export interface Block {
    readonly stmts: Stmt[];
    returnExpr?: Expr;
    /** Nested function definitions that should be emitted inside the parent's IIFE */
    nestedFunctions?: Map<number, NestedFnDef>;
}

// ============================================================================
// The shape of each kind
// ============================================================================

/** Called on a child; answering `true` stops the walk. */
export type VisitExpr = (expr: Expr) => boolean;
export type VisitBlock = (block: Block) => boolean;

/**
 * What a kind is MADE OF — the one statement of it, for everything that walks a tree without
 * caring what the kind does (whether an expression reads a variable). What a kind DOES is the two
 * modes' business: one case each in `codegen.ts` and `exec.ts`.
 *
 * Each visitor calls `visit` on the children it names, in the order they are evaluated, until one
 * answers `true`, and answers whether one did — so a search stops early and a walk that wants
 * every child answers `false`.
 */
export interface Shape<N> {
    /** The node's operands: the expressions evaluated where the node itself is. */
    exprs(node: N, visit: VisitExpr): boolean;
    /** The blocks the node runs. */
    blocks?(node: N, visit: VisitBlock): boolean;
    /**
     * Expressions that are the body of ANOTHER declaration (`subFn`): built by a Builder of their
     * own, with their own inputs and their own variables.
     */
    inner?(node: N, visit: VisitExpr): boolean;
}

const none = (): boolean => false;
const binary = (node: { a: Expr; b: Expr }, visit: VisitExpr): boolean => visit(node.a) || visit(node.b);
const value = (node: { value: Expr }, visit: VisitExpr): boolean => visit(node.value);
/** A key or an index is an operand only when it is not written into the node as a constant. */
const operand = (part: string | number | Expr, visit: VisitExpr): boolean => typeof part === 'object' && visit(part);

/**
 * The shape of every expression kind. The record must name each member of {@link Expr} exactly
 * once — a kind added to the union without a row here does not compile.
 */
export const EXPR_SHAPE: { [K in Expr['kind']]: Shape<Extract<Expr, { kind: K }>> } = {
    lit: { exprs: none },
    input: { exprs: none },
    var: { exprs: none },
    get: { exprs: (node, visit) => visit(node.obj) || operand(node.key, visit) },
    at: { exprs: (node, visit) => visit(node.arr) || operand(node.index, visit) },
    call: { exprs: (node, visit) => node.args.some(visit) },
    new: { exprs: (node, visit) => node.args.some(visit) },
    obj: { exprs: (node, visit) => node.entries.some(([key, entry]) => operand(key, visit) || visit(entry)) },
    arr: { exprs: (node, visit) => node.elements.some(visit) },
    eq: { exprs: binary },
    neq: { exprs: binary },
    lt: { exprs: binary },
    gt: { exprs: binary },
    lte: { exprs: binary },
    gte: { exprs: binary },
    not: { exprs: (node, visit) => visit(node.a) },
    and: { exprs: binary },
    or: { exprs: binary },
    nullish: { exprs: binary },
    typeof: { exprs: value },
    isType: { exprs: value },
    isNull: { exprs: value },
    isNullish: { exprs: value },
    has: { exprs: (node, visit) => visit(node.obj) || operand(node.key, visit) },
    len: { exprs: value },
    ternary: { exprs: (node, visit) => visit(node.cond) || visit(node.then) || visit(node.else) },
    instanceof: { exprs: value },
    concat: { exprs: (node, visit) => node.parts.some(visit) },
    add: { exprs: binary },
    sub: { exprs: binary },
    mul: { exprs: binary },
    div: { exprs: binary },
    mod: { exprs: binary },
    bitAnd: { exprs: binary },
    bitOr: { exprs: binary },
    bitXor: { exprs: binary },
    shl: { exprs: binary },
    shr: { exprs: binary },
    ushr: { exprs: binary },
    method: { exprs: (node, visit) => visit(node.obj) || node.args.some(visit) },
    map: { exprs: (node, visit) => visit(node.arr), blocks: (node, visit) => visit(node.body) },
    subFn: { exprs: (node, visit) => visit(node.arg), inner: (node, visit) => visit(node.body) },
};

/** The shape of every statement kind — held complete the same way as {@link EXPR_SHAPE}. */
export const STMT_SHAPE: { [K in Stmt['kind']]: Shape<Extract<Stmt, { kind: K }>> } = {
    let: { exprs: (node, visit) => visit(node.expr) },
    set: { exprs: (node, visit) => visit(node.obj) || operand(node.key, visit) || visit(node.value) },
    push: { exprs: (node, visit) => visit(node.arr) || visit(node.value) },
    setVar: { exprs: value },
    exec: { exprs: (node, visit) => visit(node.expr) },
    return: { exprs: (node, visit) => node.value !== undefined && visit(node.value) },
    throw: { exprs: (node, visit) => visit(node.error) },
    if: {
        exprs: (node, visit) => visit(node.cond),
        blocks: (node, visit) => visit(node.then) || (node.else !== undefined && visit(node.else)),
    },
    loop: {
        exprs: (node, visit) =>
            (node.arr !== undefined && visit(node.arr)) ||
            (node.start !== undefined && visit(node.start)) ||
            (node.end !== undefined && visit(node.end)),
        blocks: (node, visit) => visit(node.body),
    },
    forIn: { exprs: (node, visit) => visit(node.obj), blocks: (node, visit) => visit(node.body) },
    forOf: { exprs: (node, visit) => visit(node.iterable), blocks: (node, visit) => visit(node.body) },
    switch: {
        exprs: value,
        blocks: (node, visit) =>
            node.cases.some(([, block]) => visit(block)) || (node.default !== undefined && visit(node.default)),
    },
    while: { exprs: (node, visit) => visit(node.cond), blocks: (node, visit) => visit(node.body) },
    break: { exprs: none },
    continue: { exprs: none },
    await: { exprs: (node, visit) => visit(node.expr) },
    try: {
        exprs: none,
        blocks: (node, visit) =>
            visit(node.body) ||
            (node.catch !== undefined && visit(node.catch)) ||
            (node.finally !== undefined && visit(node.finally)),
    },
};

/** The shape of `expr`, read from the table. */
export function shapeOfExpr(expr: Expr): Shape<Expr> {
    return EXPR_SHAPE[expr.kind] as Shape<Expr>;
}

/** The shape of `stmt`, read from the table. */
export function shapeOfStmt(stmt: Stmt): Shape<Stmt> {
    return STMT_SHAPE[stmt.kind] as Shape<Stmt>;
}

/** Every expression kind, as a runtime list: the rows of {@link EXPR_SHAPE}, in their order. */
export const EXPR_KINDS = Object.keys(EXPR_SHAPE) as Expr['kind'][];

/** Every statement kind, as a runtime list: the rows of {@link STMT_SHAPE}, in their order. */
export const STMT_KINDS = Object.keys(STMT_SHAPE) as Stmt['kind'][];
