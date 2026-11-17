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
 * The interpreted mode: a block turned into nested closures once, then called. What runs where
 * `new Function` is refused (a strict CSP) or the mode says `'interpreted'`.
 */
import { Block, Expr, Stmt, shapeOfExpr, shapeOfStmt } from './nodes.js';

// ============================================================================
// Closure-Based Executor (Optimized Exec Mode)
// ============================================================================

/**
 * A value of the tree as the INTERPRETER uses it: a nested-function marker stands for its
 * interpreted body. The functions declared inside an interpreted function are interpreted too
 * ({@link fnExec}), and the marker itself would compile where the process compiles.
 */
export function interpretedValue<T>(value: T): T {
    if (typeof value === 'function') {
        const executor = (value as { __nestedFnExecutor?: T }).__nestedFnExecutor;
        if (executor) return executor;
    }
    return value;
}

/** An expression, a statement or a block as a closure over the call's arguments and its variables. */
type EvalFn = (args: any[], vars: any[]) => any;

/**
 * The variable array of a call that binds no variable. Frozen: a closure that wrote to it would
 * be writing to every such call at once, and throws instead.
 */
const NO_VARS: any[] = Object.freeze([]) as any;

/**
 * Whether an expression reads a variable — whether evaluating it needs the variable array. A `map`
 * always does: it binds its element and its index. The rest is what the kind is made of.
 */
function exprNeedsVars(expr: Expr): boolean {
    if (expr.kind === 'var' || expr.kind === 'map') return true;
    const shape = shapeOfExpr(expr);
    return shape.exprs(expr, exprNeedsVars) || (shape.inner !== undefined && shape.inner(expr, exprNeedsVars));
}

/**
 * What `{[key]: value}` does: the key becomes an OWN property, whatever it is called. A plain
 * assignment would run the `__proto__` setter for that one key and replace the object's prototype
 * with the value — with a key that comes from data, that is the data choosing the prototype.
 */
function setComputedKey(target: any, key: any, value: unknown): void {
    if ((typeof key === 'string' && key !== '__proto__') || typeof key === 'number') {
        target[key] = value;
    } else {
        Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
    }
}

/**
 * Flatten AND expressions into an array of operands for fast short-circuit evaluation.
 */
function flattenAnd(expr: Expr): Expr[] {
    if (expr.kind === 'and') {
        return [...flattenAnd(expr.a), ...flattenAnd(expr.b)];
    }
    return [expr];
}

/**
 * An expression as a closure: built once from the tree, called with the call's arguments and its
 * variables. ONE compiler for every expression — until 2026-11-17 there were two, one for
 * expressions that read no variable and one for the rest, the same cases written twice.
 *
 * What it does for speed: an `&&` chain is flattened and unrolled up to ten operands, and a call
 * with up to three arguments does not build an argument array.
 */
