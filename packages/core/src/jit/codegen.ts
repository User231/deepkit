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
 * The compiled mode: `CodeGenerator` writes a block as JavaScript source and builds it with
 * `new Function`.
 */
import { Block, Expr, NestedFnDef, Stmt } from './nodes.js';
import { jitDebug } from './runtime.js';

// ============================================================================
// Code Generator (JIT Mode)
// ============================================================================

const identifierRegex = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * A name hint as a JavaScript binding can carry it: every character a binding
 * refuses becomes `_`, and a leading digit (or nothing) gets one in front.
 */
export function sanitizeIdentifier(name: string): string {
    let sanitized = name.replace(/[^a-zA-Z0-9_$]/g, '_');
    if (sanitized.length === 0 || /^[0-9]/.test(sanitized)) {
        sanitized = '_' + sanitized;
    }
    return sanitized;
}

function isValidIdentifier(key: string): boolean {
    return identifierRegex.test(key);
}

/**
 * How tightly the text the generator emits for a node binds, in JavaScript's own order. Only the
 * levels the generator leaves unparenthesized are named: everything it wraps itself — `(a+b)`,
 * `(a||b)`, `(a?b:c)`, `(k in o)` — is primary.
 */
const PREC_AND = 4;
const PREC_EQUALITY = 8;
const PREC_RELATIONAL = 9;
const PREC_UNARY = 14;
const PREC_MEMBER = 17;
const PREC_PRIMARY = 18;

/** `!isNull(x)` and `!isNullish(x)` are emitted as comparisons. */
const notPrecedence = (expr: Extract<Expr, { kind: 'not' }>): number =>
    expr.a.kind === 'isNull' || expr.a.kind === 'isNullish' ? PREC_EQUALITY : PREC_UNARY;

/** `-1`, `-Infinity`, `-5n` are a unary minus and a literal; `-0` is emitted as `(-0)`. */
const litPrecedence = (expr: Extract<Expr, { kind: 'lit' }>): number => {
    const value = expr.value;
    if (typeof value === 'number' && value < 0) return PREC_UNARY;
    if (typeof value === 'bigint' && value < 0n) return PREC_UNARY;
    return PREC_PRIMARY;
};

/**
 * The level of the text {@link CodeGenerator} emits for each kind — kept beside it, row by case.
 * Every kind has a row: one that is left out does not compile, where a `default` would have
 * called its text primary and left it without the parentheses it needs.
 */
const EMITTED_PRECEDENCE: { [K in Expr['kind']]: number | ((expr: Extract<Expr, { kind: K }>) => number) } = {
    lit: litPrecedence,
    input: PREC_PRIMARY,
    var: PREC_PRIMARY,
    get: PREC_MEMBER,
    at: PREC_MEMBER,
    call: PREC_MEMBER,
    new: PREC_MEMBER,
    obj: PREC_PRIMARY,
    arr: PREC_PRIMARY,
    eq: PREC_EQUALITY,
    neq: PREC_EQUALITY,
    lt: PREC_RELATIONAL,
    gt: PREC_RELATIONAL,
    lte: PREC_RELATIONAL,
    gte: PREC_RELATIONAL,
    not: notPrecedence,
    and: PREC_AND,
    // Everything below that is primary is text the generator wraps itself.
    or: PREC_PRIMARY,
    nullish: PREC_PRIMARY,
    typeof: PREC_UNARY,
    isType: PREC_EQUALITY,
    isNull: PREC_EQUALITY,
    isNullish: PREC_EQUALITY,
    has: PREC_PRIMARY,
    len: PREC_MEMBER,
    ternary: PREC_PRIMARY,
    instanceof: PREC_PRIMARY,
    concat: PREC_PRIMARY,
    add: PREC_PRIMARY,
    sub: PREC_PRIMARY,
    mul: PREC_PRIMARY,
    div: PREC_PRIMARY,
    mod: PREC_PRIMARY,
    bitAnd: PREC_PRIMARY,
    bitOr: PREC_PRIMARY,
    bitXor: PREC_PRIMARY,
    shl: PREC_PRIMARY,
    shr: PREC_PRIMARY,
    ushr: PREC_PRIMARY,
    method: PREC_MEMBER,
    map: PREC_MEMBER,
    subFn: PREC_MEMBER,
    invoke: PREC_MEMBER,
};

/** `_nfn_<id>`, with the function's name hint after it where it has one. */
function nestedFnName(id: number, def: NestedFnDef | undefined): string {
    return def?.name ? `_nfn_${id}_${sanitizeIdentifier(def.name)}` : `_nfn_${id}`;
}

function emittedPrecedence(expr: Expr): number {
    const level = EMITTED_PRECEDENCE[expr.kind] as number | ((expr: Expr) => number);
    return typeof level === 'number' ? level : level(expr);
}

