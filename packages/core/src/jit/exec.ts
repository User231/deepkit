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
import { Block, Expr, Stmt, shapeOfExpr } from './nodes.js';

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

/**
 * Compile an expression to a closure function.
 * The closure captures the structure and returns a function that evaluates it.
 *
 * Optimizations:
 * 1. Pure expressions (no vars) use simplified single-arg signature
 * 2. AND chains are flattened into arrays for fast short-circuit evaluation
 * 3. Common patterns like isType(get(x, key), type) are specialized
 */
type EvalFn = (args: any[], vars: any[]) => any;
type PureEvalFn = (args: any[]) => any;

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
 * Compile a pure expression (no vars) to a single-arg closure.
 */
function compilePureExpr(expr: Expr): PureEvalFn {
    switch (expr.kind) {
        case 'lit': {
            const value = interpretedValue(expr.value);
            return () => value;
        }
        case 'input': {
            const index = expr.index;
            return args => args[index];
        }
        case 'get': {
            // A read from null or undefined throws, as the compiled `obj.key` does.
            const objFn = compilePureExpr(expr.obj);
            if (typeof expr.key === 'string') {
                const key = expr.key;
                return args => objFn(args)[key];
            } else {
                const keyFn = compilePureExpr(expr.key);
                return args => objFn(args)[keyFn(args)];
            }
        }
        case 'at': {
            const arrFn = compilePureExpr(expr.arr);
            if (typeof expr.index === 'number') {
                const idx = expr.index;
                return args => arrFn(args)[idx];
            } else {
                const idxFn = compilePureExpr(expr.index);
                return args => arrFn(args)[idxFn(args)];
            }
        }
        case 'call': {
            const fn = interpretedValue(expr.fn);
            const argFns = expr.args.map(compilePureExpr);
            const len = argFns.length;
            if (len === 0) return () => fn();
            if (len === 1) {
                const a0 = argFns[0];
                return args => fn(a0(args));
            }
            if (len === 2) {
                const a0 = argFns[0],
                    a1 = argFns[1];
                return args => fn(a0(args), a1(args));
            }
            if (len === 3) {
                const a0 = argFns[0],
                    a1 = argFns[1],
                    a2 = argFns[2];
                return args => fn(a0(args), a1(args), a2(args));
            }
            return args => fn(...argFns.map(f => f(args)));
        }
        case 'new': {
            const ctor = expr.ctor;
            const argFns = expr.args.map(compilePureExpr);
            return args => new ctor(...argFns.map(f => f(args)));
        }
        case 'obj': {
            const entries = expr.entries.map(
                ([k, v]) => [typeof k === 'string' ? k : compilePureExpr(k), compilePureExpr(v)] as const,
            );
            return args => {
                const result: any = {};
                for (const [k, vFn] of entries) {
                    if (typeof k === 'string') result[k] = vFn(args);
                    else setComputedKey(result, k(args), vFn(args));
                }
                return result;
            };
        }
        case 'arr': {
            const elemFns = expr.elements.map(compilePureExpr);
            return args => elemFns.map(f => f(args));
        }
        case 'eq': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) === bFn(args);
        }
        case 'neq': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) !== bFn(args);
        }
        case 'lt': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) < bFn(args);
        }
        case 'gt': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) > bFn(args);
        }
        case 'lte': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) <= bFn(args);
        }
        case 'gte': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) >= bFn(args);
        }
        case 'not': {
            const aFn = compilePureExpr(expr.a);
            return args => !aFn(args);
        }
        case 'and': {
            // Flatten AND chain for optimal short-circuit evaluation
            const operands = flattenAnd(expr);
            const fns = operands.map(compilePureExpr);
            const len = fns.length;
            // Unroll common cases for speed
            if (len === 2) {
                const f0 = fns[0],
                    f1 = fns[1];
                return args => f0(args) && f1(args);
            }
            if (len === 3) {
                const f0 = fns[0],
                    f1 = fns[1],
                    f2 = fns[2];
                return args => f0(args) && f1(args) && f2(args);
            }
            if (len === 4) {
                const f0 = fns[0],
                    f1 = fns[1],
                    f2 = fns[2],
                    f3 = fns[3];
                return args => f0(args) && f1(args) && f2(args) && f3(args);
            }
            if (len === 5) {
                const f0 = fns[0],
                    f1 = fns[1],
                    f2 = fns[2],
                    f3 = fns[3],
                    f4 = fns[4];
                return args => f0(args) && f1(args) && f2(args) && f3(args) && f4(args);
            }
            if (len === 6) {
                const f0 = fns[0],
                    f1 = fns[1],
                    f2 = fns[2],
                    f3 = fns[3],
                    f4 = fns[4],
                    f5 = fns[5];
                return args => f0(args) && f1(args) && f2(args) && f3(args) && f4(args) && f5(args);
            }
            if (len === 7) {
                const f0 = fns[0],
                    f1 = fns[1],
                    f2 = fns[2],
                    f3 = fns[3],
                    f4 = fns[4],
                    f5 = fns[5],
                    f6 = fns[6];
                return args => f0(args) && f1(args) && f2(args) && f3(args) && f4(args) && f5(args) && f6(args);
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
                return args =>
                    f0(args) && f1(args) && f2(args) && f3(args) && f4(args) && f5(args) && f6(args) && f7(args);
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
                return args =>
                    f0(args) &&
                    f1(args) &&
                    f2(args) &&
                    f3(args) &&
                    f4(args) &&
                    f5(args) &&
                    f6(args) &&
                    f7(args) &&
                    f8(args);
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
                return args =>
                    f0(args) &&
                    f1(args) &&
                    f2(args) &&
                    f3(args) &&
                    f4(args) &&
                    f5(args) &&
                    f6(args) &&
                    f7(args) &&
                    f8(args) &&
                    f9(args);
            }
            // General case for >10 operands. `&&` answers with the operand that decided it —
            // the first falsy one, else the last — not with a boolean.
            return args => {
                let value: any;
                for (const fn of fns) {
                    value = fn(args);
                    if (!value) return value;
                }
                return value;
            };
        }
        case 'or': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) || bFn(args);
        }
        case 'nullish': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) ?? bFn(args);
        }
        case 'typeof': {
            const valueFn = compilePureExpr(expr.value);
            return args => typeof valueFn(args);
        }
        case 'isType': {
            const valueFn = compilePureExpr(expr.value);
            const type = expr.type;
            return args => typeof valueFn(args) === type;
        }
        case 'isNull': {
            const valueFn = compilePureExpr(expr.value);
            return args => valueFn(args) === null;
        }
        case 'isNullish': {
            const valueFn = compilePureExpr(expr.value);
            return args => valueFn(args) == null;
        }
        case 'has': {
            const objFn = compilePureExpr(expr.obj);
            if (typeof expr.key === 'string') {
                const key = expr.key;
                return args => key in objFn(args);
            } else {
                const keyFn = compilePureExpr(expr.key);
                return args => keyFn(args) in objFn(args);
            }
        }
        case 'len': {
            const valueFn = compilePureExpr(expr.value);
            return args => valueFn(args).length;
        }
        case 'ternary': {
            const condFn = compilePureExpr(expr.cond);
            const thenFn = compilePureExpr(expr.then);
            const elseFn = compilePureExpr(expr.else);
            return args => (condFn(args) ? thenFn(args) : elseFn(args));
        }
        case 'instanceof': {
            const valueFn = compilePureExpr(expr.value);
            const ctor = expr.ctor;
            return args => valueFn(args) instanceof ctor;
        }
        case 'concat': {
            const partFns = expr.parts.map(compilePureExpr);
            return args => {
                let result = '';
                for (const fn of partFns) result += fn(args);
                return result;
            };
        }
        case 'add': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) + bFn(args);
        }
        case 'sub': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) - bFn(args);
        }
        case 'mul': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) * bFn(args);
        }
        case 'div': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) / bFn(args);
        }
        case 'mod': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) % bFn(args);
        }
        case 'bitAnd': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) & bFn(args);
        }
        case 'bitOr': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) | bFn(args);
        }
        case 'bitXor': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) ^ bFn(args);
        }
        case 'shl': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) << bFn(args);
        }
        case 'shr': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) >> bFn(args);
        }
        case 'ushr': {
            const aFn = compilePureExpr(expr.a);
            const bFn = compilePureExpr(expr.b);
            return args => aFn(args) >>> bFn(args);
        }
        case 'method': {
            const objFn = compilePureExpr(expr.obj);
            const argFns = expr.args.map(compilePureExpr);
            const method = expr.method;
            return args => {
                const obj = objFn(args);
                const methodArgs = argFns.map(fn => fn(args));
                return obj[method](...methodArgs);
            };
        }
        case 'subFn': {
            // SubFn evaluates the body with the arg as input(0)
            const argFn = compilePureExpr(expr.arg);
            const bodyFn = compilePureExpr(expr.body);
            return args => {
                const argValue = argFn(args);
                return bodyFn([argValue]);
            };
        }
        case 'var':
        case 'map':
            throw new Error(`Expression ${expr.kind} requires vars but compiled as pure`);
    }
}