function compileExpr(expr: Expr): EvalFn {
    switch (expr.kind) {
        case 'lit': {
            const value = interpretedValue(expr.value);
            return () => value;
        }
        case 'input': {
            const index = expr.index;
            return args => args[index];
        }
        case 'var': {
            const id = expr.id;
            return (_args, vars) => vars[id];
        }
        case 'get': {
            // A read from null or undefined throws, as the compiled `obj.key` does.
            const objFn = compileExpr(expr.obj);
            if (typeof expr.key === 'string') {
                const key = expr.key;
                return (args, vars) => objFn(args, vars)[key];
            } else {
                const keyFn = compileExpr(expr.key);
                return (args, vars) => objFn(args, vars)[keyFn(args, vars)];
            }
        }
        case 'at': {
            const arrFn = compileExpr(expr.arr);
            if (typeof expr.index === 'number') {
                const idx = expr.index;
                return (args, vars) => arrFn(args, vars)[idx];
            } else {
                const idxFn = compileExpr(expr.index);
                return (args, vars) => arrFn(args, vars)[idxFn(args, vars)];
            }
        }
        case 'call': {
            const fn = interpretedValue(expr.fn);
            const argFns = expr.args.map(compileExpr);
            const len = argFns.length;
            if (len === 0) return () => fn();
            if (len === 1) {
                const a0 = argFns[0];
                return (args, vars) => fn(a0(args, vars));
            }
            if (len === 2) {
                const a0 = argFns[0],
                    a1 = argFns[1];
                return (args, vars) => fn(a0(args, vars), a1(args, vars));
            }
            if (len === 3) {
                const a0 = argFns[0],
                    a1 = argFns[1],
                    a2 = argFns[2];
                return (args, vars) => fn(a0(args, vars), a1(args, vars), a2(args, vars));
            }
            return (args, vars) => fn(...argFns.map(f => f(args, vars)));
        }
        case 'new': {
            const ctor = expr.ctor;
            const argFns = expr.args.map(compileExpr);
            return (args, vars) => new ctor(...argFns.map(f => f(args, vars)));
        }
        case 'obj': {
            const entries = expr.entries.map(
                ([k, v]) => [typeof k === 'string' ? k : compileExpr(k), compileExpr(v)] as const,
            );
            return (args, vars) => {
                const result: any = {};
                for (const [k, vFn] of entries) {
                    if (typeof k === 'string') result[k] = vFn(args, vars);
                    else setComputedKey(result, k(args, vars), vFn(args, vars));
                }
                return result;
            };
        }
        case 'arr': {
            const elemFns = expr.elements.map(compileExpr);
            return (args, vars) => elemFns.map(f => f(args, vars));
        }
        case 'eq': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) === bFn(args, vars);
        }
        case 'neq': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) !== bFn(args, vars);
        }
        case 'lt': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) < bFn(args, vars);
        }
        case 'gt': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) > bFn(args, vars);
        }
        case 'lte': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) <= bFn(args, vars);
        }
        case 'gte': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) >= bFn(args, vars);
        }
        case 'not': {
            const aFn = compileExpr(expr.a);
            return (args, vars) => !aFn(args, vars);
        }
        case 'and': {
            // Flatten AND chain for optimal short-circuit evaluation
            const operands = flattenAnd(expr);
            const fns = operands.map(compileExpr);
            const len = fns.length;
            // Unroll common cases for speed
            if (len === 2) {
                const f0 = fns[0],
                    f1 = fns[1];
                return (args, vars) => f0(args, vars) && f1(args, vars);
            }
            if (len === 3) {
                const f0 = fns[0],
                    f1 = fns[1],
                    f2 = fns[2];
                return (args, vars) => f0(args, vars) && f1(args, vars) && f2(args, vars);
            }
            if (len === 4) {
                const f0 = fns[0],
                    f1 = fns[1],
                    f2 = fns[2],
                    f3 = fns[3];
                return (args, vars) => f0(args, vars) && f1(args, vars) && f2(args, vars) && f3(args, vars);
            }
            if (len === 5) {
                const f0 = fns[0],
                    f1 = fns[1],
                    f2 = fns[2],
                    f3 = fns[3],
                    f4 = fns[4];
                return (args, vars) =>
                    f0(args, vars) && f1(args, vars) && f2(args, vars) && f3(args, vars) && f4(args, vars);
            }
            if (len === 6) {
                const f0 = fns[0],
                    f1 = fns[1],
                    f2 = fns[2],
                    f3 = fns[3],
                    f4 = fns[4],
                    f5 = fns[5];
                return (args, vars) =>
                    f0(args, vars) &&
                    f1(args, vars) &&
                    f2(args, vars) &&
                    f3(args, vars) &&
                    f4(args, vars) &&
                    f5(args, vars);
            }
            if (len === 7) {
                const f0 = fns[0],
                    f1 = fns[1],
                    f2 = fns[2],
                    f3 = fns[3],
                    f4 = fns[4],
                    f5 = fns[5],
                    f6 = fns[6];
                return (args, vars) =>
                    f0(args, vars) &&
                    f1(args, vars) &&
                    f2(args, vars) &&
                    f3(args, vars) &&
                    f4(args, vars) &&
                    f5(args, vars) &&
                    f6(args, vars);
            }
            if (len === 8) {
                const f0 = fns[0],
                    f1 = fns[1],
                    f2 = fns[2],
                    f3 = fns[3],
                    f4 = fns[4],
                    f5 = fns[5],
                    f6 = fns[6],
                    f7 = fns[7];
                return (args, vars) =>
                    f0(args, vars) &&
                    f1(args, vars) &&
                    f2(args, vars) &&
                    f3(args, vars) &&
                    f4(args, vars) &&
                    f5(args, vars) &&
                    f6(args, vars) &&
                    f7(args, vars);
            }
            if (len === 9) {
                const f0 = fns[0],
                    f1 = fns[1],
                    f2 = fns[2],
                    f3 = fns[3],
                    f4 = fns[4],
                    f5 = fns[5],
                    f6 = fns[6],
                    f7 = fns[7],
                    f8 = fns[8];
                return (args, vars) =>
                    f0(args, vars) &&
                    f1(args, vars) &&
                    f2(args, vars) &&
                    f3(args, vars) &&
                    f4(args, vars) &&
                    f5(args, vars) &&
                    f6(args, vars) &&
                    f7(args, vars) &&
                    f8(args, vars);
            }
            if (len === 10) {
                const f0 = fns[0],
                    f1 = fns[1],
                    f2 = fns[2],
                    f3 = fns[3],
                    f4 = fns[4],
                    f5 = fns[5],
                    f6 = fns[6],
                    f7 = fns[7],
                    f8 = fns[8],
                    f9 = fns[9];
                return (args, vars) =>
                    f0(args, vars) &&
                    f1(args, vars) &&
                    f2(args, vars) &&
                    f3(args, vars) &&
                    f4(args, vars) &&
                    f5(args, vars) &&
                    f6(args, vars) &&
                    f7(args, vars) &&
                    f8(args, vars) &&
                    f9(args, vars);
            }
            // General case for >10 operands. `&&` answers with the operand that decided it —
            // the first falsy one, else the last — not with a boolean.
            return (args, vars) => {
                let value: any;
                for (const fn of fns) {
                    value = fn(args, vars);
                    if (!value) return value;
                }
                return value;
            };
        }
        case 'or': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) || bFn(args, vars);
        }
        case 'nullish': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) ?? bFn(args, vars);
        }
        case 'typeof': {
            const valueFn = compileExpr(expr.value);
            return (args, vars) => typeof valueFn(args, vars);
        }
        case 'isType': {
            const valueFn = compileExpr(expr.value);
            const type = expr.type;
            return (args, vars) => typeof valueFn(args, vars) === type;
        }
        case 'isNull': {
            const valueFn = compileExpr(expr.value);
            return (args, vars) => valueFn(args, vars) === null;
        }
        case 'isNullish': {
            const valueFn = compileExpr(expr.value);
            return (args, vars) => valueFn(args, vars) == null;
        }
        case 'has': {
            const objFn = compileExpr(expr.obj);
            if (typeof expr.key === 'string') {
                const key = expr.key;
                return (args, vars) => key in objFn(args, vars);
            } else {
                const keyFn = compileExpr(expr.key);
                return (args, vars) => keyFn(args, vars) in objFn(args, vars);
            }
        }
        case 'len': {
            const valueFn = compileExpr(expr.value);
            return (args, vars) => valueFn(args, vars).length;
        }
        case 'ternary': {
            const condFn = compileExpr(expr.cond);
            const thenFn = compileExpr(expr.then);
            const elseFn = compileExpr(expr.else);
            return (args, vars) => (condFn(args, vars) ? thenFn(args, vars) : elseFn(args, vars));
        }
        case 'instanceof': {
            const valueFn = compileExpr(expr.value);
            const ctor = expr.ctor;
            return (args, vars) => valueFn(args, vars) instanceof ctor;
        }
        case 'concat': {
            const partFns = expr.parts.map(compileExpr);
            return (args, vars) => {
                let result = '';
                for (const fn of partFns) result += fn(args, vars);
                return result;
            };
        }
        case 'add': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) + bFn(args, vars);
        }
        case 'sub': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) - bFn(args, vars);
        }
        case 'mul': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) * bFn(args, vars);
        }
        case 'div': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) / bFn(args, vars);
        }
        case 'mod': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) % bFn(args, vars);
        }
        case 'bitAnd': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) & bFn(args, vars);
        }
        case 'bitOr': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) | bFn(args, vars);
        }
        case 'bitXor': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) ^ bFn(args, vars);
        }
        case 'shl': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) << bFn(args, vars);
        }
        case 'shr': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) >> bFn(args, vars);
        }
        case 'ushr': {
            const aFn = compileExpr(expr.a);
            const bFn = compileExpr(expr.b);
            return (args, vars) => aFn(args, vars) >>> bFn(args, vars);
        }
        case 'method': {
            const objFn = compileExpr(expr.obj);
            const argFns = expr.args.map(compileExpr);
            const method = expr.method;
            return (args, vars) => {
                const obj = objFn(args, vars);
                const methodArgs = argFns.map(fn => fn(args, vars));
                return obj[method](...methodArgs);
            };
        }
        case 'map': {
            const arrFn = compileExpr(expr.arr);
            const elemId = expr.elemId;
            const indexId = expr.indexId;
            const bodyFn = compileBlock(expr.body);
            // The array's own `map`, as compiled code calls it: a hole stays a hole, and a value
            // that has no `map` is a TypeError rather than something to index.
            // The body is a function of its own: its `return` ends here.
            return (args, vars) =>
                arrFn(args, vars).map((elem: any, i: number) => {
                    vars[elemId] = elem;
                    vars[indexId] = i;
                    return bodyFn(args, vars) === RETURN ? takeReturned() : undefined;
                });
        }
        case 'invoke': {
            // A plain call of the value. What a closure answers is not a reference, so there is no
            // `this` to pass, whatever expression the function came from.
            const fnFn = compileExpr(expr.fn);
            const argFns = expr.args.map(compileExpr);
            const len = argFns.length;
            if (len === 0) return (args, vars) => fnFn(args, vars)();
            if (len === 1) {
                const a0 = argFns[0];
                return (args, vars) => fnFn(args, vars)(a0(args, vars));
            }
            if (len === 2) {
                const a0 = argFns[0],
                    a1 = argFns[1];
                return (args, vars) => fnFn(args, vars)(a0(args, vars), a1(args, vars));
            }
            if (len === 3) {
                const a0 = argFns[0],
                    a1 = argFns[1],
                    a2 = argFns[2];
                return (args, vars) => fnFn(args, vars)(a0(args, vars), a1(args, vars), a2(args, vars));
            }
            return (args, vars) => {
                const fn = fnFn(args, vars);
                return fn(...argFns.map(f => f(args, vars)));
            };
        }
        case 'subFn': {
            // SubFn evaluates the body with the arg as input(0)
            // The body was built by its own Builder: its variable ids are its own and would
            // overwrite the enclosing function's if the two shared one array.
            const argFn = compileExpr(expr.arg);
            const bodyFn = compileExpr(expr.body);
            if (!exprNeedsVars(expr.body)) return (args, vars) => bodyFn([argFn(args, vars)], NO_VARS);
            return (args, vars) => bodyFn([argFn(args, vars)], []);
        }
    }
}

