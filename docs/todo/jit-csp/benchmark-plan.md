# JIT/CSP Migration: Benchmark Plan

> **Status:** Phase 0 - Establishing Baselines
> **Branch:** `feat/next`
> **Last Updated:** 2026-01-21

## Overview

Before migrating packages to the new JIT engine, we need comprehensive benchmarks to:
1. Establish performance baselines for all affected packages
2. Detect regressions during migration (10% threshold = warning, 20% = failure)
3. Validate that the new JIT engine matches or beats current performance

## Architecture Decision

### Hybrid Approach

```
packages/*/benchmarks/           # Package-specific micro-benchmarks (quick iteration)
benchmarks/src/benchmarks/core/  # Integration benchmarks (CI baselines, cross-package)
```

**Rationale:**
- Micro-benchmarks in packages for fast developer iteration
- Centralized benchmarks for unified baseline comparison during migration
- Single `npm run benchmark -- --save-baseline` captures all packages

### Existing Infrastructure

The `benchmarks/` directory already provides:
- `BenchSuite` from `@deepkit/bench` for running benchmarks
- JSON reporter with metadata (git commit, timestamp, Node version, platform)
- Baseline comparison with configurable thresholds (5%/10%/20%)
- CLI: `--save-baseline`, `--compare-baseline`

## Packages Using CompilerContext (Migration Order)

| Priority | Package | JIT Usage | Benchmark Status |
|----------|---------|-----------|------------------|
| 1 | @deepkit/type | serializer, snapshot, change-detector, path | 🔄 Expanding |
| 2 | @deepkit/bson | bson-serializer, bson-deserializer | 🔄 Expanding |
| 3 | @deepkit/injector | injector factories | 🔄 Expanding |
| 4 | @deepkit/http | router, request-parser | 🔄 Expanding |
| 5 | @deepkit/rpc | message serialization | ❌ NEW (none exist) |
| 6 | @deepkit/orm | hydration, queries | 🔄 Expanding |
| 7 | @deepkit/event | dispatcher | 🔄 Expanding |
| 8 | @deepkit/app | bootstrap | 🔄 Expanding |

## Benchmark Specifications

### Tier 1: Critical (Must complete before migration)

#### @deepkit/type - `benchmarks/src/benchmarks/core/type/`

**serialization.bench.ts** (expand existing):
- Primitives: string, number, boolean, null, undefined
- Objects: small (5 props), medium (15 props), large (50+ props)
- Arrays: 100, 1000, 10000 items
- Nested: 3-5 levels deep
- Special types: Date, BigInt, Map, Set
- Unions: literal unions with 10, 100, 1000 members

**validation.bench.ts** (expand existing):
- `validate()` vs `is()` vs `guard()` vs `assert()`
- Simple constraints: MinLength, MaxLength, Email, Pattern
- Complex schemas: nested objects, unions, arrays
- Error collection overhead

**change-detection.bench.ts** (NEW):
- `createSnapshot()`: small, medium, large objects
- `getChangeDetector()`: compilation + execution
- `buildChanges()`: no changes vs with changes
- `getPrimaryKeyExtractor()`
- `getPrimaryKeyHashGenerator()`

#### @deepkit/bson - `benchmarks/src/benchmarks/core/bson/`

**bson.bench.ts** (expand existing):
- Primitives: string, number, boolean
- Objects: 5, 50, 500 properties
- Arrays: 100, 1000, 10000 elements
- Nested: 3-5 levels deep
- Special types: ObjectId, UUID, Date, BigInt
- Binary data: various sizes
- Comparison baseline vs official js-bson

### Tier 2: High Priority

#### @deepkit/rpc - `benchmarks/src/benchmarks/core/rpc/` (NEW)

**messages.bench.ts**:
- `createRpcMessage()` + `serializeBinaryRpcMessage()`
- `readBinaryRpcMessage()` + `parseBody<T>()`
- Small, medium, large message bodies
- Type caching effectiveness

**actions.bench.ts**:
- Action call latency (end-to-end)
- Parameter validation overhead
- Return type serialization

