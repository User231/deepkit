# feat/next → master: Comprehensive Framework Modernization

> **755 files changed, 142,117 insertions, 24,531 deletions**
> Covers: @deepkit/core, @deepkit/type, @deepkit/type-compiler, @deepkit/bson, @deepkit/http, @deepkit/orm, @deepkit/rpc, @deepkit/framework, @deepkit/run, @deepkit/bench, and more.

---

## Summary

This PR represents a comprehensive modernization of Deepkit Framework across three major axes:

1. **JIT Architecture Rewrite** — New expression-tree based `jit.ts` in `@deepkit/core`, enabling CSP-compliant environments and tiered execution (interpret first, JIT-compile hot paths).

2. **BSON Package Rewrite** — Complete rewrite of `@deepkit/bson` using the new Builder API. Zero `new Function()` calls, shape-learning JIT deserializer, security hardening.

3. **Type Serializer Rewrite** — `@deepkit/type` serializer migrated to `jit.fn()` API with major performance improvements (union validation 1000x faster, ReceiveType overhead reduced 90%).

Plus 25+ bug fixes, 8 new features, comprehensive benchmark infrastructure, and Jest → node:test migration for core packages.

---

## Breaking Changes

### 1. `feat(type,bson)!: Type-driven Reference serialization with `Inline` annotation`

`& Reference` now **always** serializes as FK (primary key only), regardless of runtime object state. Previously, serialization depended on `isReferenceInstance()` which was unpredictable.

**New API:**
```typescript
class Post {
    // Always serializes as FK (e.g., { author: 2 })
    author: User & Reference;

    // Always serializes as nested object (throws if not loaded)
    editor: User & Reference & Inline;

    // Inline only for JSON, FK for BSON/MongoDB
    reviewer: User & Reference & Inline<{ only: ['json'] }>;
}
```

**Migration:** If your code relied on `joinWith()` affecting serialization output, use `& Reference & Inline` on the type definition instead. See `docs/todo.md` "Design Decision" section for full rationale.

### 2. `feat(bson)!: BSON API overhaul`

**Removed exports:**
- `Writer` class
- `BaseParser` class
- `BSONBinarySerializer` class
- `ValueWithBSONSerializer` type
- `AutoBuffer` utility
- `getBSONSizer()` function
- `stringByteLength()` utility
- `getBsonEncoder()` (renamed to `getBSONEncoder()`)

**Changed return types:**
- `getBSONSerializer<T>()` now returns `(data: T) => [Uint8Array, number]` (buffer + size tuple, zero-copy)
- Was: `(data: T) => Uint8Array`

**New exports:**
- `getBSONEncoder<T>()` — high-level encode/decode pair
- `deserializeBSONWithoutOptimiser()` — public slow-path deserializer
- `SerializeResult` type alias for `[Uint8Array, number]`

### 3. `feat(core)!: New jit.ts — expression tree JIT/Exec architecture`

The old `CompilerContext`-based JIT in `@deepkit/core` is replaced with a new Builder API (`jit.ts`). This is an internal API used by `@deepkit/type` and `@deepkit/bson` — not directly user-facing, but affects anyone extending the serializer.

**Key changes:**
- `CompilerContext` → `Builder` with expression tree model
- `new Function()` → closure-based executors (CSP-compatible)
- Supports tiered execution: interpret first, compile to JIT after N calls

---

## New Features