export class CodeGenerator {
    private externals: Map<any, string>;
    /** Per name hint, how many names were handed out for it. */
    private reservedNames: Map<string, number>;
    /**
     * Ids of the nested functions whose definition THIS compilation unit emits (shared with child
     * generators). A marker outside this set came from another Builder — a sub-function cached per
     * type and reused across top-level compiles — and must be adopted, see {@link addExternal}.
     */
    private ownedNested: Set<number>;
    /** Definitions adopted from other units (id → code), emitted at the `new Function` scope level. */
    private adoptedNested: Map<number, string>;
    /**
     * Which nested functions the text of each function refers to (shared with child generators):
     * referrer → the ids it names. Read after generation to find the nested functions that
     * nothing in the unit calls — see {@link compile}.
     */
    private nestedRefs: Map<number, Set<number>>;
    /**
     * Whose text this generator writes: a nested function's id, or {@link UNIT_FN} for text that
     * is always part of the unit — its own function, a helper, an adopted definition's caller.
     */
    private referrer: number;
    private argCount: number;
    /** Helper functions collected during code generation: fnId -> code */
    private helperFunctions = new Map<number, string>();
    /** Variable name hints: id -> name */
    private varNames = new Map<number, string>();
    /** Input argument names */
    private inputNames: string[];
    /** Current indentation level */
    private indentLevel = 0;
    /** Indentation string (4 spaces) */
    private readonly indentStr = '    ';

    /** Default values for input arguments (undefined means no default) */
    private inputDefaults: readonly unknown[];
    /**
     * The loops being emitted, innermost last. A `break` inside a `switch` would leave the switch,
     * not the loop the tree means, so it is emitted with the loop's label — and only a loop that
     * such a break names gets one.
     */
    private loops: { label: string; labelled: boolean; switchDepth: number }[] = [];
    private nextLabel = 0;

    constructor(
        argCount: number,
        inputNames?: string[],
        sharedState?: {
            externals: Map<any, string>;
            reservedNames: Map<string, number>;
            ownedNested?: Set<number>;
            adoptedNested?: Map<number, string>;
            nestedRefs?: Map<number, Set<number>>;
            referrer?: number;
        },
        inputDefaults?: readonly unknown[],
        /** The unit's own function is an async function. */
        private readonly isAsync = false,
        /** What the unit's own function is called (a hint, see `NestedFnDef.name`). */
        private readonly fnName?: string,
    ) {
        this.argCount = argCount;
        // Share externals/reservedNames/nested bookkeeping with parent CodeGenerator if provided
        this.externals = sharedState?.externals || new Map();
        this.reservedNames = sharedState?.reservedNames || new Map();
        this.ownedNested = sharedState?.ownedNested || new Set();
        this.adoptedNested = sharedState?.adoptedNested || new Map();
        this.nestedRefs = sharedState?.nestedRefs || new Map();
        this.referrer = sharedState?.referrer ?? UNIT_FN;
        // Use provided names or default to v0, v1, ...
        this.inputNames =
            inputNames && inputNames.length === argCount
                ? inputNames
                : Array.from({ length: argCount }, (_, i) => `v${i}`);
        // Store defaults (undefined means no default for that arg)
        this.inputDefaults = inputDefaults || [];
    }

    /** Get current indentation */
    private get indent(): string {
        return this.indentStr.repeat(this.indentLevel);
    }

    /**
     * Get variable name by id. A hint is a HINT, not an identifier: builders
     * pass property names through (`b.var_(UNSET, 'carried-differently')`), so
     * every character JavaScript refuses in a binding is replaced — the same
     * rule {@link reserveName} applies to external references.
     */
    private varName(id: number): string {
        const name = this.varNames.get(id);
        return name ? `${sanitizeIdentifier(name)}_${id}` : `v${id}`;
    }

    /** Register a variable name hint */
    registerVarName(id: number, name: string): void {
        this.varNames.set(id, name);
    }

    private reserveName(name: string): string {
        const sanitized = sanitizeIdentifier(name);
        // `hint_0`, `hint_1`, …: the next free one. Names are reserved here only, so the count of
        // those handed out for a hint is the next index — a unit may hold thousands (an injector's
        // module), and looking for the first free one from 0 each time was quadratic and capped.
        const index = this.reservedNames.get(sanitized) ?? 0;
        this.reservedNames.set(sanitized, index + 1);
        return sanitized + '_' + index;
    }

    private addExternal(value: any, hint: string = 'ext'): string {
        // Check for nested function marker — use the nested function name directly
        if (value && typeof value === 'function' && typeof (value as any).__nestedFnId === 'number') {
            const id: number = (value as any).__nestedFnId;
            let refs = this.nestedRefs.get(this.referrer);
            if (!refs) this.nestedRefs.set(this.referrer, (refs = new Set()));
            refs.add(id);
            if (!this.ownedNested.has(id)) {
                // The marker was registered on a DIFFERENT Builder: a sub-function compiled while
                // building one type, cached, and now referenced from another top-level compile.
                // Its definition is not part of this unit — emitting `_nfn_N(...)` alone would be
                // a ReferenceError at call time. Adopt the definition into this unit (hoisted
                // function declarations, so placement does not matter); without one at hand,
                // fall through and call the marker's closure executor as a plain external.
                const def = (value as any).__nestedFnDef as NestedFnDef | undefined;
                if (def) {
                    this.adoptedNested.set(id, this.compileNestedFn(id, def));
                    return nestedFnName(id, def);
                }
            } else {
                return nestedFnName(id, (value as any).__nestedFnDef as NestedFnDef | undefined);
            }
        }
        // Check if already registered
        const registered = this.externals.get(value);
        if (registered !== undefined) return registered;
        const name = this.reserveName(hint);
        this.externals.set(value, name);
        return name;
    }

