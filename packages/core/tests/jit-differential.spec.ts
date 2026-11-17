/**
 * Differential tests for the JIT's two execution modes.
 *
 * One expression tree, two ways to run it: compiled (`fnJIT` — source text through `new Function`)
 * and interpreted (`fnExec` — closures, the only mode where code generation is blocked, e.g. under a
 * strict CSP). Nothing but these tests holds the two to the same answer, so every program here runs
 * in both modes on the same inputs and must agree on the result, on the error, and on what it did
 * to its inputs.
 *
 * The matrices are generated from two tables — one row per expression kind, one per statement
 * kind — and the tables are held complete against `EXPR_KINDS` / `STMT_KINDS`: a kind added to the
 * tree without a row here fails the first test of this file.
 *
 * Reproduce a fuzz failure with `JIT_FUZZ_SEED=<seed> JIT_FUZZ_N=<n>`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { inspect } from 'node:util';

import { expect } from '@deepkit/run/expect';

import {
    type Block,
    Builder,
    EXPR_KINDS,
    type Expr,
    InvalidProgramError,
    Ref,
    STMT_KINDS,
    type Stmt,
    arg,
    canJIT,
    compilesFunctions,
    fn,
    fnAsync,
    fnAsyncExec,
    fnAsyncJIT,
    fnAsyncJITTop,
    fnExec,
    fnJIT,
    fnJITTop,
    getJitMode,
    getJitThreshold,
    setJitMode,
    setJitThreshold,
    shapeOfExpr,
    shapeOfStmt,
} from '../src/jit.js';
import { compilationsOf, expectGolden, generatedSource } from './support/generated-source.js';

// ============================================================================
// Harness
// ============================================================================

type Program = (b: Builder, ...x: Ref[]) => Ref | void;
type Define = (...args: any[]) => (...args: any[]) => any;
type Inputs = () => unknown[];
type Outcome = { threw: false; value: unknown; inputs: unknown[] } | { threw: true; error: unknown; inputs: unknown[] };

const ARGC = 4;

function compile(define: Define, program: Program): (...args: any[]) => any {
    return define(arg(), arg(), arg(), arg(), program);
}

function run(f: (...args: any[]) => any, make: Inputs): Outcome {
    const inputs = make();
    try {
        return { threw: false, value: f(...inputs), inputs };
    } catch (error) {
        return { threw: true, error, inputs };
    }
}

/**
 * Structural equality that keeps what a serializer cares about: `-0` is not `0`, `NaN` is `NaN`,
 * a hole is not `undefined`, an absent key is not an `undefined` one, key order and prototype count.
 * Functions and symbols are equal by identity.
 */
function same(a: unknown, b: unknown, seen = new Map<object, object>()): boolean {
    if (Object.is(a, b)) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (seen.get(a) === b) return true;
    seen.set(a, b);
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    if (a instanceof Date && b instanceof Date) return Object.is(a.getTime(), b.getTime());
    if (a instanceof Error && b instanceof Error) return a.message === b.message;
    if (a instanceof Map && b instanceof Map) return same([...a.entries()], [...b.entries()], seen);
    if (a instanceof Set && b instanceof Set) return same([...a.values()], [...b.values()], seen);
    const keysA = Reflect.ownKeys(a);
    const keysB = Reflect.ownKeys(b);
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
        if (keysA[i] !== keysB[i]) return false;
        if (!same((a as any)[keysA[i]], (b as any)[keysB[i]], seen)) return false;
    }
    return true;
}

function show(value: unknown): string {
    return inspect(value, { depth: 5, breakLength: Infinity });
}

function showOutcome(o: Outcome): string {
    if (o.threw) {
        return o.error instanceof Error ? `throws ${o.error.constructor.name}: ${o.error.message}` : `throws ${show(o.error)}`;
    }
    return show(o.value);
}

function sameOutcome(compiled: Outcome, interpreted: Outcome): boolean {
    if (compiled.threw !== interpreted.threw) return false;
    if (compiled.threw && interpreted.threw) {
        const a = compiled.error;
        const b = interpreted.error;
        // An engine error is compared by class: its message names the generated variable.
        if (a instanceof Error && b instanceof Error) return a.constructor === b.constructor;
        return same(a, b);
    }
    if (!compiled.threw && !interpreted.threw && !same(compiled.value, interpreted.value)) return false;
    return same(compiled.inputs, interpreted.inputs);
}

/**
 * Run one program in both modes on every input vector and return what disagreed (nothing, when
 * the modes agree). A program the compiled mode cannot even build is a disagreement by itself:
 * the interpreter has no source text to get wrong.
 */
function differences(label: string, program: Program, vectors: Inputs[]): string[] {
    let compiled: (...args: any[]) => any;
    let interpreted: (...args: any[]) => any;
    try {
        compiled = compile(fnJIT, program);
    } catch (error) {
        return [`${label}: compiled mode failed to build — ${error instanceof Error ? `${error.constructor.name}: ${error.message}` : show(error)}`];
    }
    try {
        interpreted = compile(fnExec, program);
    } catch (error) {
        return [`${label}: interpreted mode failed to build — ${error instanceof Error ? `${error.constructor.name}: ${error.message}` : show(error)}`];
    }
    const out: string[] = [];
    for (const make of vectors) {
        const c = run(compiled, make);
        const i = run(interpreted, make);
        if (!sameOutcome(c, i)) {
            const inputsNote = same(c.inputs, i.inputs) ? '' : ` | inputs after: compiled ${show(c.inputs)} / interpreted ${show(i.inputs)}`;
            out.push(`${label} on ${show(make())}: compiled ${showOutcome(c)} / interpreted ${showOutcome(i)}${inputsNote}`);
        }
    }
    return out;
}

/** What an async function did, awaited. A call that THROWS instead of answering a promise is its own outcome. */
async function runAsync(f: (...args: any[]) => any, make: Inputs): Promise<Outcome> {
    const inputs = make();
    let answered: unknown;
    try {
        answered = f(...inputs);
    } catch (error) {
        return { threw: true, error: ['threw before answering a promise', error], inputs };
    }
    if (!(answered instanceof Promise)) return { threw: true, error: ['answered no promise', answered], inputs };
    try {
        return { threw: false, value: await answered, inputs };
    } catch (error) {
        return { threw: true, error, inputs };
    }
}

/** {@link differences}, for a program of an async function: declared async, awaited, compared. */
async function differencesAsync(label: string, program: Program, vectors: Inputs[]): Promise<string[]> {
    let compiled: (...args: any[]) => any;
    let interpreted: (...args: any[]) => any;
    try {
        compiled = compile(fnAsyncJIT, program);
    } catch (error) {
        return [`${label}: compiled mode failed to build — ${error instanceof Error ? `${error.constructor.name}: ${error.message}` : show(error)}`];
    }
    try {
        interpreted = compile(fnAsyncExec, program);
    } catch (error) {
        return [`${label}: interpreted mode failed to build — ${error instanceof Error ? `${error.constructor.name}: ${error.message}` : show(error)}`];
    }
    const out: string[] = [];
    for (const make of vectors) {
        const c = await runAsync(compiled, make);
        const i = await runAsync(interpreted, make);
        if (!sameOutcome(c, i)) {
            const inputsNote = same(c.inputs, i.inputs) ? '' : ` | inputs after: compiled ${show(c.inputs)} / interpreted ${show(i.inputs)}`;
            out.push(`${label} on ${show(make())}: compiled ${showOutcome(c)} / interpreted ${showOutcome(i)}${inputsNote}`);
        }
    }
    return out;
}

function expectNoDifferences(found: string[]): void {
    if (found.length === 0) return;
    const shown = found.slice(0, 25).join('\n  ');
    const rest = found.length > 25 ? `\n  … and ${found.length - 25} more` : '';
    expect(`${found.length} difference(s):\n  ${shown}${rest}`).toBe('');
}

/** The kinds a program's tree contains — the proof that a table row exercises the kind it is filed under. */
function kindsOf(node: unknown, out = new Set<string>()): Set<string> {
    if (Array.isArray(node)) {
        for (const n of node) kindsOf(n, out);
        return out;
    }
    if (node instanceof Map) {
        for (const v of node.values()) kindsOf(v, out);
        return out;
    }
    if (node === null || typeof node !== 'object' || Object.getPrototypeOf(node) !== Object.prototype) return out;
    const kind = (node as { kind?: unknown }).kind;
    if (typeof kind === 'string') out.add(kind);
    for (const [key, value] of Object.entries(node)) {
        if (kind === 'lit' && key === 'value') continue;
        kindsOf(value, out);
    }
    return out;
}

function treeOf(program: Program): Block {
    // An async declaration takes every program a plain one does, and the ones that wait as well.
    const b = new Builder(ARGC, { async: true });
    const result = program(b, ...Array.from({ length: ARGC }, (_, i) => b.input(i)));
    return b.build(result ?? undefined);
}

// ============================================================================
// Fixtures
// ============================================================================

class Box {
    constructor(public v: unknown) {}
}

function pair(a: unknown, b: unknown): unknown[] {
    return [a, b];
}

/** Leaves a mark on the list each time it is evaluated. */
function noteRead(list: unknown[]): unknown[] {
    list.push('read');
    return list;
}

/** A promise that settles later than the microtasks queued before it: another task runs in between. */
function later<T>(value: T): Promise<T> {
    return new Promise(resolve => setImmediate(() => resolve(value)));
}

function resolved<T>(value: T): Promise<T> {
    return Promise.resolve(value);
}

function rejected(reason: unknown): Promise<never> {
    return Promise.reject(reason);
}

/** Not a promise, but awaited like one. */
function thenable(value: unknown): { then(resolve: (value: unknown) => void): void } {
    return { then: resolve => resolve(['then', value]) };
}

const holey: unknown[] = [1, 2, 3];
delete holey[1];

/** Plain JavaScript that is handed a function and calls it. */
function callWith(f: (...args: unknown[]) => unknown, ...args: unknown[]): unknown {
    return f(...args);
}

const hyphenated = { 'to-text': (suffix: unknown) => 'text' + String(suffix) };

/**
 * x0 number-like, x1 string-like, x2 object-like, x3 array-like — and then vectors that break each
 * of those expectations, so a kind is also seen on the wrong type, on null and on undefined.
 */
const VECTORS: Inputs[] = [
    () => [5, 'ab', { a: 1, b: 'x' }, [1, 2, 3]],
    () => [0, '', {}, []],
    () => [-1, 'a', { a: null, c: 0 }, [0]],
    () => [true, false, { a: { a: 2 } }, ['a', 'b']],
    () => [null, undefined, { length: 2, a: 0 }, [[1], [2]]],
    () => [2, 2, 'str', [undefined, null]],
    () => [1.5, 'b', new Box(3), [3, 1, 2]],
    () => ['a', 1, [7, 8], 'xyz'],
];

// ============================================================================
// Expression table: one row per kind
// ============================================================================

type Mk = (b: Builder, x: Ref[]) => Ref;

interface Slot {
    name: string;
    /** This kind, with the child `mk` builds in one operand position and plain inputs in the others. */
    put: (b: Builder, mk: Mk, x: Ref[]) => Ref;
}

interface ExprRow {
    /** The kind at the root of a small tree: the child of the nesting matrix. */
    leaf: Mk;
    /** More trees of this kind for the operation matrix. */
    more?: Record<string, Mk>;
    slots: Slot[];
}

type BinaryKind = 'eq' | 'neq' | 'lt' | 'gt' | 'lte' | 'gte' | 'and' | 'or' | 'nullish' | 'add' | 'sub' | 'mul' | 'div' | 'mod' | 'bitAnd' | 'bitOr' | 'bitXor' | 'shl' | 'shr' | 'ushr';

function binary(kind: BinaryKind): ExprRow {
    const op = (b: Builder, l: Ref, r: Ref): Ref => (b[kind] as (l: Ref, r: Ref) => Ref)(l, r);
    return {
        leaf: (b, x) => op(b, x[0], x[1]),
        more: {
            'same operand twice': (b, x) => op(b, x[0], x[0]),
            'against a negative literal': (b, x) => op(b, x[0], b.lit(-1)),
            'negative literal on the left': (b, x) => op(b, b.lit(-2), x[0]),
            'left-nested chain': (b, x) => op(b, op(b, x[0], x[1]), x[0]),
            'right-nested chain': (b, x) => op(b, x[0], op(b, x[1], x[0])),
        },
        slots: [
            { name: 'left', put: (b, mk, x) => op(b, mk(b, x), x[1]) },
            { name: 'right', put: (b, mk, x) => op(b, x[0], mk(b, x)) },
        ],
    };
}

