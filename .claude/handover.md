# Handover

*Updated 2026-02-08 (Gen 70)*

## Init Checklist
<!-- Next agent: complete these steps IN ORDER before doing anything else. -->
1. Read this entire handover document
2. Read `CLAUDE.md` for project rules
3. Read `docs/pr-description.md` — comprehensive PR description with all changes cataloged
4. Run the verification command (below) to confirm expected state
5. Recreate tasks from the Tasks section via `TaskCreate`
6. Check the Suppressed Issues section — do not re-suppress these without noting it

## Architecture Snapshot

```
@deepkit/type-spec       → ReflectionOp bytecode definitions
@deepkit/type-compiler   → TS transformer (compile-time), DeepkitLoader (bundlers)
@deepkit/run             → TS loader (node --import), expect.ts test shim
@deepkit/type            → Runtime types, validation, serialization
@deepkit/core            → Utilities, CompilerContext, DeepkitError base
@deepkit/bson            → BSON serializer/deserializer

Pipeline: TS types → type-compiler → ReflectionOp bytecode → processor VM → Type objects → JIT serialization/validation

Test migration: Jest → node:test + @deepkit/run/expect shim
  bson ✅ | type-compiler ✅ | type ✅
```

## Current State
- **Branch**: `feat/next`
- **Backup branch**: `feat/next-backup` (points to pre-perf-fix state, 306+ messy commits)
- **Active plan**: none — commit plan executed, PR description updated
- **Working on**: Consumer package migration (broken BSON imports) + performance verification
- **Dirty files**: none (all committed)
- **Failing tests**: none known for bson/type/type-compiler — consumer packages (rpc, mongo, broker, framework-debug-api) have broken BSON imports that will fail at compile
- **Master worktree**: `/Users/marc/bude/deepkit-master` — fully built, has compiled benchmarks (`packages/bson/tsconfig.bench.json` → `dist/bench/`)
- **Verification command**: `git log --oneline -5` (expect: 21 semantic commits, top is `chore: update handover...`, below it `docs(website)...`, `fix: update remaining packages...`, etc.)

## Next Steps
1. **Prove performance is still optimal** — Run BSON and type benchmarks vs master and bson vs bson-js. bson-js should be updated to newest version first. Benchmark files:
   - feat/next perf-regression: `node --import @deepkit/run --test packages/bson/tests/serialize/perf-regression.spec.ts` and `tests/deserialize/perf-regression.spec.ts`
   - master comparison: `cd /Users/marc/bude/deepkit-master && npx tsc -p packages/bson/tsconfig.bench.json && node --expose-gc packages/bson/dist/bench/benchmarks/compare-bench.js`
   - type benchmarks: `packages/type/benchmarks/compare-bench.ts` (feat/next), master has equivalent in its worktree
2. **Fix consumer package BSON imports** — See Suppressed Issues for the full list. Key broken packages: rpc, mongo, broker, broker-redis, framework-debug-api. See `docs/pr-description.md` "Open TODOs" section for migration details.
3. **Verify final state** — Full test suite must pass after consumer migrations

## Alignment Check
- **Goal**: Get feat/next branch ready for PR — all tests passing, performance proven, clean commit history
- **Scope boundary**: The commit plan is DONE (21 commits). Focus is now on (a) proving perf is optimal, (b) fixing broken consumer imports. Do NOT re-squash commits.
- **Plan file**: none — commit plan was executed this session
- **Recovery**: `git reset --hard feat/next-backup` restores the 306+ commit history (loses clean squash)

## Tasks
- [ ] **Update bson-js to latest version** — Check if `bson` npm package in the repo is latest. Update and re-run comparison benchmarks. [status: pending]
- [ ] **Run BSON perf benchmarks vs master** — Run both serialize and deserialize perf-regression tests on feat/next AND master compare-bench.ts. Verify all ratios hold. [status: pending]
- [ ] **Run type perf benchmarks vs master** — Ensure all 12 type benchmarks still beat master. [status: pending]
- [ ] **Fix consumer BSON imports (rpc)** — `packages/rpc/src/protocol.ts` uses Writer, getBSONSizer, BsonStreamReader. Needs refactored message construction. HIGH complexity. [status: pending]
- [ ] **Fix consumer BSON imports (mongo)** — `packages/mongo/src/client/connection.ts` uses BSONBinarySerializer, Writer, getBSONSizer. Needs new serializer composition. HIGH complexity. [status: pending]
- [ ] **Fix consumer BSON imports (broker)** — `packages/broker/src/snapshot.ts` uses old getBSONSerializer return type. `packages/broker/src/adapters/deepkit-adapter.ts` uses getBsonEncoder. LOW complexity. [status: pending]
- [ ] **Fix consumer BSON imports (broker-redis)** — Remove AutoBuffer, fix getBsonEncoder → getBSONEncoder. MEDIUM complexity. [status: pending]
- [ ] **Fix consumer BSON imports (framework-debug-api)** — `packages/framework-debug-api/src/stopwatch-encoding.ts` uses Writer, BaseParser, getBSONSizer, stringByteLength. MEDIUM complexity. [status: pending]