    /** The code of `expr` as an operand that must bind at least as tightly as `min`. */
    private operand(expr: Expr, min: number): string {
        const code = this.exprToCode(expr);
        return emittedPrecedence(expr) < min ? `(${code})` : code;
    }

    /** The code of `expr` as the object of `.key`, `[index]` or `.method()`. */
    private memberObject(expr: Expr): string {
        // `5.toFixed` does not parse: the dot is taken for a decimal point.
        if (expr.kind === 'lit' && typeof expr.value === 'number') return `(${this.exprToCode(expr)})`;
        return this.operand(expr, PREC_MEMBER);
    }

    /** The code of `expr` as an operand of an arithmetic, bitwise or shift operator. */
    private arithmeticOperand(expr: Expr): string {
        const code = this.operand(expr, PREC_UNARY);
        // `x--1` is a decrement followed by a number; `x-(-1)` is what the tree says.
        return code.startsWith('-') ? `(${code})` : code;
    }

    /** A statement that begins with `{` is a block, not an object literal. */
    private atStatementStart(code: string): string {
        return code.startsWith('{') ? `(${code})` : code;
    }

    private memberAccess(obj: string, key: string): string {
        return isValidIdentifier(key) ? `${obj}.${key}` : `${obj}[${JSON.stringify(key)}]`;
    }

    private binary(expr: { a: Expr; b: Expr }, operator: string, min: number): string {
        return `${this.operand(expr.a, min)}${operator}${this.operand(expr.b, min)}`;
    }

    private arithmetic(expr: { a: Expr; b: Expr }, operator: string): string {
        return `(${this.arithmeticOperand(expr.a)}${operator}${this.arithmeticOperand(expr.b)})`;
    }