const EXPR: Record<Expr['kind'], ExprRow> = {
    lit: {
        leaf: b => b.lit(7),
        more: {
            string: b => b.lit('s'),
            negative: b => b.lit(-3),
            null: b => b.lit(null),
            undefined: b => b.lit(undefined),
            object: b => b.lit(hyphenated),
        },
        slots: [],
    },
    input: {
        leaf: (b, x) => x[0],
        more: { 'by index': b => b.input(2) },
        slots: [],
    },
    var: {
        leaf: (b, x) => b.let(x[0]),
        more: {
            named: (b, x) => b.let(x[1], 'some-name'),
            mutable: (b, x) => {
                const v = b.var_(1, 'count');
                b.setVar(v, b.add(b.getVar(v), x[0]));
                return b.getVar(v);
            },
        },
        slots: [],
    },
    get: {
        leaf: (b, x) => b.get(x[2], 'a'),
        more: {
            'key that is no identifier': (b, x) => b.get(x[2], 'not-an-identifier'),
            'computed key': (b, x) => b.get(x[2], x[1]),
            chained: (b, x) => b.get(b.get(x[2], 'a'), 'a'),
            'on a literal number': b => b.get(b.lit(5), 'constructor'),
            'on a literal string': b => b.get(b.lit('abc'), 'length'),
        },
        slots: [
            { name: 'object', put: (b, mk, x) => b.get(mk(b, x), 'a') },
            { name: 'key', put: (b, mk, x) => b.get(x[2], mk(b, x)) },
        ],
    },
    at: {
        leaf: (b, x) => b.at(x[3], 0),
        more: {
            'computed index': (b, x) => b.at(x[3], x[0]),
            'negative literal index': (b, x) => b.at(x[3], -1),
            'of a string': (b, x) => b.at(x[1], 0),
        },
        slots: [
            { name: 'array', put: (b, mk, x) => b.at(mk(b, x), 0) },
            { name: 'index', put: (b, mk, x) => b.at(x[3], mk(b, x)) },
        ],
    },
    call: {
        leaf: (b, x) => b.call(pair, x[0], x[1]),
        more: {
            'no arguments': b => b.call(() => 'called'),
            'five arguments': (b, x) => b.call((...all: unknown[]) => all, x[0], x[1], x[2], x[3], x[0]),
        },
        slots: [
            { name: 'first argument', put: (b, mk, x) => b.call(pair, mk(b, x), x[1]) },
            { name: 'second argument', put: (b, mk, x) => b.call(pair, x[0], mk(b, x)) },
        ],
    },
    new: {
        leaf: (b, x) => b.new_(Box, x[0]),
        more: { 'then read': (b, x) => b.get(b.new_(Box, x[0]), 'v') },
        slots: [{ name: 'argument', put: (b, mk, x) => b.new_(Box, mk(b, x)) }],
    },
    obj: {
        leaf: (b, x) => b.obj({ a: x[0] }),
        more: {
            empty: b => b.emptyObj(),
            'keys that are no identifiers': (b, x) => b.obj({ 'a-b': x[0], '1x': x[1], '': x[2] }),
            'computed key': (b, x) => b.obj([[x[1], x[0]]]),
            'read back': (b, x) => b.get(b.obj({ a: x[0] }), 'a'),
        },
        slots: [
            { name: 'value', put: (b, mk, x) => b.obj({ a: mk(b, x), b: x[1] }) },
            { name: 'computed key', put: (b, mk, x) => b.obj([[mk(b, x), x[0]]]) },
        ],
    },
    arr: {
        leaf: (b, x) => b.arr(x[0], x[1]),
        more: { empty: b => b.emptyArr(), 'read back': (b, x) => b.at(b.arr(x[0], x[1]), 1) },
        slots: [
            { name: 'first element', put: (b, mk, x) => b.arr(mk(b, x), x[1]) },
            { name: 'last element', put: (b, mk, x) => b.arr(x[0], mk(b, x)) },
        ],
    },
    eq: binary('eq'),
    neq: binary('neq'),
    lt: binary('lt'),
    gt: binary('gt'),
    lte: binary('lte'),
    gte: binary('gte'),
    not: {
        leaf: (b, x) => b.not(x[0]),
        more: {
            'of isNull': (b, x) => b.not(b.isNull(x[0])),
            'of isNullish': (b, x) => b.not(b.isNullish(x[0])),
            twice: (b, x) => b.not(b.not(x[0])),
        },
        slots: [{ name: 'operand', put: (b, mk, x) => b.not(mk(b, x)) }],
    },
    and: {
        ...binary('and'),
        more: {
            ...binary('and').more,
            // The interpreter unrolls chains of up to ten operands and loops over longer ones.
            'twelve operands, all truthy': (b, x) => Array.from({ length: 11 }, () => b.lit(1)).reduce((acc, one) => b.and(acc, one), x[3]),
            'twelve operands, last one decides': (b, x) => Array.from({ length: 11 }, () => b.lit(1)).reduceRight((acc, one) => b.and(one, acc), x[0]),
            'twelve operands, first one decides': (b, x) => Array.from({ length: 11 }, () => b.lit(1)).reduce((acc, one) => b.and(acc, one), x[0]),
        },
    },
    or: binary('or'),
    nullish: binary('nullish'),
    typeof: {
        leaf: (b, x) => b.typeof_(x[0]),
        slots: [{ name: 'operand', put: (b, mk, x) => b.typeof_(mk(b, x)) }],
    },
    isType: {
        leaf: (b, x) => b.isType(x[1], 'string'),
        more: { 'a type that does not exist': (b, x) => b.isType(x[0], 'no "such" type') },
        slots: [
            { name: 'string operand', put: (b, mk, x) => b.isType(mk(b, x), 'string') },
            { name: 'boolean operand', put: (b, mk, x) => b.isType(mk(b, x), 'boolean') },
            { name: 'number operand', put: (b, mk, x) => b.isType(mk(b, x), 'number') },
            { name: 'object operand', put: (b, mk, x) => b.isType(mk(b, x), 'object') },
        ],
    },
    isNull: {
        leaf: (b, x) => b.isNull(x[0]),
        slots: [{ name: 'operand', put: (b, mk, x) => b.isNull(mk(b, x)) }],
    },
    isNullish: {
        leaf: (b, x) => b.isNullish(x[0]),
        slots: [{ name: 'operand', put: (b, mk, x) => b.isNullish(mk(b, x)) }],
    },
    has: {
        leaf: (b, x) => b.has(x[2], 'a'),
        more: { 'computed key': (b, x) => b.has(x[2], x[1]), 'key with quotes': (b, x) => b.has(x[2], 'it\'s "quoted"') },
        slots: [
            { name: 'object', put: (b, mk, x) => b.has(mk(b, x), 'a') },
            { name: 'key', put: (b, mk, x) => b.has(x[2], mk(b, x)) },
        ],
    },
    len: {
        leaf: (b, x) => b.len(x[3]),
        more: { 'of a string': (b, x) => b.len(x[1]) },
        slots: [{ name: 'operand', put: (b, mk, x) => b.len(mk(b, x)) }],
    },
    ternary: {
        leaf: (b, x) => b.ternary(x[0], x[1], x[2]),
        slots: [
            { name: 'condition', put: (b, mk, x) => b.ternary(mk(b, x), x[1], x[2]) },
            { name: 'then', put: (b, mk, x) => b.ternary(x[0], mk(b, x), x[2]) },
            { name: 'else', put: (b, mk, x) => b.ternary(x[0], x[1], mk(b, x)) },
        ],
    },
    instanceof: {
        leaf: (b, x) => b.isInstance(x[2], Box),
        more: { 'against Array': (b, x) => b.isInstance(x[3], Array) },
        slots: [{ name: 'operand', put: (b, mk, x) => b.isInstance(mk(b, x), Box) }],
    },
    concat: {
        leaf: (b, x) => b.concat(x[0], x[1]),
        more: {
            'no parts': b => b.concat(),
            'one part': (b, x) => b.concat(x[0]),
            'two numbers': b => b.concat(b.lit(1), b.lit(2)),
            'three parts': (b, x) => b.concat(x[0], b.lit('-'), x[1]),
        },
        slots: [
            { name: 'only part', put: (b, mk, x) => b.concat(mk(b, x)) },
            { name: 'first part', put: (b, mk, x) => b.concat(mk(b, x), x[1]) },
            { name: 'last part', put: (b, mk, x) => b.concat(x[0], mk(b, x)) },
        ],
    },
    add: binary('add'),
    sub: binary('sub'),
    mul: binary('mul'),
    div: binary('div'),
    mod: binary('mod'),
    bitAnd: binary('bitAnd'),
    bitOr: binary('bitOr'),
    bitXor: binary('bitXor'),
    shl: binary('shl'),
    shr: binary('shr'),
    ushr: binary('ushr'),
    method: {
        leaf: (b, x) => b.method(x[1], 'toString'),
        more: {
            'with arguments': (b, x) => b.method(x[3], 'slice', b.lit(1), b.lit(2)),
            'on a literal number': b => b.method(b.lit(255), 'toString', b.lit(16)),
            'on a negative literal': b => b.method(b.lit(-1.5), 'toFixed', b.lit(2)),
            'a name that is no identifier': b => b.method(b.lit(hyphenated), 'to-text', b.lit('!')),
        },
        slots: [
            { name: 'object', put: (b, mk, x) => b.method(mk(b, x), 'toString') },
            { name: 'argument', put: (b, mk, x) => b.method(x[3], 'concat', mk(b, x)) },
        ],
    },
    map: {
        leaf: (b, x) => b.map(x[3], (e, i) => b.arr(e, i)),
        more: {
            'element only': (b, x) => b.map(x[3], e => e),
            'body with statements': (b, x) =>
                b.map(x[3], (e, i) => {
                    const doubled = b.let(b.add(e, e));
                    b.if_(b.eq(i, b.lit(1)), () => b.lit('second'));
                    return doubled;
                }),
            'object body': (b, x) => b.map(x[3], e => b.obj({ e })),
            'map inside map': (b, x) => b.map(x[3], e => b.map(x[3], (inner, i) => b.arr(e, inner, i))),
            'array with a hole': b => b.map(b.lit(holey), e => b.arr(e)),
        },
        slots: [
            { name: 'array', put: (b, mk, x) => b.map(mk(b, x), e => e) },
            { name: 'body', put: (b, mk, x) => b.map(x[3], (e, i) => mk(b, [e, i, x[2], x[3]])) },
            {
                name: 'body after a statement',
                put: (b, mk, x) =>
                    b.map(x[3], (e, i) => {
                        const kept = b.let(e);
                        return b.arr(kept, mk(b, [e, i, x[2], x[3]]));
                    }),
            },
        ],
    },
    subFn: {
        leaf: (b, x) => b.subFn(x[2], (b2, input) => b2.get(input, 'a')),
        more: {
            'used twice': (b, x) => {
                const check = (value: Ref) => b.subFn(value, (b2, input) => b2.isType(input, 'string'));
                return b.arr(check(x[0]), check(x[1]));
            },
            'body maps its input': (b, x) => {
                const kept = b.let(x[0]);
                const mapped = b.subFn(x[3], (b2, input) => b2.map(input, (e, i) => b2.arr(e, i)));
                return b.arr(kept, mapped, kept);
            },
            'inside a sub-function': (b, x) => b.subFn(x[2], (b2, input) => b2.subFn(b2.get(input, 'a'), (b3, inner) => b3.typeof_(inner))),
        },
        slots: [
            { name: 'argument', put: (b, mk, x) => b.subFn(mk(b, x), (b2, input) => b2.isType(input, 'string')) },
            // A sub-function body sees its one input only; the child is built from it.
            { name: 'body', put: (b, mk, x) => b.subFn(x[2], (b2, input) => mk(b2, [input, input, input, input])) },
        ],
    },
};

/** Cells of the nesting matrix that are not programs, each with its reason: the Builder must REFUSE them. */
const UNSUPPORTED_NESTING = new Map<string, string>([['subFn.body<var', 'a sub-function body is one expression: the statement that binds a variable would be dropped']]);

// ============================================================================
// Statement table
// ============================================================================

/** Every position of a statement that takes an expression. */
const STMT_SLOTS: Array<{ name: string; put: (b: Builder, mk: Mk, x: Ref[]) => Ref | void; async?: true }> = [
    { name: 'let', put: (b, mk, x) => b.let(mk(b, x)) },
    {
        name: 'set object',
        put: (b, mk, x) => {
            b.set(mk(b, x), 'k', x[0]);
            return x[2];
        },
    },
    {
        name: 'set key',
        put: (b, mk, x) => {
            const target = b.let(b.emptyObj());
            b.set(target, mk(b, x), x[0]);
            return target;
        },
    },
    {
        name: 'set value',
        put: (b, mk, x) => {
            const target = b.let(b.emptyObj());
            b.set(target, 'k', mk(b, x));
            return target;
        },
    },
    {
        name: 'push array',
        put: (b, mk, x) => {
            b.push(mk(b, x), x[0]);
            return x[3];
        },
    },
    {
        name: 'push value',
        put: (b, mk, x) => {
            const target = b.let(b.emptyArr());
            b.push(target, mk(b, x));
            return target;
        },
    },
    {
        name: 'setVar',
        put: (b, mk, x) => {
            const v = b.var_(0);
            b.setVar(v, mk(b, x));
            return b.getVar(v);
        },
    },
    {
        name: 'exec',
        put: (b, mk, x) => {
            b.exec(mk(b, x));
            return x[3];
        },
    },
    { name: 'return', put: (b, mk, x) => b.return_(mk(b, x)) },
    { name: 'throw', put: (b, mk, x) => b.throw_(mk(b, x)) },
    {
        name: 'if condition',
        put: (b, mk, x) => {
            b.if_(
                mk(b, x),
                () => b.lit('then'),
                () => b.lit('else'),
            );
        },
    },
    {
        name: 'loop array',
        put: (b, mk, x) => {
            const out = b.let(b.emptyArr());
            b.loop(mk(b, x), (e, i) => b.push(out, b.arr(e, i)));
            return out;
        },
    },
    {
        name: 'range start',
        put: (b, mk, x) => {
            const out = b.let(b.emptyArr());
            b.forRange(b.bitAnd(mk(b, x), b.lit(3)), b.lit(4), i => b.push(out, i));
            return out;
        },
    },
    {
        name: 'range end',
        put: (b, mk, x) => {
            const out = b.let(b.emptyArr());
            b.forRange(b.lit(0), b.bitAnd(mk(b, x), b.lit(3)), i => b.push(out, i));
            return out;
        },
    },
    {
        name: 'forIn object',
        put: (b, mk, x) => {
            const out = b.let(b.emptyArr());
            b.forIn(mk(b, x), (k, v) => b.push(out, b.arr(k, v)));
            return out;
        },
    },
    {
        name: 'forOf iterable',
        put: (b, mk, x) => {
            const out = b.let(b.emptyArr());
            b.forOf(mk(b, x), v => b.push(out, v));
            return out;
        },
    },
    {
        name: 'switch value',
        put: (b, mk, x) => {
            b.switch_(
                mk(b, x),
                [
                    [1, () => b.lit('one')],
                    ['a', () => b.lit('letter')],
                    [true, () => b.lit('yes')],
                    [null, () => b.lit('null')],
                ],
                () => b.lit('other'),
            );
        },
    },
    {
        name: 'while condition',
        put: (b, mk, x) => {
            const turns = b.var_(0);
            b.while_(b.and(b.lt(b.getVar(turns), b.lit(3)), mk(b, x)), () => {
                b.setVar(turns, b.add(b.getVar(turns), b.lit(1)));
            });
            return b.getVar(turns);
        },
    },
    // `await a===b` would wait for `a`: every kind is awaited whole.
    { name: 'await value', async: true, put: (b, mk, x) => b.await_(mk(b, x)) },
];