// ============================================================================
// Completion: how a statement ended
// ============================================================================

/**
 * A statement, or a block, answers with how it ended:
 *
 *  - `NORMAL`    it ran to its end;
 *  - `RETURN`    the function returns — the value is in {@link returned};
 *  - `BREAK`     the enclosing loop is left;
 *  - `CONTINUE`  the enclosing loop goes to its next turn.
 *
 * Who hands it on and who stops it is the whole protocol:
 *
 *  - a block, an `if` and a `switch` hand the first one that is not `NORMAL` upward;
 *  - a LOOP — every kind of loop — is where `BREAK` and `CONTINUE` stop, and hands `RETURN` upward;
 *  - a FUNCTION — the executor, and the body of a `map` — is where `RETURN` stops.
 *
 * A `break` or `continue` with no loop around it never gets here: the Builder refuses the program.
 */
type Signal = 0 | 1 | 2 | 3;
const NORMAL = 0;
const RETURN = 1;
const BREAK = 2;
const CONTINUE = 3;

type StmtFn = (args: any[], vars: any[]) => Signal;

/**
 * The value of the `RETURN` on its way up. One slot is enough, and no allocation per call: between
 * the statement that writes it and the function boundary that takes it, nothing runs but the
 * closures handing the signal upward — with one exception, a `for…of` that is left early, which
 * closes its iterator and so may run anything ({@link leaveForOf}).
 */
