# Roadmap

> **Pruned 2026-07-28.** The original file was the upstream project's public-community
> roadmap (release cadence, npm/Discord growth targets, Q1-2025 documentation and DX
> initiatives, GraphQL/caching/serverless/cloud-platform plans, feature-request process).
> None of that governs this fork, which is not published and is consumed only by the
> applications that vendor it as a submodule. The old text is in git history.

## The fork's actual roadmap

Tracked in [`docs/todo.md`](todo.md):

- **Active:** the TypeScript 7 (Go) transformer — reflection needs a `before` transformer
  host, which TS7 as shipped does not have; the workspace stays pinned to TS 6.0.3 until a
  TS7 path provably emits `__type`.
- **Optional / unscheduled:** migrate the remaining `CompilerContext` users
  (`http`/`injector`/`workflow`) to `jit.ts`; cross-runtime CI; BSON deserialize perf
  ceiling.
- Otherwise: fix what consumers surface, with tests, per the quality gates in
  `docs/todo.md` and the conventions in `CLAUDE.md` (both this repo's own).

Historical record of what already landed (v2 JIT/serializer/BSON, TS 6, standard
decorators, `node:test`, Angular removal): `CHANGELOG.md`, `docs/MIGRATION.md`, and
[`docs/refactor.md`](refactor.md).