/** Programs for each statement kind; `x1` of the control-flow vectors is the array they record in. */
const STMT: Record<Stmt['kind'], Record<string, Program>> = {
    let: {
        'binds once': (b, x0) => {
            const v = b.let(b.add(x0, b.lit(1)));
            return b.arr(v, v);
        },
        'name that is no identifier': (b, x0) => b.let(x0, '1-odd name'),
    },
    set: {
        'identifier key': (b, x0, x1, x2) => {
            b.set(x2, 'added', x0);
            return x2;
        },
        'key that is no identifier': (b, x0, x1, x2) => {
            b.set(x2, 'needs-quotes', x0);
            return x2;
        },
        'computed key': (b, x0, x1, x2) => {
            b.set(x2, b.concat(b.lit('k'), x0), x1);
            return x2;
        },
        'on a fresh object literal': (b, x0) => {
            b.set(b.obj({ a: x0 }), 'lost', x0);
            return x0;
        },
    },
    push: {
        'onto an input': (b, x0, x1, x2, x3) => {
            b.push(x3, x0);
            return b.len(x3);
        },
        'onto a fresh array literal': (b, x0) => {
            b.push(b.arr(x0), x0);
            return x0;
        },
    },
    setVar: {
        'plain assignment': (b, x0) => {
            const v = b.var_(0);
            b.setVar(v, x0);
            return b.getVar(v);
        },
        'add one to a number, a string, a bigint': (b, x0) => {
            const n = b.var_(1);
            const s = b.var_('a');
            b.setVar(n, b.add(b.getVar(n), b.lit(1)));
            b.setVar(s, b.add(b.getVar(s), b.lit(1)));
            return b.arr(b.getVar(n), b.getVar(s), x0);
        },
        'subtract one': (b, x0) => {
            const n = b.var_(1);
            const s = b.var_('7');
            b.setVar(n, b.sub(b.getVar(n), b.lit(1)));
            b.setVar(s, b.sub(b.getVar(s), b.lit(1)));
            return b.arr(b.getVar(n), b.getVar(s), x0);
        },
        'add one to the input itself': (b, x0) => {
            const v = b.var_(x0);
            b.setVar(v, b.add(b.getVar(v), b.lit(1)));
            return b.getVar(v);
        },
        'every compound operator': (b, x0) => {
            const v = b.var_(x0);
            const out = b.let(b.emptyArr());
            for (const op of ['add', 'sub', 'mul', 'div', 'mod', 'bitAnd', 'bitOr', 'bitXor', 'shl', 'shr', 'ushr'] as const) {
                b.setVar(v, b[op](b.getVar(v), b.lit(3)));
                b.push(out, b.getVar(v));
                b.setVar(v, x0);
            }
            return out;
        },
        'operand order is kept': (b, x0) => {
            const v = b.var_(10);
            b.setVar(v, b.sub(x0, b.getVar(v)));
            return b.getVar(v);
        },
    },
    exec: {
        'a call': (b, x0, x1) => {
            b.exec(b.method(x1, 'push', x0));
            return x1;
        },
        'an object literal': (b, x0, x1) => {
            b.exec(b.obj({ a: b.method(x1, 'push', x0) }));
            b.exec(b.obj([[b.concat(x0), x0]]));
            return x1;
        },
    },
    return: {
        'a value': (b, x0) => {
            b.return_(b.add(x0, b.lit(1)));
        },
        nothing: (b, x0, x1) => {
            b.push(x1, b.lit('before'));
            b.return_();
        },
        'skips the rest': (b, x0, x1) => {
            b.return_(x0);
            b.push(x1, b.lit('never'));
            return b.lit('never');
        },
    },
    throw: {
        'a value': (b, x0) => {
            b.throw_(b.arr(b.lit('thrown'), x0));
        },
        'an error': b => {
            b.throw_(b.new_(RangeError, b.lit('out of range')));
        },
    },
    if: {
        'then and else': (b, x0, x1) => {
            b.if_(
                b.gt(x0, b.lit(1)),
                () => b.push(x1, b.lit('then')),
                () => b.push(x1, b.lit('else')),
            );
            return x1;
        },
        'branch that returns': (b, x0) => {
            b.if_(b.gt(x0, b.lit(1)), () => b.lit('early'));
            return b.lit('late');
        },
        'condition chain': (b, x0) => {
            b.cond(
                [
                    [b.eq(x0, b.lit(1)), () => b.lit('one')],
                    [b.eq(x0, b.lit(2)), () => b.lit('two')],
                ],
                () => b.lit('many'),
            );
        },
    },
    loop: {
        'elements and indices': (b, x0, x1, x2, x3) => {
            b.loop(x3, (e, i) => b.push(x1, b.arr(e, i)), { elem: 'el', index: 'at' });
            return x1;
        },
        'index only': (b, x0, x1, x2, x3) => {
            b.loopIdx(x3, (i, source) => b.push(x1, b.at(source, i)));
            return x1;
        },
        range: (b, x0, x1) => {
            b.forRange(x0, b.lit(6), i => b.push(x1, i));
            return x1;
        },
        'range over an array': (b, x0, x1, x2, x3) => {
            b.forRange(b.lit(1), b.len(x3), (i, e) => b.push(x1, b.arr(i, e!)), { arr: x3 });
            return x1;
        },
        'source is read once': (b, x0, x1, x2, x3) => {
            b.loop(b.call(noteRead, x3), e => b.push(x1, e));
            return x3;
        },
        'array that grows while looping': (b, x0, x1, x2, x3) => {
            b.loop(x3, e => {
                b.push(x3, b.lit('grown'));
                b.push(x1, e);
            });
            return x1;
        },
    },
    forIn: {
        'keys and values': (b, x0, x1, x2) => {
            b.forIn(x2, (k, v) => b.push(x1, b.arr(k, v)), 'key');
            return x1;
        },
        'over an array': (b, x0, x1, x2, x3) => {
            b.forIn(x3, k => b.push(x1, k));
            return x1;
        },
    },
    forOf: {
        values: (b, x0, x1, x2, x3) => {
            b.forOf(x3, v => b.push(x1, v), 'item');
            return x1;
        },
        'a Set': (b, x0, x1) => {
            b.forOf(b.lit(new Set(['p', 'q'])), v => b.push(x1, v));
            return x1;
        },
        'Map entries': (b, x0, x1) => {
            b.forOf(
                b.lit(
                    new Map<unknown, unknown>([
                        ['p', 1],
                        ['q', 2],
                    ]),
                ),
                (k, v) => b.push(x1, b.arr(k, v)),
                'k',
                'v',
            );
            return x1;
        },
    },
    switch: {
        'case that returns': (b, x0) => {
            b.switch_(
                x0,
                [
                    [1, () => b.lit('one')],
                    [2, () => b.lit('two')],
                ],
                () => b.lit('default'),
            );
        },
        'falls out to the code after': (b, x0, x1) => {
            b.switch_(x0, [
                [1, () => b.push(x1, b.lit('one'))],
                [2, () => b.push(x1, b.lit('two'))],
            ]);
            b.push(x1, b.lit('after'));
            return x1;
        },
        'case literals of every primitive type': (b, x0) => {
            b.switch_(
                x0,
                [
                    ['1', () => b.lit('string one')],
                    [1n, () => b.lit('bigint one')],
                    [-1, () => b.lit('minus one')],
                    [true, () => b.lit('true')],
                    [null, () => b.lit('null')],
                    [undefined, () => b.lit('undefined')],
                    ['it\'s "quoted"\n', () => b.lit('quoted')],
                    [1, () => b.lit('number one')],
                ],
                () => b.lit('default'),
            );
        },
        'case literal that is an object': (b, x0) => {
            b.switch_(x0, [[hyphenated, () => b.lit('the object')]], () => b.lit('default'));
        },
    },
    while: {
        'counts up': (b, x0, x1) => {
            const n = b.var_(0);
            b.while_(b.lt(b.getVar(n), b.lit(3)), () => {
                b.push(x1, b.getVar(n));
                b.setVar(n, b.add(b.getVar(n), b.lit(1)));
            });
            return x1;
        },
    },
    break: {
        'leaves a while loop': (b, x0, x1) => {
            const n = b.var_(0);
            b.while_(b.lt(b.getVar(n), b.lit(6)), () => {
                b.setVar(n, b.add(b.getVar(n), b.lit(1)));
                b.if_(b.gt(b.getVar(n), x0), () => b.break_());
                b.push(x1, b.getVar(n));
            });
            return x1;
        },
        'leaves an array loop': (b, x0, x1, x2, x3) => {
            b.loop(x3, (e, i) => {
                b.if_(b.eq(i, x0), () => b.break_());
                b.push(x1, e);
            });
            return x1;
        },
    },
    continue: {
        'skips in a while loop': (b, x0, x1) => {
            const n = b.var_(0);
            b.while_(b.lt(b.getVar(n), b.lit(4)), () => {
                b.setVar(n, b.add(b.getVar(n), b.lit(1)));
                b.if_(b.eq(b.getVar(n), x0), () => b.continue_());
                b.push(x1, b.getVar(n));
            });
            return x1;
        },
        'skips in an array loop': (b, x0, x1, x2, x3) => {
            b.loop(x3, (e, i) => {
                b.if_(b.eq(i, x0), () => b.continue_());
                b.push(x1, e);
            });
            return x1;
        },
    },
    // Programs of an async function (ASYNC_STMT_KINDS): declared async, and awaited by the harness.
    await: {
        'a promise': (b, x0) => b.await_(b.call(resolved, x0)),
        'a value that is no promise': (b, x0) => b.await_(x0),
        'a promise that settles later': (b, x0) => b.await_(b.call(later, x0)),
        'a thenable': (b, x0) => b.await_(b.call(thenable, x0)),
        'a rejection': (b, x0) => {
            b.await_(b.call(rejected, x0));
            return b.lit('never');
        },
        'named, and read twice': (b, x0) => {
            const got = b.await_(b.call(resolved, x0), 'got it');
            return b.arr(got, got);
        },
        'the result is not used': (b, x0, x1) => {
            b.await_(b.call(resolved, b.method(x1, 'push', x0)));
            return x1;
        },
        'in a loop, in order': (b, x0, x1, x2, x3) => {
            b.loop(x3, e => b.push(x1, b.await_(b.call(later, e))));
            return x1;
        },
        'an operand that is a comparison': (b, x0) => b.await_(b.eq(x0, b.lit(1))),
    },
    try: {
        'catches what the body throws': (b, x0, x1) => {
            b.try_(
                () => {
                    b.if_(b.eq(x0, b.lit(1)), () => b.throw_(b.arr(b.lit('thrown'), x0)));
                    b.push(x1, b.lit('body ran to its end'));
                },
                { catch: error => b.push(x1, error), errorName: 'the error' },
            );
            return x1;
        },
        'catches an error of the engine': (b, x0, x1) => {
            b.try_(() => b.push(x1, b.get(b.get(x0, 'missing'), 'deeper')), { catch: error => b.push(x1, b.isInstance(error, TypeError)) });
            return x1;
        },
        'finally, with nothing thrown and with something': (b, x0, x1) => {
            b.try_(
                () => {
                    b.if_(b.eq(x0, b.lit(2)), () => b.throw_(b.lit('thrown')));
                    b.push(x1, b.lit('body'));
                },
                { catch: error => b.push(x1, error), finally: () => b.push(x1, b.lit('finally')) },
            );
            return x1;
        },
        'finally without a catch lets the error on': (b, x0, x1) => {
            b.try_(
                () => {
                    b.if_(b.eq(x0, b.lit(1)), () => b.throw_(x1));
                },
                { finally: () => b.push(x1, b.lit('finally')) },
            );
            return x1;
        },
        'a return in the body runs the finally and keeps its value': (b, x0, x1) => {
            b.try_(() => b.arr(b.lit('returned'), x0), { finally: () => b.push(x1, b.lit('finally')) });
            return b.lit('never');
        },
        'a return in the catch': (b, x0) => {
            b.try_(
                () => {
                    b.throw_(x0);
                },
                { catch: error => b.arr(b.lit('caught'), error) },
            );
            return b.lit('never');
        },
        'a finally that returns replaces a return and an error': (b, x0) => {
            b.try_(
                () => {
                    b.if_(b.eq(x0, b.lit(1)), () => b.throw_(b.lit('lost')));
                    b.return_(b.lit('lost too'));
                },
                { finally: () => b.arr(b.lit('finally wins'), x0) },
            );
        },
        'a finally that throws replaces a return': (b, x0) => {
            b.try_(() => b.lit('lost'), {
                finally: () => {
                    b.if_(b.eq(x0, b.lit(2)), () => b.throw_(b.lit('from finally')));
                },
            });
        },
        'a catch that throws still runs the finally': (b, x0, x1) => {
            b.try_(
                () => {
                    b.throw_(b.lit('first'));
                },
                {
                    catch: error => {
                        b.push(x1, error);
                        b.throw_(b.arr(b.lit('second'), x1));
                    },
                    finally: () => b.push(x1, b.lit('finally')),
                },
            );
        },
        'break and continue leave through the finally': (b, x0, x1, x2, x3) => {
            b.loop(x3, (e, i) => {
                b.try_(
                    () => {
                        b.if_(b.eq(i, x0), () => b.break_());
                        b.if_(b.eq(i, b.lit(0)), () => b.continue_());
                        b.push(x1, e);
                    },
                    { finally: () => b.push(x1, b.lit('finally')) },
                );
                b.push(x1, b.lit('after'));
            });
            return x1;
        },
        'one inside another': (b, x0, x1) => {
            b.try_(
                () => {
                    b.try_(
                        () => {
                            b.throw_(b.arr(b.lit('inner'), x0));
                        },
                        {
                            catch: error => {
                                b.push(x1, error);
                                b.if_(b.eq(x0, b.lit(1)), () => b.throw_(b.lit('rethrown')));
                            },
                            finally: () => b.push(x1, b.lit('inner finally')),
                        },
                    );
                    b.push(x1, b.lit('between'));
                },
                { catch: error => b.push(x1, b.arr(b.lit('outer'), error)), finally: () => b.push(x1, b.lit('outer finally')) },
            );
            return x1;
        },
        'the caught value is a variable of the function': (b, x0) => {
            // Read after the catch, and where nothing was thrown: undefined in both modes.
            let caught: Ref | undefined;
            b.try_(
                () => {
                    b.if_(b.eq(x0, b.lit(1)), () => b.throw_(b.lit('thrown')));
                },
                {
                    catch: error => {
                        caught = error;
                    },
                },
            );
            return b.arr(caught!);
        },
        'the value of a return waits while the finally calls a function that returns': (b, x0, x1) => {
            const noisy = fn(arg(), (b2: Builder, list: Ref) => {
                b2.push(list, b2.lit('called'));
                return b2.lit('the callee returned this');
            });
            b.try_(() => b.arr(b.lit('mine'), x0), { finally: () => b.exec(b.call(noisy, x1)) });
        },
    },
};

/** The statement kinds whose programs are the statements of an async function. */
const ASYNC_STMT_KINDS: ReadonlySet<Stmt['kind']> = new Set<Stmt['kind']>(['await']);

/** x0 the iteration that triggers, x1 the array a program records in, x2 an object, x3 an array. */
const FLOW_VECTORS: Inputs[] = [1, 2, 4, 99].map(trigger => () => [trigger, [], { a: 1, b: 2, c: 3, d: 4 }, [10, 20, 30, 40]]);

/** The same shape, with x0 running over the values a statement can tell apart. */
const STMT_VECTORS: Inputs[] = [...FLOW_VECTORS, ...[0, -1, '1', 1n, true, null, undefined, 'it\'s "quoted"\n', hyphenated, 'a'].map(x0 => () => [x0, [], { a: 1, b: 2 }, [10, 20]])];

// ============================================================================
// Tests
// ============================================================================

describe('jit differential: the tables are complete', () => {
    test('every expression kind has a row whose trees contain it', () => {
        expect(Object.keys(EXPR).sort()).toEqual([...EXPR_KINDS].sort());
        const missing: string[] = [];
        for (const kind of EXPR_KINDS) {
            const row = EXPR[kind];
            for (const [name, mk] of Object.entries({ leaf: row.leaf, ...row.more })) {
                if (!kindsOf(treeOf((b, ...x) => mk(b, x))).has(kind)) missing.push(`${kind} / ${name}`);
            }
            for (const slot of row.slots) {
                if (!kindsOf(treeOf((b, ...x) => slot.put(b, EXPR.input.leaf, x))).has(kind)) missing.push(`${kind} / slot ${slot.name}`);
            }
        }
        expect(missing).toEqual([]);
    });

    test('every statement kind has programs that contain it', () => {
        expect(Object.keys(STMT).sort()).toEqual([...STMT_KINDS].sort());
        const missing: string[] = [];
        for (const kind of STMT_KINDS) {
            const programs = Object.entries(STMT[kind]);
            if (programs.length === 0) missing.push(`${kind}: no program`);
            for (const [name, program] of programs) {
                if (!kindsOf(treeOf(program)).has(kind)) missing.push(`${kind} / ${name}`);
            }
        }
        expect(missing).toEqual([]);
    });

    test('every statement kind that takes an expression has a slot for it', () => {
        const covered = new Set<string>();
        for (const slot of STMT_SLOTS) {
            for (const kind of kindsOf(treeOf((b, ...x) => slot.put(b, EXPR.input.leaf, x)))) covered.add(kind);
        }
        const takesAnExpression = STMT_KINDS.filter(kind => kind !== 'break' && kind !== 'continue' && kind !== 'try');
        expect(takesAnExpression.filter(kind => !covered.has(kind))).toEqual([]);
    });

    // The shape table (`EXPR_SHAPE` / `STMT_SHAPE`) says what each kind is made of, and everything
    // that walks a tree believes it. Here every node of every tree these tables build is LOOKED at
    // instead: the expressions and blocks found in its fields must be the ones its shape visits.
    test('the shape table names exactly the children every node has', () => {
        const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
        const isExpr = (v: unknown): v is Expr => isPlain(v) && (EXPR_KINDS as string[]).includes(v.kind as string);
        const isStmt = (v: unknown): v is Stmt => isPlain(v) && (STMT_KINDS as string[]).includes(v.kind as string);
        const isBlock = (v: unknown): v is Block => isPlain(v) && Array.isArray(v.stmts);

        const inspect = (node: Expr | Stmt) => {
            const exprs = new Set<Expr>();
            const blocks = new Set<Block>();
            const look = (v: unknown): void => {
                if (isExpr(v)) exprs.add(v);
                else if (isBlock(v)) blocks.add(v);
                else if (Array.isArray(v)) v.forEach(look);
            };
            for (const [key, v] of Object.entries(node)) {
                // A literal's value and a case's label are data, whatever they look like.
                if (node.kind === 'lit' && key === 'value') continue;
                if (node.kind === 'switch' && key === 'cases') (v as [unknown, Block][]).forEach(([, block]) => look(block));
                else look(v);
            }
            return { exprs, blocks };
        };
        const visited = (node: Expr | Stmt) => {
            const shape = isExpr(node) ? shapeOfExpr(node) : shapeOfStmt(node);
            const exprs = new Set<Expr>();
            const blocks = new Set<Block>();
            const collect = (e: Expr) => (exprs.add(e), false);
            (shape.exprs as (n: Expr | Stmt, visit: (e: Expr) => boolean) => boolean)(node, collect);
            (shape.inner as undefined | ((n: Expr | Stmt, visit: (e: Expr) => boolean) => boolean))?.(node, collect);
            (shape.blocks as undefined | ((n: Expr | Stmt, visit: (b: Block) => boolean) => boolean))?.(node, b => (blocks.add(b), false));
            return { exprs, blocks };
        };

        const wrong: string[] = [];
        const seenKinds = new Set<string>();
        const walk = (node: Expr | Stmt, where: string): void => {
            seenKinds.add(node.kind);
            const found = inspect(node);
            const named = visited(node);
            const sameSet = <T>(a: Set<T>, b: Set<T>) => a.size === b.size && [...a].every(v => b.has(v));
            if (!sameSet(found.exprs, named.exprs)) wrong.push(`${where}: ${node.kind} has ${found.exprs.size} child expression(s), its shape visits ${named.exprs.size}`);
            if (!sameSet(found.blocks, named.blocks)) wrong.push(`${where}: ${node.kind} has ${found.blocks.size} block(s), its shape visits ${named.blocks.size}`);
            for (const e of found.exprs) walk(e, where);
            for (const b of found.blocks) walkBlock(b, where);
        };
        const walkBlock = (block: Block, where: string): void => {
            for (const s of block.stmts) walk(s, where);
            if (block.returnExpr) walk(block.returnExpr, where);
        };

        for (const kind of EXPR_KINDS) {
            const row = EXPR[kind];
            for (const [name, mk] of Object.entries({ leaf: row.leaf, ...row.more }))
                walkBlock(
                    treeOf((b, ...x) => mk(b, x)),
                    `${kind} / ${name}`,
                );
            for (const slot of row.slots)
                walkBlock(
                    treeOf((b, ...x) => slot.put(b, EXPR.arr.leaf, x)),
                    `${kind} / slot ${slot.name}`,
                );
        }
        for (const kind of STMT_KINDS) {
            for (const [name, program] of Object.entries(STMT[kind])) walkBlock(treeOf(program), `${kind} / ${name}`);
        }
        for (const slot of STMT_SLOTS)
            walkBlock(
                treeOf((b, ...x) => slot.put(b, EXPR.arr.leaf, x)),
                `statement slot ${slot.name}`,
            );

        expect(wrong).toEqual([]);
        // …and the walk reached every kind there is, so no row went unchecked.
        expect([...EXPR_KINDS, ...STMT_KINDS].filter(kind => !seenKinds.has(kind))).toEqual([]);
    });
});