## Benchmark Data

### @deepkit/bson: perf-regression results (Gen 70, fresh run)

**Serialize (feat/next vs bson-js):**

| Benchmark | Ops/sec | vs bson-js |
|-----------|---------|------------|
| int32 | 1,174M | 301x |
| sensor (4 numeric) | 336M | 193x |
| user profile (6 fields) | 16.6M | 16x |
| API meta (3 strings) | 15.9M | 8x |
| sensor[] 10 cursor | 8.7M | 46x |
| sensor[] 1K cursor | 100K | 43x |
| mixed[] 10 cursor | 1.9M | 15x |
| mixed[] 1K cursor | 20K | 14x |

**Deserialize (feat/next vs bson-js):**

| Benchmark | Ops/sec | vs bson-js |
|-----------|---------|------------|
| int32 | 187M | 31x |
| sensor (4 numeric) | 23M | 12x |
| user profile (6 fields) | 11.5M | 12x |
| API meta (3 strings) | 13.1M | 8x |
| sensor[] 10 cursor | 1.7M | 11x |
| sensor[] 1K cursor | 17K | 10x |
| mixed[] 10 cursor | 1.0M | 10x |
| mixed[] 1K cursor | 10K | 10x |

**Master comparison (from same-session run):**

| Benchmark | master | feat/next | Improvement |
|-----------|--------|-----------|-------------|
| ser sensor | 7.5M | 336M | 45x |
| ser sensor[]10 cursor | 758K | 8.7M | 11x |
| ser sensor[]1K cursor | 8.4K | 100K | 12x |
| des sensor | 13.1M | 23M | 1.8x |
| des sensor[]10 cursor | 1.5M | 1.7M | 1.1x |
| des sensor[]1K cursor | 16.6K | 17K | ~same |

## Learnings
- ✅ [2026-02-06] **Type compiler resolves `T | undefined` as optional T, not union** — `prop.optional = true` and `prop.type = UUID`.
- ✅ [2026-02-07] **`isBsonTypeCompatible` must handle union types** — Returning false for ALL unions disabled shape JIT.
- ✅ [2026-02-08] **Always use `@deepkit/bench` (`BenchSuite`)** for benchmarks.
- ✅ [2026-02-08] **Type serializer perf regressions: 3 unbounded fn() rebuilds** — Fix: cache at JIT time.
- ✅ [2026-02-08] **`getBSONSerializer` returns `[sharedBuffer, size]` — buffer is reused across ALL serializers globally**. Callers must copy with `buf.slice(0, size)`.
- ✅ [2026-02-08] **BSONBuildState `forIndex()` must NOT increment depth** — Incrementing depth caused extraction at MAX_DEPTH=3, 60-90x slower for cursor responses.
- ✅ [2026-02-08] **Shape JIT must handle primitive arrays** — Without inline, documents with `string[]`/`number[]` cause shape JIT BAILOUT.
- ✅ [2026-02-08] **BenchSuite executor does NOT prevent V8 dead-code elimination** — Use `sink` variable.
- ✅ [2026-02-08] **Master BSON benchmark needs compiled JS** — `tsconfig.bench.json` with `"reflection": true`, compile with tsc, run from `dist/bench/`.
- ⚠️ [2026-02-08] **BSON array deserialize improvement limited at scale** — Single-doc sensor 1.8x faster, but sensor[]1K cursor ~same speed. Setup/overhead improvement is amortized; per-element byte-reading cost is similar between branches (~55-60ns/sensor). Serialize arrays DO scale (12x faster) due to buffer reuse.

## Dead Ends
- [2026-02-04] **"Assumed order" fast-path** — WRONG for MongoDB which returns arbitrary field order.
- [2026-02-07] **Blanket `return false` for unions in `isBsonTypeCompatible`** — Disabled shape JIT for ALL documents with union properties.
- [2026-02-08] **Eager pre-building union guards at JIT time** — Causes infinite recursion for recursive union types. Must use lazy caching.

