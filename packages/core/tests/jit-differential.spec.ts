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
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { inspect } from 'node:util';

import { expect } from '@deepkit/run/expect';

import { type Block, Builder, EXPR_KINDS, type Expr, Ref, STMT_KINDS, type Stmt, arg, canJIT, fn, fnExec, fnJIT, fnJITTop, setJitThreshold } from '../src/jit.js';
import { expectGolden, generatedSource } from './support/generated-source.js';

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
    const b = new Builder(ARGC);
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

const holey: unknown[] = [1, 2, 3];
delete holey[1];

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

/** Cells of the nesting matrix that are not programs the Builder supports, each with its reason. */
const UNSUPPORTED_NESTING = new Map<string, string>([['subFn.body<var', 'a sub-function body is one expression: the statement that binds a variable is dropped']]);

// ============================================================================
// Statement table
// ============================================================================

/** Every position of a statement that takes an expression. */
const STMT_SLOTS: Array<{ name: string; put: (b: Builder, mk: Mk, x: Ref[]) => Ref | void }> = [
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
};

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
        const takesAnExpression = STMT_KINDS.filter(kind => kind !== 'break' && kind !== 'continue');
        expect(takesAnExpression.filter(kind => !covered.has(kind))).toEqual([]);
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
        test(`statement ${kind}`, () => {
            const found: string[] = [];
            for (const [name, program] of Object.entries(STMT[kind])) {
                found.push(...differences(`${kind} / ${name}`, program, STMT_VECTORS));
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
                    if (UNSUPPORTED_NESTING.has(cell)) continue;
                    found.push(...differences(cell, (b, ...x) => slot.put(b, EXPR[child].leaf, x), VECTORS));
                }
            }
            expectNoDifferences(found);
        });
    }

    for (const slot of STMT_SLOTS) {
        test(`every kind in statement position: ${slot.name}`, () => {
            const found: string[] = [];
            for (const child of EXPR_KINDS) {
                found.push(...differences(`${slot.name}<${child}`, (b, ...x) => slot.put(b, EXPR[child].leaf, x), VECTORS));
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
// Generated source
// ============================================================================

describe('jit differential: generated source', () => {
    // What the compiled mode's functions ANSWER is held above. This holds what they ARE: the text
    // generated for every row of the two tables, in golden files. A refactor of the generator that
    // is meant to change nothing leaves them byte-identical; a change that is meant to change the
    // text is a diff of these files to read. `UPDATE_GOLDEN=1` rewrites them.
    const section = (title: string, program: Program) => `// ── ${title}\n${generatedSource(() => compile(fnJIT, program))}`;
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
            for (const [name, program] of Object.entries(STMT[kind])) sections.push(section(`${kind}: ${name}`, program));
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
        } else if (roll < 0.96) {
            b.throw_(b.arr(b.lit('thrown'), out));
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
});