describe('jit differential: operation matrix', () => {
    for (const kind of EXPR_KINDS) {
        test(`expression ${kind}`, () => {
            const row = EXPR[kind];
            const found: string[] = [];
            for (const [name, mk] of Object.entries({ leaf: row.leaf, ...row.more })) {
                found.push(...differences(`${kind} / ${name}`, (b, ...x) => mk(b, x), VECTORS));
            }
            expectNoDifferences(found);
        });
    }

    for (const kind of STMT_KINDS) {
        test(`statement ${kind}`, async () => {
            const found: string[] = [];
            for (const [name, program] of Object.entries(STMT[kind])) {
                const label = `${kind} / ${name}`;
                found.push(...(ASYNC_STMT_KINDS.has(kind) ? await differencesAsync(label, program, STMT_VECTORS) : differences(label, program, STMT_VECTORS)));
            }
            expectNoDifferences(found);
        });
    }
});

describe('jit differential: nesting matrix', () => {
    // Every kind as an operand of every other: the whole class of "the generated text parses as
    // something else than the tree says".
    for (const parent of EXPR_KINDS) {
        if (EXPR[parent].slots.length === 0) continue;
        test(`every kind inside ${parent}`, () => {
            const found: string[] = [];
            for (const slot of EXPR[parent].slots) {
                for (const child of EXPR_KINDS) {
                    const cell = `${parent}.${slot.name}<${child}`;
                    const program: Program = (b, ...x) => slot.put(b, EXPR[child].leaf, x);
                    if (UNSUPPORTED_NESTING.has(cell)) {
                        // Not skipped: refused, by both entry points, when it is declared.
                        expect(() => compile(fnExec, program)).toThrow(InvalidProgramError);
                        expect(() => compile(fnJIT, program)).toThrow(InvalidProgramError);
                        continue;
                    }
                    found.push(...differences(cell, program, VECTORS));
                }
            }
            expectNoDifferences(found);
        });
    }

    for (const slot of STMT_SLOTS) {
        test(`every kind in statement position: ${slot.name}`, async () => {
            const found: string[] = [];
            for (const child of EXPR_KINDS) {
                const label = `${slot.name}<${child}`;
                const program: Program = (b, ...x) => slot.put(b, EXPR[child].leaf, x);
                found.push(...(slot.async ? await differencesAsync(label, program, VECTORS) : differences(label, program, VECTORS)));
            }
            expectNoDifferences(found);
        });
    }
});

// ============================================================================
// Control flow
// ============================================================================

type LoopShape = (b: Builder, x: Ref[], body: (item: Ref) => void) => void;

const LOOPS: Record<string, LoopShape> = {
    loop: (b, x, body) => b.loop(x[3], e => body(e)),
    loopIdx: (b, x, body) => b.loopIdx(x[3], i => body(i)),
    forRange: (b, x, body) => b.forRange(b.lit(0), b.lit(4), i => body(i)),
    'forRange over array': (b, x, body) => b.forRange(b.lit(0), b.len(x[3]), (i, e) => body(e!), { arr: x[3] }),
    forIn: (b, x, body) => b.forIn(x[2], k => body(k)),
    forOf: (b, x, body) => b.forOf(x[3], v => body(v)),
    'forOf entries': (b, x, body) =>
        b.forOf(
            b.lit(
                new Map<unknown, unknown>([
                    [1, 'a'],
                    [2, 'b'],
                    [3, 'c'],
                    [4, 'd'],
                ]),
            ),
            (k, v) => body(b.arr(k, v)),
        ),
    while: (b, x, body) => {
        const n = b.var_(0);
        b.while_(b.lt(b.getVar(n), b.lit(4)), () => {
            b.setVar(n, b.add(b.getVar(n), b.lit(1)));
            body(b.getVar(n));
        });
    },
};

const ACTIONS: Record<string, (b: Builder, x: Ref[]) => void> = {
    break: b => b.break_(),
    continue: b => b.continue_(),
    'return a value': (b, x) => b.return_(b.arr(b.lit('returned'), x[1])),
    'return nothing': b => b.return_(),
    throw: b => b.throw_(b.lit('thrown')),
    nothing: () => undefined,
};

/** Where the action sits relative to the loop body it acts on. */
const PLACEMENTS: Record<string, (b: Builder, x: Ref[], hit: Ref, act: () => void) => void> = {
    if: (b, x, hit, act) => b.if_(hit, act),
    else: (b, x, hit, act) => b.if_(b.not(hit), () => b.push(x[1], b.lit('not hit')), act),
    'nested if': (b, x, hit, act) => b.if_(hit, () => b.if_(b.lit(true), act)),
    'condition chain': (b, x, hit, act) =>
        b.cond(
            [
                [b.lit(false), () => b.push(x[1], b.lit('never'))],
                [hit, act],
            ],
            () => b.push(x[1], b.lit('chain else')),
        ),
    'switch case': (b, x, hit, act) =>
        b.switch_(b.ternary(hit, b.lit('hit'), b.lit('miss')), [
            ['hit', act],
            ['miss', () => b.push(x[1], b.lit('miss'))],
        ]),
    'switch default': (b, x, hit, act) => b.switch_(b.ternary(hit, b.lit(1), b.lit(0)), [[0, () => b.push(x[1], b.lit('zero'))]], act),
    'switch in switch': (b, x, hit, act) => b.switch_(b.lit('outer'), [['outer', () => b.switch_(hit, [[true, act]])]]),
    'try body': (b, x, hit, act) => b.try_(() => b.if_(hit, act), { finally: () => b.push(x[1], b.lit('finally')) }),
    'try body, with a catch': (b, x, hit, act) => b.try_(() => b.if_(hit, act), { catch: error => b.push(x[1], b.arr(b.lit('caught'), error)) }),
    catch: (b, x, hit, act) =>
        b.try_(
            () => {
                b.if_(hit, () => b.throw_(b.lit('to the catch')));
            },
            { catch: act, finally: () => b.push(x[1], b.lit('finally')) },
        ),
    finally: (b, x, hit, act) => b.try_(() => b.push(x[1], b.lit('in try')), { finally: () => b.if_(hit, act) }),
    'finally, with an error on its way': (b, x, hit, act) =>
        b.try_(
            () => {
                b.try_(
                    () => {
                        b.if_(hit, () => b.throw_(b.lit('on its way')));
                    },
                    { finally: () => b.if_(hit, act) },
                );
            },
            { catch: error => b.push(x[1], b.arr(b.lit('outer caught'), error)) },
        ),
};

function flowProgram(loop: LoopShape, place: (typeof PLACEMENTS)[string], act: (typeof ACTIONS)[string]): Program {
    return (b, ...x) => {
        const turn = b.var_(0);
        loop(b, x, item => {
            b.setVar(turn, b.add(b.getVar(turn), b.lit(1)));
            b.push(x[1], b.arr(b.lit('before'), item));
            place(b, x, b.eq(b.getVar(turn), x[0]), () => act(b, x));
            b.push(x[1], b.arr(b.lit('after'), item));
        });
        b.push(x[1], b.lit('done'));
        return b.arr(b.getVar(turn), x[1]);
    };
}

/** {@link flowProgram} in an async function: it waits before the action, inside it and after it. */
function asyncFlowProgram(loop: LoopShape, place: (typeof PLACEMENTS)[string], act: (typeof ACTIONS)[string]): Program {
    return (b, ...x) => {
        const turn = b.var_(0);
        loop(b, x, item => {
            b.setVar(turn, b.add(b.getVar(turn), b.lit(1)));
            b.push(x[1], b.arr(b.lit('before'), b.await_(b.call(resolved, item))));
            place(b, x, b.eq(b.getVar(turn), x[0]), () => {
                b.push(x[1], b.await_(b.call(resolved, b.lit('waited in the action'))));
                act(b, x);
            });
            b.push(x[1], b.arr(b.lit('after'), b.await_(item)));
        });
        b.push(x[1], b.lit('done'));
        return b.arr(b.getVar(turn), x[1]);
    };
}

describe('jit differential: control flow', () => {
    for (const [loopName, loop] of Object.entries(LOOPS)) {
        test(`break, continue, return and throw inside ${loopName}`, () => {
            const found: string[] = [];
            for (const [placeName, place] of Object.entries(PLACEMENTS)) {
                for (const [actionName, act] of Object.entries(ACTIONS)) {
                    found.push(...differences(`${loopName} / ${actionName} in ${placeName}`, flowProgram(loop, place, act), FLOW_VECTORS));
                }
            }
            expectNoDifferences(found);
        });
    }

    test('an action in an inner loop leaves the outer loop alone', () => {
        const found: string[] = [];
        for (const [outerName, outer] of Object.entries(LOOPS)) {
            for (const [innerName, inner] of Object.entries(LOOPS)) {
                for (const [actionName, act] of Object.entries(ACTIONS)) {
                    const program: Program = (b, ...x) => {
                        const turn = b.var_(0);
                        outer(b, x, outerItem => {
                            b.push(x[1], b.arr(b.lit('outer'), outerItem));
                            inner(b, x, innerItem => {
                                b.setVar(turn, b.add(b.getVar(turn), b.lit(1)));
                                b.if_(b.eq(b.mod(b.getVar(turn), b.lit(3)), x[0]), () => act(b, x));
                                b.push(x[1], innerItem);
                            });
                            b.push(x[1], b.lit('inner done'));
                        });
                        return b.arr(b.getVar(turn), x[1]);
                    };
                    found.push(...differences(`${actionName} in ${innerName} inside ${outerName}`, program, FLOW_VECTORS));
                }
            }
        }
        expectNoDifferences(found);
    });

    // Anchors: both modes agreeing is not enough when both could be wrong the same way.
    const both = (name: string, body: (define: Define) => void) => {
        test(`${name} (compiled)`, () => body(fnJIT));
        test(`${name} (interpreted)`, () => body(fnExec));
    };

    both('break leaves the array loop and the function carries on', define => {
        const f = define(arg(), (b: Builder, list: Ref) => {
            const out = b.let(b.emptyArr());
            b.loop(list, e => {
                b.if_(b.eq(e, b.lit(3)), () => b.break_());
                b.push(out, e);
            });
            b.push(out, b.lit('after'));
            return out;
        });
        expect(f([1, 2, 3, 4])).toEqual([1, 2, 'after']);
    });

    both('continue skips one turn of the array loop', define => {
        const f = define(arg(), (b: Builder, list: Ref) => {
            const out = b.let(b.emptyArr());
            b.loop(list, e => {
                b.if_(b.eq(e, b.lit(3)), () => b.continue_());
                b.push(out, e);
            });
            return out;
        });
        expect(f([1, 2, 3, 4])).toEqual([1, 2, 4]);
    });

    both('break leaves forIn and forOf', define => {
        const f = define(arg(), arg(), (b: Builder, record: Ref, list: Ref) => {
            const out = b.let(b.emptyArr());
            b.forIn(record, k => {
                b.if_(b.eq(k, b.lit('b')), () => b.break_());
                b.push(out, k);
            });
            b.forOf(list, v => {
                b.if_(b.eq(v, b.lit(20)), () => b.break_());
                b.push(out, v);
            });
            return out;
        });
        expect(f({ a: 1, b: 2, c: 3 }, [10, 20, 30])).toEqual(['a', 10]);
    });

    both('break inside a switch case leaves the enclosing loop, not the switch', define => {
        const f = define(arg(), (b: Builder, list: Ref) => {
            const out = b.let(b.emptyArr());
            b.loop(list, e => {
                b.switch_(e, [
                    [2, () => b.break_()],
                    [1, () => b.push(out, b.lit('one'))],
                ]);
                b.push(out, b.arr(b.lit('after switch'), e));
            });
            return out;
        });
        expect(f([1, 2, 3])).toEqual(['one', ['after switch', 1]]);
    });

    both('continue inside a switch case goes to the next turn of the enclosing loop', define => {
        const f = define(arg(), (b: Builder, list: Ref) => {
            const out = b.let(b.emptyArr());
            b.forOf(list, e => {
                b.switch_(e, [[2, () => b.continue_()]], () => b.push(out, b.lit('default')));
                b.push(out, e);
            });
            return out;
        });
        expect(f([1, 2, 3])).toEqual(['default', 1, 'default', 3]);
    });

    both('the array a loop runs over is read once', define => {
        let reads = 0;
        const source = () => (reads++, [1, 2, 3]);
        const f = define((b: Builder) => {
            const out = b.let(b.emptyArr());
            b.loop(b.call(source), e => b.push(out, e));
            return out;
        });
        expect(f()).toEqual([1, 2, 3]);
        expect(reads).toBe(1);
    });
});

// ============================================================================
// A return value on its way up (the interpreter)
// ============================================================================

describe('jit differential: a return value on its way up', () => {
    // The interpreter hands "the function returns" upward as a signal and keeps the value in ONE
    // slot, for every call in the process. That is sound only while nothing else runs between
    // the statement that writes the slot and the function boundary that takes it. These are the
    // places where something else could.

    /** An interpreted function with a statement, so its `return` goes through the slot. */
    const theirs = fnExec(arg(), (b: Builder, x: Ref) => {
        b.let(x);
        b.return_(b.lit('theirs'));
    });

    /** An iterable whose iterator, closed early, runs another interpreted function. */
    const closing = <T>(items: T[]) => ({
        closed: 0,
        [Symbol.iterator]() {
            let i = 0;
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const self = this;
            return {
                next: () => (i < items.length ? { value: items[i++], done: false } : { value: undefined, done: true }),
                return: () => {
                    self.closed++;
                    theirs(1);
                    return { value: undefined, done: true };
                },
            };
        },
    });

    test('a for…of left by return: closing the iterator runs another interpreted function', () => {
        const program: Program = (b, x) => {
            b.forOf(x, item => {
                b.if_(b.eq(item, b.lit(2)), () => b.return_(b.concat(b.lit('mine:'), item)));
            });
            return b.lit('ran to the end');
        };
        for (const define of [fnExec, ...(canJIT ? [fnJIT] : [])]) {
            const f = compile(define, program);
            const source = closing([1, 2, 3]);
            expect(f(source)).toBe('mine:2');
            expect(source.closed).toBe(1);
            expect(f(closing([5, 6]))).toBe('ran to the end');
        }
    });

    test('a for…of over entries left by return, the same', () => {
        const program: Program = (b, x) => {
            b.forOf(x, (key: Ref, value: Ref) => {
                b.if_(b.eq(key, b.lit('b')), () => b.return_(value));
            });
            return b.lit('ran to the end');
        };
        for (const define of [fnExec, ...(canJIT ? [fnJIT] : [])]) {
            const f = compile(define, program);
            const source = closing<[string, number]>([
                ['a', 1],
                ['b', 2],
                ['c', 3],
            ]);
            expect(f(source)).toBe(2);
            expect(source.closed).toBe(1);
        }
    });

    test('a for…of left by break closes the iterator and the function still returns its own value', () => {
        const program: Program = (b, x) => {
            const seen = b.let(b.emptyArr());
            b.forOf(x, item => {
                b.push(seen, item);
                b.if_(b.eq(item, b.lit(2)), () => b.break_());
            });
            return seen;
        };
        for (const define of [fnExec, ...(canJIT ? [fnJIT] : [])]) {
            expect(compile(define, program)(closing([1, 2, 3]))).toEqual([1, 2]);
        }
    });

    test('a return whose value calls an interpreted function, a map inside a return, and recursion', () => {
        const found: string[] = [];
        // The value is computed BEFORE the slot is written: a call inside it has come and gone.
        found.push(
            ...differences(
                'return of a call',
                (b, x) => {
                    b.if_(b.isType(x, 'number'), () => b.return_(b.concat(b.call(theirs, x), b.lit('+mine'))));
                    return b.lit('not a number');
                },
                [() => [1, 0, 0, 0], () => ['s', 0, 0, 0]],
            ),
        );
        // A map body is a function of its own: each element's return is taken before the next.
        found.push(
            ...differences(
                'return of a map whose body returns',
                (b, x) => {
                    b.return_(
                        b.map(x, item => {
                            b.if_(b.isType(item, 'string'), () => b.return_(b.call(theirs, item)));
                            return b.map(item, inner => b.add(inner, b.lit(1)));
                        }),
                    );
                },
                [() => [[[1, 2], 's', [3]], 0, 0, 0], () => [[], 0, 0, 0]],
            ),
        );
        expectNoDifferences(found);

        const holder: { f?: (n: number) => number } = {};
        const call = (n: number) => holder.f!(n);
        holder.f = fnExec(arg(), (b: Builder, n: Ref) => {
            b.if_(b.lte(n, b.lit(1)), () => b.return_(b.lit(1)));
            b.return_(b.mul(n, b.call(call, b.sub(n, b.lit(1)))));
        });
        expect(holder.f(10)).toBe(3628800);
    });

    test('a function that returns nothing after one that returned something answers undefined', () => {
        const something = fnExec(arg(), (b: Builder, x: Ref) => {
            b.let(x);
            b.return_(b.lit('something'));
        });
        const nothing = fnExec(arg(), (b: Builder, x: Ref) => {
            b.let(x);
            b.return_();
        });
        const fallsOff = fnExec(arg(), (b: Builder, x: Ref) => {
            b.let(x);
        });
        expect(something(1)).toBe('something');
        expect(nothing(1)).toBe(undefined);
        expect(something(1)).toBe('something');
        expect(fallsOff(1)).toBe(undefined);
    });
});