    private exprToCode(expr: Expr): string {
        switch (expr.kind) {
            case 'lit':
                return this.litToCode(expr.value);
            case 'input':
                return this.inputNames[expr.index];
            case 'var':
                return this.varName(expr.id);
            case 'get': {
                const obj = this.memberObject(expr.obj);
                if (typeof expr.key === 'string') return this.memberAccess(obj, expr.key);
                return `${obj}[${this.exprToCode(expr.key)}]`;
            }
            case 'at': {
                const arr = this.memberObject(expr.arr);
                const idx = typeof expr.index === 'number' ? String(expr.index) : this.exprToCode(expr.index);
                return `${arr}[${idx}]`;
            }
            case 'call': {
                const fnName = this.addExternal(expr.fn, expr.fn.name || 'fn');
                const args = expr.args.map(a => this.exprToCode(a)).join(',');
                return `${fnName}(${args})`;
            }
            case 'new': {
                const ctorName = this.addExternal(expr.ctor, expr.ctor.name || 'Ctor');
                const args = expr.args.map(a => this.exprToCode(a)).join(',');
                return `new ${ctorName}(${args})`;
            }
            case 'obj': {
                const props = expr.entries
                    .map(([k, v]) => {
                        const key =
                            typeof k === 'string'
                                ? isValidIdentifier(k)
                                    ? k
                                    : JSON.stringify(k)
                                : `[${this.exprToCode(k)}]`;
                        return `${key}:${this.exprToCode(v)}`;
                    })
                    .join(',');
                return `{${props}}`;
            }
            case 'arr': {
                const elems = expr.elements.map(e => this.exprToCode(e)).join(',');
                return `[${elems}]`;
            }
            // An operand of `===` that is itself a comparison is wrapped: `a===b===c` compares the
            // RESULT of the first with c, whichever side the tree nested it on.
            case 'eq':
                return this.binary(expr, '===', PREC_RELATIONAL);
            case 'neq':
                return this.binary(expr, '!==', PREC_RELATIONAL);
            case 'lt':
                return this.binary(expr, '<', PREC_RELATIONAL + 1);
            case 'gt':
                return this.binary(expr, '>', PREC_RELATIONAL + 1);
            case 'lte':
                return this.binary(expr, '<=', PREC_RELATIONAL + 1);
            case 'gte':
                return this.binary(expr, '>=', PREC_RELATIONAL + 1);
            case 'not':
                // Optimize common patterns
                if (expr.a.kind === 'isNull') {
                    // !isNull(x) -> null!==x (operand-first for V8 optimization)
                    return `null!==${this.operand(expr.a.value, PREC_RELATIONAL)}`;
                }
                if (expr.a.kind === 'isNullish') {
                    // !isNullish(x) -> null!=x (intentional != for nullish check)
                    return `null!=${this.operand(expr.a.value, PREC_RELATIONAL)}`;
                }
                // Keep parentheses - !a===b parses as (!a)===b, not !(a===b)
                return `!(${this.exprToCode(expr.a)})`;
            case 'and': {
                // Flatten AND chain for optimal JS engine optimization
                // Generates: a&&b&&c instead of ((a&&b)&&c)
                const operands: Expr[] = [];
                const collect = (e: Expr): void => {
                    if (e.kind === 'and') {
                        collect(e.a);
                        collect(e.b);
                    } else {
                        operands.push(e);
                    }
                };
                collect(expr);
                return operands.map(e => this.operand(e, PREC_AND + 1)).join('&&');
            }
            case 'or': {
                // Flatten OR chain for optimal JS engine optimization
                // Wrap in parens since || has lower precedence than &&
                const operands: Expr[] = [];
                const collect = (e: Expr): void => {
                    if (e.kind === 'or') {
                        collect(e.a);
                        collect(e.b);
                    } else {
                        operands.push(e);
                    }
                };
                collect(expr);
                return `(${operands.map(e => this.operand(e, PREC_AND)).join('||')})`;
            }
            case 'nullish':
                // `a&&b??c` is a syntax error: `??` does not mix with `&&` unparenthesized.
                return `(${this.operand(expr.a, PREC_AND + 1)}??${this.operand(expr.b, PREC_AND + 1)})`;
            case 'typeof':
                return `typeof ${this.operand(expr.value, PREC_UNARY)}`;
            case 'isType':
                // Operand-first comparison is faster in V8: "string"===typeof x vs typeof x==="string"
                return `${JSON.stringify(expr.type)}===typeof ${this.operand(expr.value, PREC_UNARY)}`;
            case 'isNull':
                // Operand-first for consistency with isType
                return `null===${this.operand(expr.value, PREC_RELATIONAL)}`;
            case 'isNullish':
                return `${this.operand(expr.value, PREC_RELATIONAL)}==null`;
            case 'has': {
                const obj = this.operand(expr.obj, PREC_RELATIONAL + 1);
                const key =
                    typeof expr.key === 'string'
                        ? JSON.stringify(expr.key)
                        : this.operand(expr.key, PREC_RELATIONAL + 1);
                return `(${key} in ${obj})`;
            }
            case 'len':
                return `${this.memberObject(expr.value)}.length`;
            case 'ternary':
                return `(${this.exprToCode(expr.cond)}?${this.exprToCode(expr.then)}:${this.exprToCode(expr.else)})`;
            case 'instanceof': {
                const ctorName = this.addExternal(expr.ctor, expr.ctor.name || 'Ctor');
                return `(${this.operand(expr.value, PREC_RELATIONAL + 1)} instanceof ${ctorName})`;
            }
            case 'concat': {
                if (expr.parts.length === 0) return '""';
                // Concatenation is of strings: a leading "" keeps `1+2` from being an addition.
                // A part that is a string literal already settles it.
                const first = expr.parts[0];
                const lead = first.kind === 'lit' && typeof first.value === 'string' ? '' : '""+';
                return `(${lead}${expr.parts.map(p => this.arithmeticOperand(p)).join('+')})`;
            }
            case 'add':
                return this.arithmetic(expr, '+');
            case 'sub':
                return this.arithmetic(expr, '-');
            case 'mul':
                return this.arithmetic(expr, '*');
            case 'div':
                return this.arithmetic(expr, '/');
            case 'mod':
                return this.arithmetic(expr, '%');
            case 'bitAnd':
                return this.arithmetic(expr, '&');
            case 'bitOr':
                return this.arithmetic(expr, '|');
            case 'bitXor':
                return this.arithmetic(expr, '^');
            case 'shl':
                return this.arithmetic(expr, '<<');
            case 'shr':
                return this.arithmetic(expr, '>>');
            case 'ushr':
                return this.arithmetic(expr, '>>>');
            case 'method': {
                const args = expr.args.map(a => this.exprToCode(a)).join(',');
                return `${this.memberAccess(this.memberObject(expr.obj), expr.method)}(${args})`;
            }
            case 'map': {
                const arr = this.memberObject(expr.arr);
                // The body is a function of its own: no loop of the enclosing one reaches into it.
                const enclosingLoops = this.loops;
                this.loops = [];
                try {
                    // Check if body is simple (just a return expression, no statements)
                    if (expr.body.stmts.length === 0 && expr.body.returnExpr) {
                        const returnCode = this.exprToCode(expr.body.returnExpr);
                        const needsParens = returnCode.startsWith('{');
                        const wrapped = needsParens ? `(${returnCode})` : returnCode;
                        // Check if index is used
                        const indexUsed = returnCode.includes(`v${expr.indexId}`);
                        const params = indexUsed ? `(v${expr.elemId},v${expr.indexId})` : `v${expr.elemId}`;
                        return `${arr}.map(${params}=>${wrapped})`;
                    }
                    // Complex body - use function
                    const params = `(v${expr.elemId},v${expr.indexId})`;
                    return `${arr}.map(function${params}{${this.blockToCode(expr.body)}})`;
                } finally {
                    this.loops = enclosingLoops;
                }
            }
            case 'invoke': {
                const args = expr.args.map(a => this.exprToCode(a)).join(',');
                const fn = this.operand(expr.fn, PREC_MEMBER);
                // `o.f(x)` would call f with `this` being o. A function that is a value is
                // called with none, in both modes: `(0,o.f)(x)`.
                const isReference = expr.fn.kind === 'get' || expr.fn.kind === 'at' || expr.fn.kind === 'len';
                return isReference ? `(0,${fn})(${args})` : `${fn}(${args})`;
            }
            case 'subFn': {
                // Generate a helper function for better V8 optimization
                // This follows the Typia pattern: const _fn_N = (v0) => body;
                const fnName = `_fn_${expr.fnId}`;
                if (!this.helperFunctions.has(expr.fnId)) {
                    // The body was built by its own Builder, with one input: it is generated by a
                    // generator of its own, so `input(0)` is the helper's parameter — not whatever
                    // the enclosing function calls its first argument.
                    // A helper is emitted whoever asked for it first, so what it refers to is
                    // referred to by the unit (no `referrer`), not by the function being written.
                    const bodyGen = new CodeGenerator(1, undefined, {
                        externals: this.externals,
                        reservedNames: this.reservedNames,
                        ownedNested: this.ownedNested,
                        adoptedNested: this.adoptedNested,
                        nestedRefs: this.nestedRefs,
                    });
                    const bodyCode = bodyGen.exprToCode(expr.body);
                    for (const [fnId, code] of bodyGen.helperFunctions) {
                        this.helperFunctions.set(fnId, code);
                    }
                    this.helperFunctions.set(expr.fnId, `function ${fnName}(v0){return ${bodyCode};}`);
                }
                return `${fnName}(${this.exprToCode(expr.arg)})`;
            }
        }
    }