function compileExprToClosure(expr: Expr): EvalFn {
    // For pure expressions, use optimized single-arg version
    if (!exprNeedsVars(expr)) {
        const pureFn = compilePureExpr(expr);
        return (args, _vars) => pureFn(args);
    }

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
            return (args, vars) => vars[id];
        }
        case 'get': {
            const objFn = compileExprToClosure(expr.obj);
            if (typeof expr.key === 'string') {
                const key = expr.key;
                return (args, vars) => objFn(args, vars)[key];
            } else {
                const keyFn = compileExprToClosure(expr.key);
                return (args, vars) => objFn(args, vars)[keyFn(args, vars)];
            }
        }
        case 'at': {
            const arrFn = compileExprToClosure(expr.arr);
            if (typeof expr.index === 'number') {
                const idx = expr.index;
                return (args, vars) => arrFn(args, vars)[idx];
            } else {
                const idxFn = compileExprToClosure(expr.index);
                return (args, vars) => arrFn(args, vars)[idxFn(args, vars)];
            }
        }
        case 'call': {
            const fn = interpretedValue(expr.fn);
            const argFns = expr.args.map(compileExprToClosure);
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
            const argFns = expr.args.map(compileExprToClosure);
            return (args, vars) => new ctor(...argFns.map(f => f(args, vars)));
        }
        case 'obj': {
            const entries = expr.entries.map(
                ([k, v]) => [typeof k === 'string' ? k : compileExprToClosure(k), compileExprToClosure(v)] as const,
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
            const elemFns = expr.elements.map(compileExprToClosure);
            return (args, vars) => elemFns.map(f => f(args, vars));
        }
        case 'eq': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) === bFn(args, vars);
        }
        case 'neq': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) !== bFn(args, vars);
        }
        case 'lt': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) < bFn(args, vars);
        }
        case 'gt': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) > bFn(args, vars);
        }
        case 'lte': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) <= bFn(args, vars);
        }
        case 'gte': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) >= bFn(args, vars);
        }
        case 'not': {
            const aFn = compileExprToClosure(expr.a);
            return (args, vars) => !aFn(args, vars);
        }
        case 'and': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) && bFn(args, vars);
        }
        case 'or': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) || bFn(args, vars);
        }
        case 'nullish': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) ?? bFn(args, vars);
        }
        case 'typeof': {
            const valueFn = compileExprToClosure(expr.value);
            return (args, vars) => typeof valueFn(args, vars);
        }
        case 'isType': {
            const valueFn = compileExprToClosure(expr.value);
            const type = expr.type;
            return (args, vars) => typeof valueFn(args, vars) === type;
        }
        case 'isNull': {
            const valueFn = compileExprToClosure(expr.value);
            return (args, vars) => valueFn(args, vars) === null;
        }
        case 'isNullish': {
            const valueFn = compileExprToClosure(expr.value);
            return (args, vars) => valueFn(args, vars) == null;
        }
        case 'has': {
            const objFn = compileExprToClosure(expr.obj);
            if (typeof expr.key === 'string') {
                const key = expr.key;
                return (args, vars) => key in objFn(args, vars);
            } else {
                const keyFn = compileExprToClosure(expr.key);
                return (args, vars) => keyFn(args, vars) in objFn(args, vars);
            }
        }
        case 'len': {
            const valueFn = compileExprToClosure(expr.value);
            return (args, vars) => valueFn(args, vars).length;
        }
        case 'ternary': {
            const condFn = compileExprToClosure(expr.cond);
            const thenFn = compileExprToClosure(expr.then);
            const elseFn = compileExprToClosure(expr.else);
            return (args, vars) => (condFn(args, vars) ? thenFn(args, vars) : elseFn(args, vars));
        }
        case 'instanceof': {
            const valueFn = compileExprToClosure(expr.value);
            const ctor = expr.ctor;
            return (args, vars) => valueFn(args, vars) instanceof ctor;
        }
        case 'concat': {
            const partFns = expr.parts.map(compileExprToClosure);
            return (args, vars) => {
                let result = '';
                for (const fn of partFns) result += fn(args, vars);
                return result;
            };
        }
        case 'add': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) + bFn(args, vars);
        }
        case 'sub': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) - bFn(args, vars);
        }
        case 'mul': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) * bFn(args, vars);
        }
        case 'div': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) / bFn(args, vars);
        }
        case 'mod': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) % bFn(args, vars);
        }
        case 'bitAnd': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) & bFn(args, vars);
        }
        case 'bitOr': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) | bFn(args, vars);
        }
        case 'bitXor': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) ^ bFn(args, vars);
        }
        case 'shl': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) << bFn(args, vars);
        }
        case 'shr': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) >> bFn(args, vars);
        }
        case 'ushr': {
            const aFn = compileExprToClosure(expr.a);
            const bFn = compileExprToClosure(expr.b);
            return (args, vars) => aFn(args, vars) >>> bFn(args, vars);
        }
        case 'method': {
            const objFn = compileExprToClosure(expr.obj);
            const argFns = expr.args.map(compileExprToClosure);
            const method = expr.method;
            return (args, vars) => {
                const obj = objFn(args, vars);
                const methodArgs = argFns.map(fn => fn(args, vars));
                return obj[method](...methodArgs);
            };
        }
        case 'map': {
            const arrFn = compileExprToClosure(expr.arr);
            const elemId = expr.elemId;
            const indexId = expr.indexId;
            const bodyFn = compileBlockToClosure(expr.body);
            // The array's own `map`, as compiled code calls it: a hole stays a hole, and a value
            // that has no `map` is a TypeError rather than something to index.
            return (args, vars) =>
                arrFn(args, vars).map((elem: any, i: number) => {
                    vars[elemId] = elem;
                    vars[indexId] = i;
                    // bodyFn returns { earlyReturn, value } - extract value
                    return bodyFn(args, vars)?.value;
                });
        }
        case 'subFn': {
            // SubFn evaluates the body with the arg as input(0)
            // The body was built by its own Builder: its variable ids are its own and would
            // overwrite the enclosing function's if the two shared one array.
            const argFn = compileExprToClosure(expr.arg);
            const bodyFn = compileExprToClosure(expr.body);
            return (args, vars) => {
                const argValue = argFn(args, vars);
                return bodyFn([argValue], []);
            };
        }
    }
}