// ============================================================================
// Literals
// ============================================================================

const sharedObject = { shared: true };
const sharedSymbol = Symbol('shared');

const LITERALS: unknown[] = [
    0,
    -0,
    1,
    -1,
    1.5,
    -1.5,
    1e21,
    -1e-7,
    2 ** 53,
    NaN,
    Infinity,
    -Infinity,
    0n,
    1n,
    -5n,
    12345678901234567890n,
    true,
    false,
    null,
    undefined,
    '',
    'a',
    '1',
    'it\'s "quoted"',
    'back\\slash',
    'line\nbreak\r\ttab',
    'separators   and  ',
    '${not} `a template`',
    '</script><!--',
    '__proto__',
    'constructor',
    'lone surrogate \ud800',
    'null byte \0',
    sharedSymbol,
    sharedObject,
    [1, 2],
    pair,
    Box,
    new Date(0),
    /re/g,
];

/** Every position a literal can be written in. */
const LITERAL_POSITIONS: Record<string, (b: Builder, v: unknown, x: Ref[]) => Ref | void> = {
    returned: (b, v) => b.lit(v),
    'equal to (left)': (b, v, x) => b.eq(b.lit(v), x[0]),
    'equal to (right)': (b, v, x) => b.eq(x[0], b.lit(v)),
    'less than': (b, v, x) => b.arr(b.lt(x[0], b.lit(v)), b.gte(b.lit(v), x[0])),
    'subtracted from': (b, v, x) => b.sub(x[0], b.lit(v)),
    'subtracted (left)': (b, v, x) => b.sub(b.lit(v), x[0]),
    'added to': (b, v, x) => b.add(x[0], b.lit(v)),
    'added (left)': (b, v, x) => b.add(b.lit(v), x[0]),
    'multiplied, divided, remainder': (b, v, x) => b.arr(b.mul(x[0], b.lit(v)), b.div(x[0], b.lit(v)), b.mod(b.lit(v), x[0])),
    'bit operations': (b, v, x) => b.arr(b.bitAnd(x[0], b.lit(v)), b.bitOr(b.lit(v), x[0]), b.shl(x[0], b.lit(v)), b.ushr(b.lit(v), b.lit(1))),
    typeof: (b, v) => b.typeof_(b.lit(v)),
    'not, and, or, nullish, ternary': (b, v, x) => b.arr(b.not(b.lit(v)), b.and(b.lit(v), x[0]), b.or(b.lit(v), x[0]), b.nullish(b.lit(v), x[0]), b.ternary(b.lit(v), b.lit('T'), b.lit('F'))),
    'null checks': (b, v) => b.arr(b.isNull(b.lit(v)), b.isNullish(b.lit(v)), b.not(b.isNull(b.lit(v))), b.not(b.isNullish(b.lit(v)))),
    'object of a property read': (b, v) => b.get(b.lit(v), 'constructor'),
    'object of a method call': (b, v) => b.method(b.lit(v), 'toString'),
    'object of an index read': (b, v) => b.at(b.lit(v), 0),
    'object of a length read': (b, v) => b.len(b.lit(v)),
    'index of an array': (b, v, x) => b.at(x[3], b.lit(v)),
    'computed key of a read': (b, v, x) => b.get(x[2], b.lit(v)),
    'computed key of an object literal': (b, v, x) => b.obj([[b.lit(v), x[0]]]),
    'computed key of a write': (b, v, x) => {
        const target = b.let(b.emptyObj());
        b.set(target, b.lit(v), x[0]);
        return target;
    },
    'key of a membership test': (b, v, x) => b.has(x[2], b.lit(v)),
    'value of an object literal': (b, v) => b.obj({ value: b.lit(v) }),
    'element of an array literal': (b, v) => b.arr(b.lit(v), b.lit(v)),
    'argument of a call': (b, v) => b.call(pair, b.lit(v), b.lit(v)),
    'part of a concatenation': (b, v) => b.concat(b.lit('<'), b.lit(v), b.lit('>')),
    'the only part of a concatenation': (b, v) => b.concat(b.lit(v)),
    'initial value of a variable': (b, v) => b.getVar(b.var_(v)),
    'assigned to a variable': (b, v) => {
        const variable = b.var_(0);
        b.setVar(variable, b.lit(v));
        return b.getVar(variable);
    },
    'case of a switch': (b, v, x) => {
        b.switch_(x[0], [[v, () => b.lit('hit')]], () => b.lit('miss'));
    },
    thrown: (b, v) => {
        b.throw_(b.lit(v));
    },
    'instance check': (b, v) => b.isInstance(b.lit(v), Box),
};

/** Positions that take a string as part of the tree, not as a literal expression. */
const STRING_POSITIONS: Record<string, (b: Builder, v: string, x: Ref[]) => Ref | void> = {
    'key of a read': (b, v, x) => b.get(x[2], v),
    'key of an object literal': (b, v, x) => b.obj({ [v]: x[0] }),
    'key of an object literal, as an entry': (b, v, x) => b.obj([[v, x[0]]]),
    'key of a write': (b, v, x) => {
        const target = b.let(b.emptyObj());
        b.set(target, v, x[0]);
        return target;
    },
    'key of a membership test': (b, v, x) => b.has(x[2], v),
    'type of a typeof check': (b, v, x) => b.isType(x[0], v),
    'name of a variable': (b, v, x) => b.let(x[0], v),
    'name of a loop variable': (b, v, x) => {
        const out = b.let(b.emptyArr());
        b.loop(x[3], (e, i) => b.push(out, b.arr(e, i)), { elem: v, index: v });
        return out;
    },
};

describe('jit differential: literals', () => {
    for (const [position, put] of Object.entries(LITERAL_POSITIONS)) {
        test(`every literal ${position}`, () => {
            const found: string[] = [];
            for (const value of LITERALS) {
                const vectors: Inputs[] = [value, 0, 1, -1, 2, 'a', '1', null, undefined, 1n, true].map(x0 => () => [x0, 'b', { a: 1, 1: 'one', constructor: 'own', '': 'empty', [sharedSymbol]: 'sym' }, ['zero', 'one', 'two']]);
                found.push(...differences(`${position}: ${show(value)}`, (b, ...x) => put(b, value, x), vectors));
            }
            expectNoDifferences(found);
        });
    }

    for (const [position, put] of Object.entries(STRING_POSITIONS)) {
        test(`every string as ${position}`, () => {
            const found: string[] = [];
            for (const value of LITERALS) {
                if (typeof value !== 'string') continue;
                const vectors: Inputs[] = [() => [1, 'b', { a: 1, [value]: 'present' }, ['zero', 'one']], () => ['s', 'b', {}, []]];
                found.push(...differences(`${position}: ${show(value)}`, (b, ...x) => put(b, value, x), vectors));
            }
            expectNoDifferences(found);
        });
    }

    test('a literal comes back as the value it is', () => {
        for (const define of [fnJIT, fnExec]) {
            for (const value of LITERALS) {
                expect(Object.is(define((b: Builder) => b.lit(value))(), value)).toBe(true);
            }
        }
    });
});

// ============================================================================
// Arguments and defaults
// ============================================================================

describe('jit differential: argument defaults', () => {
    const DEFAULTS: unknown[] = [0, -1, 1.5, 'text', 'it\'s "quoted"', '', true, false, null, 7n, NaN, -0, Infinity, sharedObject, sharedSymbol];

    test('an omitted argument takes its default in both modes', () => {
        const found: string[] = [];
        for (const value of DEFAULTS) {
            for (const define of [fnJIT, fnExec]) {
                const mode = define === fnJIT ? 'compiled' : 'interpreted';
                const f = define(arg('first'), arg('second', value), (b: Builder, first: Ref, second: Ref) => b.arr(first, second));
                const cases: [unknown[], unknown[]][] = [
                    [[1], [1, value]],
                    [
                        [1, undefined],
                        [1, value],
                    ],
                    [
                        [1, null],
                        [1, null],
                    ],
                    [
                        [1, 0],
                        [1, 0],
                    ],
                    [
                        [1, 'given'],
                        [1, 'given'],
                    ],
                    [[], [undefined, value]],
                ];
                for (const [args, expected] of cases) {
                    const actual = f(...args);
                    if (!same(actual, expected)) found.push(`${mode}, default ${show(value)}, called with ${show(args)}: ${show(actual)}, expected ${show(expected)}`);
                }
            }
        }
        expectNoDifferences(found);
    });

    test('defaults on every argument, and on the first only', () => {
        for (const define of [fnJIT, fnExec]) {
            const all = define(arg('a', 1), arg('b', 'two'), arg('c', null), (b: Builder, a: Ref, bb: Ref, c: Ref) => b.arr(a, bb, c));
            expect(all()).toEqual([1, 'two', null]);
            expect(all(undefined, undefined, 3)).toEqual([1, 'two', 3]);
            const first = define(arg('a', 1), arg('b'), (b: Builder, a: Ref, bb: Ref) => b.arr(a, bb));
            expect(first(undefined, 2)).toEqual([1, 2]);
        }
    });

    test('a nested function keeps its defaults', () => {
        for (const define of [fnJIT, fnExec]) {
            const outer = define(arg('value'), (b: Builder, value: Ref) => {
                const inner = define(arg('v'), arg('offset', 10), (b2: Builder, v: Ref, offset: Ref) => b2.add(v, offset));
                return b.arr(b.call(inner, value), b.call(inner, value, b.lit(1)));
            });
            expect(outer(5)).toEqual([15, 6]);
        }
    });

    test('a tiered function answers the same before and after it compiles', () => {
        setJitThreshold(3);
        try {
            const f = fn(arg('list'), arg('offset', 100), (b: Builder, list: Ref, offset: Ref) => {
                const out = b.let(b.emptyArr());
                b.loop(list, e => {
                    b.if_(b.eq(e, b.lit(2)), () => b.continue_());
                    b.if_(b.eq(e, b.lit(4)), () => b.break_());
                    b.push(out, b.add(e, offset));
                });
                return out;
            });
            for (let call = 0; call < 6; call++) {
                expect(f([1, 2, 3, 4, 5])).toEqual([101, 103]);
            }
        } finally {
            setJitThreshold(0);
        }
    });

    test('argument names that are not usable as they are', () => {
        for (const define of [fnJIT, fnExec]) {
            const f = define(arg('data'), arg('state'), (b: Builder, data: Ref, state: Ref) =>
                b.arr(
                    b.subFn(data, (b2, input) => b2.isType(input, 'string')),
                    state,
                ),
            );
            expect(f('text', 1)).toEqual([true, 1]);
            expect(f(5, 2)).toEqual([false, 2]);
        }
    });
});

// ============================================================================
// Programs the Builder refuses
// ============================================================================