let returned: any;

function takeReturned(): any {
    const value = returned;
    returned = undefined;
    return value;
}

/** Statements whose closure is the same whatever the statement says. */
const breakStmt: StmtFn = () => BREAK;
const continueStmt: StmtFn = () => CONTINUE;
const returnNothing: StmtFn = () => {
    returned = undefined;
    return RETURN;
};

function compileStmt(stmt: Stmt): StmtFn {
    switch (stmt.kind) {
        case 'let': {
            const id = stmt.id;
            const exprFn = compileExpr(stmt.expr);
            return (args, vars) => {
                vars[id] = exprFn(args, vars);
                return NORMAL;
            };
        }
        case 'set': {
            const objFn = compileExpr(stmt.obj);
            const valueFn = compileExpr(stmt.value);
            if (typeof stmt.key === 'string') {
                const key = stmt.key;
                return (args, vars) => {
                    objFn(args, vars)[key] = valueFn(args, vars);
                    return NORMAL;
                };
            } else {
                const keyFn = compileExpr(stmt.key);
                return (args, vars) => {
                    objFn(args, vars)[keyFn(args, vars)] = valueFn(args, vars);
                    return NORMAL;
                };
            }
        }
        case 'push': {
            const arrFn = compileExpr(stmt.arr);
            const valueFn = compileExpr(stmt.value);
            return (args, vars) => {
                arrFn(args, vars).push(valueFn(args, vars));
                return NORMAL;
            };
        }
        case 'setVar': {
            const id = stmt.id;
            const valueFn = compileExpr(stmt.value);
            return (args, vars) => {
                vars[id] = valueFn(args, vars);
                return NORMAL;
            };
        }
        case 'exec': {
            const exprFn = compileExpr(stmt.expr);
            return (args, vars) => {
                exprFn(args, vars);
                return NORMAL;
            };
        }
        case 'return': {
            if (!stmt.value) return returnNothing;
            const valueFn = compileExpr(stmt.value);
            return (args, vars) => {
                returned = valueFn(args, vars);
                return RETURN;
            };
        }
        case 'throw': {
            const errorFn = compileExpr(stmt.error);
            return (args, vars) => {
                throw errorFn(args, vars);
            };
        }
        case 'if': {
            const condFn = compileExpr(stmt.cond);
            const thenFn = compileBlock(stmt.then);
            const elseFn = stmt.else ? compileBlock(stmt.else) : undefined;
            if (!elseFn) return (args, vars) => (condFn(args, vars) ? thenFn(args, vars) : NORMAL);
            return (args, vars) => (condFn(args, vars) ? thenFn(args, vars) : elseFn(args, vars));
        }
        case 'loop': {
            const arrFn = stmt.arr ? compileExpr(stmt.arr) : undefined;
            const startFn = stmt.start ? compileExpr(stmt.start) : undefined;
            const endFn = stmt.end ? compileExpr(stmt.end) : undefined;
            const elemId = stmt.elemId;
            const indexId = stmt.indexId;
            const bodyFn = compileBlock(stmt.body);
            const readsElem = !!arrFn && !stmt.skipElem;
            return (args, vars) => {
                const arr = arrFn ? arrFn(args, vars) : undefined;
                const start = startFn ? startFn(args, vars) : 0;
                const end = endFn ? endFn(args, vars) : arr.length;
                for (let i = start; i < end; i++) {
                    vars[indexId] = i;
                    if (readsElem) {
                        vars[elemId] = arr[i];
                    }
                    const signal = bodyFn(args, vars);
                    if (signal === RETURN) return RETURN;
                    if (signal === BREAK) break;
                }
                return NORMAL;
            };
        }
        case 'forIn': {
            const objFn = compileExpr(stmt.obj);
            const keyId = stmt.keyId;
            const bodyFn = compileBlock(stmt.body);
            return (args, vars) => {
                const obj = objFn(args, vars);
                for (const key in obj) {
                    vars[keyId] = key;
                    const signal = bodyFn(args, vars);
                    if (signal === RETURN) return RETURN;
                    if (signal === BREAK) break;
                }
                return NORMAL;
            };
        }
        case 'forOf': {
            const iterableFn = compileExpr(stmt.iterable);
            const valueId = stmt.valueId;
            const keyId = stmt.keyId;
            const bodyFn = compileBlock(stmt.body);
            // For Map entries with keyId, destructure [key, value]
            if (keyId !== undefined) {
                return (args, vars) => {
                    let signal: Signal = NORMAL;
                    let held: any;
                    for (const [key, value] of iterableFn(args, vars)) {
                        vars[keyId] = key;
                        vars[valueId] = value;
                        signal = bodyFn(args, vars);
                        if (signal === RETURN) {
                            held = returned;
                            break;
                        }
                        if (signal === BREAK) break;
                    }
                    return leaveForOf(signal, held);
                };
            }
            // For Set or simple iteration
            return (args, vars) => {
                let signal: Signal = NORMAL;
                let held: any;
                for (const item of iterableFn(args, vars)) {
                    vars[valueId] = item;
                    signal = bodyFn(args, vars);
                    if (signal === RETURN) {
                        held = returned;
                        break;
                    }
                    if (signal === BREAK) break;
                }
                return leaveForOf(signal, held);
            };
        }
        case 'switch': {
            const valueFn = compileExpr(stmt.value);
            const cases = stmt.cases.map(([lit, block]) => [lit, compileBlock(block)] as const);
            const defaultFn = stmt.default ? compileBlock(stmt.default) : undefined;
            return (args, vars) => {
                const value = valueFn(args, vars);
                for (const [lit, blockFn] of cases) {
                    if (value === lit) {
                        // A break or continue in a case belongs to the enclosing loop: handed up.
                        return blockFn(args, vars);
                    }
                }
                return defaultFn ? defaultFn(args, vars) : NORMAL;
            };
        }
        case 'while': {
            const condFn = compileExpr(stmt.cond);
            const bodyFn = compileBlock(stmt.body);
            return (args, vars) => {
                while (condFn(args, vars)) {
                    const signal = bodyFn(args, vars);
                    if (signal === RETURN) return RETURN;
                    if (signal === BREAK) break;
                }
                return NORMAL;
            };
        }
        case 'break':
            return breakStmt;
        case 'continue':
            return continueStmt;
        case 'try': {
            const bodyFn = compileBlock(stmt.body);
            const catchFn = stmt.catch ? compileBlock(stmt.catch) : undefined;
            const finallyFn = stmt.finally ? compileBlock(stmt.finally) : undefined;
            const errorId = stmt.errorId!;
            if (!finallyFn) {
                return (args, vars) => {
                    try {
                        return bodyFn(args, vars);
                    } catch (error) {
                        vars[errorId] = error;
                        return catchFn!(args, vars);
                    }
                };
            }
            return (args, vars) => {
                let signal: Signal;
                let held: any;
                try {
                    if (catchFn) {
                        try {
                            signal = bodyFn(args, vars);
                        } catch (error) {
                            vars[errorId] = error;
                            signal = catchFn(args, vars);
                        }
                    } else {
                        signal = bodyFn(args, vars);
                    }
                    // The value of a RETURN waits here while the `finally` runs: that block may
                    // call anything, an interpreted function with a return of its own included.
                    held = returned;
                } catch (error) {
                    // A `finally` that ends abruptly replaces the error; one that does not lets it on.
                    const after = finallyFn(args, vars);
                    if (after !== NORMAL) return after;
                    throw error;
                }
                const after = finallyFn(args, vars);
                if (after !== NORMAL) return after;
                returned = held;
                return signal;
            };
        }
        case 'await':
            // What `new Function` says of the same tree: only an async function's own statements
            // wait, and those are compiled by compileAsyncStmt().
            throw new SyntaxError('await is only valid in the statements of an async function');
    }
}

