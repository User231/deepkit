# JIT Compilation Strategy: Supporting CSP-Restricted Environments

> **Status:** ✅ Core API implemented in `@deepkit/core`
> **Related:** `docs/refactor.md`
> **Last updated:** 2026-01-21

This document addresses a fundamental architectural challenge: Deepkit's performance depends on JIT compilation via `new Function()`, but environments like Cloudflare Workers, browsers with strict CSP, and some embedded runtimes block dynamic code generation.

---

## Executive Summary

Deepkit achieves 10-100x performance improvements through JIT compilation using `new Function()`. This is used in:
- **@deepkit/type** - Serialization (~32M ops/sec) and validation (~26M ops/sec)
- **@deepkit/bson** - BSON encoding (13x faster than bson-js)
- **@deepkit/injector** - Dependency resolution
- **@deepkit/http** - Request parsing
- **@deepkit/workflow** - State machine compilation

**The Problem:** `new Function()` is blocked in:
- Cloudflare Workers (CSP restriction for security)
- Browsers with `script-src` CSP without `'unsafe-eval'`
- Some embedded JavaScript runtimes
- Environments using Trusted Types without proper policies

**Solution Strategy:** Unified function builder API (`jit.fn()`):
1. **Single API** - Write code once using context primitives (`ctx.obj()`, `ctx.get()`, `ctx.set()`, etc.)
2. **JIT mode** - Primitives accumulate code strings → compile with `new Function()`
3. **Exec mode** - Primitives execute directly → full debuggability, works everywhere
4. **AOT (optional)** - Pre-generate code at build time for production

---

## 1. Current JIT Architecture Analysis

### 1.1 CompilerContext: The Foundation

All JIT compilation flows through `CompilerContext` in `packages/core/src/compiler.ts`:

```typescript
export class CompilerContext {
    public readonly context = new Map<string, any>();

    build(functionCode: string, ...args: string[]): any {
        functionCode = this.format(`
            'use strict';
            ${this.preCode}
            return function self(${args.join(', ')}){
                'use strict';
                ${functionCode}
            };
        `);
        return new Function(...this.context.keys(), functionCode)(...this.context.values());
    }
}
```

**Key insight:** Context variables are passed as closure parameters to the generated function, enabling V8 to inline them.

### 1.2 Where JIT Is Used

| Package | Location | Purpose | Performance Impact |
|---------|----------|---------|-------------------|
| @deepkit/core | `compiler.ts` | CompilerContext.build/raw | Foundation for all JIT |
| @deepkit/type | `serializer.ts` | createSerializeFunction | 32M ops/sec |
| @deepkit/type | `serializer.ts` | createTypeGuardFunction | 26M ops/sec |
| @deepkit/type | `path.ts` | pathResolver | Change detection |
| @deepkit/type | `snapshot.ts` | createJITConverterForSnapshot | ORM snapshots |
| @deepkit/type | `change-detector.ts` | createJITChangeDetectorForSnapshot | Dirty checking |
| @deepkit/bson | `bson-serializer.ts` | createBSONSerializer | 13x faster than bson-js |
| @deepkit/bson | `bson-deserializer.ts` | createBSONDeserializer | 13x faster than bson-js |
| @deepkit/injector | `injector.ts` | Factory generation | ~100x faster than reflection |
| @deepkit/http | `request-parser.ts` | buildRequestParser | Per-route optimization |
| @deepkit/workflow | `workflow.ts` | buildApplier | State machine dispatch |

### 1.3 Why JIT Is Fast

1. **Type Specialization**: Each type gets its own optimized code path
2. **Inlined Operations**: No function call overhead for property access
3. **V8 Hidden Class Stability**: Generated code maintains consistent object shapes
4. **Loop Unrolling**: Known property counts enable unrolled loops
5. **Eliminated Branching**: Type checks resolved at generation time, not runtime

**Example - Generated Serializer Code:**
```javascript
// For type: { id: number, name: string, email: string & Email }
function serialize(data, state) {
    var result = {};

    // Direct property access - no iteration, no type checking
    result.id = data.id;
    result.name = data.name;

    // Validation baked in for email
    if (typeof data.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        result.email = data.email;
    } else {
        throw new ValidationError('email', 'Expected valid email');
    }

    return result;
}
```

---

## 2. Performance Tiers Without JIT

### 2.1 Benchmark Reference Data

From research on comparable libraries:

| Approach | Relative Performance | Example |
|----------|---------------------|---------|
| JIT (current Deepkit) | 100% baseline | 32M ops/sec |
| AOT (Typia) | 95-100% of JIT | ~30M ops/sec |
| Pre-bound closures | 40-60% of JIT | ~15M ops/sec |
| TypedArray operations | 60-90% of JIT (numeric) | ~25M ops/sec |
| Switch-based dispatch | 25-40% of JIT | ~10M ops/sec |
| Bytecode interpreter + IC | 30-50% of JIT | ~12M ops/sec |
| Recursive interpretation | 10-20% of JIT | ~5M ops/sec |

**Key finding from TypeBox:** Their `TypeCompiler` (JIT) vs `Value.Check` (interpreted) shows:
- Simple objects: **~22x slower** interpreted
- Complex unions: **~33x slower** interpreted

### 2.2 Target Performance by Environment

| Environment | Strategy | Target Performance |
|-------------|----------|-------------------|
| Node.js | JIT | 32M ops/sec (current) |
| Deno | JIT | 32M ops/sec |
| Bun | JIT | 32M ops/sec |
| Cloudflare Workers | AOT or Interpreted | 15-30M ops/sec (AOT) or 1-5M ops/sec (interpreted) |
| Browser (no CSP) | JIT | 32M ops/sec |
| Browser (strict CSP) | AOT or Interpreted | 15-30M ops/sec or 1-5M ops/sec |

---

## 3. Solution Architecture

### 3.1 Unified Function Builder Architecture