describe('jit differential: programs the Builder refuses', () => {
    // Until 2026-11-17 each of these was accepted, and the two modes ran it differently: the
    // compiled one failed (a SyntaxError when it was built, a ReferenceError at the first call)
    // and the interpreted one answered something — `undefined`, `null` in an array, the wrong
    // argument. A program that cannot mean the same in both modes is refused when it is DECLARED,
    // whatever the entry point and whatever the mode.
    const ENTRY_POINTS: [string, Define][] = [
        ['fn', fn],
        ['fnJIT', fnJIT],
        ['fnJITTop', fnJITTop],
        ['fnExec', fnExec],
    ];

    /** A value that only another declaration can hand out, captured from it. */
    function foreign<T>(make: (b: Builder, x: Ref) => T): T {
        let captured: T | undefined;
        fnExec(arg(), (b: Builder, x: Ref) => {
            captured = make(b, x);
            return x;
        });
        return captured as T;
    }

    const REFUSED: Record<string, { program: (b: Builder, x: Ref) => Ref | void; says: RegExp }> = {
        'break_() outside a loop': {
            program: b => {
                b.break_();
                return b.lit('after');
            },
            says: /break_\(\) outside a loop/,
        },
        'continue_() outside a loop': {
            program: b => {
                b.continue_();
                return b.lit('after');
            },
            says: /continue_\(\) outside a loop/,
        },
        'break_() in a branch with no loop around it': {
            program: (b, x) => {
                b.if_(b.eq(x, b.lit(1)), () => b.break_());
                return x;
            },
            says: /break_\(\) outside a loop/,
        },
        'break_() inside a map body, with a loop around the map': {
            program: (b, x) => {
                const out = b.let(b.emptyArr());
                b.loop(x, () => {
                    b.push(
                        out,
                        b.map(x, v => {
                            b.if_(b.eq(v, b.lit(2)), () => b.break_());
                            return v;
                        }),
                    );
                });
                return out;
            },
            says: /map\(\) is a function of its own/,
        },
        'continue_() inside a map body': {
            program: (b, x) =>
                b.map(x, v => {
                    b.continue_();
                    return v;
                }),
            says: /continue_\(\) outside a loop/,
        },
        'a variable of another declaration': {
            program: b =>
                b.add(
                    b.lit(1),
                    foreign(b2 => b2.let(b2.lit(2), 'theirs')),
                ),
            says: /reads an input or a variable of another declaration/,
        },
        'a variable of the enclosing declaration, read in a nested function': {
            program: (b, x) => {
                const outer = b.let(b.add(x, b.lit(1)), 'outer');
                const nested = fn(arg(), (b2: Builder, y: Ref) => b2.add(y, outer));
                return b.call(nested, x);
            },
            says: /reads an input or a variable of another declaration/,
        },
        'an input of the enclosing declaration, read in a nested function': {
            program: (b, x) => {
                const nested = fn(arg(), arg(), (b2: Builder, y: Ref, z: Ref) => b2.add(b2.add(y, z), x));
                return b.call(nested, x, x);
            },
            says: /reads an input or a variable of another declaration/,
        },
        'an input of another declaration': {
            program: b =>
                b.get(
                    foreign((_b2, theirs) => theirs),
                    'k',
                ),
            says: /reads an input or a variable of another declaration/,
        },
        'a subFn body with a statement': {
            program: (b, x) =>
                b.subFn(x, (b2, input) => {
                    const v = b2.let(b2.add(input, b2.lit(1)));
                    return v;
                }),
            says: /subFn\(\): its body is one expression, and this one wrote 1 statement\(s\) \(let\)/,
        },
        'a subFn body that reads a variable of the function around it': {
            program: b => {
                const outer = b.let(b.lit(7), 'outer');
                return b.subFn(b.lit(5), (b2, input) => b2.add(input, outer));
            },
            says: /reads an input or a variable of another declaration/,
        },
        'a subFn body that reads the input of the function around it': {
            program: (b, x) => b.subFn(b.lit(5), (b2, input) => b2.add(input, x)),
            says: /reads an input or a variable of another declaration/,
        },
        'setVar() on a variable of another declaration': {
            program: b => {
                const theirs = foreign(b2 => b2.var_(0, 'counter'));
                b.setVar(theirs, b.lit(3));
            },
            says: /setVar\(\) on a variable \(counter\) of another declaration/,
        },
        'getVar() on a variable of another declaration': {
            program: b => b.getVar(foreign(b2 => b2.var_(0, 'counter'))),
            says: /getVar\(\) on a variable \(counter\) of another declaration/,
        },
        'a foreign variable deep in a statement of a loop body': {
            program: (b, x) => {
                const theirs = foreign(b2 => b2.let(b2.lit(2)));
                const out = b.let(b.emptyArr());
                b.loop(x, item => {
                    b.if_(b.isType(item, 'number'), () => b.push(out, b.mul(item, theirs)));
                });
                return out;
            },
            says: /reads an input or a variable of another declaration/,
        },
    };

    const ASYNC_ENTRY_POINTS: [string, Define][] = [
        ['fnAsync', fnAsync],
        ['fnAsyncJIT', fnAsyncJIT],
        ['fnAsyncJITTop', fnAsyncJITTop],
        ['fnAsyncExec', fnAsyncExec],
    ];

    const expectRefused = (entries: [string, Define][], program: (b: Builder, x: Ref) => Ref | void, says: RegExp) => {
        for (const [entry, define] of entries) {
            let thrown: unknown;
            try {
                define(arg(), program);
            } catch (error) {
                thrown = error;
            }
            expect(`${entry}: ${thrown instanceof InvalidProgramError ? 'refused' : `not refused (${show(thrown)})`}`).toBe(`${entry}: refused`);
            expect((thrown as Error).message).toMatch(says);
        }
    };

    test('await_() in a function that is not async', () => {
        // Compiled it would be a SyntaxError when the function is built; interpreted, a statement
        // that hands a promise on as if it were the value.
        expectRefused(ENTRY_POINTS, (b, x) => b.await_(x), /await_\(\) in a function that is not async: declare it with fnAsync\(\)/);
        expectRefused(
            ENTRY_POINTS,
            (b, x) => {
                b.loop(x, e => {
                    b.if_(b.isType(e, 'object'), () => b.exec(b.await_(e)));
                });
            },
            /await_\(\) in a function that is not async/,
        );
    });

    test('await_() inside the body of map(), in an async function', () => {
        expectRefused(ASYNC_ENTRY_POINTS, (b, x) => b.map(x, e => b.await_(e)), /await_\(\) inside the body of map\(\): that body is a plain function of its own/);
        // …and a loop in the same function waits.
        for (const [, define] of ASYNC_ENTRY_POINTS) {
            expect(() =>
                define(arg(), (b: Builder, x: Ref) => {
                    b.loop(x, e => b.exec(b.await_(e)));
                    return b.map(x, e => e);
                }),
            ).not.toThrow();
        }
    });

    test('a nested plain function inside an async one does not wait', () => {
        expectRefused(
            ASYNC_ENTRY_POINTS,
            (b, x) => {
                const plain = fn(arg(), (b2: Builder, y: Ref) => b2.await_(y));
                return b.call(plain, x);
            },
            /await_\(\) in a function that is not async/,
        );
    });

    test('try_() with neither a catch nor a finally', () => {
        expectRefused([...ENTRY_POINTS, ...ASYNC_ENTRY_POINTS], b => b.try_(() => b.lit(1), {}), /try_\(\) with neither a catch nor a finally/);
    });

    for (const [name, { program, says }] of Object.entries(REFUSED)) {
        test(name, () => {
            for (const [entry, define] of ENTRY_POINTS) {
                let thrown: unknown;
                try {
                    define(arg(), program);
                } catch (error) {
                    thrown = error;
                }
                expect(`${entry}: ${thrown instanceof InvalidProgramError ? 'refused' : `not refused (${show(thrown)})`}`).toBe(`${entry}: refused`);
                expect((thrown as Error).message).toMatch(says);
            }
        });
    }

    // The refusals above are by example. This one is by table: a foreign operand in EVERY operand
    // position of every expression kind and of every statement — the positions the nesting matrix
    // already knows. A Builder method that took an operand without checking it would show here.
    test('a foreign operand is refused in every operand position there is', () => {
        const accepted: string[] = [];
        const foreignChild: Mk = () => foreign((_b2, theirs) => theirs);
        const refused = (label: string, program: Program, define: Define = fnExec) => {
            try {
                compile(define, program);
                accepted.push(label);
            } catch (error) {
                if (!(error instanceof InvalidProgramError)) accepted.push(`${label}: threw ${show(error)}`);
            }
        };
        for (const kind of EXPR_KINDS) {
            for (const slot of EXPR[kind].slots) {
                // A sub-function body is built from its own input, not from the child handed in.
                if (kind === 'subFn' && slot.name === 'body') continue;
                refused(`${kind}.${slot.name}`, (b, ...x) => slot.put(b, foreignChild, x));
            }
        }
        for (const slot of STMT_SLOTS) refused(`statement ${slot.name}`, (b, ...x) => slot.put(b, foreignChild, x), slot.async ? fnAsyncExec : fnExec);
        expect(accepted).toEqual([]);
    });

    test("an expression over foreign operands is foreign, and one over none of anybody's is free", () => {
        // What a Ref method builds outside any Builder keeps whose it is…
        const theirs = foreign((_b2, input) => input.get('a').at(0).len());
        expect(() => fnExec(arg(), (b: Builder) => b.not(theirs))).toThrow(InvalidProgramError);
        // …and two declarations in one expression are refused where they meet.
        expect(() => fnExec(arg(), (_b: Builder, x: Ref) => x.get(foreign((_b2, input) => input)))).toThrow(InvalidProgramError);
        expect(() => fnExec(arg(), (_b: Builder, x: Ref) => x.at(foreign((_b2, input) => input)))).toThrow(InvalidProgramError);

        // Literals, and expressions over literals only, read nothing: any declaration may use them.
        const free = foreign(b2 => [
            b2.lit(1),
            b2.emptyObj(),
            b2.emptyArr(),
            b2.add(b2.lit(1), b2.lit(2)),
            b2.obj({ k: b2.lit(1) }),
            b2.arr(b2.lit(1)),
            b2.call(String, b2.lit(1)),
            b2.concat(b2.lit('a'), b2.lit('b')),
            b2.ternary(b2.lit(true), b2.lit(1), b2.lit(2)),
            b2.lit([1, 2]).len(),
            b2.subFn(b2.lit(2), (b3, input) => b3.mul(input, b3.lit(3))),
        ]);
        const f = fnExec(arg(), (b: Builder) => b.arr(...free));
        expect(f(0)).toEqual([1, {}, [], 3, { k: 1 }, [1], '1', 'ab', 1, 2, 6]);
    });

    test('nothing in the Builder reads an operand except through the check', () => {
        // `own()` is the one door to an operand's tree. A method that read `ref.expr` itself would
        // take an operand unchecked.
        const source = readFileSync(join(__dirname, '..', 'src', 'jit', 'builder.ts'), 'utf8');
        const builder = source.slice(source.indexOf('export class Builder {'));
        const reads = builder
            .split('\n')
            .map((line, index) => ({ line: line.trim(), index }))
            .filter(({ line }) => /\.expr\b/.test(line) && !line.startsWith('//') && !line.startsWith('*'))
            .map(({ line }) => line);
        expect(reads).toEqual(['return ref.expr;']);
    });

    test('break_() and continue_() throw where they are called', () => {
        let reached = 'nothing';
        expect(() =>
            fnExec(arg(), (b: Builder) => {
                reached = 'before';
                b.break_();
                reached = 'after';
            }),
        ).toThrow(InvalidProgramError);
        expect(reached).toBe('before');
    });

    test('a refused declaration does not capture the functions declared after it', () => {
        expect(() => fn(arg(), (b: Builder) => b.break_())).toThrow(InvalidProgramError);
        const after = fn(arg(), (b: Builder, x: Ref) => b.add(x, b.lit(1)));
        expect((after as { __nestedFnId?: number }).__nestedFnId).toBe(undefined);
        expect(after(1)).toBe(2);
    });

    // What stands next to each refusal and is a program: the same shapes, with the loop, the
    // argument or the declaration in the right place.
    const ACCEPTED: Record<string, [Program, unknown[], unknown]> = {
        'break_() in a branch inside a loop': [
            (b, x) => {
                const out = b.let(b.emptyArr());
                b.loop(x, item => {
                    b.if_(b.eq(item, b.lit(2)), () => b.break_());
                    b.push(out, item);
                });
                return out;
            },
            [[1, 2, 3]],
            [1],
        ],
        'break_() in a switch inside a loop': [
            (b, x) => {
                const out = b.let(b.emptyArr());
                b.loop(x, item => {
                    b.switch_(item, [[2, () => b.break_()]], () => b.push(out, item));
                });
                return out;
            },
            [[1, 2, 3]],
            [1],
        ],
        'a loop with a break inside a map body': [
            (b, x) =>
                b.map(x, row => {
                    const out = b.let(b.emptyArr());
                    b.loop(row, item => {
                        b.if_(b.eq(item, b.lit(0)), () => b.break_());
                        b.push(out, item);
                    });
                    return out;
                }),
            [
                [
                    [1, 0, 2],
                    [3, 4],
                ],
            ],
            [[1], [3, 4]],
        ],
        'a variable read after the loop that bound it': [
            (b, x) => {
                let last: Ref | undefined;
                b.loop(x, item => {
                    last = b.let(b.add(item, b.lit(10)));
                });
                return last as Ref;
            },
            [[1, 2]],
            12,
        ],
        'the value of the enclosing function passed to a nested function as an argument': [
            (b, x) => {
                const outer = b.let(b.add(x, b.lit(1)));
                const nested = fn(arg(), arg(), (b2: Builder, y: Ref, o: Ref) => b2.add(y, o));
                return b.call(nested, x, outer);
            },
            [5],
            11,
        ],
        'the value of the enclosing function passed to a subFn as its argument': [(b, x) => b.subFn(b.add(x, b.lit(1)), (b2, input) => b2.mul(input, b2.lit(2))), [5], 12],
        'an expression of another declaration that reads none of its inputs or variables': [
            (b, x) =>
                b.add(
                    x,
                    foreign(b2 => b2.mul(b2.lit(3), b2.lit(4))),
                ),
            [1],
            13,
        ],
        'a mutable variable of the function, set inside a map body and a loop': [
            (b, x) => {
                const total = b.var_(0);
                b.loop(x, item => b.setVar(total, b.add(b.getVar(total), item)));
                b.exec(
                    b.map(x, item => {
                        b.setVar(total, b.add(b.getVar(total), item));
                        return item;
                    }),
                );
                return b.getVar(total);
            },
            [[1, 2, 3]],
            12,
        ],
    };

    for (const [name, [program, input, expected]] of Object.entries(ACCEPTED)) {
        test(`accepted: ${name}`, () => {
            expectNoDifferences(differences(name, program, [() => [...input, 0, 0, 0].slice(0, ARGC)]));
            const f = compile(fnExec, program);
            expect(f(...input)).toEqual(expected);
        });
    }
});

// ============================================================================
// Nested functions
// ============================================================================

describe('jit differential: nested functions', () => {
    const modes: [string, Define][] = [
        ['compiled', fnJIT],
        ['interpreted', fnExec],
    ];

    for (const [mode, define] of modes) {
        test(`a function built inside another is called from it (${mode})`, () => {
            const outer = define(arg('list'), (b: Builder, list: Ref) => {
                const double = define(arg('n'), (b2: Builder, n: Ref) => b2.mul(n, b2.lit(2)));
                return b.map(list, e => b.call(double, e));
            });
            expect(outer([1, 2, 3])).toEqual([2, 4, 6]);
        });

        test(`siblings call each other, in either order of definition (${mode})`, () => {
            const outer = define(arg('n'), (b: Builder, n: Ref) => {
                let second: (...args: any[]) => any = () => undefined;
                const first = define(arg('v'), (b2: Builder, v: Ref) => b2.call((value: unknown) => second(value), b2.add(v, b2.lit(1))));
                second = define(arg('v'), (b2: Builder, v: Ref) => b2.mul(v, b2.lit(10)));
                const third = define(arg('v'), (b2: Builder, v: Ref) => b2.call(second, b2.call(first, v)));
                return b.arr(b.call(first, n), b.call(second, n), b.call(third, n));
            });
            expect(outer(1)).toEqual([20, 10, 200]);
        });

        test(`a nested function calls itself through its own name (${mode})`, () => {
            const outer = define(arg('n'), (b: Builder, n: Ref) => {
                let self: (...args: any[]) => any = () => undefined;
                self = define(arg('v'), (b2: Builder, v: Ref) => {
                    b2.if_(b2.lte(v, b2.lit(1)), () => b2.lit(1));
                    return b2.mul(
                        v,
                        b2.call((value: unknown) => self(value), b2.sub(v, b2.lit(1))),
                    );
                });
                return b.call(self, n);
            });
            expect(outer(5)).toBe(120);
        });

        test(`a nested function built for one function is reused by another (${mode})`, () => {
            let shared: (...args: any[]) => any = () => undefined;
            const first = define(arg('n'), (b: Builder, n: Ref) => {
                shared = define(arg('v'), (b2: Builder, v: Ref) => b2.concat(b2.lit('<'), v, b2.lit('>')));
                return b.call(shared, n);
            });
            const second = define(arg('n'), (b: Builder, n: Ref) => b.arr(b.call(shared, n), b.call(shared, b.lit('again'))));
            expect(first(1)).toBe('<1>');
            expect(second(2)).toEqual(['<2>', '<again>']);
        });

        test(`a nested function with control flow and a literal object (${mode})`, () => {
            const outer = define(arg('lists'), (b: Builder, lists: Ref) => {
                const firstEven = define(arg('list'), (b2: Builder, list: Ref) => {
                    const found = b2.var_<unknown>(sharedObject);
                    b2.loop(list, e => {
                        b2.if_(b2.neq(b2.mod(e, b2.lit(2)), b2.lit(0)), () => b2.continue_());
                        b2.setVar(found, e);
                        b2.break_();
                    });
                    return b2.getVar(found);
                });
                return b.map(lists, list => b.call(firstEven, list));
            });
            expect(outer([[1, 3, 4, 6], [1, 3], [8]])).toEqual([4, sharedObject, 8]);
        });

        test(`a separate compilation unit inside another function (${mode})`, () => {
            const outer = define(arg('n'), (b: Builder, n: Ref) => {
                const separate = fnJITTop(arg('v'), arg('step', 5), (b2: Builder, v: Ref, step: Ref) => b2.add(v, step));
                return b.arr(b.call(separate, n), b.call(separate, n, b.lit(1)));
            });
            expect(outer(1)).toEqual([6, 2]);
        });
    }
});

describe('jit differential: a nested function called from plain JavaScript', () => {
    // A function declared inside another one's declaration is that function's NESTED function:
    // `fn()` hands back a marker, generated code that references it calls the nested function of
    // its own unit, and the interpreter calls its interpreted body. Plain JavaScript that holds
    // the marker — a closure, a cache, a handle — calls the marker itself. Until 2026-11-16 that
    // was the interpreted body, in a process that compiles and with nothing to say so: bson's
    // extracted deserializer was called that way, and decoded 50x slower than a compiled path.
    // Now the first such call compiles the definition as a unit of its own.
    type Fn = (...args: any[]) => any;
    const NO_FN: Fn = () => undefined;

    /** `outer(n)` calls `inner(n)`; `inner(v, step = 5)` is `v * 2 + step`. */
    function build(define: Define): { outer: Fn; inner: Fn } {
        let inner = NO_FN;
        const outer = define(arg('n'), (b: Builder, n: Ref) => {
            inner = fn(arg('v'), arg('step', 5), (b2: Builder, v: Ref, step: Ref) => b2.add(b2.mul(v, b2.lit(2)), step));
            return b.call(inner, n);
        });
        return { outer, inner };
    }

    const whereCompiled = { skip: compilesFunctions() ? false : 'this run interprets: there is nothing to compile' };

    test('it is compiled by its first call, once', whereCompiled, () => {
        const { outer, inner } = build(fnJIT);
        expect(typeof (inner as { __nestedFnId?: number }).__nestedFnId).toBe('number');

        const first = compilationsOf(() => expect(inner(3)).toBe(11));
        expect(first.length).toBe(1);
        expect(first[0].source).toContain('return function(v,step=');

        const later = compilationsOf(() => {
            expect(inner(4)).toBe(13);
            expect(inner(4, 1)).toBe(9);
            // The enclosing function calls the nested function of its own unit, as before.
            expect(outer(1)).toBe(7);
        });
        expect(later.length).toBe(0);
    });

    test('a call that never comes compiles nothing', whereCompiled, () => {
        const built = compilationsOf(() => {
            const { outer } = build(fnJIT);
            expect(outer(1)).toBe(7);
            expect(outer(2)).toBe(9);
        });
        // One unit: the enclosing function, its nested function inside it.
        expect(built.length).toBe(1);
        expect(built[0].source).toContain('function _nfn_');
    });

    test('with a threshold it is interpreted until the threshold is reached', whereCompiled, () => {
        const before = getJitThreshold();
        setJitThreshold(3);
        try {
            const { inner } = build(fnJIT);
            expect(compilationsOf(() => expect(inner(1)).toBe(7)).length).toBe(0);
            expect(compilationsOf(() => expect(inner(2)).toBe(9)).length).toBe(0);
            expect(compilationsOf(() => expect(inner(3)).toBe(11)).length).toBe(1);
            expect(compilationsOf(() => expect(inner(4)).toBe(13)).length).toBe(0);
        } finally {
            setJitThreshold(before);
        }
    });

    test('the interpreter calls the interpreted body, as a callee and as a value', whereCompiled, () => {
        let double = NO_FN;
        const viaCall = build(fnExec);
        const viaValue = fnExec(arg('list'), (b: Builder, list: Ref) => {
            double = fn(arg('v'), (b2: Builder, v: Ref) => b2.mul(v, b2.lit(2)));
            // The marker as a VALUE: Array.prototype.map is what calls it.
            return b.method(list, 'map', b.lit(double));
        });
        const interpreted = compilationsOf(() => {
            expect(viaCall.outer(1)).toBe(7);
            expect(viaValue([1, 2, 3])).toEqual([2, 4, 6]);
        });
        // The functions declared inside an interpreted function are interpreted too.
        expect(interpreted.length).toBe(0);

        // Plain JavaScript that calls the same markers gets functions like any other.
        expect(compilationsOf(() => expect(viaCall.inner(3)).toBe(11)).length).toBe(1);
        expect(compilationsOf(() => expect(double(4)).toBe(8)).length).toBe(1);
    });

    test('built where functions are interpreted, it stays interpreted', () => {
        const before = getJitMode();
        setJitMode('interpreted');
        let built: { outer: Fn; inner: Fn };
        try {
            built = build(fn);
        } finally {
            setJitMode(before);
        }
        // The mode is read when a function is built, not when it is called.
        const calls = () => {
            expect(built.inner(3)).toBe(11);
            expect(built.inner(3, 1)).toBe(7);
            expect(built.outer(1)).toBe(7);
        };
        if (canJIT) expect(compilationsOf(calls).length).toBe(0);
        else calls();
    });

    for (const [mode, define] of [
        ['compiled', fnJIT],
        ['interpreted', fnExec],
    ] as [string, Define][]) {
        test(`it answers as the enclosing function's own call does (${mode})`, () => {
            const { outer, inner } = build(define);
            for (const n of [0, 1, -2.5, 7]) expect(inner(n)).toBe(outer(n));
            expect(inner(1, undefined)).toBe(7);
            expect(Number.isNaN(inner(undefined))).toBe(true);
        });
    }
});