**observables.bench.ts**:
- Observable item emission rate
- Subscription/unsubscription overhead
- Collection batch operations (add, update, remove)

#### @deepkit/orm - `benchmarks/src/benchmarks/core/orm/`

**orm.bench.ts** (expand existing):
- Bulk hydration: 100, 500, 1000 entities
- With nested objects and references
- Identity map deduplication
- Complex filter queries: nested $and/$or, large $in arrays
- Join queries: 1-level, 2-level, 3-level

#### @deepkit/injector - `benchmarks/src/benchmarks/core/injector/`

**injector.bench.ts** (expand existing):
- Provider table scaling: 10, 50, 200, 500 providers
- Dependency chain depths: 1, 3, 5, 10 levels
- Scoped vs singleton resolution
- Tag-based injection
- Circular dependency detection overhead

### Tier 3: Important

#### @deepkit/http - `benchmarks/src/benchmarks/core/http/`

**http.bench.ts** (expand existing):
- Route matching: 10, 50, 100, 500 routes
- Path parameter extraction
- Query string parsing: simple, complex, large
- Body parsing: JSON 1KB, 100KB, 1MB
- Parameter validation
- Middleware chains: 0, 5, 10, 20 middlewares

#### @deepkit/event - `benchmarks/src/benchmarks/core/event/`

**event.bench.ts** (expand existing):
- Listener scaling: 1, 10, 50 listeners
- Sync vs async dispatch
- DI injection into listeners
- Event propagation control

#### @deepkit/app - `benchmarks/src/benchmarks/core/app/`

**app.bench.ts** (expand existing):
- Minimal app: 1 provider
- Medium app: 50 providers, 3 modules
- Large app: 200+ providers, 5+ nested modules
- Config loading: env parsing, validation
- CLI command parameter parsing

## Execution Plan

### Phase 0: Establish Baselines (Current)

```bash
# 1. Implement all benchmark expansions
# 2. Run and save baseline
cd benchmarks
npm run benchmark -- --save-baseline

# Baseline saved to: benchmarks/src/benchmarks/baselines/benchmark-<date>-<commit>.json
```

### Phase 1-3: During Migration

```bash
# After each migration phase, compare against baseline
npm run benchmark -- --compare-baseline

# Thresholds:
# - 5%:  Significant change (logged)
# - 10%: Warning (yellow) - investigate
# - 20%: Failure (red, exit code 1) - must fix before proceeding
```

## File Structure After Implementation

```
benchmarks/src/benchmarks/core/
├── type/
│   ├── serialization.bench.ts    ✅ (expanded)
│   ├── validation.bench.ts       ✅ (expanded)
│   ├── reflection.bench.ts       ✅ (existing)
│   └── change-detection.bench.ts ✅ (NEW)
├── bson/
│   └── bson.bench.ts             ✅ (expanded)
├── orm/
│   └── orm.bench.ts              ✅ (expanded)
├── injector/
│   ├── injector.bench.ts         ✅ (existing)
│   ├── core.bench.ts             ✅ (existing)
│   └── scaling.bench.ts          ✅ (NEW)
├── http/
│   └── http.bench.ts             ✅ (expanded)
├── event/
│   └── event.bench.ts            ✅ (expanded)
├── app/
│   └── app.bench.ts              ✅ (expanded)
└── rpc/                          ✅ (NEW directory)
    ├── messages.bench.ts         ✅ (NEW)
    ├── actions.bench.ts          ✅ (NEW)
    └── observables.bench.ts      ✅ (NEW)
```

## Success Criteria

1. All benchmarks run without errors
2. Baseline saved with current JIT implementation
3. After migration: no benchmark shows >10% regression
4. Performance improvements documented in migration notes

## Notes

- Run with `--expose-gc --max_old_space_size=3048` for accurate memory measurements
- Each benchmark runs for 1 second by default (configurable via `--max-time`)
- Async benchmarks are detected automatically
- Results include: ops/sec, mean time, variance, RME, heap diff, GC events