/**
 * How a statement ended, when it did not simply run to its end: the function returns, or the
 * enclosing loop is left or goes to its next turn. A block, an `if` and a `switch` hand the first
 * one they meet upward; a LOOP — every kind of loop — is where `earlyBreak` and `earlyContinue` stop.
 */
type Completion = { earlyReturn?: boolean; earlyBreak?: boolean; earlyContinue?: boolean; value?: any };

const BREAK: Completion = Object.freeze({ earlyBreak: true });
const CONTINUE: Completion = Object.freeze({ earlyContinue: true });

type StmtFn = (args: any[], vars: any[]) => Completion | void;

function compileStmtToClosure(stmt: Stmt): StmtFn {
    switch (stmt.kind) {
        case 'let': {
            const id = stmt.id;
            const exprFn = compileExprToClosure(stmt.expr);
            return (args, vars) => {
                vars[id] = exprFn(args, vars);
            };
        }
        case 'set': {
            const objFn = compileExprToClosure(stmt.obj);
            const valueFn = compileExprToClosure(stmt.value);
            if (typeof stmt.key === 'string') {
                const key = stmt.key;
                return (args, vars) => {
                    objFn(args, vars)[key] = valueFn(args, vars);
                };
            } else {
                const keyFn = compileExprToClosure(stmt.key);
                return (args, vars) => {
                    objFn(args, vars)[keyFn(args, vars)] = valueFn(args, vars);
                };
            }
        }
        case 'push': {
            const arrFn = compileExprToClosure(stmt.arr);
            const valueFn = compileExprToClosure(stmt.value);
            return (args, vars) => {
                arrFn(args, vars).push(valueFn(args, vars));
            };
        }
        case 'setVar': {
            const id = stmt.id;
            const valueFn = compileExprToClosure(stmt.value);
            return (args, vars) => {
                vars[id] = valueFn(args, vars);
            };
        }
        case 'exec': {
            const exprFn = compileExprToClosure(stmt.expr);
            return (args, vars) => {
                exprFn(args, vars);
            };
        }
        case 'return': {
            if (stmt.value) {
                const valueFn = compileExprToClosure(stmt.value);
                return (args, vars) => ({ earlyReturn: true, value: valueFn(args, vars) });
            }
            return () => ({ earlyReturn: true, value: undefined });
        }
        case 'throw': {
            const errorFn = compileExprToClosure(stmt.error);
            return (args, vars) => {
                throw errorFn(args, vars);
            };
        }
        case 'if': {
            const condFn = compileExprToClosure(stmt.cond);
            const thenFn = compileBlockToClosure(stmt.then);
            const elseFn = stmt.else ? compileBlockToClosure(stmt.else) : undefined;
            return (args, vars) => {
                if (condFn(args, vars)) {
                    const r = thenFn(args, vars);
                    if (r) return r;
                } else if (elseFn) {
                    const r = elseFn(args, vars);
                    if (r) return r;
                }
            };
        }
        case 'loop': {
            const arrFn = stmt.arr ? compileExprToClosure(stmt.arr) : undefined;
            const startFn = stmt.start ? compileExprToClosure(stmt.start) : undefined;
            const endFn = stmt.end ? compileExprToClosure(stmt.end) : undefined;
            const elemId = stmt.elemId;
            const indexId = stmt.indexId;
            const bodyFn = compileBlockToClosure(stmt.body);
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
                    const r = bodyFn(args, vars);
                    if (r) {
                        if (r.earlyReturn) return r;
                        if (r.earlyBreak) break;
                    }
                }
            };
        }
        case 'forIn': {
            const objFn = compileExprToClosure(stmt.obj);
            const keyId = stmt.keyId;
            const bodyFn = compileBlockToClosure(stmt.body);
            return (args, vars) => {
                const obj = objFn(args, vars);
                for (const key in obj) {
                    vars[keyId] = key;
                    const r = bodyFn(args, vars);
                    if (r) {
                        if (r.earlyReturn) return r;
                        if (r.earlyBreak) break;
                    }
                }
            };
        }
        case 'forOf': {
            const iterableFn = compileExprToClosure(stmt.iterable);
            const valueId = stmt.valueId;
            const keyId = stmt.keyId;
            const bodyFn = compileBlockToClosure(stmt.body);
            // For Map entries with keyId, destructure [key, value]
            if (keyId !== undefined) {
                return (args, vars) => {
                    const iterable = iterableFn(args, vars);
                    for (const [key, value] of iterable) {
                        vars[keyId] = key;
                        vars[valueId] = value;
                        const r = bodyFn(args, vars);
                        if (r) {
                            if (r.earlyReturn) return r;
                            if (r.earlyBreak) break;
                        }
                    }
                };
            }
            // For Set or simple iteration
            return (args, vars) => {
                const iterable = iterableFn(args, vars);
                for (const item of iterable) {
                    vars[valueId] = item;
                    const r = bodyFn(args, vars);
                    if (r) {
                        if (r.earlyReturn) return r;
                        if (r.earlyBreak) break;
                    }
                }
            };
        }
        case 'switch': {
            const valueFn = compileExprToClosure(stmt.value);
            const cases = stmt.cases.map(([lit, block]) => [lit, compileBlockToClosure(block)] as const);
            const defaultFn = stmt.default ? compileBlockToClosure(stmt.default) : undefined;
            return (args, vars) => {
                const value = valueFn(args, vars);
                for (const [lit, blockFn] of cases) {
                    if (value === lit) {
                        // A break or continue in a case belongs to the enclosing loop: handed up.
                        return blockFn(args, vars);
                    }
                }
                if (defaultFn) {
                    return defaultFn(args, vars);
                }
            };
        }
        case 'while': {
            const condFn = compileExprToClosure(stmt.cond);
            const bodyFn = compileBlockToClosure(stmt.body);
            return (args, vars) => {
                while (condFn(args, vars)) {
                    const r = bodyFn(args, vars);
                    if (r) {
                        if (r.earlyReturn) return r;
                        if (r.earlyBreak) break;
                    }
                }
            };
        }
        case 'break':
            return () => BREAK;
        case 'continue':
            return () => CONTINUE;
    }
}

