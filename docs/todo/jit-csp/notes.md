# JIT/CSP Migration Notes

## Phase 0: Benchmarks (COMPLETE)

**Completed 2026-01-21**

- Created comprehensive benchmark suite in `benchmarks/`
- 306 benchmarks across 15 suites
- Baseline saved: `benchmarks/src/benchmarks/baselines/baseline-pre-jit-refactor.json`
- Fixed BSON export issue (redundant BaseParser export)
- Fixed ESM require() issue in comparison reporter

Key benchmark results (pre-refactor):
- type/serialization: ~2-32M ops/sec depending on complexity
- type/validation: ~12-21M ops/sec
- type/change-detection: ~5-47M ops/sec
- bson/serialization: ~1-6M ops/sec for arrays
- injector: ~27-104M ops/sec

## Phase 1: @deepkit/type Migration

### Investigation Notes

_(Add notes here as you investigate each file)_

### serializer.ts

**Location:** `packages/type/src/serializer.ts`

**Key functions to migrate:**
- `createSerializeFunction()`
- `createTypeGuardFunction()` (if JIT-based)

**Dependencies:**
- CompilerContext from @deepkit/core
- Type reflection APIs

**Notes:**
_(Add investigation notes here)_

---

### change-detector.ts

**Location:** `packages/type/src/change-detector.ts`

**Key functions to migrate:**
- `createJITChangeDetectorForSnapshot()`

**Notes:**
_(Add investigation notes here)_

---

### snapshot.ts

**Location:** `packages/type/src/snapshot.ts`

**Key functions to migrate:**
- `createJITConverterForSnapshot()`

**Notes:**
_(Add investigation notes here)_

---

### path.ts

**Location:** `packages/type/src/path.ts`

**Key functions to migrate:**
- Path resolver JIT compilation

**Notes:**
_(Add investigation notes here)_

---

## Blockers / Issues

_(Track any blockers here)_

## Decisions Made

_(Record architectural decisions here)_
