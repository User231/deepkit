# Deepkit Todo Tracker

> **Init prompt**: `open docs/todo.md and continue the work`
>
> **Last updated:** 2026-07-28 (pruned to current state; the feat/next-era tracker —
> upstream-issue triage tables, JIT-CSP/BSON phase plans, per-package improvement grids —
> lives in this file's git history).

This is the central task tracker for this fork. Read this entire section before starting.

---

## Current State (read this first)

**This fork (`User231/deepkit`) owns Deepkit v2.** Upstream abandoned `feat/next`; the v2
work (expression-tree JIT, serializer rewrite, BSON rewrite) was completed here and is merged
on **`master`** — there is no pending "big PR", no local-first embargo, and no plan to sync
upstream's issue tracker. The fork's consumers are the applications that vendor it as a
submodule; each one's CLAUDE.md + `docs/02-platform/deepkit/*.md` record its own integration
history. This fork does not name them — it is shared, so naming one consumer in here both
goes stale and leaks that product's identity into every other checkout.

Landed and verified (see `CHANGELOG.md` for the full v2 record):

- **v2 JIT** (`core/src/jit.ts`): tiered exec, `canJIT` fallback — CSP/Workers-safe. The last
  CSP gap (`fnJITTop()` compiled unconditionally → `getBSONDeserializer` threw under blocked
  codegen) was fixed 2026-07-28; regression: `packages/bson/tests/csp-fallback.spec.ts`.
- **v2 type serializer + BSON rewrite**: suites green (bson+core 915/915, type ~2000).
- **TypeScript 6.0.3** everywhere; **standard TC39 decorators** (dual-mode runtime).
- **`node:test` via `@deepkit/run`** (Jest fully removed).
- **Angular constellation + website removed** (2026-07-22, `aee7067e3`) — desktop-ui,
  ui-library, devtool, api-console-*, framework-debug-gui, orm-browser*, angular-ssr,
  type-angular, typedoc pipeline. Don't resurrect any of it piecemeal.

---

## Active Work

| Item | Status |
|------|--------|
| **TypeScript 7 (Go) transformer** ([#658](https://github.com/deepkit/deepkit-framework/issues/658)) | The one live workstream. TS7 has no transformer host, and reflection IS a `before` transformer — the fork stays pinned to TS 6.0.3 until a TS7/Go path emits `__type` provably. Gate any TS bump on emitted `__type` in `dist/`, never on the version number. |

## Known Remaining Work (optional, not scheduled)

- **`CompilerContext` (v1 string-JIT) still lives in** `http` (router, request-parser),
  `injector`, `workflow` — server-side packages where `new Function` is always available.
  Migrating them to `jit.ts` only matters if those packages ever need to run under blocked
  codegen (edge runtimes). No current need.
- **AOT tier** from the JIT/CSP design (`docs/design/jit-serializer-design.md`): never built. The
  interpreter fallback covers CSP environments; AOT would only close the perf gap there.
- **Cross-runtime CI** (Deno/Bun/Workers): not built. The no-codegen environment is covered
  in-suite by `csp-fallback.spec.ts` (subprocess with
  `--disallow-code-generation-from-strings`).
- **BSON deserialize perf ceiling**: the original author considered 2.5–13× vs bson-js
  improvable; per-element cost plateaus ~55–60 ns. Benchmarks + baselines exist
  (`benchmarks/`).
- **Test-harness quirk**: under `--disallow-code-generation-from-strings`, the `@deepkit/run`
  loader mis-imports `uuid` in a few bson specs (`uuid_1.v4 is not a function`); plain
  `require('uuid')` works under the flag, so it's loader interop, test-only. Annoying, not
  urgent.

Upstream's GitHub issue backlog is **not tracked here anymore** — this fork fixes what its
consumer needs. The old triage tables (and the 35+ issues fixed during the feat/next work)
are in this file's git history and in `CHANGELOG.md`.

---

## Agent Instructions

### Your Role

You are an **orchestrator/supervisor**. You coordinate work but delegate execution to sub-agents.

### How to Continue Work

1. **Check `docs/todo/` folder** for existing issue folders (only open items live there —
   completed-work archives were removed 2026-07-28, see git history)
2. **Pick an item** from Active Work / Known Remaining Work, or whatever the consuming app
   needs
3. **Skip items marked `BLOCKED` or `NOT-YET`**

### How to Work

**CRITICAL: Never modify files directly. Always delegate to sub-agents.**

```
You (orchestrator)
  ├── Sub-agent: Explore codebase, find relevant files
  ├── Sub-agent: Analyze issue, investigate root cause
  ├── Sub-agent: Implement fix (writes code)
  ├── Sub-agent: Write tests
  ├── Sub-agent: VERIFY (run all quality gates)  ← REQUIRED
  └── Sub-agent: Document changes
```

Why: Keeps context clean, prevents orchestrator from getting lost in details.

### Quality Gates (before every commit)

```
Gate 1: TYPECHECK    - npm run typecheck
Gate 2: LINT         - prettier --check
Gate 3: TESTS        - npm run test packages/<affected>/
Gate 4: BENCHMARK    - For hot-path packages (type, bson, orm)
Gate 5: SECURITY     - For http/rpc/orm/sql changes
Gate 6: DX AUDIT     - For error handling, API changes
Gate 7: DOCUMENTATION - JSDoc, README, examples updated
Gate 8: IMPACT       - For core package changes

ANY GATE FAIL → Fix and re-verify
```

### Rules (Non-Negotiable)

1. **Commits**
   - Only commit when a valuable chunk is complete (safe checkpoint)
   - Never amend commits
   - Never commit if typecheck, lint, or tests fail
   - Conventional commit format (enforced by the commit-msg hook)

2. **Tests**
   - Always run tests before committing: `npm run test packages/<pkg>/`
   - Never simplify or weaken existing tests
   - Never run only a subset of tests to "make it pass"
   - Add regression tests for every bug fix

3. **Documentation**
   - Non-trivial efforts get a `docs/todo/<issue-id>/` folder (template:
     `docs/todo/_ISSUE_TEMPLATE`); update its `notes.md` as you investigate
   - Update JSDoc for changed public APIs; update README if behavior changes
   - Update this file's Active Work table

4. **Performance** (for hot-path packages: type, bson, orm, injector)
   - Run benchmarks before and after changes; block commit if >10% regression
   - `cd benchmarks && npm run benchmark -- --compare-baseline`

5. **Security** (for http, rpc, orm, sql, mongo)
   - Review against the security checklist (`docs/team/security.md`)

### Hooks (Implemented in lefthook.yml)

- [x] Pre-commit: block if typecheck fails
- [x] Pre-commit: block if lint (prettier) fails
- [x] Commit-msg: enforce conventional commits

### Team Roles

See `docs/team/README.md` for the full team intro and pipeline diagram.

| Avatar | Name | Role | When Active |
|--------|------|------|-------------|
| 🧑‍💼 | Max | Lead | Every task - coordinates pipeline |
| 🔍 | Scout | Explorer | Phase 1 - find files, investigate |
| 🔧 | Alex | Implementer | Phase 2 - write code |
| 🧪 | Tess | Tester | Phase 2 - write tests |
| 🏎️ | Turbo | Perf | Phase 3 - hot-path changes |
| 🔒 | Sam | Security | Phase 3 - http/rpc/orm/sql |
| 🎨 | Devon | DX | Phase 3 - error/API changes |
| 📝 | Dana | Docs | Phase 3 - all changes |
| 🌊 | River | Impact | Phase 3 - core packages |

## Issue Folder Structure

Each issue folder should contain:

```
docs/todo/<issue-id>/
├── README.md       # Issue description, context, approach
├── notes.md        # Investigation notes, findings
├── tasks.md        # Sub-tasks checklist (if complex)
└── comments/       # GitHub comments sync (if needed)
```

Housekeeping 2026-07-28: the completed-work archives (numbered issue folders, `bson-rewrite/`
phase docs, jit-csp tracker/failing-tests) were **removed** (git history keeps them), and the
durable design records were promoted to **`docs/design/`** (`jit-serializer-design.md`,
`jit-exec-mode.md`, `bson-{serialization,deserialization}-strategy.md`). What still sits under
`docs/todo/` besides the template is an **open item**.