```
                    ┌─────────────────────────────────────┐
                    │          Deepkit Type API           │
                    │   serialize<T>() / validate<T>()    │
                    └────────────────┬────────────────────┘
                                     │
                    ┌────────────────▼────────────────────┐
                    │       jit.build() API               │
                    │   Unified function builder          │
                    │   (writes using primitives)         │
                    └────────────────┬────────────────────┘
                                     │
                         canJIT() detection
                                     │
                  ┌──────────────────┴──────────────────┐
                  │                                      │
                  ▼                                      ▼
        ┌─────────────────┐                  ┌─────────────────┐
        │   JITContext    │                  │   ExecContext   │
        ├─────────────────┤                  ├─────────────────┤
        │ Performance:    │                  │ Performance:    │
        │ 100% baseline   │                  │ 20-40%          │
        │                 │                  │                 │
        │ Availability:   │                  │ Availability:   │
        │ Node/Deno/Bun   │                  │ Everywhere      │
        │ Browser (no CSP)│                  │ (Workers, CSP)  │
        │                 │                  │                 │
        │ Debuggability:  │                  │ Debuggability:  │
        │ Limited         │                  │ Full            │
        └─────────────────┘                  └─────────────────┘
```

### 3.2 Context Interface (Implemented)

```typescript
// packages/core/src/jit.ts

/**
 * Slot interface with chainable methods for property access.
 * In JIT mode: SlotExpr that builds code strings
 * In Exec mode: ExecSlot that wraps actual values
 */
interface Slot<T = any> {
    /** Get a property value - chainable! */
    get<K extends keyof T>(key: K): Slot<T[K]>;
    get(key: string | Slot<string>): Slot<any>;

    /** Get array element by index */
    at(index: number | Slot<number>): Slot<any>;

    /** Get length of array or string */
    len(): Slot<number>;
}

interface Context {
    // Create values
    obj<T extends object = any>(): Slot<T>;
    objFrom<T extends object = any>(entries: Record<string, Slot> | Array<[string | Slot<string>, Slot]>): Slot<T>;
    arr<T = any>(): Slot<T[]>;
    lit<T>(value: T): Slot<T>;

    // Property access (prefer slot.get() for chainable API)
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
}
```

### 3.3 Runtime Detection

```typescript
// packages/core/src/runtime-detection.ts

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
        trustedTypes: typeof trustedTypes !== 'undefined',
        webAssembly: typeof WebAssembly !== 'undefined',
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
    if (typeof process !== 'undefined' && process.versions?.node) return 'node';
    if (typeof Deno !== 'undefined') return 'deno';
    if (typeof Bun !== 'undefined') return 'bun';
    if (typeof navigator !== 'undefined') {
        if (navigator.userAgent?.includes('Cloudflare-Workers')) return 'cloudflare';
        return 'browser';
    }
    return 'unknown';
}
```

---

## 4. JIT Strategy (Current Implementation)

The JIT strategy is the current implementation. It uses `CompilerContext` to generate optimized functions at runtime.

**Files involved:**
- `packages/core/src/compiler.ts` - CompilerContext
- `packages/type/src/serializer.ts` - Template registry and code generation
- `packages/bson/src/bson-serializer.ts` - BSON-specific templates

**No changes needed** - this continues to work where `new Function()` is available.

---

## 5. AOT Strategy (Build-Time Generation)

### 5.1 Overview

AOT (Ahead-of-Time) compilation generates serializer/validator code at build time instead of runtime. This produces static JavaScript files that don't require `new Function()`.

### 5.2 CLI Tool

```bash
# Generate serializers for all types in a project
npx @deepkit/type-aot generate \
  --project tsconfig.json \
  --output src/generated \
  --format ts

# Watch mode for development
npx @deepkit/type-aot generate --watch
```

### 5.3 Generated Code Structure

```typescript
// src/generated/serializers.ts (auto-generated)
import { SerializerRegistry } from '@deepkit/type';

// Generated serializer for User type
function serializeUser(data: any, state: any): any {
    const result: any = {};
    if (typeof data.id !== 'number') {
        throw new ValidationError('id', 'Expected number');
    }
    result.id = data.id;
    result.name = String(data.name);
    result.email = data.email;
    return result;
}

// Register all generated serializers
export function registerAOTSerializers(registry: SerializerRegistry): void {
    registry.register('User', serializeUser);
    registry.register('Post', serializePost);
    // ... all types
}
```

### 5.4 Integration with Type System

The AOT generator would:
1. Load the TypeScript project
2. Run `@deepkit/type-compiler` to extract type metadata
3. For each type with metadata, generate serializer/validator code
4. Output static TypeScript/JavaScript files

```typescript
// packages/type-aot/src/generator.ts

export async function generateAOT(options: AOTOptions): Promise<void> {
    // 1. Load project
    const program = ts.createProgram([...sourceFiles], compilerOptions);

    // 2. Extract types via type-compiler
    const types = extractTypesWithMetadata(program);

    // 3. Generate code for each type
    const generatedCode: string[] = [];
    for (const type of types) {
        // Use existing template system but output to string instead of new Function()
        const code = generateSerializerCode(type);
        generatedCode.push(code);
    }

    // 4. Write output files
    await writeGeneratedFiles(options.output, generatedCode);
}
```

### 5.5 Build Tool Integration

**Vite:**
```typescript
// vite.config.ts
import deepkitAOT from '@deepkit/type-aot/vite';

export default defineConfig({
    plugins: [
        deepkitAOT({
            output: './src/generated',
        })
    ]
});
```

**Webpack:**
```typescript
// webpack.config.js
const DeepkitAOTPlugin = require('@deepkit/type-aot/webpack');

module.exports = {
    plugins: [
        new DeepkitAOTPlugin({
            output: './src/generated',
        })
    ]
};
```

### 5.6 Expected Performance

AOT should achieve **95-100%** of JIT performance because:
- Same generated code, just created at build time
- V8 can still optimize the static functions
- No code generation overhead at runtime

**Trade-offs:**
- Requires build step
- Generated files add to bundle size
- Must regenerate when types change

---

## 6. Unified Function Builder API (`jit` namespace)

### 6.1 Overview

Instead of separate JIT and interpreted implementations, we use a **unified function builder API** that transparently chooses the execution strategy. You write code once using primitives, and the system either:
- **JIT mode**: Accumulates code strings → compiles with `new Function()`
- **Exec mode**: Re-runs your callback on each invocation → primitives execute directly with actual values

This provides **full debuggability** in exec mode (real stack traces, breakpoints work, actual values visible) while achieving maximum performance in JIT mode.

