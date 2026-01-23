# Deserialize Optimization Plan

## Status: PARTIALLY IMPLEMENTED

**Before:** ~11M ops/s (with `in` checks)
**After:** ~12M ops/s (object literal)
**vs Hand-optimized:** 75%

The main optimization (skip `in` checks, use object literal) has been implemented
for object literals (interfaces). Classes still use the proper `deserializeClass`
handler that creates instances.

**Remaining gap (25%)** is due to:

- Options object handling `var s2=(s1?s1:{})`
- Type coercion checks `s2.loosely!==false`
- Temporary variables for coercion logic

## Overhead Analysis

| Layer                    | Performance | % of Baseline | Overhead |
| ------------------------ | ----------- | ------------- | -------- |
| Baseline (direct return) | 37.4M       | 100%          | -        |
| + options arg            | 33.2M       | 89%           | 11%      |
| **+ in checks**          | **22.8M**   | **61%**       | **39%**  |
| + null checks            | 21.2M       | 57%           | 4%       |
| + type/loosely checks    | 25.4M       | 68%           | -        |
| Deepkit actual           | 23.6M       | 63%           | 37%      |

**The `in` checks are the biggest bottleneck**, causing 39% overhead!

## Current Generated Code (Simple)

```javascript
function(s0,s1){
  var s2=(s1?s1:{});
  var s3=undefined;
  if(((typeof s0==="object")&&(!(s0===null)))){
    var s4={};
    if(("number" in s0)){                    // <-- `in` check overhead
      if((!(s0.number==null))){              // <-- null check overhead
        var s5=false;
        if(((s2.loosely!==false)&&(typeof s0.number==="string"))){  // <-- runtime loosely check
          s5=isSignedNumericString_0(s0.number);
        }
        s4.number=((typeof s0.number==="number")?s0.number:...);
      }
    }
    // ... repeat for each property
    s3=s4;
  }else{
    throw validationErrorCreate_0(...);
  }
  return s3;
}
```

## Optimization 1: Skip `in` Checks for Required Properties

For **required non-nullable properties**, the `in` check is unnecessary:

```javascript
// Current (slow)
if ('number' in s0) {
  if (!(s0.number == null)) {
    s4.number = s0.number;
  }
}

// Optimized (fast)
if (s0.number == null) throw new Error('number required');
s4.number = s0.number;

// Or even simpler for primitives
s4.number = s0.number; // Will be undefined if missing, validation can catch later
```

**Expected gain: +20-30%**

## Optimization 2: Compile-Time Loosely Mode

Currently, `loosely` is checked at runtime for every property:

```javascript
if(((s2.loosely!==false)&&(typeof s0.number==="string"))){...}
```

Create two separate deserialize functions:

- `deserializeStrict` - no type coercion, fastest
- `deserializeLoose` - with type coercion

```javascript
// Strict mode (compile-time)
function deserializeStrict(s0) {
  return {
    number: typeof s0.number === 'number' ? s0.number : throwTypeError(),
    string: s0.string,
    boolean: s0.boolean,
  };
}
```

**Expected gain: +10-15%**

## Optimization 3: Object Literal Output (Like Serialize)

For types with all required properties, use object literal:

```javascript
// Current (incremental)
var s4={};
s4.number = s0.number;
s4.string = s0.string;
s4.boolean = s0.boolean;
return s4;

// Optimized (literal)
return {
  number: s0.number,
  string: s0.string,
  boolean: s0.boolean
};
```

**Expected gain: +25%** (same as serialize optimization)

## Optimization 4: Fast Path for Valid Primitives

When input is already the correct type, skip all conversion logic:

```javascript
// Current
var s5=false;
if(((s2.loosely!==false)&&(typeof s0.number==="string"))){
  s5=isSignedNumericString_0(s0.number);
}
s4.number=((typeof s0.number==="number")?s0.number:...);

// Optimized (check correct type first)
s4.number = typeof s0.number === "number" ? s0.number : convertNumber(s0.number, s2);
```

**Expected gain: +5-10%**

## Optimization 5: Remove Options Object When Not Needed

If no options are used, don't create the options object:

```javascript
// Current
function(s0,s1){
  var s2=(s1?s1:{});  // Always created
  ...
}

// Optimized (when options not used)
function(s0){
  ...
}
```

Already partially implemented via `lazyLet`, but can be improved.

**Expected gain: +5%**

## Implementation Priority

| Optimization                  | Expected Gain | Complexity | Status            |
| ----------------------------- | ------------- | ---------- | ----------------- |
| Skip `in` checks for required | +25%          | Medium     | **DONE**          |
| Object literal output         | +25%          | Medium     | **DONE**          |
| Compile-time loosely          | +10%          | High       | Future            |
| Fast path primitives          | +10%          | Low        | Future            |
| Remove options when unused    | +5%           | Low        | Partial (lazyLet) |

## Target Generated Code

```javascript
// Simple type (all required, no conversion needed)
function(s0){
  if(typeof s0 !== "object" || s0 === null) throw typeError();
  return {
    number: s0.number,
    string: s0.string,
    boolean: s0.boolean
  };
}

// With strict validation
function(s0){
  if(typeof s0 !== "object" || s0 === null) throw typeError();
  if(typeof s0.number !== "number") throw typeError('number');
  if(typeof s0.string !== "string") throw typeError('string');
  if(typeof s0.boolean !== "boolean") throw typeError('boolean');
  return {
    number: s0.number,
    string: s0.string,
    boolean: s0.boolean
  };
}
```

## Next Steps

1. Implement "skip `in` checks for required" in handlers.ts
2. Use object literal output for deserialize (like serialize)
3. Add compile-time strict mode option
4. Benchmark after each change