describe('jit differential: a nested function nothing in its unit calls', () => {
    // `fn()` inside a declaration registers a nested function whether or not the tree ever
    // refers to it. One that is only kept for plain JavaScript to call — a cache, a handle —
    // compiles a unit of its own on its first call; the enclosing unit used to carry a second
    // copy of it, text that was parsed, compiled and held for nothing (12 such functions in the
    // BSON decoder of one model). The generator leaves it out, with whatever only it needed.
    type Fn = (...args: any[]) => any;
    const NO_FN: Fn = () => undefined;
    const whereCompiled = { skip: compilesFunctions() ? false : 'this run interprets: there is no text' };

    const nestedIn = (source: string) => source.match(/^function _nfn_\d+\(/gm)?.length ?? 0;
    // Declarations, for their names: an external is named after the function it is.
    function plusHundred(value: number): number {
        return value + 100;
    }
    function minusOne(value: number): number {
        return value - 1;
    }

    test('it is not in the text, nor is what only it refers to', whereCompiled, () => {
        let side = NO_FN;
        let outer = NO_FN;
        const units = compilationsOf(() => {
            outer = fnJIT(arg('n'), (b: Builder, n: Ref) => {
                side = fn(arg('v'), (b2: Builder, v: Ref) => b2.call(plusHundred, v));
                const used = fn(arg('v'), (b2: Builder, v: Ref) => b2.call(minusOne, b2.mul(v, b2.lit(2))));
                return b.call(used, n);
            });
        });
        expect(units.length).toBe(1);
        expect(nestedIn(units[0].source)).toBe(1);
        expect(units[0].externals).toEqual(['minusOne_0']);
        expect(outer(2)).toBe(3);

        // It is a function all the same: its own unit, on its first call.
        const first = compilationsOf(() => expect(side(1)).toBe(101));
        expect(first.length).toBe(1);
        expect(first[0].externals).toEqual(['plusHundred_0']);
        expect(nestedIn(first[0].source)).toBe(0);
    });

    test('what a called function calls stays; what only an uncalled one calls goes with it', whereCompiled, () => {
        let side = NO_FN;
        let outer = NO_FN;
        const units = compilationsOf(() => {
            outer = fnJIT(arg('n'), (b: Builder, n: Ref) => {
                const leaf = fn(arg('v'), (b2: Builder, v: Ref) => b2.add(v, b2.lit(1)));
                const used = fn(arg('v'), (b2: Builder, v: Ref) => b2.mul(b2.call(leaf, v), b2.lit(2)));
                const onlyForSide = fn(arg('v'), (b2: Builder, v: Ref) => b2.call(plusHundred, v));
                // Refers to a function the unit keeps and to one nothing else refers to.
                side = fn(arg('v'), (b2: Builder, v: Ref) => b2.add(b2.call(onlyForSide, v), b2.call(leaf, v)));
                return b.call(used, n);
            });
        });
        expect(units.length).toBe(1);
        expect(nestedIn(units[0].source)).toBe(2);
        expect(units[0].externals).toEqual([]);
        expect(outer(2)).toBe(6);

        // Its own unit holds the two it calls.
        const first = compilationsOf(() => expect(side(1)).toBe(103));
        expect(first.length).toBe(1);
        expect(nestedIn(first[0].source)).toBe(2);
    });

    test('a function that only calls itself is not called', whereCompiled, () => {
        let outer = NO_FN;
        let countdown: Fn = NO_FN;
        const units = compilationsOf(() => {
            outer = fnJIT(arg('n'), (b: Builder, n: Ref) => {
                // The reference is to the marker itself, inside its own body.
                const self: { fn: Fn } = { fn: NO_FN };
                const body = (b2: Builder, v: Ref) => {
                    b2.if_(b2.lte(v, b2.lit(0)), () => b2.lit('done'));
                    return b2.call((value: number) => self.fn(value), b2.sub(v, b2.lit(1)));
                };
                countdown = self.fn = fn(arg('v'), body);
                return b.add(n, b.lit(1));
            });
        });
        expect(units.length).toBe(1);
        expect(nestedIn(units[0].source)).toBe(0);
        expect(outer(1)).toBe(2);
        expect(countdown(3)).toBe('done');
    });

    test('at any depth: an uncalled function inside a called one', whereCompiled, () => {
        let deepSide = NO_FN;
        let outer = NO_FN;
        const units = compilationsOf(() => {
            outer = fnJIT(arg('n'), (b: Builder, n: Ref) => {
                const used = fn(arg('v'), (b2: Builder, v: Ref) => {
                    deepSide = fn(arg('w'), (b3: Builder, w: Ref) => b3.call(plusHundred, w));
                    const deepUsed = fn(arg('w'), (b3: Builder, w: Ref) => b3.mul(w, b3.lit(3)));
                    return b2.call(deepUsed, v);
                });
                return b.call(used, n);
            });
        });
        expect(units.length).toBe(1);
        expect(nestedIn(units[0].source)).toBe(2);
        expect(units[0].externals).toEqual([]);
        expect(outer(2)).toBe(6);
        expect(deepSide(1)).toBe(101);
    });

    test('a marker used as a value is a call', whereCompiled, () => {
        let outer = NO_FN;
        const units = compilationsOf(() => {
            outer = fnJIT(arg('list'), (b: Builder, list: Ref) => {
                const double = fn(arg('v'), (b2: Builder, v: Ref) => b2.mul(v, b2.lit(2)));
                return b.method(list, 'map', b.lit(double));
            });
        });
        expect(nestedIn(units[0].source)).toBe(1);
        expect(outer([1, 2])).toEqual([2, 4]);
    });

    test('what only an uncalled function needed goes in as many passes as it takes', whereCompiled, () => {
        let outer = NO_FN;
        let side = NO_FN;
        const units = compilationsOf(() => {
            outer = fnJIT(arg('n'), (b: Builder, n: Ref) => {
                const viaHelper = fn(arg('v'), (b2: Builder, v: Ref) => b2.call(plusHundred, v));
                // A helper is emitted whoever asked for it, so what it calls counts as called by
                // the unit — until the function that asked for it is gone, and the helper with it.
                side = fn(arg('v'), (b2: Builder, v: Ref) => b2.subFn(v, (b3, input) => b3.call(viaHelper, input)));
                return b.add(n, b.lit(1));
            });
        });
        expect(units.length).toBe(1);
        expect(units[0].source).toBe("'use strict';\nreturn function(n){\nreturn (n+1);\n}");
        expect(units[0].externals).toEqual([]);
        expect(outer(1)).toBe(2);
        expect(side(1)).toBe(101);
    });

    for (const [mode, define] of [
        ['compiled', fnJIT],
        ['interpreted', fnExec],
    ] as [string, Define][]) {
        test(`the functions answer the same, called or not (${mode})`, () => {
            let side = NO_FN;
            const outer = define(arg('n'), (b: Builder, n: Ref) => {
                const leaf = fn(arg('v'), (b2: Builder, v: Ref) => b2.add(v, b2.lit(1)));
                const used = fn(arg('v'), (b2: Builder, v: Ref) => b2.mul(b2.call(leaf, v), b2.lit(2)));
                side = fn(arg('v'), arg('step', 10), (b2: Builder, v: Ref, step: Ref) => b2.add(b2.call(leaf, v), step));
                return b.call(used, n);
            });
            expect(outer(2)).toBe(6);
            expect(side(1)).toBe(12);
            expect(side(1, 0)).toBe(2);
        });
    }
});

describe('jit differential: a declaration that fails', () => {
    // While a body callback runs, its declaration is "the active one" and a function declared
    // inside becomes its nested function. A callback that throws used to leave it active for good:
    // every function declared afterwards, anywhere in the process, was handed back as a nested
    // marker of a dead declaration — an interpreted function where a compiled one was asked for.
    for (const [name, define] of [
        ['fn', fn],
        ['fnJIT', fnJIT],
        ['fnJITTop', fnJITTop],
        ['fnExec', fnExec],
    ] as [string, Define][]) {
        test(`a body that throws in ${name} does not capture the functions declared after it`, () => {
            expect(() =>
                define((b: Builder) => {
                    b.let(b.lit(1));
                    throw new RangeError('refused');
                }),
            ).toThrow(RangeError);

            const after = fnJIT(arg(), (b: Builder, x: Ref) => b.add(x, b.lit(1)));
            expect((after as { __nestedFnId?: number }).__nestedFnId).toBe(undefined);
            expect(after(1)).toBe(2);

            // A nested declaration that throws leaves its PARENT active, not itself and not nothing.
            const outer = fnJIT(arg(), (b: Builder, x: Ref) => {
                expect(() =>
                    define(() => {
                        throw new RangeError('refused inside');
                    }),
                ).toThrow(RangeError);
                const inner = fnJIT(arg(), (b2: Builder, v: Ref) => b2.mul(v, b2.lit(3)));
                expect(typeof (inner as { __nestedFnId?: number }).__nestedFnId).toBe('number');
                return b.call(inner, x);
            });
            expect((outer as { __nestedFnId?: number }).__nestedFnId).toBe(undefined);
            expect(outer(2)).toBe(6);
        });
    }
});

// ============================================================================
// Refused writes
// ============================================================================

describe('jit differential: a write the target refuses', () => {
    // Generated source is strict, like the interpreter (a module): a write that cannot happen is a
    // TypeError in both modes. Until 2026-11-16 the generated source was sloppy and dropped the
    // write in silence — the same tree lost a value compiled and threw interpreted.
    const TARGETS: Record<string, () => unknown> = {
        'a frozen object': () => Object.freeze({ k: 0 }),
        'a property with a getter and no setter': () => ({
            get k() {
                return 0;
            },
        }),
        'a property that is not writable': () => Object.defineProperty({}, 'k', { value: 0, writable: false, enumerable: true }),
        'a new key on an object that takes none': () => Object.preventExtensions({}),
        'a string': () => 'primitive',
        'a number': () => 7,
        'a boolean': () => true,
    };
    const WRITES: Record<string, Program> = {
        'set, static key': (b, target) => {
            b.set(target, 'k', b.lit(1));
            return b.lit('survived');
        },
        'set, computed key': (b, target, key) => {
            b.set(target, key, b.lit(1));
            return b.lit('survived');
        },
        'set inside a nested function': (b, target) => {
            const inner = fn(arg(), (bb: Builder, t: Ref) => {
                bb.set(t, 'k', bb.lit(1));
                return bb.lit('survived');
            });
            return b.call(inner, target);
        },
    };

    for (const [targetName, makeTarget] of Object.entries(TARGETS)) {
        for (const [writeName, program] of Object.entries(WRITES)) {
            test(`${writeName} on ${targetName} throws in both modes`, () => {
                for (const define of [fnJIT, fnExec]) {
                    const target = makeTarget();
                    expect(() => compile(define, program)(target, 'k')).toThrow(TypeError);
                    if (typeof target === 'object') expect((target as { k?: number }).k ?? 0).toBe(0);
                }
                expectNoDifferences(differences(`${writeName} on ${targetName}`, program, [() => [makeTarget(), 'k', 0, 0]]));
            });
        }
    }

    test('a frozen array refuses push in both modes', () => {
        const program: Program = (b, target) => {
            b.push(target, b.lit(1));
            return b.lit('survived');
        };
        for (const define of [fnJIT, fnExec]) {
            expect(() => compile(define, program)(Object.freeze([]))).toThrow(TypeError);
        }
    });

    test('a write the target accepts is unchanged', () => {
        const program: Program = (b, target) => {
            b.set(target, 'k', b.lit(1));
            return target;
        };
        for (const define of [fnJIT, fnExec]) {
            expect(compile(define, program)({ k: 0 })).toEqual({ k: 1 });
        }
    });
});

// ============================================================================
// Async functions
// ============================================================================

describe('jit differential: async functions', () => {
    // The interpreter has an async twin of every statement that holds a block — the only way to
    // an `await` — so each of them is run here with an `await` inside it.
    for (const [loopName, loop] of Object.entries(LOOPS)) {
        test(`break, continue, return and throw across an await inside ${loopName}`, async () => {
            const found: string[] = [];
            for (const [placeName, place] of Object.entries(PLACEMENTS)) {
                for (const [actionName, act] of Object.entries(ACTIONS)) {
                    found.push(...(await differencesAsync(`${loopName} / ${actionName} in ${placeName}`, asyncFlowProgram(loop, place, act), FLOW_VECTORS)));
                }
            }
            expectNoDifferences(found);
        });
    }

    const PROGRAMS: Record<string, Program> = {
        'no await at all: still a promise': (b, x0) => b.add(x0, b.lit(1)),
        'no statement at all': () => undefined,
        'an error before the first await is a rejection': (b, x0) => {
            b.throw_(b.arr(b.lit('thrown first'), x0));
        },
        'an engine error before the first await is a rejection': (b, x0) => b.get(b.get(x0, 'missing'), 'deeper'),
        'what it returns is a promise: the promise is adopted': (b, x0) => b.call(later, x0),
        'what it returns is a rejection': (b, x0) => b.call(rejected, b.arr(b.lit('rejected'), x0)),
        'a rejection is caught': (b, x0, x1) => {
            b.try_(
                () => {
                    b.await_(b.call(rejected, x0));
                    b.push(x1, b.lit('never'));
                },
                { catch: error => b.push(x1, b.arr(b.lit('caught'), error)), finally: () => b.push(x1, b.await_(b.call(resolved, b.lit('finally')))) },
            );
            return x1;
        },
        'an await in the catch and in the finally only': (b, x0, x1) => {
            b.try_(
                () => {
                    b.if_(b.eq(x0, b.lit(1)), () => b.throw_(b.lit('thrown')));
                    b.push(x1, b.lit('body'));
                },
                {
                    catch: error => b.push(x1, b.await_(b.call(resolved, error))),
                    finally: () => b.push(x1, b.await_(b.call(later, b.lit('finally')))),
                },
            );
            return x1;
        },
        'a return waits for a finally that waits': (b, x0, x1) => {
            b.try_(() => b.arr(b.lit('returned'), x0), {
                finally: () => {
                    b.await_(b.call(later, x0));
                    b.push(x1, b.lit('finally'));
                },
            });
            return b.lit('never');
        },
        'a finally that waits and then returns replaces an error': (b, x0) => {
            b.try_(
                () => {
                    b.throw_(b.lit('lost'));
                },
                {
                    finally: () => {
                        const waited = b.await_(b.call(resolved, x0));
                        b.if_(b.eq(waited, b.lit(1)), () => b.arr(b.lit('finally wins'), waited));
                    },
                },
            );
        },
        'a nested async function is awaited': (b, x0) => {
            const inner = fnAsync(arg(), (b2: Builder, y: Ref) => {
                const got = b2.await_(b2.call(later, y));
                return b2.arr(b2.lit('inner'), got);
            });
            return b.arr(b.await_(b.call(inner, x0)), b.await_(b.call(inner, b.lit('again'))));
        },
        'a nested async function that rejects': (b, x0, x1) => {
            const inner = fnAsync(arg(), (b2: Builder, y: Ref) => {
                b2.await_(b2.call(resolved, y));
                b2.throw_(b2.arr(b2.lit('from inner'), y));
            });
            b.try_(
                () => {
                    b.await_(b.call(inner, x0));
                },
                { catch: error => b.push(x1, error) },
            );
            return x1;
        },
        'a plain nested function is called between two awaits': (b, x0) => {
            const plain = fn(arg(), (b2: Builder, y: Ref) => b2.arr(b2.lit('plain'), y));
            const first = b.await_(b.call(resolved, x0));
            const between = b.let(b.call(plain, first));
            const second = b.await_(b.call(later, between));
            return b.arr(first, between, second);
        },
        // What stands for a closure: a nested function with the values it needs bound as its
        // leading arguments. Whoever calls it — here plain JavaScript — passes the rest.
        'a nested function, bound to values of this call, is handed to plain JavaScript': (b, x0, x1) => {
            const inner = fnAsync(arg(), arg(), arg(), (b2: Builder, list: Ref, held: Ref, passed: Ref) => {
                b2.push(list, b2.arr(held, b2.await_(b2.call(later, passed))));
                return b2.lit('inner done');
            });
            const bound = b.method(b.lit(inner), 'bind', b.lit(undefined), x1, x0);
            return b.arr(b.await_(b.call(callWith, bound, b.lit('passed in'))), x1);
        },
        'a map between two awaits': (b, x0, x1, x2, x3) => {
            const first = b.await_(b.call(resolved, x3));
            const mapped = b.let(b.map(first, (e, i) => b.arr(e, i, x0)));
            return b.arr(b.await_(b.call(later, mapped)), mapped);
        },
    };

    for (const [name, program] of Object.entries(PROGRAMS)) {
        test(name, async () => {
            expectNoDifferences(await differencesAsync(name, program, STMT_VECTORS));
        });
    }

    // Anchors: both modes agreeing is not enough when both could be wrong the same way.
    const both = (name: string, body: (defineAsync: Define, define: Define) => Promise<void>) => {
        test(`${name} (compiled)`, () => body(fnAsyncJIT, fnJIT));
        test(`${name} (interpreted)`, () => body(fnAsyncExec, fnExec));
    };

    both('it answers a promise, and what it returns is what the promise resolves to', async defineAsync => {
        const f = defineAsync(arg(), (b: Builder, x: Ref) => {
            const got = b.await_(b.call(later, x));
            return b.arr(b.lit('got'), got);
        });
        const answered = f(7);
        expect(answered).toBeInstanceOf(Promise);
        expect(await answered).toEqual(['got', 7]);
    });

    both('an error thrown before the first await rejects, it does not throw', async defineAsync => {
        const f = defineAsync(arg(), (b: Builder, x: Ref) => {
            b.throw_(b.new_(RangeError, x));
        });
        let answered: unknown;
        expect(() => (answered = f('too early'))).not.toThrow();
        await expect(answered as Promise<unknown>).rejects.toThrow('too early');
    });

    both('calls that overlap keep their own variables and their own return values', async defineAsync => {
        const f = defineAsync(arg(), arg(), (b: Builder, x: Ref, wait: Ref) => {
            const before = b.let(b.mul(x, b.lit(10)), 'before');
            const got = b.await_(b.method(wait, 'call', b.lit(undefined), x));
            return b.arr(x, before, got);
        });
        // The first call is still waiting when the second and the third run to their end.
        let release!: (value: unknown) => void;
        const held = new Promise(resolve => (release = resolve));
        const first = f(1, () => held);
        const second = await f(2, later);
        const third = await f(3, resolved);
        release('released');
        expect(await first).toEqual([1, 10, 'released']);
        expect(second).toEqual([2, 20, 2]);
        expect(third).toEqual([3, 30, 3]);
    });

    both('a return keeps its value while it waits and other functions return theirs', async (defineAsync, define) => {
        const f = defineAsync(arg(), arg(), (b: Builder, x: Ref, gate: Ref) => {
            b.try_(() => b.arr(b.lit('mine'), x), {
                finally: () => {
                    b.await_(gate);
                },
            });
        });
        const other = define(arg(), (b: Builder, x: Ref) => {
            b.return_(b.arr(b.lit('theirs'), x));
        });
        let release!: (value: unknown) => void;
        const gate = new Promise(resolve => (release = resolve));
        const waiting = f(1, gate);
        // While the first return waits in its finally: a plain function returns, and so does
        // another call of the same async function.
        expect(other(2)).toEqual(['theirs', 2]);
        expect(await f(3, undefined)).toEqual(['mine', 3]);
        expect(other(4)).toEqual(['theirs', 4]);
        release(undefined);
        expect(await waiting).toEqual(['mine', 1]);
    });

    both('statements run in order across the awaits, and a loop waits turn by turn', async defineAsync => {
        const f = defineAsync(arg(), arg(), (b: Builder, list: Ref, log: Ref) => {
            b.loop(list, (e, i) => {
                b.push(log, b.arr(b.lit('start'), i));
                b.push(log, b.arr(b.lit('end'), b.await_(b.call(later, e))));
            });
            return b.len(log);
        });
        const log: unknown[] = [];
        expect(await f(['a', 'b'], log)).toBe(4);
        expect(log).toEqual([
            ['start', 0],
            ['end', 'a'],
            ['start', 1],
            ['end', 'b'],
        ]);
    });

    test('a function declared inside an async one, and called by it, is in its unit', { skip: !canJIT }, () => {
        const text = generatedSource(() => {
            fnAsyncJIT(arg('x'), (b: Builder, x: Ref) => {
                const inner = fnAsync(arg('y'), (b2: Builder, y: Ref) => b2.await_(b2.call(later, y)));
                const plain = fn(arg('z'), (b2: Builder, z: Ref) => b2.add(z, b2.lit(1)));
                return b.call(plain, b.await_(b.call(inner, x)));
            });
        });
        expect(text).toContain('async function _nfn_0(y){');
        expect(text).toContain('function _nfn_1(z){');
        expect(text).not.toContain('async function _nfn_1');
        expect(text).toContain('return async function(x){');
    });
});

// ============================================================================
// Generated source
// ============================================================================

describe('jit differential: generated source', () => {
    // What the compiled mode's functions ANSWER is held above. This holds what they ARE: the text
    // generated for every row of the two tables, in golden files. A refactor of the generator that
    // is meant to change nothing leaves them byte-identical; a change that is meant to change the
    // text is a diff of these files to read. `UPDATE_GOLDEN=1` rewrites them.
    const section = (title: string, program: Program, define: Define = fnJIT) => `// ── ${title}\n${generatedSource(() => compile(define, program))}`;
    // The text exists only where it can be generated.
    const needsCodeGeneration = { skip: !canJIT };

    test('every expression kind', needsCodeGeneration, () => {
        const sections: string[] = [];
        for (const kind of EXPR_KINDS) {
            const row = EXPR[kind];
            for (const [name, mk] of Object.entries({ leaf: row.leaf, ...row.more })) {
                sections.push(section(`${kind}: ${name}`, (b, ...x) => mk(b, x)));
            }
        }
        expectGolden(join(__dirname, 'golden', 'jit-expressions.js'), sections.join('\n'));
    });

    test('every statement kind', needsCodeGeneration, () => {
        const sections: string[] = [];
        for (const kind of STMT_KINDS) {
            for (const [name, program] of Object.entries(STMT[kind])) sections.push(section(`${kind}: ${name}`, program, ASYNC_STMT_KINDS.has(kind) ? fnAsyncJIT : fnJIT));
        }
        expectGolden(join(__dirname, 'golden', 'jit-statements.js'), sections.join('\n'));
    });

    test('functions inside functions, and argument defaults', needsCodeGeneration, () => {
        const text = generatedSource(() => {
            fnJIT(arg('list'), arg('factor', 2), (b: Builder, list: Ref, factor: Ref) => {
                const scale = fnJIT(arg('n'), arg('by', 1), (b2: Builder, n: Ref, by: Ref) => b2.mul(n, by));
                const label = fnJIT(arg('n'), (b2: Builder, n: Ref) => b2.concat(b2.lit('#'), b2.call(scale, n, b2.lit(10))));
                return b.map(list, e => b.arr(b.call(scale, e, factor), b.call(label, e)));
            });
            // `fnJIT`, not `fn` / `fnJITTop`: the text is wanted whatever mode the suite runs in.
            fnJIT(arg('value'), (b: Builder, value: Ref) => b.subFn(value, (b2, v) => b2.and(b2.isType(v, 'object'), b2.not(b2.isNull(v)))));
        });
        expectGolden(join(__dirname, 'golden', 'jit-functions.js'), text);
    });
});

// ============================================================================
// Random programs
// ============================================================================

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const FUZZ_LITERALS: unknown[] = [0, 1, 2, 3, -1, -2, 0.5, 'a', 'b', '', '1', true, false, null, undefined];
/** Kinds a random expression is drawn from; `var` and `lit` and `input` are the terminals. */
const FUZZ_KINDS = EXPR_KINDS.filter(kind => EXPR[kind].slots.length > 0);

interface Scope {
    rnd: () => number;
    /** Variables in scope, readable anywhere below their binding. */
    vars: Ref[];
    /** False inside a sub-function body, where a statement cannot be emitted. */
    statements: boolean;
    /** The block is an async function's: about one statement in five waits. */
    async?: boolean;
}

function pick<T>(rnd: () => number, list: readonly T[]): T {
    return list[Math.floor(rnd() * list.length)];
}

function randomExpr(b: Builder, x: Ref[], depth: number, scope: Scope): Ref {
    const { rnd } = scope;
    if (depth <= 0 || rnd() < 0.15) {
        const roll = rnd();
        if (roll < 0.45) return pick(rnd, x);
        if (roll < 0.6 && scope.vars.length > 0) return pick(rnd, scope.vars);
        return b.lit(pick(rnd, FUZZ_LITERALS));
    }
    const kind = pick(rnd, FUZZ_KINDS);
    const slot = pick(rnd, EXPR[kind].slots);
    // The slot's other operands are the inputs, or — half of the time each — random trees of their own.
    const siblings = x.map(input => (rnd() < 0.5 ? input : randomExpr(b, x, depth - 1, scope)));
    return slot.put(b, (b2, x2) => randomExpr(b2, x2, depth - 1, b2 === b ? scope : { rnd, vars: [], statements: false }), kind === 'subFn' ? x : siblings);
}

function randomBlock(b: Builder, x: Ref[], out: Ref, depth: number, scope: Scope, inLoop: boolean): void {
    const { rnd } = scope;
    const vars = [...scope.vars];
    const inner: Scope = { ...scope, vars };
    const expr = (d = 2): Ref => randomExpr(b, x, d, inner);
    const count = 1 + Math.floor(rnd() * 4);
    for (let n = 0; n < count; n++) {
        if (scope.async && rnd() < 0.2) {
            vars.push(b.await_(rnd() < 0.5 ? b.call(resolved, expr()) : expr()));
            continue;
        }
        const roll = rnd();
        if (roll < 0.2) {
            b.push(out, expr());
        } else if (roll < 0.3) {
            vars.push(b.let(expr()));
        } else if (roll < 0.38) {
            const v = b.var_(pick(rnd, FUZZ_LITERALS));
            b.setVar(v, pick(rnd, [b.add, b.sub, b.mul, b.bitOr] as const).call(b, b.getVar(v), pick(rnd, [b.lit(1), expr(1)])));
            vars.push(b.getVar(v));
        } else if (roll < 0.44) {
            const target = b.let(rnd() < 0.5 ? b.emptyObj() : b.emptyArr());
            b.set(target, rnd() < 0.5 ? pick(rnd, ['a', 'b-c', '0']) : expr(1), expr());
            b.push(out, target);
        } else if (roll < 0.56 && depth > 0) {
            b.if_(expr(), () => randomBlock(b, x, out, depth - 1, inner, inLoop), rnd() < 0.5 ? () => randomBlock(b, x, out, depth - 1, inner, inLoop) : undefined);
        } else if (roll < 0.64 && depth > 0) {
            b.switch_(
                expr(1),
                pick(rnd, [
                    [0, 1],
                    ['a', 'b'],
                    [true, null],
                    [1, '1', undefined],
                ] as unknown[][]).map(literal => [literal, () => randomBlock(b, x, out, depth - 1, inner, inLoop)] as [unknown, () => void]),
                rnd() < 0.5 ? () => randomBlock(b, x, out, depth - 1, inner, inLoop) : undefined,
            );
        } else if (roll < 0.84 && depth > 0) {
            const body = (item: Ref) => {
                b.push(out, item);
                randomBlock(b, x, out, depth - 1, { ...inner, vars: [...vars, item] }, true);
            };
            const shape = Math.floor(rnd() * 6);
            if (shape === 0) b.loop(pick(rnd, [x[3], b.arr(expr(1), expr(1), expr(1))]), e => body(e));
            else if (shape === 1) b.forRange(b.lit(Math.floor(rnd() * 2)), b.bitAnd(expr(1), b.lit(3)), i => body(i));
            else if (shape === 2) b.forIn(pick(rnd, [x[2], b.obj({ a: expr(1), b: expr(1) })]), k => body(k));
            else if (shape === 3) b.forOf(b.arr(expr(1), expr(1), expr(1)), v => body(v));
            else if (shape === 4) b.loopIdx(b.arr(expr(1), expr(1)), i => body(i));
            else {
                const turns = b.var_(0);
                b.while_(b.lt(b.getVar(turns), b.lit(3)), () => {
                    b.setVar(turns, b.add(b.getVar(turns), b.lit(1)));
                    body(b.getVar(turns));
                });
            }
        } else if (roll < 0.9 && inLoop) {
            if (rnd() < 0.5) b.break_();
            else b.continue_();
        } else if (roll < 0.94) {
            b.return_(rnd() < 0.8 ? b.arr(b.lit('returned'), out, expr()) : undefined);
        } else if (roll < 0.955) {
            b.throw_(b.arr(b.lit('thrown'), out));
        } else if (roll < 0.99 && depth > 0) {
            const shape = Math.floor(rnd() * 3);
            const more = (chance: number) => {
                if (rnd() < chance) randomBlock(b, x, out, depth - 1, inner, inLoop);
            };
            b.try_(() => randomBlock(b, x, out, depth - 1, inner, inLoop), {
                // An engine error is recorded by its class: its message names a generated variable.
                catch:
                    shape !== 1
                        ? error => {
                              b.push(out, b.arr(b.lit('caught'), b.ternary(b.isInstance(error, Error), b.get(b.get(error, 'constructor'), 'name'), error)));
                              more(0.5);
                          }
                        : undefined,
                finally:
                    shape !== 0
                        ? () => {
                              b.push(out, b.lit('finally'));
                              more(0.3);
                          }
                        : undefined,
            });
        } else {
            b.exec(expr());
        }
    }
}

describe('jit differential: random programs', () => {
    const seed = Number(process.env.JIT_FUZZ_SEED || 20261116);
    const count = Number(process.env.JIT_FUZZ_N || 400);

    function report(label: string, program: Program, found: string[]): string[] {
        if (found.length === 0) return [];
        const tree = JSON.stringify(treeOf(program), (key, value) => (typeof value === 'function' ? `[function ${value.name}]` : typeof value === 'bigint' ? `${value}n` : value === undefined ? '[undefined]' : value));
        return [...found.slice(0, 3), `  tree of ${label}: ${tree}`];
    }

    test(`${count} random expressions, seed ${seed}`, () => {
        const found: string[] = [];
        for (let n = 0; n < count && found.length < 12; n++) {
            const program: Program = (b, ...x) => randomExpr(b, x, 4, { rnd: mulberry32(seed + n), vars: [], statements: true });
            found.push(...report(`expression ${n}`, program, differences(`expression ${n}`, program, VECTORS)));
        }
        expectNoDifferences(found);
    });

    test(`${count} random statement blocks, seed ${seed}`, () => {
        const found: string[] = [];
        for (let n = 0; n < count && found.length < 12; n++) {
            const program: Program = (b, ...x) => {
                const out = b.let(b.emptyArr());
                randomBlock(b, x, out, 3, { rnd: mulberry32(seed * 31 + n), vars: [], statements: true }, false);
                return out;
            };
            found.push(...report(`block ${n}`, program, differences(`block ${n}`, program, VECTORS)));
        }
        expectNoDifferences(found);
    });

    test(`${count} random statement blocks of an async function, seed ${seed}`, async () => {
        const found: string[] = [];
        for (let n = 0; n < count && found.length < 12; n++) {
            const program: Program = (b, ...x) => {
                const out = b.let(b.emptyArr());
                randomBlock(b, x, out, 3, { rnd: mulberry32(seed * 37 + n), vars: [], statements: true, async: true }, false);
                return out;
            };
            found.push(...report(`async block ${n}`, program, await differencesAsync(`async block ${n}`, program, VECTORS)));
        }
        expectNoDifferences(found);
    });
});
