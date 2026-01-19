# Issue #478: Literal Union Optimization

## Status: COMPLETE ✅

All work completed including comprehensive test coverage.

---

## Summary of Changes

### 1. Performance Fix (Original Issue)
- Set-based O(1) optimization for pure literal unions
- Prevents stack overflow for unions with 86,400+ members
- Threshold changed from 5 to 1 (ALL literal unions use optimization)

### 2. Validation Consistency Fix
- Both small and large literal unions now validate during serialize/deserialize
- No more silent pass-through of invalid values

### 3. BSON Error Message Improvements
- Added `value` parameter to ValidationError.from() calls
- Use `stringifyValueWithType()` for clearer error messages
- Format: `Cannot convert "hello" (string) to 'a' | 'b'`

### 4. Loose Deserialization Support
- String-to-number coercion for numeric literal unions when `{ loosely: true }`

---

## Test Coverage Summary

### Type Package Tests Added (28 new tests)
- **Type varieties**: boolean, bigint, single-member, mixed types
- **Edge cases**: empty string, zero vs "0", all-falsy, negative, floats
- **Contexts**: root level, arrays, tuples, nested, optional, multiple props
- **Error messages**: paths, format, value field

### BSON Package Tests Added (27 new tests)
- **Serialization**: string/number/boolean/mixed literals
- **Sizing**: accuracy verification, error handling
- **Round-trip**: all literal types preserve values
- **Errors**: format, value field, paths
- **Contexts**: arrays, nested objects, optional
- **Performance**: large unions (50-100 members)

---

## Final Test Results

```
Test Suites: 6 passed, 6 total
Tests:       331 passed, 331 total
```

| Package | Tests |
|---------|-------|
| type/serializer.spec.ts | 137 |
| type/validation.spec.ts | 56 |
| bson/bson-serialize.spec.ts | 90 |
| bson/bson-parser.spec.ts | 41 |
| bson/type-spec.spec.ts | 5 |
| bson/stream.spec.ts | 2 |

---

## Files Modified

### Source Files
- `packages/type/src/serializer.ts` - Set optimization, threshold=1, loose coercion
- `packages/bson/src/bson-serializer.ts` - BSON union handlers, error improvements

### Test Files
- `packages/type/tests/serializer.spec.ts` - +28 literal union tests
- `packages/type/tests/validation.spec.ts` - minor updates
- `packages/bson/tests/bson-serialize.spec.ts` - +27 literal union tests

---

## Coverage Checklist

### Core Functionality ✅
- [x] Large unions don't stack overflow
- [x] Small unions validate (no silent pass-through)
- [x] Error messages use stringifyValueWithType
- [x] BSON byte layout is correct
- [x] Round-trip preserves values

### Type Varieties ✅
- [x] String literals
- [x] Number literals
- [x] Boolean literals (`true | false`)
- [x] BigInt literals
- [x] Mixed types
- [x] Single-member

### Edge Cases ✅
- [x] Empty string
- [x] Zero vs "0"
- [x] All-falsy union
- [x] Negative numbers
- [x] Float literals

### Contexts ✅
- [x] Root level
- [x] Object property
- [x] Array of unions
- [x] Tuple element
- [x] Nested object
- [x] Optional property
- [x] Multiple properties

### Error Messages ✅
- [x] Correct path for nested
- [x] Correct path for arrays
- [x] Value included in error
- [x] Type formatting correct

### BSON ✅
- [x] Serialization works
- [x] Sizer matches output
- [x] Round-trip preserves
- [x] Large unions perform
- [x] Errors are correct
