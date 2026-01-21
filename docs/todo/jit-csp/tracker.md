# @deepkit/type Rewrite Tracker

## Current Status

| Phase | Status | Notes |
|-------|--------|-------|
| jit.ts primitives | ✅ Done | var_, setVar, getVar, switch_, ternary, isInstance added |
| Reset type/src | ⏳ Pending | Need to restore from src-old or git |
| serializer.ts | ⏳ Pending | Core file, do first |
| change-detector.ts | ⏳ Pending | Uses var_/setVar for state |
| snapshot.ts | ⏳ Pending | Similar to serializer |
| path.ts | ⏳ Pending | Simplest, good for validation |
| Testing | ⏳ Blocked | After all files rewritten |

---

## Files Tracking

### Non-JIT Files (copy from src-old)

These files don't use JIT compilation - just copy them:

- `reflection/type.ts` (114KB)
- `reflection/processor.ts` (105KB)
- `reflection/reflection.ts` (55KB)
- `reflection/extends.ts` (32KB)
- `reflection/state.ts`
- `core.ts`, `utils.ts`, `default.ts`
- `changes.ts`, `reference.ts`, `registry.ts`
- `inheritance.ts`, `mixin.ts`, `debug.ts`, `types.ts`
- `validators.ts`, `decorator.ts`, `decorator-builder.ts`
- `type-serialization.ts`

### JIT Files (must rewrite with jit.fn())

| File | Status | Notes |
|------|--------|-------|
| `serializer.ts` | ⏳ | Main compilation, TypeHandlers |
| `serializer-facade.ts` | ✅ | Public API, no JIT needed |
| `change-detector.ts` | ⏳ | Uses var_/setVar/getVar |
| `snapshot.ts` | ⏳ | Similar pattern to serializer |
| `path.ts` | ⏳ | Property path resolution |
| `typeguard.ts` | ✅ | Simple wrapper, no JIT |
| `validator.ts` | ✅ | Simple wrapper, no JIT |
| `index.ts` | ✅ | Just exports |

---

## jit.ts Extensions

| Primitive | Status | Purpose |
|-----------|--------|---------|
| `var_(initial)` | ✅ Added | Create mutable cell |
| `setVar(ref, value)` | ✅ Added | Update mutable cell |
| `getVar(ref)` | ✅ Added | Read mutable cell |
| `switch_(value, cases, default)` | ✅ Added | Switch statement |
| `ternary(cond, then, else)` | ✅ Added | Inline conditional |
| `isInstance(value, ctor)` | ✅ Added | instanceof check |

---

## Previous Failures (for reference)

**Attempt 1**: Agent created jit-based serializer but sub-agents "fixed" by restoring CompilerContext.

**Attempt 2**: Spawned agents fell back to CompilerContext when jit.fn() seemed difficult:
- `change-detector.ts` - ctx.when() state tracking issue
- `path.ts` - Fell back to CompilerContext
- `serializer.ts` - Mixed approach

**Root cause**: Agents default to CompilerContext when patterns don't fit jit.fn() easily.

**Solution**: Extend jit.ts with new primitives (done), never fall back to CompilerContext.

---

## Session Log

### 2026-01-21

- Added jit.ts primitives: var_, setVar, getVar, switch_, ternary, isInstance
- All 181 jit.spec.ts tests passing
- Consolidated docs into plan.md + tracker.md
- Next: Reset type/src, start rewrite