## Suppressed Issues
- [2026-02-07] `packages/rpc/src/protocol.ts:10-17` — Imports `Writer`, `getBSONSizer`, `BsonStreamReader` (all removed/renamed). Will fail at compile.
- [2026-02-07] `packages/mongo/src/client/connection.ts:13` — Imports `BSONBinarySerializer`, `BsonStreamReader`, `Writer`, `getBSONSizer`. Will fail at compile.
- [2026-02-07] `packages/mongo/src/mongo-serializer.ts:10` — Imports `BSONBinarySerializer`, `ValueWithBSONSerializer`. Will fail at compile.
- [2026-02-07] `packages/mongo/src/client/client.ts:10` — Imports `BSONBinarySerializer`. Will fail at compile.
- [2026-02-07] `packages/broker-redis/src/broker-redis.ts:13` — Imports `AutoBuffer`, uses `getBsonEncoder` (renamed). Will fail at compile.
- [2026-02-07] `packages/framework-debug-api/src/stopwatch-encoding.ts:1-9` — Imports `Writer`, `BaseParser`, `getBSONSizer`, `stringByteLength`. Will fail at compile.
- [2026-02-07] `packages/broker/src/snapshot.ts` — Uses `getBSONSerializer` return as `Uint8Array` (actually `[Uint8Array, number]`). Will fail at runtime.
- [2026-02-07] `packages/broker/src/adapters/deepkit-adapter.ts` — Uses `getBsonEncoder` (renamed). Will fail at compile.
- [2026-02-08] `packages/type/tests/serializer.spec.ts:1153,1180,1204,1363` — 4 tests skipped (`test.skip`): onLoad call (x3), extend with custom type. Pre-existing Jest skips.

## Open Questions
- **BSON array deserialize does NOT benefit from single-doc speedup** — Per-element cost ~55-60ns on both branches. Setup overhead (33ns improvement) is amortized across 1000 elements. Optimization target: investigate if shape JIT can reduce per-element overhead for array deserialization.

## Generation Log
- [2026-02-04] Gen 1-35: BSON rewrite foundations
- [2026-02-06] Gen 36-40: BinaryBigInt, union coercion, constructor properties, Map/Set, embedded
- [2026-02-07] Gen 41-55: BSON rewrite complete — API cleanup, Jest→node:test, perf optimization, union fixes
- [2026-02-08] Gen 56: Created @deepkit/type perf regression tests. Discovered union validation 1000x slower.
- [2026-02-08] Gen 57: Fixed union validation perf — O(1) discriminator dispatch.
- [2026-02-08] Gen 58: ReceiveType overhead optimizations.
- [2026-02-08] Gen 59: Hybrid direct argument passing for ReceiveType.
- [2026-02-08] Gen 60: Node:test migration — bson, type-compiler, type.
- [2026-02-08] Gen 61: Fixed serialize/null issue — `useDefineForClassFields: false`.
- [2026-02-08] Gen 62: Created PR description and commit cleanup plan.
- [2026-02-08] Gen 63: Discovered catastrophic perf regression for nested class types.
- [2026-02-08] Gen 64: Fixed perf regressions (3 bugs in state.ts + handlers.ts).
- [2026-02-08] Gen 65: Handover — perf fix uncommitted.
- [2026-02-08] Gen 66: Benchmarked both branches. Fixed 9 uncached guard rebuilds. Medium validate/is still slow.
- [2026-02-08] Gen 67: Inlined index signatures. ALL 12 type benchmarks beat master.
- [2026-02-08] Gen 68: Ran BSON benchmarks. Found shared-buffer corruption bug in benchmarks. Fixed: all 22 BSON benchmarks beat master. Fixed bson-js comparison benchmark for new API.
- [2026-02-08] Gen 69: Fixed BSON array perf — 60-90x improvement. Deepkit 6-12x faster than bson-js at ALL sizes.
- [2026-02-08] Gen 70: Ran all 53 BSON perf-regression tests (pass). Ran master comparison benchmarks. Updated PR description with 3 numbers per benchmark (ops/sec, vs master, vs bson-js). Executed commit plan — squashed 306+ commits into 21 clean semantic commits. Discovered array deserialize does not scale with single-doc improvement.

---
*End of handover. Next: prove perf is optimal (update bson-js, re-run benchmarks), then fix consumer BSON imports.*