/**
 * How a `for…of` ends once its loop statement is behind it. Leaving the loop early CLOSES the
 * iterator — its `return()` runs, and that is somebody's code: a generator's `finally`, which may
 * call an interpreted function and leave its own value in {@link returned}. The value of this
 * function's `RETURN` was taken aside before the loop was left and is put back here.
 */
function leaveForOf(signal: Signal, held: any): Signal {
    if (signal !== RETURN) return NORMAL;
    returned = held;
    return RETURN;
}

function compileBlock(block: Block): StmtFn {
    const stmtFns = block.stmts.map(compileStmt);
    const returnFn = block.returnExpr ? compileExpr(block.returnExpr) : undefined;
    const count = stmtFns.length;

    // The expression a block ends with is what the function returns.
    if (count === 0) {
        if (!returnFn) return () => NORMAL;
        return (args, vars) => {
            returned = returnFn(args, vars);
            return RETURN;
        };
    }
    if (count === 1 && !returnFn) return stmtFns[0];

    return (args, vars) => {
        for (let i = 0; i < count; i++) {
            const signal = stmtFns[i](args, vars);
            if (signal !== NORMAL) return signal;
        }
        if (returnFn) {
            returned = returnFn(args, vars);
            return RETURN;
        }
        return NORMAL;
    };
}

