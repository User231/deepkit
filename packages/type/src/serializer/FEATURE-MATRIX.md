# Feature Matrix Analysis

## Typia Implementations (Reference)

From typescript-runtime-type-benchmarks, here's exactly what typia uses:

| Benchmark        | Typia Code                 | Description                                            |
| ---------------- | -------------------------- | ------------------------------------------------------ |
| **assertLoose**  | `is(data)` → `true`        | Loose type check, return boolean                       |
| **assertStrict** | `equals(data)` → `true`    | Strict type check (rejects extra keys), return boolean |
| **parseSafe**    | `is(data)` + `clone(data)` | Loose validate, then clone object                      |
| **parseStrict**  | `equals(data)` → `data`    | Strict validate, return original                       |

Key insight: typia uses just 3 functions:

- `is()` - loose validation (ignores extra keys)
- `equals()` - strict validation (rejects extra keys)
- `clone()` - create new object with only declared properties

---

## Benchmark Categories (typescript-runtime-type-benchmarks)

### 1. Assert Loose

**Input:** `unknown` → **Output:** `boolean` (or throw)
**Behavior:**

- Check types match schema
- **IGNORE** extra/unknown keys
- Throw on missing required keys
- Throw on wrong types
- Returns `true` if valid

**Use case:** Fast validation when you trust the source won't have malicious extra keys

### 2. Assert Strict

**Input:** `unknown` → **Output:** `boolean` (or throw)
**Behavior:**

- Check types match schema
- **THROW** on extra/unknown keys
- Throw on missing required keys
- Throw on wrong types
- Returns `true` if valid

**Use case:** Strict validation for untrusted input

### 3. Parse Safe

**Input:** `unknown` → **Output:** `T` (new object)
**Behavior:**