### 6.2 Architecture

```
                    ┌─────────────────────────────────────┐
                    │           jit.fn() API              │
                    │   Unified function builder          │
                    └────────────────┬────────────────────┘
                                     │
                         canJIT() detection
                                     │
                  ┌──────────────────┴──────────────────┐
                  │                                      │
                  ▼                                      ▼
        ┌─────────────────┐                  ┌─────────────────┐
        │   JITContext    │                  │   ExecContext   │
        │                 │                  │                 │
        │ • Passed as     │                  │ • Passed as     │
        │   first arg     │                  │   first arg     │
        │ • Accumulates   │                  │ • Direct value  │
        │   code strings  │                  │   flow          │
        │ • Compiles once │                  │ • Re-runs       │
        │ • Returns native│                  │   callback      │
        │   function      │                  │ • Full debug    │
        └─────────────────┘                  └─────────────────┘

No global state - context passed explicitly to callback.
```

### 6.3 API Design

```typescript
// packages/core/src/jit.ts

import { jit } from '@deepkit/core';

// Build a function with typed arguments using jit.fn()
// Context is passed as FIRST argument to callback
// Use natural `return` instead of special ret()
const serialize = jit.fn(
    jit.arg<User>(),
    jit.arg<Uint8Array>(),
    jit.arg<number>(),
    (ctx, input, buffer, offset) => {
        const output = ctx.obj();

        // Regular for loop - runs at build time (JIT) or every call (exec)
        for (const prop of props) {
            ctx.set(output, prop.name, ctx.get(input, prop.name));
        }

        return output;  // Natural return!
    }
);

// Type: (input: User, buffer: Uint8Array, offset: number) => any
```

**Key insight:** Use regular JavaScript constructs (for loops, if statements) for build-time logic. Only use `ctx.*` methods for operations that need to be compiled/executed at runtime.

### 6.4 Primitives Reference

All primitives are methods on `ctx` (the context passed to the callback).

| Primitive | Purpose | JIT mode | Exec mode |
|-----------|---------|----------|-----------|
| **jit namespace** ||||
| `jit.arg<T>()` | Declare input parameter | Slot number | Actual value |
| `jit.fn(...)` | Build function | `new Function(...)` | Returns wrapper |
| **Create** ||||
| `ctx.obj<T>()` | Create `{}` | `var sN={};` | Returns `{}` |
| `ctx.arr<T>()` | Create `[]` | `var sN=[];` | Returns `[]` |
| `ctx.lit(v)` | Embed constant | `var sN=e[i];` | Returns `v` |
| **Access** ||||
| `ctx.get(o,k)` | Read property | `var sN=sO[k];` | Returns `o[k]` |
| `ctx.set(o,k,v)` | Write property | `sO[k]=sV;` | Does `o[k]=v` |
| `ctx.at(arr,i)` | Array index | `var sN=sA[i];` | Returns `arr[i]` |
| `ctx.has(o,k)` | Check property | `k in sO` | Returns `k in o` |
| **Array** ||||
| `ctx.push(a,v)` | Append to array | `sA.push(sV);` | Does `a.push(v)` |
| `ctx.len(a)` | Array/string length | `sA.length` | Returns `a.length` |
| **Equality** ||||
| `ctx.eq(a,b)` | Strict equal | `sA===sB` | Returns `a===b` |
| `ctx.neq(a,b)` | Not equal | `sA!==sB` | Returns `a!==b` |
| **Comparison** ||||
| `ctx.lt(a,b)` | Less than | `sA<sB` | Returns `a<b` |
| `ctx.gt(a,b)` | Greater than | `sA>sB` | Returns `a>b` |
| `ctx.lte(a,b)` | Less or equal | `sA<=sB` | Returns `a<=b` |
| `ctx.gte(a,b)` | Greater or equal | `sA>=sB` | Returns `a>=b` |
| **Logical** ||||
| `ctx.not(a)` | Negate | `!sA` | Returns `!a` |
| `ctx.and(a,b)` | Logical AND | `sA&&sB` | Returns `a&&b` |
| `ctx.or(a,b)` | Logical OR | `sA\|\|sB` | Returns `a\|\|b` |
| **Type Checks** ||||
| `ctx.isType(v,t)` | typeof check | `typeof sV===t` | Returns `typeof v===t` |
| `ctx.isNull(v)` | null check | `sV===null` | Returns `v===null` |
| `ctx.isNullish(v)` | nullish check | `sV==null` | Returns `v==null` |
| **Calls** ||||
| `ctx.call(fn,...)` | Function call | `e[i](...)` | Returns `fn(...)` |
| `ctx.new_(C,...)` | Constructor | `new e[i](...)` | Returns `new C(...)` |
| **Control** ||||
| `ctx.loop(arr,fn)` | **Runtime** iteration | `for(...)` | `for(...)` |
| `ctx.when(c,t,e)` | Runtime conditional | `if(sC){...}` | `if(c){...}` |

**Note:** For build-time loops, use regular JavaScript `for` loops. Everything else (bitwise, arithmetic, string ops, TypedArray) → use `ctx.call()`.

### 6.5 Key Design: Direct Value Flow in Exec Mode

In exec mode, **no slots array** is needed. Values flow directly:

```
JIT Mode:                              Exec Mode:
─────────                              ─────────
input = 0 (slot number)                input = { name: 'John' } (actual value)
ctx.obj() → 1 (slot number)            ctx.obj() → {} (actual object)
ctx.get(0, 'name') → 2 (slot)          ctx.get(input, 'name') → 'John' (actual)
ctx.set(1, 'name', 2) → emits code     ctx.set(output, 'name', 'John') → mutates
return 1 → emits "return s1;"          return output → returns actual object
```

### 6.6 Early Return with `when()`

Early returns inside `when()` work naturally:

```typescript
const serialize = jit.fn(jit.arg<any>(), (ctx, input) => {
    ctx.when(ctx.isNull(input), () => {
        return ctx.lit(null);  // Early return!
    });

    const output = ctx.obj();
    ctx.set(output, 'name', ctx.get(input, 'name'));
    return output;
});
```

**JIT mode** generates:
```javascript
function(s0) {
    if (s0 === null) {
        return null;
    }
    var s1 = {};
    s1["name"] = s0["name"];
    return s1;
}
```