// ============================================================================
// Async functions
// ============================================================================
//
// An async function is interpreted by the same closures wherever it does not wait: an expression
// never waits (`await` is a statement), and a statement none of whose blocks holds an `await` is
// the synchronous closure above. Only the statements ON THE WAY to an `await` — the `await`
// itself, and the `if`, the `switch`, the loops and the `try` around it — have an async closure
// here, each the async twin of its case in compileStmt().
//
// The modes agree on what an async function does and in which order; they do not agree on how
// many microtask turns it takes, and nothing should depend on that.

/**
 * A `RETURN` on its way up through an async function, with its value. The one slot the
 * synchronous closures share ({@link returned}) cannot hold it across an `await`: anything may
 * run in between, another interpreted function with a return of its own included.
 */
class Returned {
    constructor(readonly value: unknown) {}
}

/** How an async statement ended: `NORMAL`, `BREAK`, `CONTINUE`, or a {@link Returned}. */
type Completion = Signal | Returned;

type AsyncStmtFn = (args: any[], vars: any[]) => Completion | Promise<Completion>;

/** Whether running a statement can wait: it is an `await`, or one of its blocks holds one. */
function stmtAwaits(stmt: Stmt): boolean {
    if (stmt.kind === 'await') return true;
    const shape = shapeOfStmt(stmt);
    return shape.blocks !== undefined && shape.blocks(stmt, blockAwaits);
}

function blockAwaits(block: Block): boolean {
    return block.stmts.some(stmtAwaits);
}

/** A block of an async function: the async closure when it can wait, the synchronous one when not. */
function compileBlockOfAsync(block: Block): AsyncStmtFn {
    if (blockAwaits(block)) return compileAsyncBlock(block);
    const blockFn = compileBlock(block);
    return (args, vars) => {
        const signal = blockFn(args, vars);
        return signal === RETURN ? new Returned(takeReturned()) : signal;
    };
}

