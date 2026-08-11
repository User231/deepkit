# Infrastructure Refactor Plan — superseded; fork status

> **Status:** Historical (upstream's feat/next-era master plan, originally 2026-01-20).
> **Pruned:** 2026-07-28 — the full 1,800-line phase plan (custom DB clients, SQL adapter
> unification, Selector API, RPC binary protocol, MessageTemplate/ContextDispatcher
> primitives, phases 7–13) is in this file's **git history**. It is not the fork's plan.
> Current work tracking: [`docs/todo.md`](todo.md).

This fork completed the parts of that plan it needed — the v2 performance core — and
deliberately dropped the rest. Summary so nobody re-derives intent from the old text:

## What landed (on this fork's `master`)

- **JIT/CSP prerequisite — DONE.** v2 `core/src/jit.ts`: expression-tree Builder, tiered
  execution (interpret first, compile hot paths), `canJIT` runtime detection with a
  transparent closure-executor fallback where `new Function` is blocked (strict CSP,
  Cloudflare Workers, `--disallow-code-generation-from-strings`). 2026-07-28: `fnJITTop()`
  gained the same fallback (was the one path that threw under CSP — broke
  `getBSONDeserializer`; regression test `packages/bson/tests/csp-fallback.spec.ts`).
  The AOT tier from the three-tier design was never built (interpreter covers the need).
- **Type serializer rewritten on `jit.fn()`** (`@deepkit/type`) — the v2 headline; see
  `CHANGELOG.md` and `docs/BENCHMARKS.md` for numbers.
- **BSON rewritten** on the same Builder (`@deepkit/bson`) — `Uint8Array`+`DataView`
  throughout (the "remove Buffer" prerequisite, realized in the rewritten packages).
- **Benchmark system** — root `benchmarks/` (core / comparison / v8-patterns) with saved
  baselines and `--compare-baseline` regression gating; `@deepkit/bench` exists.
- **HTTP CORS** (the one Phase-8 item that shipped, as part of v2).
- Adjacent to (not part of) the plan: Jest → `node:test` via `@deepkit/run`;
  TypeScript 6.0.3; standard TC39 decorators; Angular constellation + website removed
  (2026-07-22, `aee7067e3`).

## Still planned

- **TypeScript 7 (Go) transformer** — the one live workstream; see
  [`docs/todo.md`](todo.md) § Active Work.
- Optional, unscheduled: migrate the remaining `CompilerContext` users (`http`, `injector`,
  `workflow` — server-side only) to `jit.ts`; cross-runtime CI; BSON deserialize perf
  ceiling. Listed with context in [`docs/todo.md`](todo.md) § Known Remaining Work.

## Explicitly not pursued (dropped with the upstream plan)

- Phase 0 primitives: `ContextDispatcher`, `ConnectionWriter`, `MessageTemplate`,
  `TopologyManager`, unified streaming.
- Custom binary DB clients (PostgreSQL/MySQL/Redis) — `postgres` still wraps `pg`.
- MongoDB client optimization; SQL adapter unification (Phase 3); Selector API / `query2`
  (Phase 5); RPC binary protocol (Phase 6).
- Phases 7–13 (validator additions, SSE/rate-limit/cache/OpenAPI/HTTP2, DI lifecycle/testing
  utilities, OpenTelemetry/Prometheus/health modules, testing infrastructure, frontend
  integrations, LLM/edge/migration tooling). **No consumer has asked for the framework-level
  versions** — the observability, SSE and rate-limiting pieces are built downstream instead —
  so they stay unbuilt here.
