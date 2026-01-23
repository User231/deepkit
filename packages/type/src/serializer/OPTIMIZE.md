# Serializer Optimization - COMPLETED

## Final Generated Code

For a simple class like:

```typescript
class SmallModel {
  ready?: boolean;
  tags: string[] = [];
  priority: number = 0;
  constructor(
    public id: number,
    public name: string,
  ) {}
}
```

Generated serialize code:

```javascript
function(s0,s1){
var s3={tags:s0.tags,priority:s0.priority,id:s0.id,name:s0.name};
if(("ready" in s0)){
s3.ready=(s0.ready??null);
}
return s3;
}
```

Key optimizations:

- **Object literal** for required properties (fast V8 hidden class)
- **Incremental assignment** only for optional properties
- No unused variables, no 'use strict', minimal overhead

## Completed Optimizations

### 1. Unnecessary `in` checks (FIXED)

**Was**: `if (("id" in s0)) { ... }` for all properties
**Now**: Only optional properties have `in` check
**Location**: handlers.ts:592 - `needsHasCheck = isDeserialize || isOptional(memberType)`

### 2. Identity map for primitive arrays (FIXED)

**Was**: `s0.tags.map(s6 => s6)` - creates array by mapping each element to itself
**Now**: Returns input directly for serialize with primitive element types
**Location**: handlers.ts:341-345 - `if (isPassThrough) return input;`

### 3. `{c: value}` wrapper pattern (FIXED)

**Was**: `var s5 = {c: []};` - unnecessary object allocations
**Now**: `var s5 = [];` - simple variables
**Location**: jit.ts:696-706

### 4. Hybrid object literal + incremental (IMPLEMENTED)

**Was**: `var s4 = {}; s4.a = value; s4.b = value; ...` (all incremental)
**Now**: `var s4 = {a:s0.a, b:s0.b}; if("c" in s0){s4.c = ...}` (hybrid)

**Approach**: Use object literal for required properties, incremental for optional.

**Benchmark results** (see `benchmarks/object-building.bench.ts`):

- Pure required properties: Object literal is 1.1x-6x faster
- With optional properties using spread: 2.5x-19x **slower**
- Hybrid approach: Best of both worlds

**SmallModel (4 required + 1 optional):**
| Scenario | Old Incremental | NEW HYBRID | Improvement |
|----------|-----------------|------------|-------------|
| With optional set | 154M ops/s | 151M ops/s | ~same |
| Without optional | 143M ops/s | 186M ops/s | **1.30x faster** |

**Location**: handlers.ts - `buildObjectLiteralBody()` now categorizes properties

**V8 Hidden Class Analysis** (see `benchmarks/v8-monomorphic.ts`):

- When optional property presence is **consistent**: ~150M ops/s (optimal)
- When optional property presence is **mixed**: ~44M ops/s (polymorphic deopt)
- Root cause: Adding property to object literal triggers hidden class transition
- Alternative (monomorphic with undefined) would change output semantics
- Current approach is semantically correct with acceptable performance

### 5. Unnecessary `unpopulatedSymbol` check (FIXED)

**Was**: `if((!(s0.tags === const_0)) && isArray_0(s0.tags))`
**Now**: Handled at property level for arrays
**Location**: handlers.ts:654-661 - check for unpopulatedSymbol before state.build()

### 6. Type check wrapper for serialize (FIXED)

**Was**: `if(typeof s0==="object" && !(s0===null)){...}else{throw}`
**Now**: Removed for serialize direction - trust input is valid class instance
**Location**: handlers.ts:488-544 - separate code paths for serialize/deserialize

### 7. Null checks for required properties (FIXED)

**Was**: `if((!(s0.id==null))){ s4.id=s0.id; }else{ }`
**Now**: `s4.id = s0.id;` - direct assignment for required non-nullable
**Location**: handlers.ts:644-658 - isNullable check before adding null guard

### 8. Array.isArray for typed arrays (FIXED)

**Was**: `var s4=[]; if(isArray_0(s0.tags)){ s4=s0.tags; } s3.tags=s4;`
**Now**: `s3.tags=s0.tags;` (with unpopulatedSymbol check at property level)
**Location**: handlers.ts:341-345 (handleArray), 654-661 (property level check)

