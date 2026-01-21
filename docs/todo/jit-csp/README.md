# JIT/CSP Migration Project

> **Status:** Phase 1 - Migrate @deepkit/type
> **Priority:** HIGH
> **Documentation:** `docs/jit-csp-refactor.md`

## Quick Start for Agents

```bash
# 1. Read the full technical spec first
cat docs/jit-csp-refactor.md

# 2. Run baseline benchmarks to understand current performance
cd benchmarks && npm run benchmark -- -d src/benchmarks/core/type

# 3. After changes, compare against baseline
npm run benchmark -- --compare-baseline
```

## Current Status

- [x] **Phase 0:** Baseline benchmarks (306 benchmarks, 15 suites)
- [ ] **Phase 1:** Migrate @deepkit/type ← **YOU ARE HERE**
- [ ] **Phase 2:** Migrate @deepkit/bson
- [ ] **Phase 3:** Migrate remaining packages
- [ ] **Phase 4:** Testing & Documentation

## Phase 1 Tasks: @deepkit/type Migration

Migrate these files to use the new `jit` API from `@deepkit/core`:

### Files to Migrate (in order)

| File | Purpose | Complexity | Status |
|------|---------|------------|--------|
| `packages/type/src/serializer.ts` | JSON serialization | High | [ ] |
| `packages/type/src/change-detector.ts` | ORM dirty checking | Medium | [ ] |
| `packages/type/src/snapshot.ts` | ORM snapshots | Medium | [ ] |
| `packages/type/src/path.ts` | Property path resolver | Low | [ ] |

### Migration Pattern

**Before (old CompilerContext):**
```typescript
const compiler = new CompilerContext();
compiler.set('myValue', someValue);
const code = `
    var result = {};
    result.id = data.id;
    return result;
`;
return compiler.build(code, 'data');
```

**After (new jit API):**
```typescript
import { jit } from '@deepkit/core';

const fn = jit.fn<(data: any) => any>((ctx) => {
    const result = ctx.obj();
    ctx.set(result, 'id', ctx.get(ctx.param(0), 'id'));
    ctx.return(result);
});
```

### Key Principles

1. **One file at a time** - Complete migration + tests + benchmarks before moving on
2. **No regressions** - Benchmark comparison must pass (< 10% slowdown allowed)
3. **Tests must pass** - Run `npm run test packages/type/` after each file
4. **Commit after each file** - Safe checkpoints

### Verification Checklist (per file)

```bash
# 1. Typecheck
npm run tsc

# 2. Tests
npm run test packages/type/

# 3. Benchmarks (compare against baseline)
cd benchmarks && npm run benchmark -- -d src/benchmarks/core/type --compare-baseline

# 4. If all pass, commit
git add -A && git commit -m "refactor(type): migrate <filename> to jit API"
```

## Reference

- **New JIT API:** `packages/core/src/jit.ts`
- **Technical Spec:** `docs/jit-csp-refactor.md`
- **Benchmark Baseline:** `benchmarks/src/benchmarks/baselines/baseline-pre-jit-refactor.json`

## Notes

Add investigation notes to `docs/todo/jit-csp/notes.md` as you work.