**Exec mode** uses a flag to handle early return without exceptions:

```
serialize(null):
┌─────────────────────────────────────────────────────────────┐
│  ExecContext: { hasEarlyReturn: false, earlyReturnValue: ∅ }│
│                                                             │
│  ctx.isNull(null) → true                                    │
│  ctx.when(true, callback):                                  │
│    ├── callback() called                                    │
│    │   └── return ctx.lit(null) → returns null              │
│    └── Sets hasEarlyReturn=true, earlyReturnValue=null      │
│                                                             │
│  ctx.obj() → hasEarlyReturn? YES → returns undefined (no-op)│
│  ctx.get() → hasEarlyReturn? YES → returns undefined (no-op)│
│  ctx.set() → hasEarlyReturn? YES → no-op                    │
│  return output → returns undefined                          │
│                                                             │
│  jit.fn wrapper: hasEarlyReturn? YES → return null          │
└─────────────────────────────────────────────────────────────┘
Result: null ✓
```

### 6.7 Implementation

```typescript
// packages/core/src/jit.ts

// Opaque type - at runtime: number (JIT) or actual value T (Exec)
declare const SlotBrand: unique symbol;
type Slot<T = any> = (number | T) & { [SlotBrand]: T };
type Arg<T> = { __brand: 'arg'; __type?: T };

// Detect once at module load
const canJIT = (() => {
    try { new Function('return true')(); return true; }
    catch { return false; }
})();

export const jit = {
    arg<T>(): Arg<T> {
        return { __brand: 'arg' } as Arg<T>;
    },

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
};
```

**That's it.** The `jit` namespace has only two functions: `arg()` and `fn()`.

All primitives are methods on the context (`ctx`) which is passed as the first argument to your callback. No global state, no stack, no delegation.

### 6.8 JITContext Implementation

