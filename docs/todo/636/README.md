# Issue #636: Hydrate fetched objects in identity map

## Summary

When the same entity appears multiple times in a query result via different paths, they should share the same hydrated instance. Currently reference proxies block access to fully loaded objects.

## GitHub Link

https://github.com/deepkit/deepkit-framework/issues/636

## Context

- **Package**: @deepkit/orm
- **Severity**: Medium
- **Type**: Bug
- **Status**: ✅ FIXED

## Current Behavior (Before Fix)

```typescript
const review = await session.query(Review)
    .innerJoinWith('book')
    .innerJoinWith('user')
    .findOne();

// review.user is FULLY HYDRATED (joined explicitly)
// review.book.author is a REFERENCE PROXY (not joined, only has PK)

review.user.name;        // ✓ Works - "Peter"
review.book.author.name; // ✗ Fails - unpopulated reference error
```

## Expected Behavior

Both `review.user` and `review.book.author` should be the same object instance when they reference the same User entity. Accessing properties on either should work.

## Solution

### Approach: Upgrade References In-Place

When processing joined data and finding a reference proxy in the pool/identity-map, we **upgrade** the proxy to a full object by:

1. **Changing the prototype** from `ReferenceClass` to `EntityClass` (`Object.setPrototypeOf`)
2. **Assigning properties directly** to the object

This approach:
- Preserves object identity (all holders see the same upgraded object)
- Makes `isReferenceInstance()` return `false` after upgrade
- Is 3.4x faster than using `Object.defineProperty` (benchmarked)
- Results in faster property access after upgrade

### Key Distinction: Joined Data vs Main Results

References are only upgraded when processing **joined data** (via `joinWith`, `useJoinWith`, etc.), not when the same entity simply appears as another row in the result set.

```typescript
// Joined data: book.author IS upgraded because user is joined
Review.innerJoinWith('book').innerJoinWith('user')
// → review.book.author === review.user (same object, upgraded)

// Main result: block.previous is NOT upgraded
Block.find()  // No joins
// → block.previous remains a reference proxy
```

### Files Changed

- `packages/orm/src/formatter.ts`
  - Added `upgradeReferenceToObject()` function using `Object.setPrototypeOf` + direct assignment
  - Updated pool lookup to upgrade references only when `isJoinedData=true`
  - Updated identity map lookup with same logic
  - Pass `isJoinedData=true` when processing `join.populate` relations

### Tests Added

- `packages/orm/tests/identity-map.spec.ts`
  - `identity map hydrates references when full object is loaded via join`
  - `identity map reference upgrade with multiple overlapping references`
  - `self-referencing entity: FK references remain as references when not joined`
  - `self-referencing entity: FK references ARE upgraded when joined`

## Tasks

- [x] Understand reference proxy internals (can it be upgraded in place?)
- [x] Benchmark different upgrade approaches
- [x] Implement `upgradeReferenceToObject` using Option E (setPrototypeOf + assign)
- [x] Add `isJoinedData` flag to distinguish joined vs main result data
- [x] Write explicit test cases for both scenarios
- [x] Run full ORM test suite (41 tests pass)
- [x] Run SQLite integration tests (90 tests pass)
- [x] Verify the bookstore test passes

## Progress Log

| Date | Action |
|------|--------|
| 2026-01-20 | Started investigation, analyzed formatter and identity map |
| 2026-01-20 | Benchmarked 5 approaches for upgrading references |
| 2026-01-20 | Implemented Option E (setPrototypeOf + direct assign) - 3.4x faster |
| 2026-01-20 | Added isJoinedData flag to prevent upgrading FK references incorrectly |
| 2026-01-20 | Added 4 dedicated tests, all ORM and SQLite tests pass |