- Check types match schema
- **STRIP** extra/unknown keys (don't include in output)
- Throw on missing required keys
- Throw on wrong types
- Returns **new object** with only declared properties

**Use case:** Sanitize untrusted input, remove `__proto__` attacks

### 4. Parse Strict

**Input:** `unknown` → **Output:** `T` (new object)
**Behavior:**

- Check types match schema
- **THROW** on extra/unknown keys
- Throw on missing required keys
- Throw on wrong types
- Returns **new object** with only declared properties

**Use case:** Strict parsing that rejects any unexpected data

---

## Feature Dimensions

| Dimension           | Options                                         |
| ------------------- | ----------------------------------------------- |
| **Output**          | `boolean` (assert) vs `T` (parse/return object) |
| **Unknown keys**    | ignore / strip / throw                          |
| **Type coercion**   | none / loose (string→number, etc.)              |
| **Error reporting** | throw-only / collect errors array               |
| **Object creation** | none (assert) / plain object / class instance   |

---

## Deepkit Current Features

### Serialize (internal → external)

- Input: Class instance or typed object
- Output: Plain JSON-compatible object
- Features: naming strategy, groups, exclude
- **No validation** (trusts input is typed)

### Deserialize (external → internal)

- Input: `unknown` (external data)
- Output: Plain object OR class instance
- Features:
  - Type coercion (`loosely` option)
  - Error throwing on invalid types
  - Creates new object (strips unknown keys)
  - Can create class instances

### Validate / Type Guard

- Input: `unknown`
- Output: `boolean` + optional error array
- Features:
  - Type checking
  - Error collection with paths
  - Loose vs strict mode

---

## Mapping Deepkit → Benchmark Categories

| Benchmark         | Deepkit Equivalent     | Notes                           |
| ----------------- | ---------------------- | ------------------------------- |
| **Assert Loose**  | `is<T>(data)`          | Type guard, ignore unknown keys |
| **Assert Strict** | ❌ Not implemented     | Need to check for unknown keys  |
| **Parse Safe**    | `deserialize<T>(data)` | Creates object, strips unknown  |
| **Parse Strict**  | ❌ Not implemented     | Need to throw on unknown keys   |

---

## Current Deepkit Public API

### typeguard.ts

```typescript
is<T>(data, serializer?, errors?, type?): data is T
getValidatorFunction<T>(serializer?, type?): Guard<T>
guard<T>(serializer?, type?): Guard<T>
assert<T>(data, serializer?, type?): asserts data is T
```

### serializer-facade.ts

```typescript
deserialize<T>(data, options?, serializer?, namingStrategy?, type?): T
deserializeFunction<T>(serializer?, namingStrategy?, type?): SerializeFunction
cast<T>(data, options?, serializer?, namingStrategy?, type?): T  // deserialize + assert
castFunction<T>(serializer?, namingStrategy?, type?): (data) => T
serialize<T>(data, options?, serializer?, namingStrategy?, type?): JSONSingle<T>
serializeFunction<T>(serializer?, namingStrategy?, type?): SerializeFunction
```

---

## Problems with Current Deepkit Implementation

### 1. `is<T>()` is slow

```typescript
// Current: resolves type EVERY call
export function is<T>(data: any, serializer = serializer, errors = [], type?) {
  const fn = getValidatorFunction(serializerToUse, receiveType); // ← type resolution!
  return fn(data, { errors });
}
```

**Fix**: Use `getValidatorFunction<T>()` for benchmarks (pre-compute function).

### 2. "Loose" validation is NOT actually fast

**Critical finding**: `createTypeGuardFunction(type, serializer, true)` does NOT generate a simple && chain.

Generated "loose" code (6561 chars):

```javascript
function(s0,s1){
var s2=(s1?s1:{});        // Options object
var s3=1000;              // Score tracking
if((!((typeof s0==="object")&&...))){
s3=0;
if(s2.errors){            // Error collection
s2.errors.push(new ValidationErrorItem_0(...));
}
}else{
if((!("number" in s0))){ // `in` check
...
```

Optimal code (pure && chain, ~200 chars):

```javascript
return typeof s0 === "object" && s0 !== null &&
       typeof s0.number === "number" && ...
```

The `withLoose` parameter controls which TYPE GUARDS to use (loose vs strict union resolution), NOT the code structure. Both modes generate:

- Score tracking (`var s3=1000;`)
- Error collection (`if(s2.errors)`)
- `in` checks
- Null checks

This is why Deepkit validation is **32% of optimal** (35M vs 111M ops/s).

### 3. `deserialize` has runtime option overhead

```typescript
// Generated code has runtime checks:
var s2 = s1 ? s1 : {};
if (s2.loosely !== false) {
  /* coercion logic */
}
```

This 5-10% overhead happens on EVERY property.

### 4. No unknown key checking

Neither validation nor parsing can reject extra keys:

- `is<T>({a:1, b:2, EXTRA:3})` → `true` (ignores extra)
- `deserialize<T>({a:1, b:2, EXTRA:3})` → `{a:1, b:2}` (strips extra)

There's no way to **throw** on extra keys (assertStrict, parseStrict).

### 5. Type coercion always included

Even with `loosely: false`, the generated code still has coercion infrastructure.
Need separate JIT function without ANY coercion code.

---

## Proposed Optimal API

To match benchmark categories with maximum performance:

```typescript
// ============================================================
// ASSERT (returns boolean, no object creation)
// ============================================================

// Assert Loose - FASTEST (simple && chain, no error collection)
isFast<T>(data: unknown): data is T

// Assert Loose with errors
is<T>(data: unknown, errors?: ValidationError[]): data is T

// Assert Strict (throw on unknown keys)
isStrict<T>(data: unknown): data is T

// ============================================================
// PARSE (returns new object T)
// ============================================================

// Parse Safe - strips unknown keys, no coercion
parse<T>(data: unknown): T

// Parse Safe with coercion
parseLoose<T>(data: unknown): T  // or: parse<T>(data, { loose: true })

// Parse Strict - throws on unknown keys
parseStrict<T>(data: unknown): T

// ============================================================
// SERIALIZE (typed input → plain output)
// ============================================================

// Already optimal
serialize<T>(data: T): unknown
```

---

## Implementation Strategy

### For Maximum Performance

Each operation should have its own JIT-compiled function:

1. **`isFast<T>`** - Pure && chain, no errors, no options

   ```javascript
   function(s0) {
     return typeof s0 === "object" && s0 !== null &&
            typeof s0.number === "number" && ...
   }
   ```

2. **`parse<T>`** (safe) - Object literal, no coercion, no unknown key check

   ```javascript
   function(s0) {
     if (typeof s0 !== "object" || s0 === null) throw ...;
     return {
       number: s0.number,  // direct access, no coercion
       string: s0.string,
       ...
     };
   }
   ```

3. **`parseLoose<T>`** - Object literal with coercion

   ```javascript
   function(s0) {
     if (typeof s0 !== "object" || s0 === null) throw ...;
     return {
       number: typeof s0.number === "number" ? s0.number : Number(s0.number),
       ...
     };
   }
   ```

4. **`parseStrict<T>`** - Check for unknown keys first
   ```javascript
   function(s0) {
     if (typeof s0 !== "object" || s0 === null) throw ...;
     const keys = Object.keys(s0);
     if (keys.length !== 3 || !keys.every(k => k in expected)) throw ...;
     return { number: s0.number, ... };
   }
   ```

---

## Key Insight: Separate JIT Functions

Current problem: One function tries to handle all cases with runtime options:

```javascript
function(s0, s1) {
  var opts = s1 || {};
  if (opts.loosely !== false) { ... }  // Runtime check on every property!
}
```

Solution: Generate separate functions for each mode:

- `deserialize_loose` - with coercion
- `deserialize_strict` - without coercion
- `validate_fast` - pure boolean
- `validate_with_errors` - collects errors

The options determine WHICH function to call, not runtime behavior within one function.

---

## Priority Implementation Order

1. **`parse<T>`** (Parse Safe without coercion) - Most common benchmark case
2. **`isFast<T>`** (Assert Loose) - Pure validation
3. **`parseStrict<T>`** - For strict mode
4. **`isStrict<T>`** - For strict validation

Keep existing `cast<T>` and `deserialize<T>` for backwards compatibility with coercion.

---

## Detailed Implementation Plan

### Phase 0: Fast Type Guard (Pure && Chain)

**Priority #1**: Create a new validation mode that generates pure && chain code.

```typescript
// New mode in BuildState
const state = new BuildState('validate', this, ctx, optionsSlot, guardRegistry, {
  validation: 'fast', // NEW: pure && chain, no score, no errors
});
```

**Generated code target**:

```javascript
function(s0){
  return typeof s0 === "object" && s0 !== null && !Array.isArray(s0) &&
         typeof s0.number === "number" &&
         typeof s0.negNumber === "number" &&
         typeof s0.maxNumber === "number" &&
         typeof s0.string === "string" &&
         typeof s0.longString === "string" &&
         typeof s0.boolean === "boolean" &&
         typeof s0.deeplyNested === "object" && s0.deeplyNested !== null &&
         typeof s0.deeplyNested.foo === "string" &&
         typeof s0.deeplyNested.num === "number" &&
         typeof s0.deeplyNested.bool === "boolean";
}
```

**Changes required**:

1. Add `validation: 'fast'` mode to `BuildState.options`
2. In fast mode, skip:
   - Score tracking (`var s3=1000;`)
   - Error collection (`if(s2.errors)`)
   - Options object (`var s2=(s1?s1:{});`)
   - `in` checks for required properties
   - Null checks for non-nullable properties
3. Return early `false` instead of score decrement
4. Chain all checks with `&&` for short-circuit evaluation

**Expected result**: 100% of optimal (~111M ops/s)

---

### Phase 1: Benchmark-Optimized API (New Functions)

Create new functions that match benchmark requirements exactly:

```typescript
// === VALIDATION (boolean return) ===

// Assert Loose - for typescript-runtime-type-benchmarks assertLoose
// JIT: Pure && chain, no error collection, no options
export function createIsLooseFunction<T>(): (data: unknown) => data is T;
export function isLoose<T>(data: unknown): data is T; // convenience wrapper

// Assert Strict - for assertStrict benchmark (FUTURE)
// JIT: && chain + Object.keys check
export function createIsStrictFunction<T>(): (data: unknown) => data is T;
export function isStrict<T>(data: unknown): data is T;

// === PARSING (returns new object) ===

// Parse Safe - for parseSafe benchmark
// JIT: Object literal clone, no coercion, no unknown key check
export function createParseFunction<T>(): (data: unknown) => T;
export function parse<T>(data: unknown): T;

// Parse Strict - for parseStrict benchmark (FUTURE)
// JIT: Object.keys check + object literal clone
export function createParseStrictFunction<T>(): (data: unknown) => T;
export function parseStrict<T>(data: unknown): T;
```

### Phase 2: Registry-Based Mode Selection

Instead of runtime options, use separate registries:

```typescript
// serializer/index.ts
export const serializer = {
  // Existing
  serializeRegistry: new HandlerRegistry('serialize'),
  deserializeRegistry: new HandlerRegistry('deserialize'), // with coercion
  validationRegistry: new HandlerRegistry('validate'), // score-based

  // New: benchmark-optimized
  parseRegistry: new HandlerRegistry('parse'), // no coercion, object literal
  isLooseRegistry: new HandlerRegistry('isLoose'), // pure && chain
  isStrictRegistry: new HandlerRegistry('isStrict'), // && chain + unknown key check
};
```

### Phase 3: JIT Function Variants

Each registry generates different code:

| Registry      | Generated Code Pattern                                                            |
| ------------- | --------------------------------------------------------------------------------- |
| `isLoose`     | `return typeof s0 === "object" && s0 !== null && typeof s0.a === "number" && ...` |
| `isStrict`    | Same as isLoose + `&& Object.keys(s0).every(k => k in expected)`                  |
| `parse`       | `return { a: s0.a, b: s0.b, ... }`                                                |
| `parseStrict` | Unknown key check + object literal                                                |
| `deserialize` | Full coercion logic (existing)                                                    |

### Current Performance (2025-01 Benchmark)

Tested with `benchmarks/optimal-comparison.ts`:

| Operation                | Optimal | Deepkit | % of Optimal | Status          |
| ------------------------ | ------- | ------- | ------------ | --------------- |
| **Type Guard**           | 111M    | 36M     | 32%          | 🔴 Major gap    |
| **Serialize**            | 12M     | 12M     | 97%          | ✅ Optimal      |
| **Deserialize (clone)**  | 17M     | 12M     | 73%          | 🟡 Has overhead |
| **Cast (with coercion)** | N/A     | 2.5M    | -            | Unique feature  |

**Key Finding**: Type guard is the biggest performance gap (68% slower than optimal).

The type guard generates 6561 chars of code with score tracking and error collection,
while optimal is ~200 chars of pure && chain.

### Performance Targets

| Operation   | Target      | Current    | Gap | Priority |
| ----------- | ----------- | ---------- | --- | -------- |
| assertLoose | ~111M ops/s | ~36M ops/s | 68% | **P0**   |
| parseSafe   | ~17M ops/s  | ~12M ops/s | 29% | P1       |
| serialize   | ~12M ops/s  | ~12M ops/s | 0%  | ✅ Done  |

The main gap is in validation (need pure && chain without score-based error collection).

---

## Mapping to Benchmark Test Requirements

### assertLoose Tests

1. ✅ Valid data → `true`
2. ✅ Valid + extra keys → `true` (ignore extra)
3. ✅ Valid + nested extra keys → `true` (ignore extra in nested)
4. ✅ Missing required → throw
5. ✅ Wrong type → throw

**Deepkit Implementation**: `isLoose<T>()` with pure && chain

### assertStrict Tests

1. ✅ Valid data → `true`
2. ❌ Valid + extra keys → throw
3. ❌ Valid + nested extra keys → throw
4. ✅ Missing required → throw
5. ✅ Wrong type → throw

**Deepkit Implementation**: `isStrict<T>()` with Object.keys check

### parseSafe Tests

1. ✅ Valid data → cloned T
2. ✅ Valid + extra keys → cloned T without extra
3. ✅ Valid + nested extra keys → cloned T without extra
4. ✅ Missing required → throw
5. ✅ Wrong type → throw

**Deepkit Implementation**: `parse<T>()` - already works via deserialize (strips unknown)

### parseStrict Tests

1. ✅ Valid data → cloned T
2. ❌ Valid + extra keys → throw
3. ❌ Valid + nested extra keys → throw
4. ✅ Missing required → throw
5. ✅ Wrong type → throw

**Deepkit Implementation**: `parseStrict<T>()` with Object.keys check + clone