function compileAsyncBlock(block: Block): AsyncStmtFn {
    const count = block.stmts.length;
    const asyncFns: (AsyncStmtFn | undefined)[] = [];
    const syncFns: (StmtFn | undefined)[] = [];
    for (const stmt of block.stmts) {
        const waits = stmtAwaits(stmt);
        asyncFns.push(waits ? compileAsyncStmt(stmt) : undefined);
        syncFns.push(waits ? undefined : compileStmt(stmt));
    }
    const returnFn = block.returnExpr ? compileExpr(block.returnExpr) : undefined;

    return async (args, vars) => {
        for (let i = 0; i < count; i++) {
            const asyncFn = asyncFns[i];
            if (asyncFn) {
                let completion = asyncFn(args, vars);
                if (completion instanceof Promise) completion = await completion;
                if (completion !== NORMAL) return completion;
            } else {
                const signal = syncFns[i]!(args, vars);
                if (signal !== NORMAL) return signal === RETURN ? new Returned(takeReturned()) : signal;
            }
        }
        if (returnFn) return new Returned(returnFn(args, vars));
        return NORMAL;
    };
}

/** A statement that can wait ({@link stmtAwaits}). The cases are the ones that hold a block, and `await`. */
function compileAsyncStmt(stmt: Stmt): AsyncStmtFn {
    switch (stmt.kind) {
        case 'await': {
            const id = stmt.id;
            const exprFn = compileExpr(stmt.expr);
            return async (args, vars): Promise<Completion> => {
                vars[id] = await exprFn(args, vars);
                return NORMAL;
            };
        }
        case 'if': {
            const condFn = compileExpr(stmt.cond);
            const thenFn = compileBlockOfAsync(stmt.then);
            const elseFn = stmt.else ? compileBlockOfAsync(stmt.else) : undefined;
            if (!elseFn) return (args, vars) => (condFn(args, vars) ? thenFn(args, vars) : NORMAL);
            return (args, vars) => (condFn(args, vars) ? thenFn(args, vars) : elseFn(args, vars));
        }
        case 'switch': {
            const valueFn = compileExpr(stmt.value);
            const cases = stmt.cases.map(([lit, block]) => [lit, compileBlockOfAsync(block)] as const);
            const defaultFn = stmt.default ? compileBlockOfAsync(stmt.default) : undefined;
            return (args, vars) => {
                const value = valueFn(args, vars);
                for (const [lit, blockFn] of cases) {
                    if (value === lit) return blockFn(args, vars);
                }
                return defaultFn ? defaultFn(args, vars) : NORMAL;
            };
        }
        case 'loop': {
            const arrFn = stmt.arr ? compileExpr(stmt.arr) : undefined;
            const startFn = stmt.start ? compileExpr(stmt.start) : undefined;
            const endFn = stmt.end ? compileExpr(stmt.end) : undefined;
            const elemId = stmt.elemId;
            const indexId = stmt.indexId;
            const bodyFn = compileBlockOfAsync(stmt.body);
            const readsElem = !!arrFn && !stmt.skipElem;
            return async (args, vars) => {
                const arr = arrFn ? arrFn(args, vars) : undefined;
                const start = startFn ? startFn(args, vars) : 0;
                const end = endFn ? endFn(args, vars) : arr.length;
                for (let i = start; i < end; i++) {
                    vars[indexId] = i;
                    if (readsElem) {
                        vars[elemId] = arr[i];
                    }
                    const completion = await bodyFn(args, vars);
                    if (completion instanceof Returned) return completion;
                    if (completion === BREAK) break;
                }
                return NORMAL;
            };
        }
        case 'forIn': {
            const objFn = compileExpr(stmt.obj);
            const keyId = stmt.keyId;
            const bodyFn = compileBlockOfAsync(stmt.body);
            return async (args, vars) => {
                const obj = objFn(args, vars);
                for (const key in obj) {
                    vars[keyId] = key;
                    const completion = await bodyFn(args, vars);
                    if (completion instanceof Returned) return completion;
                    if (completion === BREAK) break;
                }
                return NORMAL;
            };
        }
        case 'forOf': {
            const iterableFn = compileExpr(stmt.iterable);
            const valueId = stmt.valueId;
            const keyId = stmt.keyId;
            const bodyFn = compileBlockOfAsync(stmt.body);
            // Leaving the loop early closes the iterator, and that may run anything — but a
            // Returned carries its own value, so there is nothing to take aside here.
            if (keyId !== undefined) {
                return async (args, vars) => {
                    for (const [key, value] of iterableFn(args, vars)) {
                        vars[keyId] = key;
                        vars[valueId] = value;
                        const completion = await bodyFn(args, vars);
                        if (completion instanceof Returned) return completion;
                        if (completion === BREAK) break;
                    }
                    return NORMAL;
                };
            }
            return async (args, vars) => {
                for (const item of iterableFn(args, vars)) {
                    vars[valueId] = item;
                    const completion = await bodyFn(args, vars);
                    if (completion instanceof Returned) return completion;
                    if (completion === BREAK) break;
                }
                return NORMAL;
            };
        }
        case 'while': {
            const condFn = compileExpr(stmt.cond);
            const bodyFn = compileBlockOfAsync(stmt.body);
            return async (args, vars) => {
                while (condFn(args, vars)) {
                    const completion = await bodyFn(args, vars);
                    if (completion instanceof Returned) return completion;
                    if (completion === BREAK) break;
                }
                return NORMAL;
            };
        }
        case 'try': {
            const bodyFn = compileBlockOfAsync(stmt.body);
            const catchFn = stmt.catch ? compileBlockOfAsync(stmt.catch) : undefined;
            const finallyFn = stmt.finally ? compileBlockOfAsync(stmt.finally) : undefined;
            const errorId = stmt.errorId!;
            return async (args, vars) => {
                let completion: Completion;
                try {
                    try {
                        completion = await bodyFn(args, vars);
                    } catch (error) {
                        if (!catchFn) throw error;
                        vars[errorId] = error;
                        completion = await catchFn(args, vars);
                    }
                } catch (error) {
                    if (!finallyFn) throw error;
                    // A `finally` that ends abruptly replaces the error; one that does not lets it on.
                    const after = await finallyFn(args, vars);
                    if (after !== NORMAL) return after;
                    throw error;
                }
                if (finallyFn) {
                    const after = await finallyFn(args, vars);
                    if (after !== NORMAL) return after;
                }
                return completion;
            };
        }
        // No block to hold an `await`: stmtAwaits() answers false, and compileStmt() has the case.
        case 'let':
        case 'set':
        case 'push':
        case 'setVar':
        case 'exec':
        case 'return':
        case 'throw':
        case 'break':
        case 'continue':
            return compileBlockOfAsync({ stmts: [stmt] });
    }
}

