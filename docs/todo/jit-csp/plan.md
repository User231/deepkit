# @deepkit/type Rewrite Plan

## Goal

Rewrite `packages/type/src` JIT files using `jit.fn()` from `@deepkit/core` instead of `CompilerContext`.

**Why**:
- CSP compliance (Cloudflare Workers, strict browser CSP)
- Full debuggability in exec mode
- Cleaner architecture (no template string accumulation)

---

## ⛔ CRITICAL RULE

**NEVER use `CompilerContext`. This is the ENTIRE POINT of this rewrite.**

```typescript
// ❌ FORBIDDEN
import { CompilerContext } from '@deepkit/core';
const compiler = new CompilerContext();
compiler.context.set('helper', fn);
const code = `return ${accessor}.foo;`;
return compiler.build(code, 'data');

// ❌ FORBIDDEN
state.template += `if (${accessor}) { ... }`;

// ✅ REQUIRED - Use jit.fn() from @deepkit/core
import { jit, Context, Slot } from '@deepkit/core';

const fn = jit.fn(jit.arg<any>(), (ctx, input) => {
    ctx.when(ctx.has(input, 'foo'), () => {
        return input.get('foo');
    });
    return ctx.lit(undefined);
});
```

**If jit.fn() seems insufficient**: Extend `@deepkit/core/src/jit.ts` with new primitives. DO NOT fall back to CompilerContext.

### Before/After Example

```typescript
// ❌ OLD (CompilerContext) - This is what exists in packages/type/src/serializer.ts
const compiler = new CompilerContext();
compiler.context.set('isString', (v: any) => typeof v === 'string');
compiler.context.set('ValidationError', ValidationError);
const code = `
    if (!isString(data)) throw new ValidationError('Expected string');
    return data;
`;
return compiler.build(code, 'data');

// ✅ NEW (jit.fn()) - Rewrite to this
return jit.fn(jit.arg<any>(), (ctx, data) => {
    ctx.when(ctx.not(ctx.isType(data, 'string')), () => {
        ctx.call(throwValidationError, ctx.lit('Expected string'));
    });
    return data;
});
```

```typescript
// ❌ OLD - Tracking state with template strings
let code = 'var hasChanges = false;\n';
for (const prop of props) {
    code += `if (old.${prop} !== new.${prop}) hasChanges = true;\n`;
}
code += 'return hasChanges;';
return compiler.build(code, 'old', 'new');

// ✅ NEW - Using var_/setVar/getVar
return jit.fn(jit.arg<any>(), jit.arg<any>(), (ctx, oldObj, newObj) => {
    const hasChanges = ctx.var_(false);
    for (const prop of props) {
        ctx.when(ctx.neq(oldObj.get(prop), newObj.get(prop)), () => {
            ctx.setVar(hasChanges, ctx.lit(true));
        });
    }
    return ctx.getVar(hasChanges);
});
```

**Key insight**: The old code accumulates template strings. The new code calls ctx methods that either generate code (JIT mode) or execute directly (Exec mode).

---

## Files to Rewrite

**Important**: The PUBLIC API must stay the same. Existing tests in `packages/type/tests/` must pass without modification. Read the current implementation first to understand what functionality to replicate.

| File | Purpose | Notes |
|------|---------|-------|
| `serializer.ts` | JSON serialization | Core compile function, type handlers |
| `change-detector.ts` | ORM dirty checking | Uses var_/setVar/getVar for state tracking |
| `snapshot.ts` | ORM snapshots | Similar to serializer |
| `path.ts` | Property path resolver | Simpler, good starting point |

Files that DON'T need changes (just copy from src-old):
- `reflection/*` - Type VM, no JIT
- `validators.ts` - Constraint definitions
- `decorator*.ts` - Decorator infrastructure
- Most utility files

---

## Architecture

### Direct Switch-Based Dispatch

```typescript
function compile(type: Type, input: Slot, ctx: Context, state: CompilerState): Slot {
    // 1. Check class-specific handler (Date, Map, Set, custom)
    const classHandler = state.classHandlers.get(type.classType);
    if (classHandler) return classHandler(type, input, ctx, state);

    // 2. Direct switch on type.kind - NO registry lookup
    switch (type.kind) {
        case ReflectionKind.string: return compileString(type, input, ctx, state);
        case ReflectionKind.number: return compileNumber(type, input, ctx, state);
        case ReflectionKind.union: return compileUnion(type, input, ctx, state);
        // ...
    }
}
```