type BlockFn = (args: any[], vars: any[]) => Completion | void;

function compileBlockToClosure(block: Block): BlockFn {
    const stmtFns = block.stmts.map(compileStmtToClosure);
    const returnFn = block.returnExpr ? compileExprToClosure(block.returnExpr) : undefined;

    return (args, vars) => {
        for (const fn of stmtFns) {
            const result = fn(args, vars);
            if (result && (result.earlyReturn || result.earlyBreak || result.earlyContinue)) return result;
        }
        if (returnFn) {
            return { earlyReturn: true, value: returnFn(args, vars) };
        }
    };
}

/**
 * Check if a block is pure (no statements, return expr doesn't need vars).
 */
function isPureBlock(block: Block): boolean {
    if (block.stmts.length > 0) return false;
    if (!block.returnExpr) return true;
    return !exprNeedsVars(block.returnExpr);
}

/**
 * Create an optimized closure-based executor for a block.
 * Pre-compiles to closures for efficient repeated execution.
 *
 * For pure blocks (no statements, return expr doesn't need vars),
 * uses a simplified executor that avoids vars array allocation.
 */
function createClosureExecutor<T>(block: Block, inputDefaults?: readonly unknown[]): (...args: any[]) => T {
    // An argument that is left out, or passed as undefined, takes its default — as the parameter
    // list of the compiled function says it does.
    const defaults = inputDefaults && inputDefaults.some(value => value !== undefined) ? inputDefaults : undefined;

    // Fast path for pure blocks (common case for type guards)
    if (isPureBlock(block)) {
        if (!block.returnExpr) {
            return () => undefined as T;
        }
        const pureFn = compilePureExpr(block.returnExpr);
        if (defaults) return (...args: any[]): T => pureFn(withDefaults(args, defaults)) as T;
        return (...args: any[]): T => pureFn(args) as T;
    }

    // General case with vars support
    const blockFn = compileBlockToClosure(block);
    if (defaults) {
        return (...args: any[]): T => {
            const result = blockFn(withDefaults(args, defaults), []);
            return result?.value;
        };
    }
    return (...args: any[]): T => {
        const result = blockFn(args, []);
        return result?.value;
    };
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
export function createExecutor<T>(block: Block, inputDefaults?: readonly unknown[]): (...args: any[]) => T {
    return createClosureExecutor<T>(block, inputDefaults);
}