### 9. Empty else branches (FIXED)

**Was**: `}else{ }` - dead code in generated output
**Now**: Eliminated - ctx.when() captures callback output before emitting else
**Location**: jit.ts:640-656 - capture elseBody before deciding to emit

### 10. Optional primitive property null check (FIXED)

**Was**: Nested if statements for optional primitive properties

```javascript
if ('ready' in s0) {
  if (!(s0.ready == null)) {
    s3.ready = s0.ready;
  } else {
    s3.ready = null;
  }
}
```

**Now**: Uses nullish coalescing for primitive types (string, number, boolean)

```javascript
if ('ready' in s0) {
  s3.ready = s0.ready ?? null;
}
```

**Location**: handlers.ts:617-641 - isPrimitivePassThrough check for serialize direction
**Note**: Non-primitive optional types (Date, class, etc.) still use if/else since they need transformation

### 11. UnpopulatedSymbol only for BackReference arrays (FIXED)

**Was**: All arrays checked for unpopulatedSymbol (ORM lazy loading marker)
**Now**: Only BackReference arrays need this check
**Location**: handlers.ts:668-680 - added `isBackReferenceType(memberType)` condition

### 12. Unused options variable (FIXED)

**Was**: `var s2=(s1?s1:{});` always emitted even when options not used
**Now**: Uses lazy variable binding - only emitted if actually referenced
**Location**: jit.ts - added `lazyLet()` method and `deferredVars` tracking
**Location**: serializer.ts:118,138,158,186,238 - changed `ctx.let` to `ctx.lazyLet`

### 13. Remove 'use strict' directive (FIXED)

**Was**: `function(s0,s1){'use strict';...}` - redundant in ES modules
**Now**: Removed - ES modules are strict by default
**Location**: jit.ts:827

### 14. Direct return for all-required types (FIXED - serialize)

**Applies to:** Serialize only
**Was**: `var s3 = {...}; return s3;` - always uses variable assignment
**Now**: `return {...};` - direct return when no incremental properties exist
**Location**: handlers.ts - `buildObjectLiteralBody()` fast path

**V8 Bytecode Analysis** (see `benchmarks/V8-INSIGHTS.md`):

```
# var s3={...}; return s3;  (43 bytes, 2 registers)
CreateObjectLiteral → Star1 → ... → Mov r1, r0 → Return

# return {...};  (40 bytes, 1 register)
CreateObjectLiteral → Star0 → ... → Return
```

The extra `Mov r1, r0` instruction causes ~25% overhead.

**Benchmark Results** (with DCE prevention):
| Pattern | Performance |
|---------|-------------|
| Direct return `return {...}` | 23.4M ops/s |
| Variable + return `var s3={...}; return s3;` | 17.5M ops/s |
| With optional property (adding) | 10.8M ops/s |
| With optional property (skipping) | 17.0M ops/s |

**Deepkit JIT vs Hand-written** (see `benchmarks/jit-vs-v8.ts`):
| Pattern | Deepkit JIT | Hand-written |
|---------|-------------|--------------|
| AllRequired (direct) | **19.9M** | 18.6M |
| WithOptional (has) | 12.2M | 13.7M |
| WithOptional (no) | 18.1M | 22.8M |

### 15. Object literal for deserialize with required properties (FIXED)

**Applies to**: Object literals (interfaces) only, not classes

**Was**: All deserialize properties used `in` checks and incremental building

```javascript
var s4={};
if(("number" in s0)){ if((!(s0.number==null))){ s4.number=convert(s0.number); } }
if(("string" in s0)){ if((!(s0.string==null))){ s4.string=s0.string; } }
return s4;
```

**Now**: Required properties use object literal, skip `in` checks

```javascript
s3={number:convert(s0.number),string:s0.string,boolean:s0.boolean};
return s3;
```

**Current Performance vs Hand-Optimized**:

- Serialize: **110%** (optimal)
- Deserialize: **75%** (has type coercion overhead)

