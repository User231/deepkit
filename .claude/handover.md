# Handover

*Updated 2026-02-08 (Gen 69)*

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
- **Backup branch**: `feat/next-backup` (points to `5dc5f9120`, predates perf fixes)
- **Active plan**: `.claude/commit-plan.md` — READY TO EXECUTE (all perf regressions fixed, benchmarks done)
- **Working on**: Adding bson-js comparison numbers to PR description, then commit plan execution
- **Dirty files**: none (all committed)
- **Failing tests**: none — all 360 BSON tests pass, all 1975 type tests pass (4 pre-existing skips)
- **Master worktree**: `/Users/marc/bude/deepkit-master` — fully built, has compiled benchmarks for type and bson
- **Verification command**: `git log --oneline -5` (expect: top commit is `perf(bson): fix array serialization/deserialization`)

## Next Steps
1. **Add bson-js comparison numbers to PR description** — `docs/pr-description.md` needs the vs-bson-js numbers. User explicitly requested: "these numbers must be mentioned in the pr-description so people know what they get." Use the data from Benchmark Data section below.
2. **Execute commit plan** — Follow `.claude/commit-plan.md` to squash 306+ commits into semantic history
3. **Verify final state** — Tests must pass, commit history must be clean

## Alignment Check
- **Goal**: Add bson-js comparison numbers to PR description, then clean commit history for PR
- **Scope boundary**: Do NOT fix consumer package imports yet. The array perf issue is FIXED — no more investigation needed.
- **Plan file**: `.claude/commit-plan.md` — execute ONLY after benchmark numbers are added to PR description
- **Recovery**: `git reset --hard feat/next-backup` (loses ALL perf fixes — backup predates them)

## Tasks
- [x] **Fix core BSON benchmark shared-buffer bug** — `benchmarks/src/benchmarks/core/bson/bson.bench.ts` destructure+slice pattern. [status: completed]
- [x] **Run BSON vs bson-js comparison** — Fixed array perf (60-90x improvement). Deepkit now 6-12x faster at ALL sizes. [status: completed]
- [ ] **Add bson-js numbers to PR description** — User explicitly requested these numbers in docs/pr-description.md. [status: pending]
- [ ] **Execute commit plan** — Follow `.claude/commit-plan.md`. [status: pending, blocked by PR description]
- [ ] **Verify final state** — Tests pass, history clean. [status: pending, blocked by commit plan]

## Benchmark Data

### @deepkit/type: feat/next vs master (pre-resolved API)

| Benchmark | feat/next | master | Change |
|-----------|-----------|--------|--------|
| small deserialize | 40.9M | 21.7M | **+88%** |
| medium deserialize | 9.6M | 4.3M | **+124%** |
| union deserialize | 16.5M | 2.2M | **+637%** |
| small serialize | 130.5M | 19.0M | **+587%** |
| medium serialize | 2.0M | 1.3M | **+51%** |
| union serialize | 34.6M | 2.4M | **+1342%** |
| small validate | 63.8M | 20.4M | **+213%** |
| medium validate | 20.6M | 4.9M | **+317%** |
| union validate | 8.5M | 0.5M | **+1605%** |
| small is | 368.5M | 21.1M | **+1649%** |
| medium is | 51.9M | 4.9M | **+960%** |
| union is | 8.9M | 0.5M | **+1679%** |

### @deepkit/bson: feat/next vs master (pre-resolved API)

| Benchmark | feat/next | master | Change |
|-----------|-----------|--------|--------|
| serialize int32 | 145.1M | 17.7M | **+720%** |
| serialize string | 86.2M | 10.9M | **+691%** |
| serialize MongoId | 33.9M | 9.9M | **+243%** |
| serialize UUID | 22.3M | 6.1M | **+266%** |
| serialize sensor (4 fields) | 127.1M | 7.4M | **+1617%** |
| serialize apiMeta (3 strings) | 14.3M | 5.0M | **+186%** |
| deserialize int32 | 117.9M | 29.0M | **+307%** |
| deserialize string | 37.8M | 15.0M | **+152%** |
| deserialize MongoId | 21.5M | 9.3M | **+131%** |
| deserialize UUID | 13.2M | 4.6M | **+187%** |
| deserialize sensor (4 fields) | 21.4M | 13.5M | **+59%** |
| deserialize apiMeta (3 strings) | 12.2M | 3.7M | **+230%** |

### @deepkit/bson vs bson-js (FINAL — after array perf fix)

