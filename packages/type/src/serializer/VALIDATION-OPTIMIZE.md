# Validation Optimization Analysis

## Current State

**Performance:** ~45M ops/s (loose), ~23M ops/s (strict)
**Target:** ~80M ops/s (typia/ts-auto-guard level)

## Current Generated Code

```javascript
function(s0,s1){
  var s2=(s1?s1:{});           // Options object overhead
  var s3=1000;                  // Score-based validation
  if((!((typeof s0==="object")&&((!(s0===null))&&(!isArray_0(s0)))))){
    s3=0;
    if(s2.errors){              // Error collection check on every failure
      s2.errors.push(new ValidationErrorItem_0(...));
    }
  }else{
    if((!("number" in s0))){    // Nested if/else prevents optimization
      s3=0;
      if(s2.errors){...}
    }else{
      // ... more nested checks
    }
  }
  return (s3>0);                // Score comparison
}
```

## Optimal Generated Code (Target)

```javascript
function(s0){
  return (
    typeof s0 === "object" &&
    s0 !== null &&
    typeof s0.number === "number" &&
    typeof s0.negNumber === "number" &&
    typeof s0.maxNumber === "number" &&
    typeof s0.string === "string" &&
    typeof s0.longString === "string" &&
    typeof s0.boolean === "boolean" &&
    typeof s0.deeplyNested === "object" &&
    s0.deeplyNested !== null &&
    typeof s0.deeplyNested.foo === "string" &&
    typeof s0.deeplyNested.num === "number" &&
    typeof s0.deeplyNested.bool === "boolean"
  );
}
```

## Key Optimizations Needed

### 1. Fast-Path Type Guard (No Error Collection)

Create a separate code path for when errors aren't needed:

```typescript
// New: buildFastTypeGuard() - no error support, maximum speed
buildFastTypeGuard<T>(type: Type): (data: any) => data is T
```

**Implementation:**

- Single argument (no options)
- Pure boolean expressions with &&
- No score variable
- No error collection code
- Short-circuit on first failure

### 2. Flat && Chain Instead of Nested If/Else

**Current (nested):**

```javascript
if (check1) {
  if (check2) {
    if (check3) {
      return true;
    }
  }
}
return false;
```

**Optimal (flat):**

```javascript
return check1 && check2 && check3;
```

V8 optimizes flat && chains much better than nested conditionals.

### 3. Direct Property Access for Required Properties

**Current:**

```javascript
if (("number" in s0)) {
  if (typeof s0.number === "number") { ... }
}
```

**Optimal:**

```javascript
typeof s0.number === 'number'; // Accessing undefined is fine, returns "undefined"
```

For required properties, we don't need the `in` check - if the property is missing, `typeof` returns "undefined" which fails the check anyway.

### 4. Inline Primitive Checks

**Current:**

```javascript
var s4 = 0;
if (!(typeof s0.number === 'number')) {
  // error handling
} else {
  if (isNaN_0(s0.number)) {
    // error handling
  } else {
    s4 = 1000;
  }
}
```

**Optimal:**

```javascript
typeof s0.number === 'number' && !Number.isNaN(s0.number);
// Or even simpler if NaN check isn't needed:
typeof s0.number === 'number';
```

### 5. Remove Options Object Overhead

**Current:**

```javascript
function(s0,s1){
  var s2=(s1?s1:{});
  // ...
}
```

**Optimal:**

```javascript
function(s0){
  // No options, no overhead
}
```

### 6. Eliminate isArray Check for Objects

**Current:**

```javascript
typeof s0 === 'object' && s0 !== null && !isArray(s0);
```

**Optimal (if array check not needed):**

```javascript
typeof s0 === 'object' && s0 !== null;
```

Or use a single combined check:

```javascript
s0 && typeof s0 === 'object' && !Array.isArray(s0);
```

## Implementation Plan

### Phase 1: Add Fast Type Guard Builder

1. Add `buildFastTypeGuard()` method to Serializer
2. Create new handler registry for fast guards
3. Generate pure && expressions

### Phase 2: Optimize Existing Guards

1. Detect when errors aren't used and generate simpler code
2. Use lazy code paths - only generate error code if `errors` array passed

### Phase 3: API Changes

```typescript
// Current (slow - resolves type, supports errors)
is<T>(data): data is T

// New fast APIs
isFast<T>(data): data is T                    // Pre-resolved, no errors
getIsFastFunction<T>(): (data: any) => data is T  // Cached fast guard
```

## Estimated Performance After Optimization

| Optimization            | Expected Gain |
| ----------------------- | ------------- |
| Remove options object   | +10%          |
| Flat && chain           | +30%          |
| Remove `in` checks      | +10%          |
| Remove error collection | +20%          |
| Remove score variable   | +10%          |
| **Total**               | **~80%**      |

Current: 45M → Target: 80M ops/s

## Trade-offs

**Fast guard loses:**

- Detailed error messages with paths
- Partial validation (collect all errors)
- Weighted validation scores

**Fast guard keeps:**

- Type safety (returns `data is T`)
- All type checks
- Nested object validation

## Priority

This is a **lower priority** optimization because:

1. Serialization/deserialization is more commonly used
2. Current validation is "good enough" for most use cases
3. Error collection is valuable in real applications
4. The performance gap matters less for validation (usually called once per request)

Focus on serialization/deserialization first, then revisit validation.