/**
 * An async function: it answers a promise whatever happens — an error thrown before the first
 * `await` is a rejection, not a throw — and what it returns is what the promise resolves to.
 */
function createAsyncExecutor<T>(block: Block, defaults?: readonly unknown[]): (...args: any[]) => T {
    const blockFn = compileBlockOfAsync(block);
    const run = async (...args: any[]): Promise<unknown> => {
        let completion = blockFn(defaults ? withDefaults(args, defaults) : args, []);
        if (completion instanceof Promise) completion = await completion;
        return completion instanceof Returned ? completion.value : undefined;
    };
    return run as (...args: any[]) => T;
}

// ============================================================================
// The executor: a block as a function
// ============================================================================

/** Whether a block binds no variable: no statements, and an expression that reads none. */
function isPureBlock(block: Block): boolean {
    if (block.stmts.length > 0) return false;
    if (!block.returnExpr) return true;
    return !exprNeedsVars(block.returnExpr);
}

/**
 * A block as a function: closures built once, here, and called per call.
 *
 * A block that binds no variable (the common case for type guards) is its one expression, called
 * without a variable array of its own.
 */
function createClosureExecutor<T>(
    block: Block,
    inputDefaults?: readonly unknown[],
    isAsync = false,
): (...args: any[]) => T {
    // An argument that is left out, or passed as undefined, takes its default — as the parameter
    // list of the compiled function says it does.
    const defaults = inputDefaults && inputDefaults.some(value => value !== undefined) ? inputDefaults : undefined;

    if (isAsync) return createAsyncExecutor<T>(block, defaults);

    if (isPureBlock(block)) {
        if (!block.returnExpr) {
            return () => undefined as T;
        }
        const exprFn = compileExpr(block.returnExpr);
        if (defaults) return (...args: any[]): T => exprFn(withDefaults(args, defaults), NO_VARS) as T;
        return (...args: any[]): T => exprFn(args, NO_VARS) as T;
    }

    // A function is where RETURN stops; a block that ends without one answers undefined.
    const blockFn = compileBlock(block);
    if (defaults) {
        return (...args: any[]): T =>
            blockFn(withDefaults(args, defaults), []) === RETURN ? takeReturned() : (undefined as T);
    }
    return (...args: any[]): T => (blockFn(args, []) === RETURN ? takeReturned() : (undefined as T));
}

function withDefaults(args: any[], defaults: readonly unknown[]): any[] {
    for (let i = 0; i < defaults.length; i++) {
        if (args[i] === undefined && defaults[i] !== undefined) args[i] = defaults[i];
    }
    return args;
}

/**
 * Create an optimized executor for a block.
 * Uses closure-based compilation for best performance.
 * Returns a function that accepts rest parameters and executes the block.
 */
export function createExecutor<T>(
    block: Block,
    inputDefaults?: readonly unknown[],
    isAsync = false,
): (...args: any[]) => T {
    return createClosureExecutor<T>(block, inputDefaults, isAsync);
}