| Size | Operation | Deepkit | bson-js | Ratio |
|------|-----------|---------|---------|-------|
| 1 item | serialize | 21.7M | 1.85M | **Deepkit 11.7x faster** |
| 1 item | deserialize | 12.4M | 1.73M | **Deepkit 7.2x faster** |
| 10 items | serialize | 1.94M | 175K | **Deepkit 11.1x faster** |
| 10 items | deserialize | 1.05M | 167K | **Deepkit 6.3x faster** |
| 1K items | serialize | 19.1K | 1,885 | **Deepkit 10.1x faster** |
| 1K items | deserialize | 10.7K | 1,757 | **Deepkit 6.1x faster** |
| 10K items | serialize | 1,745 | 182 | **Deepkit 9.6x faster** |
| 10K items | deserialize | 1,088 | 175 | **Deepkit 6.2x faster** |

## Learnings
- ✅ [2026-02-06] **Type compiler resolves `T | undefined` as optional T, not union** — `prop.optional = true` and `prop.type = UUID`.
- ✅ [2026-02-07] **`isBsonTypeCompatible` must handle union types** — Returning false for ALL unions disabled shape JIT.
- ✅ [2026-02-08] **Always use `@deepkit/bench` (`BenchSuite`)** for benchmarks.
- ✅ [2026-02-08] **Type serializer perf regressions: 3 unbounded fn() rebuilds** — Fix: cache at JIT time.
- ✅ [2026-02-08] **`guardObjectFast` handles BOTH `is()` AND `validate()`** — Registered for both objectLiteral and class. `guardObjectScore` is only for union scoring.
- ✅ [2026-02-08] **Medium model perf gap was architectural — FIXED** — Master inlines ALL index signature handling. feat/next now does too via `forKey()` + `state.forKey(key).build()`.
- ✅ [2026-02-08] **`getBSONSerializer` returns `[sharedBuffer, size]` — buffer is reused across ALL serializers globally**. Callers must copy with `buf.slice(0, size)` if they need to keep the data past the next serialize call.
- ✅ [2026-02-08] **BSONBuildState `forIndex()` must NOT increment depth** — Array loop bodies share a single code path (no code bloat). Incrementing depth caused array element objects to be extracted to separate functions at depth >= MAX_DEPTH (3), making array serialization 60-90x slower. The MongoDB cursor response `{ cursor: { firstBatch: Item[] } }` hits depth 3 at `Item` — the most common real-world pattern.
- ✅ [2026-02-08] **Shape JIT must handle primitive arrays (string[], number[], boolean[])** — Without inline support, any document with primitive array fields (e.g., `tags: string[]`) causes shape JIT BAILOUT, forcing ALL elements through the slow `buildDocumentBody` path with per-field name matching.
- ⚠️ [2026-02-08] **BenchSuite executor does NOT prevent V8 dead-code elimination** — Use a `sink` variable: `suite.add('name', () => { sink = fn(data); })`.
- ⚠️ [2026-02-08] **Master BSON benchmark needs compiled JS** — Create `tsconfig.bench.json` with `"reflection": true`, compile with `npx tsc -p packages/bson/tsconfig.bench.json`, run from `dist/bench/`.

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
- [2026-02-07] `packages/framework-debug-api/src/stopwatch-encoding.ts:7-9` — Uses removed BSON internals. Will fail at compile.
- [2026-02-07] `packages/broker/src/snapshot.ts` — Uses `getBSONSerializer` return as `Uint8Array` (actually `[Uint8Array, number]`). Will fail at runtime.
- [2026-02-07] `packages/broker/src/adapters/deepkit-adapter.ts` — Uses `getBsonEncoder` (renamed). Will fail at compile.
- [2026-02-08] `packages/type/tests/serializer.spec.ts:1153,1180,1204,1363` — 4 tests skipped (`test.skip`): onLoad call (x3), extend with custom type. Pre-existing Jest skips.

## Open Questions
*None — array perf issue resolved.*

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
- [2026-02-08] Gen 69: Fixed BSON array perf — 60-90x improvement. Root cause: (1) `forIndex()` incremented depth causing extraction at MAX_DEPTH=3, (2) shape JIT bailed out on primitive arrays. Deepkit now 6-12x faster than bson-js at ALL sizes. Added 12 array perf regression tests (sensor[], mixed[], string[], number[] at 10 and 1000 items in cursor response). Fixed core bson benchmark shared-buffer bug.

---
*End of handover. Next: add bson-js numbers to docs/pr-description.md, then execute commit plan.*