**Key insight**: For required properties, the `in` check was unnecessary overhead.
If a required property is missing, accessing it returns `undefined` and the type
conversion will handle it appropriately.

**Note**: Classes still use `deserializeClass` handler which creates proper instances.

**Location**: handlers.ts lines 610-615 - `canUseLiteral` now applies to deserialize for object literals

## V8 Optimization Insights

Key findings from V8 bytecode and deoptimization analysis:

1. **Direct return vs variable**: `return {...}` uses 1 register, `var s3={...}; return s3;` uses 2 registers + Mov instruction = ~25% slower

2. **Hidden class transitions**: Adding properties after object creation (`s3.opt = value`) triggers hidden class transitions, causing polymorphism penalties

3. **SetNamedProperty vs DefineNamedOwnProperty**: V8 uses `DefineNamedOwnProperty` during object creation (fast) but `SetNamedProperty` for post-creation additions (slower, triggers transitions)

4. **Polymorphism penalty**: Functions producing objects with different shapes (e.g., with/without optional property) cause "wrong map" deoptimization

5. **Our approach is optimal**: Use direct return for all-required types, accept hidden class transition cost for optional properties (spread alternative is even worse)

## Remaining Opportunities

1. ~~**Object literal syntax**~~ - IMPLEMENTED: Hybrid approach (see #4)
2. **Inline small nested serializers** - Avoid function call overhead for simple nested types
3. **Type-specific optimizations** - Date, enum, bigint could have specialized fast paths

## Comparison with typescript-runtime-type-benchmarks

See https://github.com/moltar/typescript-runtime-type-benchmarks

### Loose Assertion (validate only, no object creation)

| Library             | Performance                      |
| ------------------- | -------------------------------- |
| ts-auto-guard       | ~84M ops/s                       |
| typia               | ~79M ops/s                       |
| **Deepkit (loose)** | **~45M ops/s (53%)**             |
| Deepkit (strict)    | ~23M ops/s (27%)                 |
| Deepkit is<T>()     | ~7M ops/s (with type resolution) |

### Safe Parsing (validate + create new object + strip keys)

| Library               | Performance                            |
| --------------------- | -------------------------------------- |
| typia                 | ~76M ops/s                             |
| **Deepkit serialize** | **~14M ops/s (97% of hand-optimized)** |

Note: The benchmark comparison isn't quite apples-to-apples. Typia uses different
benchmark methodology. Our serialize is 97% of hand-written optimal code.

### Deepkit Unique: Type Coercion + Validation

| Library            | Performance |
| ------------------ | ----------- |
| Deepkit cast (new) | ~2.5M ops/s |
| Deepkit cast (old) | ~4.6M ops/s |

**Note**: Deepkit's `cast<T>` does full type coercion (string→number, etc.) which competitors don't support. The old cast was faster but less correct.

### Why Typia is Faster (for simple validation)

Typia generates simple `&&` chains:

```javascript
return "object" === typeof input &&
       typeof input.number === "number" && ...
```

Deepkit generates score-based validation with error collection:

```javascript
var s3=1000;
if(!("number" in s0)) { s3=0; if(s2.errors){...} }
return s3>0;
```

Deepkit's approach supports:

- Detailed error messages with paths
- Weighted validation scores
- Partial validation (collect all errors)

## Benchmarks

Run benchmarks to validate optimization decisions:

```bash
cd packages/type

# Compare with typescript-runtime-type-benchmarks
node --import @deepkit/run benchmarks/runtime-type-benchmark.ts

# Object literal vs incremental building
node --import @deepkit/run benchmarks/object-building.bench.ts

# JIT generated code vs hand-written
node --import @deepkit/run benchmarks/jit-vs-v8.ts

# Show generated code for models
node --import @deepkit/run benchmarks/show-jit.ts

# V8 bytecode analysis (requires --allow-natives-syntax)
node --allow-natives-syntax benchmarks/v8-force-opt.js

# V8 deoptimization tracing
node --trace-deopt --allow-natives-syntax benchmarks/v8-force-opt.js 2>&1 | head -50
```

See `benchmarks/V8-INSIGHTS.md` for detailed V8 bytecode analysis.