### TypeHandler Signature

```typescript
type TypeHandler<T extends Type = Type> = (
    type: T,
    input: Slot<any>,
    ctx: Context,
    state: CompilerState
) => Slot<any>;
```

### CompilerState Interface

```typescript
interface CompilerState {
    readonly target: 'serialize' | 'deserialize' | 'validate';
    readonly loose: boolean;
    readonly serializer: Serializer;
    readonly path: string[];

    // Recursion
    compile(type: Type, input: Slot): Slot;
    fork(segment: string | number): CompilerState;

    // Errors
    addError(code: string, message: string, value: Slot): void;

    // External values
    extern<T>(value: T): Slot<T>;
}
```

---

## Discriminated Union Optimization

For unions like `{ kind: 'circle', r: number } | { kind: 'square', s: number }`:

**Old approach**: Score ALL members → O(n × properties)
**New approach**: Detect discriminator → O(1) map lookup

```typescript
function detectDiscriminator(union: TypeUnion): DiscriminatorInfo | undefined {
    // Find property where all members have DISTINCT literal values
    for (const [property, valueMap] of candidates) {
        if (valueMap.size === union.types.length) {
            return { property, valueToMember: valueMap };
        }
    }
    return undefined;
}

function compileUnion(type: TypeUnion, input: Slot, ctx: Context, state: CompilerState): Slot {
    // Priority 1: Discriminated union (O(1) routing)
    const discriminator = detectDiscriminator(type);
    if (discriminator) {
        return compileDiscriminatedUnion(type, discriminator, input, ctx, state);
    }

    // Priority 2: Pure literal union (Set lookup)
    // Priority 3: Primitive union (typeof chain)
    // Priority 4: Complex union (scoring fallback)
}
```

---

## Matching Levels (Preserved Specificality)

For union disambiguation and type coercion:

| Level | Name | Use Case |
|-------|------|----------|
| 1 | STRICT | Exact type match (typeof checks) |
| 0-1 | NORMAL | Standard JSON conversions (ISO string → Date) |
| >1 | FALLBACK | Lower priority (number → Date as timestamp) |
| <0 | LOOSE | Aggressive coercion ('1234' → number) |

---

## Extension Points

```typescript
class Serializer {
    // Class-specific handlers (Date, Map, Set, Buffer)
    forClass(classType: ClassType, handler: TypeHandler): this;

    // Annotation handlers (UUID, Reference, Embedded)
    forAnnotation(annotation: AnnotationDefinition, handler: TypeHandler): this;
}
```

**BSON**: Needs separate architecture (binary output, two-pass). Keep existing for now.
**SQL**: Can extend new Serializer (outputs JSON strings).

---

## jit.ts Primitives Available

Core primitives in `@deepkit/core/src/jit.ts`:

| Primitive | Purpose |
|-----------|---------|
| `ctx.obj()`, `ctx.arr()`, `ctx.lit()` | Create values |
| `ctx.get()`, `ctx.set()`, `ctx.has()` | Property access |
| `ctx.when()`, `ctx.loop()`, `ctx.map()` | Control flow |
| `ctx.eq()`, `ctx.neq()`, `ctx.lt()`, `ctx.gt()` | Comparison |
| `ctx.isType()`, `ctx.isNull()`, `ctx.isNullish()` | Type checks |
| `ctx.call()`, `ctx.new_()` | Function calls |
| `ctx.var_()`, `ctx.setVar()`, `ctx.getVar()` | Mutable state tracking |
| `ctx.switch_()` | Switch statement |
| `ctx.ternary()` | Inline conditional |
| `ctx.isInstance()` | instanceof check |

If you need something not listed, **extend jit.ts** - don't use CompilerContext.

---

## Verification

```bash
# Build
npm run tsc

# Test
npm run test packages/type/

# Benchmark (must be < 10% regression)
cd benchmarks && npm run benchmark -- --compare-baseline
```