```typescript
class JITContext {
    private code = '';
    private slot = 0;
    private externs: any[] = [];
    private argCount: number;

    constructor(argCount: number) {
        this.argCount = argCount;
        this.slot = argCount;  // Args occupy first slots (s0, s1, ...)
    }

    getArgSlots(): Slot[] {
        return Array.from({ length: this.argCount }, (_, i) => i as Slot);
    }

    private nextSlot(): number {
        return this.slot++;
    }

    // Create
    obj<T>(): Slot<T> {
        const s = this.nextSlot();
        this.code += `var s${s}={};\n`;
        return s as Slot<T>;
    }

    arr<T>(): Slot<T[]> {
        const s = this.nextSlot();
        this.code += `var s${s}=[];\n`;
        return s as Slot<T[]>;
    }

    lit<T>(value: T): Slot<T> {
        const s = this.nextSlot();
        const extIdx = this.externs.push(value) - 1;
        this.code += `var s${s}=e[${extIdx}];\n`;
        return s as Slot<T>;
    }

    // Access
    get<T>(target: Slot, key: string | Slot<string>): Slot<T> {
        const s = this.nextSlot();
        const k = typeof key === 'string' ? JSON.stringify(key) : `s${key}`;
        this.code += `var s${s}=s${target}[${k}];\n`;
        return s as Slot<T>;
    }

    set(target: Slot, key: string | Slot<string>, value: Slot): void {
        const k = typeof key === 'string' ? JSON.stringify(key) : `s${key}`;
        this.code += `s${target}[${k}]=s${value};\n`;
    }

    at<T>(arr: Slot, index: number | Slot<number>): Slot<T> {
        const s = this.nextSlot();
        const i = typeof index === 'number' ? index : `s${index}`;
        this.code += `var s${s}=s${arr}[${i}];\n`;
        return s as Slot<T>;
    }

    has(target: Slot, key: string | Slot<string>): Slot<boolean> {
        const s = this.nextSlot();
        const k = typeof key === 'string' ? JSON.stringify(key) : `s${key}`;
        this.code += `var s${s}=${k} in s${target};\n`;
        return s as Slot<boolean>;
    }

    // Array
    push(arr: Slot, value: Slot): void {
        this.code += `s${arr}.push(s${value});\n`;
    }

    len(target: Slot): Slot<number> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${target}.length;\n`;
        return s as Slot<number>;
    }

    // Equality
    eq(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}===s${b};\n`;
        return s as Slot<boolean>;
    }

    neq(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}!==s${b};\n`;
        return s as Slot<boolean>;
    }

    // Comparison
    lt(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}<s${b};\n`;
        return s as Slot<boolean>;
    }

    gt(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}>s${b};\n`;
        return s as Slot<boolean>;
    }

    lte(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}<=s${b};\n`;
        return s as Slot<boolean>;
    }

    gte(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}>=s${b};\n`;
        return s as Slot<boolean>;
    }

    // Logical
    not(a: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=!s${a};\n`;
        return s as Slot<boolean>;
    }

    and(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}&&s${b};\n`;
        return s as Slot<boolean>;
    }

    or(a: Slot, b: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${a}||s${b};\n`;
        return s as Slot<boolean>;
    }

    // Type checks
    isType(value: Slot, type: string): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=typeof s${value}===${JSON.stringify(type)};\n`;
        return s as Slot<boolean>;
    }

    isNull(value: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${value}===null;\n`;
        return s as Slot<boolean>;
    }

    isNullish(value: Slot): Slot<boolean> {
        const s = this.nextSlot();
        this.code += `var s${s}=s${value}==null;\n`;
        return s as Slot<boolean>;
    }

    // Calls
    call<T>(fn: Function, ...args: Slot[]): Slot<T> {
        const s = this.nextSlot();
        const extIdx = this.externs.push(fn) - 1;
        const argsCode = args.map(a => `s${a}`).join(',');
        this.code += `var s${s}=e[${extIdx}](${argsCode});\n`;
        return s as Slot<T>;
    }

    new_<T>(ctor: new (...args: any[]) => T, ...args: Slot[]): Slot<T> {
        const s = this.nextSlot();
        const extIdx = this.externs.push(ctor) - 1;
        const argsCode = args.map(a => `s${a}`).join(',');
        this.code += `var s${s}=new e[${extIdx}](${argsCode});\n`;
        return s as Slot<T>;
    }

    // Control flow
    when(cond: Slot<boolean>, then: () => Slot | void, else_?: () => Slot | void): void {
        this.code += `if(s${cond}){\n`;
        const thenResult = then();
        if (thenResult !== undefined) {
            this.code += `return s${thenResult};\n`;
        }
        if (else_) {
            this.code += `}else{\n`;
            const elseResult = else_();
            if (elseResult !== undefined) {
                this.code += `return s${elseResult};\n`;
            }
        }
        this.code += `}\n`;
    }

    loop(arr: Slot, fn: (elem: Slot, idx: Slot) => void): void {
        const idx = this.nextSlot();
        const elem = this.nextSlot();
        this.code += `for(var s${idx}=0;s${idx}<s${arr}.length;s${idx}++){\n`;
        this.code += `var s${elem}=s${arr}[s${idx}];\n`;
        fn(elem as Slot, idx as Slot);
        this.code += `}\n`;
    }

    compile<T extends Function>(returnSlot?: Slot): T {
        if (returnSlot !== undefined) {
            this.code += `return s${returnSlot};\n`;
        }
        const argNames = Array.from({ length: this.argCount }, (_, i) => `s${i}`).join(',');
        const fn = new Function('e', `return function(${argNames}){\n${this.code}}`);
        return fn(this.externs) as T;
    }
}
```

### 6.9 ExecContext Implementation (Direct Value Flow)

```typescript
class ExecContext {
    hasEarlyReturn = false;
    earlyReturnValue: any;

    // Create
    obj<T>(): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        return {} as Slot<T>;
    }

    arr<T>(): Slot<T[]> {
        if (this.hasEarlyReturn) return undefined as any;
        return [] as Slot<T[]>;
    }

    lit<T>(value: T): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        return value as Slot<T>;
    }

    // Access
    get<T>(target: Slot, key: string | Slot<string>): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        const k = typeof key === 'string' ? key : key as unknown as string;
        return (target as any)[k] as Slot<T>;
    }

    set(target: Slot, key: string | Slot<string>, value: Slot): void {
        if (this.hasEarlyReturn) return;
        const k = typeof key === 'string' ? key : key as unknown as string;
        (target as any)[k] = value;
    }

    at<T>(arr: Slot, index: number | Slot<number>): Slot<T> {
        if (this.hasEarlyReturn) return undefined as any;
        const i = typeof index === 'number' ? index : index as unknown as number;
        return (arr as any)[i] as Slot<T>;
    }

    has(target: Slot, key: string | Slot<string>): Slot<boolean> {
        if (this.hasEarlyReturn) return undefined as any;
        const k = typeof key === 'string' ? key : key as unknown as string;
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
        return (!a) as Slot<boolean>;
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
```

### 6.10 Debuggability Comparison

```
┌─────────────────────────────────────────────────────────────────┐
│  EXEC MODE - Full Debuggability                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Setting breakpoint on: const output = ctx.obj();               │
│                                                                 │
│  Call Stack:                                                    │
│    serialize             ← your entry point                     │
│    (anonymous)           ← YOUR CALLBACK (breakpoint here)      │
│    ExecContext.obj       ← primitive implementation             │
│                                                                 │
│  Variables visible:                                             │
│    ctx = ExecContext { hasEarlyReturn: false }                  │
│    input = { name: 'John' }    ← ACTUAL VALUE                   │
│    output = undefined          ← not assigned yet               │
│                                                                 │
│  After stepping:                                                │
│    output = {}                 ← ACTUAL OBJECT                  │
│                                                                 │
│  You can:                                                       │
│    ✓ Step through your code line by line                        │
│    ✓ Inspect actual values (not slot numbers)                   │
│    ✓ See your source file and line numbers                      │
│    ✓ Set conditional breakpoints                                │
│    ✓ Add watch expressions on real variables                    │
│    ✓ Modify values during debugging                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  JIT MODE - Limited Debuggability                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Your callback ran ONCE at build time to generate code.         │
│  At runtime, only the compiled function executes.               │
│                                                                 │
│  Breakpoints in your source don't hit at runtime.               │
│                                                                 │
│  You'd have to debug the generated code:                        │
│    function(s0) {                                               │
│        var s1 = {};                                             │
│        s1["name"] = s0["name"];                                 │
│        return s1;                                               │
│    }                                                            │
│                                                                 │
│  Variables are s0, s1, s2... not your meaningful names.         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.11 Use Cases

#### 6.11.1 Simple Object Serializer

```typescript
function buildSerializer(props: Array<{ name: string }>) {
    return jit.fn(jit.arg<any>(), (ctx, input) => {
        const output = ctx.obj();

        // Regular for loop - runs at build time (JIT) or every call (exec)
        for (const prop of props) {
            ctx.set(output, prop.name, ctx.get(input, prop.name));
        }

        return output;
    });
}

const serialize = buildSerializer([{ name: 'id' }, { name: 'name' }]);
serialize({ id: 1, name: 'John' });  // { id: 1, name: 'John' }
```

#### 6.11.2 BSON Serializer with Prebaked Binary

```typescript
function buildBsonSerializer(props: PropMeta[]) {
    return jit.fn(
        jit.arg<any>(),
        jit.arg<Uint8Array>(),
        jit.arg<number>(),
        (ctx, input, buffer, offset) => {
            for (const prop of props) {
                // Pre-compute header bytes at BUILD time
                const header = Buffer.alloc(1 + prop.name.length + 1);
                header[0] = getBsonMarker(prop.type);
                header.write(prop.name + '\0', 1);

                // At runtime: just copy prebaked bytes
                offset = ctx.call(copyBytes, buffer, offset, ctx.lit(header));

                // Write dynamic value
                const value = ctx.get(input, prop.name);
                if (prop.type === 'number') {
                    offset = ctx.call(writeDouble, buffer, offset, value);
                } else if (prop.type === 'string') {
                    offset = ctx.call(writeString, buffer, offset, value);
                }
            }

            return offset;
        }
    );
}
```

#### 6.11.3 Validator with Error Collection

```typescript
function buildValidator(rules: Array<{ prop: string; check: (v: any) => boolean; msg: string }>) {
    return jit.fn(jit.arg<any>(), (ctx, input) => {
        const errors = ctx.arr<string>();

        for (const rule of rules) {
            const value = ctx.get(input, rule.prop);
            const valid = ctx.call(rule.check, value);

            ctx.when(ctx.not(valid), () => {
                ctx.push(errors, ctx.lit(rule.msg));
            });
        }

        return errors;
    });
}
```

#### 6.11.4 Database Row Hydrator

```typescript
function buildHydrator(entity: EntityMeta) {
    return jit.fn(jit.arg<any>(), (ctx, row) => {
        const instance = ctx.new_(entity.class);

        for (const col of entity.columns) {
            const raw = ctx.get(row, col.columnName);
            let value = raw;

            if (col.type === 'date') {
                value = ctx.call(toDate, raw);
            } else if (col.type === 'json') {
                value = ctx.call(JSON.parse, raw);
            }

            ctx.set(instance, col.propertyName, value);
        }

        return instance;
    });
}
```

#### 6.11.5 Nested Function Building

```typescript
function buildNestedSerializer(schema: Schema) {
    return jit.fn(jit.arg<any>(), (ctx, input) => {
        const output = ctx.obj();

        for (const prop of schema.props) {
            const value = ctx.get(input, prop.name);

            if (prop.nested) {
                // Recursively build nested serializer
                // Each jit.fn() creates its own context - no global state
                const nestedFn = buildNestedSerializer(prop.nested);
                ctx.set(output, prop.name, ctx.call(nestedFn, value));
            } else {
                ctx.set(output, prop.name, value);
            }
        }

        return output;
    });
}
```

#### 6.11.6 Early Return Pattern

```typescript
function buildSafeSerializer(props: PropMeta[]) {
    return jit.fn(jit.arg<any>(), (ctx, input) => {
        // Guard clause with early return
        ctx.when(ctx.isNullish(input), () => {
            return ctx.lit(null);
        });

        const output = ctx.obj();

        for (const prop of props) {
            const value = ctx.get(input, prop.name);

            if (prop.required) {
                ctx.when(ctx.isNullish(value), () => {
                    return ctx.lit(undefined);  // Early return on missing required
                });
            }

            ctx.set(output, prop.name, value);
        }

        return output;
    });
}
```

#### 6.11.7 Validation with Range Checks

```typescript
function buildRangeValidator(constraints: Array<{ prop: string; min?: number; max?: number }>) {
    return jit.fn(jit.arg<any>(), (ctx, input) => {
        const errors = ctx.arr<string>();

        for (const c of constraints) {
            const value = ctx.get(input, c.prop);

            // Use comparison operators directly - no function call overhead
            if (c.min !== undefined) {
                ctx.when(ctx.lt(value, ctx.lit(c.min)), () => {
                    ctx.push(errors, ctx.lit(`${c.prop} must be >= ${c.min}`));
                });
            }
            if (c.max !== undefined) {
                ctx.when(ctx.gt(value, ctx.lit(c.max)), () => {
                    ctx.push(errors, ctx.lit(`${c.prop} must be <= ${c.max}`));
                });
            }
        }

        return errors;
    });
}
```

### 6.12 Key Design Principles

1. **Minimal API**: `jit` namespace has only two functions: `arg()` and `fn()`
2. **Context as first argument**: No global state, no stack - context passed explicitly
3. **Regular JS for build-time logic**: Use normal `for` loops and `if` statements
4. **`ctx.*` for runtime operations**: Only operations that need to be compiled/executed
5. **Natural `return`**: No special `ret()` - just return values naturally
6. **Direct value flow in exec mode**: No slots array - actual values flow through
7. **Prebake everything static**: Constants, property names, binary headers → computed once
8. **Full debuggability in exec mode**: Real stack traces, breakpoints, actual values visible
9. **Comparison operators as primitives**: `lt`, `gt`, `lte`, `gte` for validation hot paths
10. **Everything else via `call()`**: Bitwise, arithmetic, string ops → use `ctx.call()`

### 6.13 Expected Performance

| Mode | Performance | Debuggability |
|------|-------------|---------------|
| JIT | 100% baseline | Limited (generated code) |
| Exec | 20-40% of JIT | Full (real stack traces) |

The exec mode is slower but provides:
- Real breakpoints in your serializer code
- Full stack traces pointing to exact lines
- All variables inspectable in debugger - **actual values, not slot numbers**
- No opaque generated functions

---

## 7. Benchmarking Strategy

### 7.1 Benchmark Infrastructure

Create comprehensive benchmarks that measure:
1. **Throughput** - Operations per second
2. **Latency** - Time per operation (p50, p95, p99)
3. **Memory** - Allocations per operation
4. **GC pressure** - Collections during benchmark

### 7.2 Benchmark Suite Structure

```
packages/type/benchmarks/
├── serialization.bench.ts    # serialize<T>() performance
├── validation.bench.ts       # validate<T>() performance
├── strategy-comparison.ts    # Compare JIT vs AOT vs Interpreted
└── memory.bench.ts          # Allocation profiling

packages/bson/benchmarks/
├── serialize.bench.ts
├── deserialize.bench.ts
└── comparison.bench.ts      # vs official bson-js

packages/injector/benchmarks/
├── resolution.bench.ts
└── scopes.bench.ts
```

### 7.3 Use `@deepkit/bench` (No External Dependencies)

Deepkit has its own benchmarking package (from `feat/better-rpc` branch) with:
- Adaptive iteration selection (1x to 10M iterations)
- GC event tracking via `--expose-gc`
- Heap delta measurement
- Statistical analysis (RME, variance)
- Color-coded output

```typescript
import { benchmark, run } from '@deepkit/bench';

// Use a module-level variable to prevent dead code elimination
// V8 can't optimize away code that writes to externally-visible state
let sink: any;

benchmark('JIT serialization', () => {
    sink = jitSerializer(testData);
});

benchmark('AOT serialization', () => {
    sink = aotSerializer(testData);
});

benchmark('Interpreted serialization', () => {
    sink = interpretedSerializer(testData);
});

await run(1); // Run for 1 second
```

**Preventing JIT over-optimization:**
- Assign results to a module-level `sink` variable (prevents dead code elimination)
- Use varied input data across iterations (prevents loop-invariant hoisting)
- The benchmark framework could also accept a `sink` parameter internally

### 7.4 V8 Optimization Verification

```bash
# Check for deoptimizations
node --trace-deopt benchmarks/serialization.bench.ts

# Verify functions are optimized
node --trace-opt benchmarks/serialization.bench.ts

# Check inline cache states (should be monomorphic)
node --trace-ic benchmarks/serialization.bench.ts 2>&1 | grep "megamorphic"
```

### 7.5 Automated Regression Detection

```yaml
# .github/workflows/benchmark.yml
name: Performance Regression

on:
  pull_request:
    paths:
      - 'packages/type/**'
      - 'packages/bson/**'
      - 'packages/injector/**'

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci

      - name: Run benchmarks (baseline)
        run: git checkout main && npm run bench -- --json > baseline.json

      - name: Run benchmarks (PR)
        run: git checkout ${{ github.head_ref }} && npm run bench -- --json > pr.json

      - name: Check regression
        run: |
          node scripts/check-regression.js baseline.json pr.json
          # Fail if any benchmark regressed >10%
```

---

## 8. V8 Optimization Patterns

### 8.1 Hidden Classes

**Rule:** Always create objects with properties in the same order.

```typescript
// GOOD: Same hidden class for all instances
class SerializerResult {
    value: any = null;
    error: any = null;
    valid: boolean = true;
}

// BAD: Different hidden classes
function createResult(hasError: boolean) {
    const result: any = { valid: true };
    if (hasError) result.error = 'something';  // Different shape!
    return result;
}
```

### 8.2 Inline Caching

**Rule:** Functions should see the same object shapes (monomorphic).

```typescript
// GOOD: Monomorphic - always same shape
function serialize(ctx: SerializationContext, data: any) {
    ctx.buffer[ctx.offset++] = data.id;  // IC becomes monomorphic
}

// BAD: Polymorphic - different shapes
function serialize(ctx: any, data: any) {
    ctx.buffer[ctx.offset++] = data.id;  // IC becomes megamorphic
}
```

### 8.3 Function Inlining

**Rule:** Keep hot functions small (~100 bytecode instructions).

```typescript
// GOOD: Small, focused functions
function serializeString(ctx: Context, value: string): void {
    const len = value.length;
    ctx.view.setUint32(ctx.offset, len, true);
    ctx.offset += 4;
    // ... write string bytes
}

// BAD: Large functions prevent inlining
function serializeAnything(ctx: Context, value: any): void {
    // 500 lines of code handling every possible type
    // V8 won't inline this
}
```

### 8.4 Array Element Kinds

**Rule:** Keep arrays packed and homogeneous.

```typescript
// GOOD: Packed SMI array
const ids: number[] = [];
for (let i = 0; i < 100; i++) {
    ids.push(i);  // Stays PACKED_SMI_ELEMENTS
}

// BAD: Holey array
const ids = new Array(100);  // HOLEY_SMI_ELEMENTS
ids[0] = 1;
```

### 8.5 Deoptimization Triggers

Avoid these patterns in hot code:

| Pattern | Problem | Solution |
|---------|---------|----------|
| `delete obj.prop` | Forces dictionary mode | Set to `undefined` |
| Mixed types in function | Causes deopt | Use type guards |
| `arguments` object | Can prevent optimization | Use rest params |
| `eval()` | Corrupts scope | Never use |
| Out-of-bounds array access | Deopt + prototype lookup | Check bounds |

---

## 9. Implementation Roadmap

### Phase 1: Core `jit` API ✅ COMPLETE

- [x] Implement `jit.fn()`, `jit.fnJIT()`, `jit.fnExec()`, and `jit.arg()` in `@deepkit/core`
- [x] Implement `JITContext` class with expression-based code generation (no intermediate slots)
- [x] Implement `ExecContext` class (direct value flow, early return flag)
- [x] Implement chainable `Slot` interface with `get()`, `at()`, `len()` methods
- [x] Implement `SlotExpr` (JIT) and `ExecSlot` (Exec) classes
- [x] Implement `objFrom()` with object syntax support
- [x] Implement `map()` for array transformation with optimal code generation
- [x] Add runtime detection (`canJIT`, `getRuntimeCapabilities()`)
- [x] Unit tests for both modes with identical behavior (133 tests passing)
- [x] Benchmarks showing JIT matches or beats hand-written baselines

**Files:**
- `packages/core/src/jit.ts` - Core implementation
- `packages/core/tests/jit.spec.ts` - 133 tests
- `packages/core/benchmarks/jit.ts` - Basic benchmarks
- `packages/core/benchmarks/jit-realworld.ts` - Real-world scenarios

### Phase 2: Migrate Serializers

- [ ] Refactor `@deepkit/type` serializer to use `jit` API
- [ ] Refactor `@deepkit/type` validator to use `jit` API
- [ ] Refactor `@deepkit/type` type guards to use `jit` API
- [ ] Refactor `@deepkit/type` change-detector to use `jit` API
- [ ] Refactor `@deepkit/type` snapshot to use `jit` API
- [ ] Benchmark JIT vs Exec performance
- [ ] Ensure feature parity between modes

### Phase 3: Migrate BSON

- [ ] Refactor `@deepkit/bson` serializer to use `jit` API
- [ ] Refactor `@deepkit/bson` deserializer to use `jit` API
- [ ] Implement prebaked binary optimization
- [ ] Benchmark against current implementation

### Phase 4: Migrate Other Packages

- [ ] Refactor `@deepkit/injector` factory generation
- [ ] Refactor `@deepkit/http` request parser
- [ ] Refactor `@deepkit/http` router
- [ ] Refactor `@deepkit/workflow` state machine compiler
- [ ] Refactor `@deepkit/sql` row converter

### Phase 5: AOT Generator (Optional)

- [ ] Create `@deepkit/type-aot` package
- [ ] CLI for code generation
- [ ] Build tool plugins (Vite, Webpack, esbuild)

### Phase 6: Testing & Documentation

- [ ] Cross-runtime testing (Node, Deno, Bun, Cloudflare Workers)
- [ ] Performance regression CI
- [ ] Migration guide
- [ ] API documentation

---

## 10. Package.json Conditional Exports

To support different runtimes optimally:

```json
{
  "name": "@deepkit/type",
  "exports": {
    ".": {
      "worker": {
        "import": "./dist/worker/index.js",
        "require": "./dist/worker/index.cjs"
      },
      "node": {
        "import": "./dist/esm/index.js",
        "require": "./dist/cjs/index.js"
      },
      "bun": "./dist/esm/index.js",
      "deno": "./dist/esm/index.js",
      "browser": "./dist/browser/index.js",
      "default": "./dist/esm/index.js"
    }
  }
}
```

The `worker` entry point would default to interpreted mode, while `node`/`bun`/`deno` would use JIT.

---

## 11. Testing Strategy

### 11.1 Strategy Parity Tests

```typescript
describe.each([
    ['JIT', () => setStrategy('jit')],
    ['AOT', () => setStrategy('aot')],
    ['Interpreted', () => setStrategy('interpreted')],
])('%s strategy', (name, setup) => {
    beforeEach(setup);

    it('serializes primitives correctly', () => {
        expect(serialize<number>(42)).toBe(42);
        expect(serialize<string>('hello')).toBe('hello');
    });

    it('serializes objects correctly', () => {
        const user = { id: 1, name: 'John' };
        expect(serialize<User>(user)).toEqual(user);
    });

    it('validates correctly', () => {
        expect(validate<number>('not a number')).toHaveErrors();
        expect(validate<number>(42)).toBeValid();
    });

    // All tests run in each mode
});
```

### 11.2 Multi-Runtime CI

```yaml
jobs:
  test-node:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [18, 20, 22]
    steps:
      - run: npm test

  test-bun:
    runs-on: ubuntu-latest
    steps:
      - uses: oven-sh/setup-bun@v2
      - run: bun test

  test-deno:
    runs-on: ubuntu-latest
    steps:
      - uses: denoland/setup-deno@v1
      - run: deno test

  test-cloudflare:
    runs-on: ubuntu-latest
    steps:
      - run: npx wrangler dev --local &
      - run: npm run test:workers
```

---

## 12. Open Questions

1. **Should AOT be the default for production builds?**
   - Pros: Faster cold starts, guaranteed CSP compatibility
   - Cons: Requires build step, larger bundle

2. **How to handle dynamic types (generics resolved at runtime)?**
   - JIT can handle this, AOT cannot
   - The unified `jit` API handles this naturally - exec mode works for any runtime type

3. **Should we add `raw()` escape hatch?**
   - `ctx.raw('custom code')` for JIT-only optimizations
   - Would be ignored in exec mode
   - Useful for edge cases but breaks portability

4. **Exec mode `hasEarlyReturn` optimization?**
   - Currently every primitive checks the flag
   - Could optimize to only check at control flow boundaries
   - Needs benchmarking to determine if it matters

---

## 13. Related Documents

- `docs/refactor.md` - Overall refactoring plan
- `docs/ARCHITECTURE.md` - Type system architecture
- `docs/BENCHMARKS.md` - Performance tracking

---

## 14. Benchmark Results (2026-01-21)

Real-world benchmarks simulating actual Deepkit package patterns:

| Scenario | Baseline | JIT | Exec | JIT vs Baseline |
|----------|----------|-----|------|-----------------|
| @deepkit/type: Entity Serialization | 2.13M | 2.11M | 922K | ~equal |
| @deepkit/type: Union Discrimination | 27.0M | 41.3M | 1.44M | **1.53x faster** |
| @deepkit/type: Change Detection | 14.3M | 89.4M | 7.14M | **6.27x faster** |
| @deepkit/http: Request Parsing | 10.3M | 10.2M | 1.29M | ~equal |
| @deepkit/sql: Row-to-Entity | 5.48M | 5.38M | 2.83M | ~equal |
| @deepkit/sql: Batch (100 rows) | 55.7K | 55.7K | 31.1K | ~equal |
| @deepkit/injector: Factory | 17.0M | 23.0M | 5.84M | **1.35x faster** |
| @deepkit/bson: Size Calculation | 17.7M | 17.3M | 3.95M | ~equal |
| @deepkit/workflow: State Machine | 25.8M | 45.0M | 2.89M | **1.75x faster** |

**Key findings:**
- JIT always matches or beats hand-written baselines
- Loop unrolling (change detection) gives massive 6x gains
- Early return chains (union, workflow) are 1.5-1.75x faster than switch statements
- Exec mode is 2-15x slower but provides full debuggability

---

## 15. Changelog

| Date | Change |
|------|--------|
| 2026-01-21 | ✅ Phase 1 COMPLETE: Core API implemented with chainable slots, `map()`, `objFrom({})` |
| 2026-01-21 | Added real-world benchmarks for type, bson, http, sql, injector, workflow |
| 2026-01-20 | Simplified: context as first arg (no global stack), removed `jit.each()` (use regular for loops), added comparison/logical operators |
| 2026-01-20 | Final design: `jit.fn()`, natural `return`, direct value flow in exec mode, early return via flag |
| 2026-01-20 | Finalized unified `jit` API design with JITContext/ExecContext |
| 2026-01-20 | Initial document from comprehensive research |

---

## 16. Research Sources

### Performance & V8
- [Fast properties in V8](https://v8.dev/blog/fast-properties)
- [V8 Hidden Classes](https://v8.dev/docs/hidden-classes)
- [JavaScript Engine Fundamentals: Shapes and Inline Caches](https://mathiasbynens.be/notes/shapes-ics)
- [V8 JIT-less Mode](https://v8.dev/blog/jitless)

### Alternative Libraries
- [TypeBox - Dual Mode](https://github.com/sinclairzx81/typebox)
- [Ajv Standalone](https://ajv.js.org/standalone.html)
- [Typia AOT](https://typia.io/)

### CSP & Cloudflare
- [Cloudflare Workers Compatibility](https://developers.cloudflare.com/workers/runtime-apis/web-standards/)
- [CSP script-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src)
- [workerd eval Discussion](https://github.com/cloudflare/workerd/discussions/1432)

### Benchmarking
- [JavaScript Benchmarking Best Practices](https://mathiasbynens.be/notes/javascript-benchmarking)
- [V8 --trace-opt and --trace-deopt](https://v8.dev/docs/profile)