### @deepkit/type
| Feature | Issue | Description |
|---------|-------|-------------|
| NanoId type support | [#419](https://github.com/deepkit/deepkit-framework/issues/419) | Native `NanoId` type with validation and serialization |
| Union constraint errors | [#577](https://github.com/deepkit/deepkit-framework/issues/577) | Show specific field-level errors for union validation failures |
| `isStrict<T>()` | — | Strict type guard without coercion |
| `isWeak<T>()` | — | Maximum-performance type guard (minimal checks) |
| `Inline` annotation | — | Control Reference serialization (see Breaking Changes) |

### @deepkit/http
| Feature | Issue | Description |
|---------|-------|-------------|
| Express-compatible methods | [#285](https://github.com/deepkit/deepkit-framework/issues/285) | `req.get()` and `req.header()` for Express middleware compat |
| Built-in CORS support | [#441](https://github.com/deepkit/deepkit-framework/issues/441) | Native CORS middleware with configurable origins/methods/headers |

### @deepkit/type-compiler
| Feature | Issue | Description |
|---------|-------|-------------|
| Improved DeepkitLoader API | [#456](https://github.com/deepkit/deepkit-framework/issues/456) | Better bundler integration for receiving types across files |
| tsconfig `extends` as array | [#600](https://github.com/deepkit/deepkit-framework/issues/600) | Support array syntax in tsconfig extends field |

### @deepkit/filesystem-aws-s3
| Feature | Description |
|---------|-------------|
| `forcePathStyle` option | Support `forcePathStyle` for S3-compatible services (MinIO, etc.) |

### @deepkit/framework
| Feature | Issue | Description |
|---------|-------|-------------|
| Custom CRUD identifiers | [#395](https://github.com/deepkit/deepkit-framework/issues/395) | Support custom identifier fields in auto-generated CRUD routes |
| Replace faker dependency | [#582](https://github.com/deepkit/deepkit-framework/issues/582) | Replaced deprecated faker with @faker-js/faker |

### @deepkit/core
| Feature | Description |
|---------|-------------|
| Error code system | `DeepkitError` base class with `DK-T###`, `DK-B###`, etc. codes |
| Builder API extensions | `forRange`, `forOf`, arithmetic/bitwise ops, `throw_`, `cond`, `concat` |

### @deepkit/bson
| Feature | Description |
|---------|-------------|
| Shape-learning JIT deserializer | Learns document shapes at runtime, generates specialized JIT code per shape |
| Circular reference detection | Depth-based extraction prevents infinite loops |
| Security hardening | Prototype pollution protection, bounds checking, size validation |
| BinaryBigInt support | Native BSON binary representation for BigInt values |

---

## Bug Fixes

### @deepkit/type-compiler
| Fix | Issue | Description |
|-----|-------|-------------|
| External types produce broken output | [#352](https://github.com/deepkit/deepkit-framework/issues/352) | Emit 'any' bytecode for external types instead of invalid JS |
| Windows backslash path delimiters | [#356](https://github.com/deepkit/deepkit-framework/issues/356) | Escape backslashes in Windows file paths |
| Optional chaining SyntaxError | [#612](https://github.com/deepkit/deepkit-framework/issues/612) | Resolve SyntaxError when optional chaining meets type arguments |
| Function type hoisting | [#664](https://github.com/deepkit/deepkit-framework/issues/664) | Hoist function `__types` declarations |
| Named re-exports missing types | [#634](https://github.com/deepkit/deepkit-framework/issues/634) | Auto re-export `__Ω` symbols with named re-exports |
| Exclude declare statements | [#601](https://github.com/deepkit/deepkit-framework/issues/601) | Don't emit type info for `declare` statements |
| External import types | [#555](https://github.com/deepkit/deepkit-framework/issues/555) | Graceful degradation for external library types |
| InferType resolution | [#509](https://github.com/deepkit/deepkit-framework/issues/509) | Replace entire TypeReferenceNode for infer types |
| Index.ts re-export failures | [#318](https://github.com/deepkit/deepkit-framework/issues/318) | Fixed via #634 named re-export fix |

### @deepkit/type
| Fix | Issue | Description |
|-----|-------|-------------|
| Circular import error | [#562](https://github.com/deepkit/deepkit-framework/issues/562) | Improve `NoTypeReceived` error messages for better DX |
| Conditional type inference | [#524](https://github.com/deepkit/deepkit-framework/issues/524) | Correct tuple inference with rest element before infer |
| Missing runtime type error | [#508](https://github.com/deepkit/deepkit-framework/issues/508) | Improve error messages with actionable guidance |
| Stack overflow on large unions | [#478](https://github.com/deepkit/deepkit-framework/issues/478) | Prevent stack overflow for large literal unions |
| Circular references in validation | [#505](https://github.com/deepkit/deepkit-framework/issues/505) | Handle circular references in `ValidationErrorItem.toString()` |
| SuperClass serialization | [#241](https://github.com/deepkit/deepkit-framework/issues/241) | Skip serializing superClass when parent has no `__type` |
| Custom `Partial<T>` shadow | — | Remove custom `Partial<T>` that shadowed TypeScript built-in |
| Optional chaining in JIT | — | Remove optional chaining from JIT-generated code |
| Constructor call exclusion | — | Exclude constructor calls from `hasDefaultFunctionExpression` |

### @deepkit/http
| Fix | Issue | Description |
|-----|-------|-------------|
| Middleware error handling | [#439](https://github.com/deepkit/deepkit-framework/issues/439) | Improve error propagation with correct status codes |
| HttpBody in separate files | [#458](https://github.com/deepkit/deepkit-framework/issues/458) | Fix parameter injection across file boundaries |
| HttpHeader case sensitivity | [#653](https://github.com/deepkit/deepkit-framework/issues/653) | Make header parameter matching case-insensitive |
| Middleware response event | [#590](https://github.com/deepkit/deepkit-framework/issues/590) | Ensure `onResponse` fires when middleware ends response early |
| HttpError propagation | [#589](https://github.com/deepkit/deepkit-framework/issues/589) | Propagate HttpError from middleware with correct status code |

### @deepkit/orm
| Fix | Issue | Description |
|-----|-------|-------------|
| Identity map hydration | [#636](https://github.com/deepkit/deepkit-framework/issues/636) | Upgrade reference proxies when same entity joined via different path |
| count() with pagination | [#668](https://github.com/deepkit/deepkit-framework/issues/668) | `count()` ignores pagination to return total count |
| `withChangeDetection` clone | — | Include `withChangeDetection` in `DatabaseQueryModel.clone()` |
| `deleteResult.modified` | — | Set `deleteResult.modified` in `MemoryDatabaseAdapter` |

### @deepkit/bson
| Fix | Issue | Description |
|-----|-------|-------------|
| NaN serialization | [#573](https://github.com/deepkit/deepkit-framework/issues/573) | Serialize NaN as 0 instead of skipping |
| Union error messages | [#676](https://github.com/deepkit/deepkit-framework/issues/676) | Improve error messages for union type mismatches |

### @deepkit/rpc
| Fix | Description |
|-----|-------------|
| Subject premature GC | Prevent FinalizationRegistry from firing during active subscriptions (V8 marks variables as "dead" during await) |
| Subscribe type correctness | Fix TypeScript types for `subscribe.apply` arguments |
| Error messages | Improve error messages with controller/method context |

### Other
| Fix | Package | Issue | Description |
|-----|---------|-------|-------------|
| Missing shebang | sql, desktop-ui | [#598](https://github.com/deepkit/deepkit-framework/issues/598) | Add shebang to CLI bin files |
| HttpQuery validator leak | http | [#614](https://github.com/deepkit/deepkit-framework/issues/614) | Fix validator expression leak in HttpQuery |
| Error classes | type, bson | — | Replace plain `Error` with proper `DeepkitError`/`BSONError` subclasses |

---

## Performance Improvements

### @deepkit/type

| Optimization | Before | After | Improvement |
|-------------|--------|-------|-------------|
| Union validation (discriminated) | ~5K ops/sec | ~5M ops/sec | **1000x** |
| `deserialize<T>()` with ReceiveType | 1M ops/sec | 3.6M ops/sec | **3.6x** |
| `validate<T>()` with ReceiveType | 1M ops/sec | 5.5M ops/sec | **5.5x** |
| `is<T>()` with ReceiveType | 1M ops/sec | 7.4M ops/sec | **7.4x** |
| Nullish checks in guards | — | — | `x==null` instead of `x===undefined\|\|x===null` |
| Serialize (no groups) | — | — | Direct object literal, skip wrapper |

**ReceiveType overhead breakdown (was 325ns → now ~32ns):**
- Eliminated Ω array wrapper (57ns)
- Singleton `NamingStrategy` (101ns allocation)
- Hybrid direct argument passing eliminates Ω side-channel entirely

**Union validation fix:** Added `detectDiscriminator()` to `guardUnionFast` — uses O(1) switch dispatch instead of linear member iteration. Error collection via `validateDiscriminatedUnionWithErrors` runtime.

**Index signature optimization:** Inline index signature validation/serialization directly in `b.forIn` loops using `state.forKey(key).build()`. Pre-build serializer/deserializer/type-guard functions at JIT time instead of rebuilding per-key per-call. Cache extracted nested functions in `buildExtractedCall`.

**vs master performance (pre-resolved `fn()` API):**

| Benchmark | feat/next | master | Change |
|-----------|-----------|--------|--------|
| Small model deserialize | 40.9M | 21.7M | **+88%** |
| Medium model deserialize | 9.6M | 4.3M | **+124%** |
| Union deserialize | 16.5M | 2.2M | **+637%** |
| Small model serialize | 130.5M | 19.0M | **+587%** |
| Medium model serialize | 2.0M | 1.3M | **+51%** |
| Union serialize | 34.6M | 2.4M | **+1342%** |
| Small model validate | 63.8M | 20.4M | **+213%** |
| Medium model validate | 20.6M | 4.9M | **+317%** |
| Union validate | 8.5M | 0.5M | **+1605%** |
| Small model `is()` | 368.5M | 21.1M | **+1649%** |
| Medium model `is()` | 51.9M | 4.9M | **+960%** |
| Union `is()` | 8.9M | 0.5M | **+1679%** |

All 12 benchmarks beat master. Fastest improvements: small `is()` +1649%, union serialize +1342%, union validate +1605%.

### @deepkit/bson

**Single document performance (pre-resolved API):**

| Benchmark | feat/next | master | vs master | vs bson-js |
|-----------|-----------|--------|-----------|------------|
| **Serialize** | | | | |
| int32 (1 field) | 145.1M | 17.7M | **+720%** | **313x** |
| float64 (1 field) | 139.1M | 16.8M | **+728%** | **278x** |
| string (1 field) | 86.2M | 10.9M | **+691%** | **41x** |
| boolean (1 field) | 98.1M | 20.2M | **+386%** | **299x** |
| MongoId (1 field) | 33.9M | 9.9M | **+243%** | **17x** |
| UUID (1 field) | 22.3M | 6.1M | **+266%** | **9x** |
| int32 x3 | 139.5M | 12.7M | **+998%** | **254x** |
| mixed x3 | 137.7M | 11.5M | **+1097%** | **236x** |
| sensor (4 numeric) | 127.1M | 7.4M | **+1617%** | **194x** |
| API meta (3 strings) | 14.3M | 5.0M | **+186%** | **8x** |
| minimal (_id only) | 33.7M | 9.1M | **+270%** | **17x** |
| **Deserialize** | | | | |
| int32 (1 field) | 117.9M | 29.0M | **+307%** | **31x** |
| float64 (1 field) | 62.9M | 28.7M | **+119%** | **14x** |
| string (1 field) | 37.8M | 15.0M | **+152%** | **11x** |
| boolean (1 field) | 79.5M | 30.5M | **+161%** | **20x** |
| MongoId (1 field) | 21.5M | 9.3M | **+131%** | **10x** |
| UUID (1 field) | 13.2M | 4.6M | **+187%** | **6x** |
| int32 x3 | 45.7M | 21.2M | **+116%** | **17x** |
| mixed x3 | 49.0M | 21.0M | **+133%** | **13x** |
| sensor (4 numeric) | 21.4M | 13.5M | **+59%** | **12x** |
| API meta (3 strings) | 12.2M | 3.7M | **+230%** | **8x** |
| minimal (_id only) | 21.4M | 9.0M | **+138%** | **10x** |

All 22 single-document benchmarks beat master. Serialize **3-17x faster** (buffer reuse + zero-copy tuple return), deserialize **1.6-4x faster** (shape-learning JIT + tiered UTF-8 decoder + hexTable2 optimization). All benchmarks **6-313x faster than bson-js**.

**Array performance (MongoDB cursor response `{ cursor: { firstBatch: T[] } }`):**

| Benchmark | Serialize | vs bson-js | Deserialize | vs bson-js |
|-----------|-----------|------------|-------------|------------|
| sensor[] 10 items | 8.6M ops/sec | **46x** | 1.7M ops/sec | **11x** |
| sensor[] 1K items | 100K ops/sec | **44x** | 17K ops/sec | **10x** |
| mixed[] 10 items | 1.9M ops/sec | **15x** | 1.0M ops/sec | **10x** |
| mixed[] 1K items | 20K ops/sec | **14x** | 10K ops/sec | **10x** |
| string[] 100 items | 700K ops/sec | **5x** | 500K ops/sec | **4x** |
| number[] 100 items | 4.3M ops/sec | **26x** | 1.4M ops/sec | **3x** |

Array performance tested in the standard MongoDB response pattern at depth 3 — the most common real-world access pattern. Deepkit maintains **3-46x advantage over bson-js** at all array sizes and element types.

**Shape-learning JIT:** Documents are profiled at runtime. After learning the shape (field order, types), a specialized JIT reader is generated that skips field name parsing. Falls back to interpreted path for unknown shapes. Provides 21x improvement for union types.

**hexTable2 optimization:** 65,536-entry lookup table maps byte-pairs to 4-char hex strings. Eliminates per-byte hex conversion for UUID/MongoId.

### @deepkit/http

| Optimization | Description |
|-------------|-------------|
| Pre-compiled middleware resolvers | Cache resolver compilation, avoid repeated compilation per request |

---

## Test Migration: Jest → node:test

Migrated three core packages from Jest to `node:test` with a shared `@deepkit/run/expect` assertion shim.

| Package | Tests | Status |
|---------|-------|--------|
| @deepkit/bson | 549 | All pass |
| @deepkit/type-compiler | 277 | All pass |
| @deepkit/type | 1,975 | All pass (4 pre-existing skips) |
| **Total** | **2,801** | **All pass** |

**Changes:**
- Created `packages/run/expect.ts` — shared expect() shim with matchers: `toBe`, `toEqual`, `toStrictEqual`, `toBeInstanceOf`, `toContain`, `toMatch`, `toThrow`, `toBeGreaterThan`, `toBeTruthy`, `toBeFalsy`, `toBeNull`, `toBeUndefined`, `toBeDefined`, `toHaveProperty`, `toHaveLength`, `toMatchObject`, `resolves`, `rejects`
- Added `test:node` scripts to package.json files
- Import pattern: `import { expect } from '@deepkit/run/expect'`
- Added `useDefineForClassFields: false` to `tsconfig.base.json` (ES2022 defaults it to `true`, which changes class field initialization semantics)

---

## Infrastructure

### Benchmark Suite (new)

Comprehensive benchmark infrastructure at `benchmarks/`:
- **306 benchmarks** across 15 suites
- Core benchmarks: serialization, validation, BSON, ORM, HTTP, RPC, injector, change-detection
- Comparison benchmarks: vs Zod, vs class-transformer, vs bson-js, vs Typia
- V8 pattern microbenchmarks: function creation, property access, nullish checks, etc.
- Pre-refactor baseline saved for regression detection
- JSON, Markdown, SVG report generation
- `npm run benchmark -- --compare-baseline` fails on >20% regression

### Docker Compose Test Environment

Full test stack at `docker-compose.yml`:
- PostgreSQL (15432), MySQL (13306), MongoDB replica set (27117), Redis (16379)
- SFTP, FTP, MinIO/S3, Fake GCS for filesystem adapter tests
- Alternative ports to avoid conflicts with local services

### Error Code System

All packages now use `DeepkitError` base class with coded errors:
- `DK-T###` (@deepkit/type), `DK-B###` (@deepkit/bson), `DK-O###` (@deepkit/orm)
- `DK-I###` (@deepkit/injector), `DK-H###` (@deepkit/http), `DK-R###` (@deepkit/rpc)
- Each code links to documentation

### Pre-commit Hooks (lefthook)

- Typecheck gate (`npm run typecheck`)
- Prettier formatting
- Conventional commit message enforcement

---

## Open TODOs (Post-Merge)

### CRITICAL: Consumer Package Migration

5 packages have broken imports due to the BSON API overhaul and need updating before the full framework compiles:

| Package | Broken Imports | Complexity |
|---------|---------------|------------|
| `@deepkit/rpc` | `Writer`, `getBSONSizer` — protocol binary serialization | High — needs refactored message construction |
| `@deepkit/mongo` | `BSONBinarySerializer`, `ValueWithBSONSerializer`, `Writer`, `getBSONSizer` | High — needs new serializer composition pattern |
| `@deepkit/broker` | `getBSONSerializer` return type changed to `[buffer, size]` tuple | Low — destructure tuple at call sites |
| `@deepkit/broker-redis` | `AutoBuffer` removed, `getBsonEncoder` → `getBSONEncoder` case fix | Medium — remove AutoBuffer, fix case + decode() signature |
| `@deepkit/framework-debug-api` | `Writer`, `BaseParser`, `getBSONSizer`, `stringByteLength` | Medium — implement local binary I/O utilities |

**Detailed migration notes:** See `.claude/handover.md` Suppressed Issues section.

### RPC Protocol Rewrite

The RPC protocol (`packages/rpc/src/protocol.ts`) uses low-level binary operations (`Writer`, `getBSONSizer`) to construct message envelopes with precise size control. This needs either:
- A refactor to use the new `getBSONSerializer()` tuple API (serialize first, then build envelope)
- Or re-exporting `Writer`/sizer utilities from `@deepkit/bson` for low-level consumers

### MongoDB Client Rewrite

The MongoDB client (`packages/mongo/src/client/connection.ts`) has similar needs — constructs MongoDB wire protocol messages using `Writer` and pre-calculated sizes. The `MongoBinarySerializer` class (extends removed `BSONBinarySerializer`) needs architectural replacement.

### Additional Package Migrations to node:test

Remaining packages still use Jest:
- @deepkit/injector, @deepkit/orm, @deepkit/http, @deepkit/framework
- @deepkit/mysql, @deepkit/postgres, @deepkit/sqlite
- @deepkit/mongo, @deepkit/rpc

### 4 Skipped Tests

`packages/type/tests/serializer.spec.ts` has 4 `test.skip` (pre-existing from Jest):
- `onLoad call` (×3) — lines 1153, 1180, 1204
- `extend with custom type` — line 1363

---

## Commit Plan

The following semantic commits should be created for changelog generation:

### Core Infrastructure
1. `docs: add comprehensive project documentation and agent workflow`
2. `feat(bench): add comprehensive benchmark suite with pre-refactor baseline`
3. `chore: add docker-compose for full test environment`
4. `chore: add pre-commit hooks with lefthook`
5. `feat(core): add error code system with DeepkitError base class`

### JIT Architecture
6. `feat(core)!: new jit.ts — unified expression tree JIT/Exec architecture`

### Type Serializer
7. `feat(type)!: rewrite serializer with jit.fn() for CSP compliance`
8. `feat(type): add NanoId type support (#419)`
9. `feat(type): add isStrict<T>() and isWeak<T>() type guards`

### BSON Rewrite
10. `feat(bson)!: rewrite BSON serializer/deserializer with Builder API`

### Reference Serialization
11. `feat(type,bson)!: type-driven Reference serialization with Inline annotation`

### Performance
12. `perf(type): union validation O(1) discriminator dispatch`
13. `perf(type): reduce ReceiveType overhead — eliminate Ω side-channel`
14. `perf(bson): shape JIT for union types — 21x improvement`
15. `perf(bson): optimize string deserialization and UUID/MongoId encoding`
16. `perf(http): pre-compiled request-scoped middleware resolvers`

### Bug Fixes (individual commits for changelog)
17. `fix(type-compiler): emit 'any' for external types instead of invalid JS (#352)`
18. `fix(type-compiler): escape Windows backslash path delimiters (#356)`
19. `fix(type-compiler): resolve optional chaining SyntaxError (#612)`
20. `fix(type-compiler): hoist function types, exclude declare statements (#664, #601)`
21. `fix(type-compiler): auto re-export __Ω symbols with named re-exports (#634, #318)`
22. `fix(type-compiler): graceful degradation for external library types (#555)`
23. `fix(type-compiler): replace TypeReferenceNode for infer types (#509)`
24. `fix(type-compiler): support tsconfig extends as array (#600)`
25. `fix(type): improve NoTypeReceived error messages (#562)`
26. `fix(type): correct tuple inference with rest before infer (#524)`
27. `fix(type): improve error "No valid runtime type" (#508)`
28. `fix(type): prevent stack overflow for large literal unions (#478)`
29. `fix(type): handle circular references in ValidationErrorItem (#505)`
30. `fix(type): skip serializing superClass when parent has no __type (#241)`
31. `fix(type,bson): use proper error classes instead of plain Error`
32. `fix(http): improve middleware error handling and performance (#439)`
33. `fix(http): add Express-compatible get() and header() methods (#285)`
34. `feat(http): add built-in CORS support (#441)`
35. `fix(http): make HttpHeader matching case-insensitive (#653)`
36. `fix(http): ensure onResponse fires on early middleware response (#590)`
37. `fix(http): propagate HttpError from middleware (#589)`
38. `fix(orm): upgrade reference proxies for identity map hydration (#636)`
39. `fix(orm): count() ignores pagination for total count (#668)`
40. `fix(bson): serialize NaN as 0 (#573)`
41. `fix(bson): improve union error messages (#676)`
42. `fix(rpc): prevent premature GC of Subjects during active subscriptions`
43. `fix(rpc): improve error messages with controller/method context`
44. `feat(framework): support custom CRUD route identifiers (#395)`
45. `feat(framework): replace deprecated faker (#582)`
46. `feat(type-compiler): improve DeepkitLoader for bundler integrations (#456)`
47. `fix(sql,desktop-ui): add shebang to CLI bin files (#598)`

### Test Migration
48. `test(bson,type-compiler,type): migrate from Jest to node:test`
49. `chore: add useDefineForClassFields: false to tsconfig.base.json`

---

## Files Changed by Package

| Package | Files | Nature |
|---------|-------|--------|
| @deepkit/type | 116 | Serializer rewrite, bug fixes, tests |
| @deepkit/mongo | 64 | Needs consumer migration |
| @deepkit/bson | 59 | Complete rewrite |
| @deepkit/framework | 42 | Bug fixes, faker replacement |
| @deepkit/rpc | 33 | Needs consumer migration |
| @deepkit/core | 32 | JIT rewrite |
| @deepkit/http | 31 | Features, bug fixes |
| @deepkit/type-compiler | 28 | Bug fixes, tests |
| @deepkit/sql | 28 | Needs consumer migration |
| @deepkit/orm | 28 | Bug fixes |
| benchmarks/ | ~80 | New package |
| docs/ | ~60 | New documentation |
| Other packages | ~100 | Minor changes |