    private litToCode(value: any): string {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'boolean') return String(value);
        if (typeof value === 'number') {
            if (Number.isNaN(value)) return 'NaN';
            if (value === Infinity) return 'Infinity';
            if (value === -Infinity) return '-Infinity';
            if (Object.is(value, -0)) return '(-0)';
            return String(value);
        }
        if (typeof value === 'bigint') return `${value}n`;
        if (typeof value === 'string') return JSON.stringify(value);
        // Complex values use external reference
        return this.addExternal(value, 'const');
    }

    private stmtToCode(stmt: Stmt): string {
        const ind = this.indent;
        switch (stmt.kind) {
            case 'let': {
                // Register variable name if provided
                if (stmt.name) {
                    this.varNames.set(stmt.id, stmt.name);
                }
                return `${ind}var ${this.varName(stmt.id)}=${this.exprToCode(stmt.expr)};\n`;
            }
            case 'set': {
                const obj = this.atStatementStart(this.memberObject(stmt.obj));
                if (typeof stmt.key === 'string') {
                    return `${ind}${this.memberAccess(obj, stmt.key)}=${this.exprToCode(stmt.value)};\n`;
                }
                const key = this.exprToCode(stmt.key);
                return `${ind}${obj}[${key}]=${this.exprToCode(stmt.value)};\n`;
            }
            case 'push':
                return `${ind}${this.atStatementStart(this.memberObject(stmt.arr))}.push(${this.exprToCode(stmt.value)});\n`;
            case 'setVar': {
                const varName = this.varName(stmt.id);
                const value = stmt.value;
                // Detect compound assignment patterns: x = x op y → x op= y
                if (
                    value.kind === 'add' ||
                    value.kind === 'sub' ||
                    value.kind === 'mul' ||
                    value.kind === 'div' ||
                    value.kind === 'mod' ||
                    value.kind === 'bitAnd' ||
                    value.kind === 'bitOr' ||
                    value.kind === 'bitXor' ||
                    value.kind === 'shl' ||
                    value.kind === 'shr' ||
                    value.kind === 'ushr'
                ) {
                    const binOp = value as { a: Expr; b: Expr };
                    // Check if left side is the same variable
                    if (binOp.a.kind === 'var' && binOp.a.id === stmt.id) {
                        // Compound assignment: x = x + y → x += y. Not `x++` for `x + 1`: that
                        // converts to a number first, so "a" + 1 would become NaN and a bigint,
                        // which refuses `+ 1`, would count up.
                        const opMap: Record<string, string> = {
                            add: '+=',
                            sub: '-=',
                            mul: '*=',
                            div: '/=',
                            mod: '%=',
                            bitAnd: '&=',
                            bitOr: '|=',
                            bitXor: '^=',
                            shl: '<<=',
                            shr: '>>=',
                            ushr: '>>>=',
                        };
                        const op = opMap[value.kind];
                        if (op) {
                            return `${ind}${varName}${op}${this.exprToCode(binOp.b)};\n`;
                        }
                    }
                }
                return `${ind}${varName}=${this.exprToCode(value)};\n`;
            }
            case 'exec':
                return `${ind}${this.atStatementStart(this.exprToCode(stmt.expr))};\n`;
            case 'return':
                return stmt.value ? `${ind}return ${this.exprToCode(stmt.value)};\n` : `${ind}return;\n`;
            case 'throw':
                return `${ind}throw ${this.exprToCode(stmt.error)};\n`;
            case 'if': {
                this.indentLevel++;
                const thenCode = this.blockToCode(stmt.then);
                let elseCode = '';
                if (stmt.else && (stmt.else.stmts.length > 0 || stmt.else.returnExpr)) {
                    elseCode = this.blockToCode(stmt.else);
                }
                this.indentLevel--;
                let code = `${ind}if(${this.exprToCode(stmt.cond)}){\n${thenCode}${ind}}`;
                if (elseCode) {
                    code += `else{\n${elseCode}${ind}}`;
                }
                return code + '\n';
            }
            case 'loop': {
                // Register variable names if provided
                if (stmt.elemName) this.varNames.set(stmt.elemId, stmt.elemName);
                if (stmt.indexName) this.varNames.set(stmt.indexId, stmt.indexName);
                const indexName = this.varName(stmt.indexId);
                const { bodyCode, label } = this.loopBody(stmt.body);

                // The array is read ONCE, before the bounds: a source such as `f()` or `o.items`
                // written into both the bound and the element read would be evaluated per
                // iteration. An input needs no copy — nothing can reassign it.
                const readsElem = !!stmt.arr && !stmt.skipElem;
                const needsArr = !!stmt.arr && (readsElem || !stmt.end);
                let arrName = '';
                let arrDecl = '';
                if (needsArr) {
                    if (stmt.arr!.kind === 'input') {
                        arrName = this.exprToCode(stmt.arr!);
                    } else {
                        arrName = `${indexName}_arr`;
                        arrDecl = `${arrName}=${this.exprToCode(stmt.arr!)},`;
                    }
                }

                // Determine start expression (default: 0)
                const startCode = stmt.start ? this.exprToCode(stmt.start) : '0';
                // Determine end expression (default: arr.length)
                const endCode = stmt.end ? this.exprToCode(stmt.end) : `${arrName}.length`;
                const endName = `${indexName}_end`;

                // Generate element access if arr provided and not skipped
                const elemDecl = readsElem
                    ? `${ind}${this.indentStr}var ${this.varName(stmt.elemId)}=${arrName}[${indexName}];\n`
                    : '';

                return `${ind}${label}for(var ${arrDecl}${indexName}=${startCode},${endName}=${endCode};${indexName}<${endName};${indexName}++){\n${elemDecl}${bodyCode}${ind}}\n`;
            }
            case 'forIn': {
                // Register variable name if provided
                if (stmt.keyName) this.varNames.set(stmt.keyId, stmt.keyName);
                const obj = this.exprToCode(stmt.obj);
                const keyName = this.varName(stmt.keyId);
                const { bodyCode, label } = this.loopBody(stmt.body);
                return `${ind}${label}for(var ${keyName} in ${obj}){\n${bodyCode}${ind}}\n`;
            }
            case 'forOf': {
                // Register variable names if provided
                if (stmt.valueName) this.varNames.set(stmt.valueId, stmt.valueName);
                if (stmt.keyId !== undefined && stmt.keyName) this.varNames.set(stmt.keyId, stmt.keyName);
                const iterable = this.exprToCode(stmt.iterable);
                const { bodyCode, label } = this.loopBody(stmt.body);
                // For Map entries with keyId, destructure [key, value]
                if (stmt.keyId !== undefined) {
                    const keyName = this.varName(stmt.keyId);
                    const valueName = this.varName(stmt.valueId);
                    return `${ind}${label}for(var [${keyName},${valueName}] of ${iterable}){\n${bodyCode}${ind}}\n`;
                }
                // For Set or simple iteration
                const valueName = this.varName(stmt.valueId);
                return `${ind}${label}for(var ${valueName} of ${iterable}){\n${bodyCode}${ind}}\n`;
            }
            case 'switch': {
                let code = `${ind}switch(${this.exprToCode(stmt.value)}){\n`;
                const enclosingLoop = this.loops[this.loops.length - 1];
                if (enclosingLoop) enclosingLoop.switchDepth++;
                this.indentLevel++;
                for (const [literal, block] of stmt.cases) {
                    // A case is compared with `===` to the VALUE given: `1n` is not `1`, an object
                    // is itself. litToCode writes each as what it is.
                    const litCode = this.litToCode(literal);
                    this.indentLevel++;
                    const blockCode = this.blockToCode(block);
                    this.indentLevel--;
                    code += `${this.indent}case ${litCode}:{\n${blockCode}${this.indent}break;}\n`;
                }
                if (stmt.default) {
                    this.indentLevel++;
                    const defaultCode = this.blockToCode(stmt.default);
                    this.indentLevel--;
                    code += `${this.indent}default:{\n${defaultCode}${this.indent}break;}\n`;
                }
                this.indentLevel--;
                if (enclosingLoop) enclosingLoop.switchDepth--;
                return code + `${ind}}\n`;
            }
            case 'while': {
                const { bodyCode, label } = this.loopBody(stmt.body);
                return `${ind}${label}while(${this.exprToCode(stmt.cond)}){\n${bodyCode}${ind}}\n`;
            }
            case 'break': {
                // `break` means the enclosing LOOP. Written bare inside a switch it would leave
                // the switch and the loop would carry on.
                const loop = this.loops[this.loops.length - 1];
                if (loop && loop.switchDepth > 0) {
                    loop.labelled = true;
                    return `${ind}break ${loop.label};\n`;
                }
                return `${ind}break;\n`;
            }
            case 'continue':
                return `${ind}continue;\n`;
            case 'await': {
                if (stmt.name) this.varNames.set(stmt.id, stmt.name);
                // `await a===b` waits for `a`: the operand is wrapped unless it binds as tightly.
                return `${ind}var ${this.varName(stmt.id)}=await ${this.operand(stmt.expr, PREC_UNARY)};\n`;
            }
            case 'try': {
                this.indentLevel++;
                const bodyCode = this.blockToCode(stmt.body);
                let code = `${ind}try{\n${bodyCode}${ind}}`;
                if (stmt.catch && stmt.errorId !== undefined) {
                    if (stmt.errorName) this.varNames.set(stmt.errorId, stmt.errorName);
                    // The caught value is a variable of the FUNCTION, like every other: a catch
                    // parameter would end with its block, where the interpreter's slot does not.
                    const errorName = this.varName(stmt.errorId);
                    const catchCode = this.blockToCode(stmt.catch);
                    code += `catch(${errorName}_caught){\n${this.indent}var ${errorName}=${errorName}_caught;\n${catchCode}${ind}}`;
                }
                if (stmt.finally) {
                    code += `finally{\n${this.blockToCode(stmt.finally)}${ind}}`;
                }
                this.indentLevel--;
                return code + '\n';
            }
        }
    }

    /**
     * The body of a loop, and the label the loop statement needs in front of it — empty unless a
     * `break` inside one of the body's switches named it.
     */
    private loopBody(body: Block): { bodyCode: string; label: string } {
        const loop = { label: `_l${this.nextLabel++}`, labelled: false, switchDepth: 0 };
        this.loops.push(loop);
        this.indentLevel++;
        const bodyCode = this.blockToCode(body);
        this.indentLevel--;
        this.loops.pop();
        return { bodyCode, label: loop.labelled ? `${loop.label}:` : '' };
    }

    private blockToCode(block: Block): string {
        let code = '';
        for (const stmt of block.stmts) {
            code += this.stmtToCode(stmt);
        }
        if (block.returnExpr) {
            code += `return ${this.exprToCode(block.returnExpr)};\n`;
        }
        return code;
    }

    /**
     * Compile a nested function definition into a code string.
     * Uses a child CodeGenerator that shares externals/reservedNames with the parent.
     */
    private compileNestedFn(id: number, def: NestedFnDef): string {
        this.ownedNested.add(id);
        const childGen = new CodeGenerator(def.inputNames.length, def.inputNames, {
            externals: this.externals,
            reservedNames: this.reservedNames,
            ownedNested: this.ownedNested,
            adoptedNested: this.adoptedNested,
            nestedRefs: this.nestedRefs,
            referrer: id,
        });

        // Recursively compile any nested functions within this nested function.
        // Own every sibling first: one may call another before its turn.
        let childNestedDefs = '';
        if (def.block.nestedFunctions) {
            for (const [nid] of def.block.nestedFunctions) this.ownedNested.add(nid);
            for (const [nid, ndef] of def.block.nestedFunctions) {
                childNestedDefs += childGen.compileNestedFn(nid, ndef);
            }
        }

        const innerBody = childGen.blockToCode(def.block);

        // Merge helper functions from child into parent
        for (const [fnId, code] of childGen.helperFunctions) {
            this.helperFunctions.set(fnId, code);
        }

        const argNames = this.parameterList(def.inputNames, def.inputDefaults || []);
        return `${childNestedDefs}${def.async ? 'async ' : ''}function ${nestedFnName(id, def)}(${argNames}){\n${innerBody}}\n`;
    }

    /** The parameter list of a generated function, defaults included (e.g. `buffer,offset=0`). */
    private parameterList(names: readonly string[], defaults: readonly unknown[]): string {
        return names
            .map((name, i) => {
                const value = defaults[i];
                return value !== undefined ? `${name}=${this.litToCode(value)}` : name;
            })
            .join(',');
    }

    /**
     * Compile `block` as one unit: its function, the nested functions it calls, the helpers.
     *
     * A nested function that NOTHING in the unit calls is left out. There is one whenever `fn()`
     * is called inside a declaration and the result is kept for plain JavaScript to call (a
     * cache, a handle) instead of being referenced by the tree: the marker compiles its own unit
     * on its first call (`nestedFunction` in `entry.ts`), and a second copy here would be text that is
     * parsed, compiled and held for nothing.
     *
     * What is called is only known once the text is written — the generator is what turns a
     * marker into a name — so the unit is generated as it always was, and generated AGAIN
     * without the uncalled functions only when there are any. The usual unit has none and its
     * text is exactly what one pass writes; the second pass also drops what only the uncalled
     * functions needed (their externals, their helpers), and runs again should that leave another
     * function uncalled.
     */
    compile<T>(block: Block): T {
        let generator: CodeGenerator = this;
        for (;;) {
            const unit = generator.generate<T>(block);
            const uncalled = generator.uncalledNested(block);
            if (uncalled.size === 0) return unit();
            block = withoutNested(block, uncalled);
            generator = new CodeGenerator(
                this.argCount,
                this.inputNames,
                undefined,
                this.inputDefaults,
                this.isAsync,
                this.fnName,
            );
        }
    }

    /** The nested functions declared in `block`, at any depth, that no emitted text refers to. */
    private uncalledNested(block: Block): Set<number> {
        // Called from the unit's own text, or part of a definition adopted from another unit.
        const called = new Set<number>(this.nestedRefs.get(UNIT_FN));
        for (const id of this.adoptedNested.keys()) called.add(id);
        for (const id of called) {
            for (const next of this.nestedRefs.get(id) ?? []) called.add(next);
        }
        const uncalled = new Set<number>();
        const visit = (nested: Block['nestedFunctions']) => {
            for (const [id, def] of nested ?? []) {
                if (!called.has(id)) uncalled.add(id);
                visit(def.block.nestedFunctions);
            }
        };
        visit(block.nestedFunctions);
        return uncalled;
    }

    /** Write the unit's text; the returned function builds it (`new Function`) and binds its externals. */
    private generate<T>(block: Block): () => T {
        // Compile nested function definitions first (they may add externals).
        // Own every id before compiling any body: a sibling may call another.
        let nestedDefs = '';
        if (block.nestedFunctions) {
            for (const [id] of block.nestedFunctions) this.ownedNested.add(id);
            for (const [id, def] of block.nestedFunctions) {
                nestedDefs += this.compileNestedFn(id, def);
            }
        }

        const body = this.blockToCode(block);

        // Definitions adopted from other units are discovered while generating the code above.
        const adoptedDefs = [...this.adoptedNested.values()].join('');

        // A default that is no primitive is passed in as an external, so the list is written
        // before the externals are collected below.
        const argNames = this.parameterList(this.inputNames, this.inputDefaults);

        // Collect externals AFTER generating all code (nested fns may have added externals)
        const externNames = [...this.externals.values()];
        const externValues = [...this.externals.keys()];

        // Place nested functions and helpers at the new Function() scope level (no IIFE).
        // V8 TurboFan generates 2.6x worse machine code when the main function is inside
        // an IIFE closure, even with identical inner functions (168M → 65M for int32x3).
        //
        // The source is STRICT, like the interpreter (a module) and like every hand-written file: a
        // write the target refuses throws instead of being dropped, a write to a name nobody declared
        // throws instead of making a global. The directive is the first statement of the outer
        // body, so the nested functions and the returned one inherit it; the returned function
        // cannot carry its own, a directive being a syntax error beside a parameter default.
        const keyword =
            (this.isAsync ? 'async function' : 'function') + (this.fnName ? ' ' + sanitizeIdentifier(this.fnName) : '');
        let fnBody: string;
        if (nestedDefs || adoptedDefs || this.helperFunctions.size > 0) {
            const helpers = [...this.helperFunctions.values()].join('');
            fnBody = `'use strict';\n${nestedDefs}${adoptedDefs}${helpers}return ${keyword}(${argNames}){\n${body}}`;
        } else {
            fnBody = `'use strict';\nreturn ${keyword}(${argNames}){\n${body}}`;
        }

        return () => {
            if (jitDebug) {
                console.log('=== JIT2 Generated Code ===');
                console.log('Externs:', externNames);
                console.log('Body:\n' + fnBody);
                console.log('===========================\n');
            }
            const fn = new Function(...externNames, fnBody);
            return fn(...externValues) as T;
        };
    }
}

/** The referrer of text that is part of a unit whatever is called: see `CodeGenerator.referrer`. */
const UNIT_FN = -1;

/** `block` without the nested functions in `dropped`, at any depth. The original is not touched: the markers hold it. */
function withoutNested(block: Block, dropped: ReadonlySet<number>): Block {
    if (!block.nestedFunctions) return block;
    const kept = new Map<number, NestedFnDef>();
    for (const [id, def] of block.nestedFunctions) {
        if (!dropped.has(id)) kept.set(id, { ...def, block: withoutNested(def.block, dropped) });
    }
    return { ...block, nestedFunctions: kept.size > 0 ? kept : undefined };
}
