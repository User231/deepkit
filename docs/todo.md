# Deepkit Todo Tracker

> **Init prompt**: `open docs/todo.md and continue the work`

This is the central task tracker for Deepkit development. Read this entire section before starting.

---

## Agent Instructions

### Your Role

You are an **orchestrator/supervisor**. You coordinate work but delegate execution to sub-agents.

### How to Continue Work

1. **Check `docs/todo/` folder** for existing issue folders
2. **Pick an incomplete issue** - read its `README.md` and `notes.md`
3. **Skip items marked `BLOCKED` or `NOT-YET`** - these are not ready
4. **Continue from where the previous agent left off**

If no existing work, pick from "Active Work" or "Backlog" below (prioritize High > Medium > Enhancement).

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

### Complete Workflow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPLETE AGENT WORKFLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   1. INTAKE                                                                  │
│      - Read CLAUDE.md + todo.md                                              │
│      - Pick issue using priority (High > Medium > Enhancement)               │
│                                                                              │
│   2. ANALYSIS                                                                │
│      - Delegate: Explore codebase, find relevant files                       │
│      - Delegate: Analyze issue, investigate root cause                       │
│      - For core packages: Run IMPACT ANALYSIS (see docs/agents/)             │
│      - Update docs/todo/<issue>/notes.md                                     │
│                                                                              │
│   3. IMPLEMENTATION                                                          │
│      - Delegate: Implement fix (writes code)                                 │
│      - Delegate: Write tests                                                 │
│                                                                              │
│   4. VERIFICATION (REQUIRED - see docs/agents/verify-agent.md)               │
│      ┌─────────────────────────────────────────────────────────────────────┐│
│      │ Gate 1: TYPECHECK    - npm run typecheck                            ││
│      │ Gate 2: LINT         - prettier --check                             ││
│      │ Gate 3: TESTS        - npm run test packages/<affected>/            ││
│      │ Gate 4: BENCHMARK    - For hot-path packages (type, bson, orm)      ││
│      │ Gate 5: SECURITY     - For http/rpc/orm/sql changes                 ││
│      │ Gate 6: DX AUDIT     - For error handling, API changes              ││
│      │ Gate 7: DOCUMENTATION - JSDoc, README, examples updated             ││
│      │ Gate 8: IMPACT       - For core package changes                     ││
│      │                                                                     ││
│      │ ANY GATE FAIL → Fix and re-verify                                   ││
│      └─────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│   5. COMMIT (only after all gates pass)                                      │
│      - Conventional commit message                                           │
│      - Reference issue number                                                │
│      - Update docs/todo/<issue>/ status                                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Rules (Non-Negotiable)

1. **Commits**
   - Only commit when a valuable chunk is complete (safe checkpoint)
   - Never amend commits
   - Never commit if typecheck fails (use `tsgo` for fast checking)
   - Never commit if lint fails
   - Never commit if tests fail

2. **Tests**
   - Always run tests before committing: `npm run test packages/<pkg>/`
   - Never simplify or weaken existing tests
   - Never run only a subset of tests to "make it pass"
   - Add regression tests for every bug fix

3. **Documentation**
   - Every issue needs a `docs/todo/<issue-id>/` folder
   - Update `notes.md` as you investigate
   - Update JSDoc for changed public APIs
   - Update README if behavior changes
   - Update this file's "Active Work" table

4. **Performance** (for hot-path packages: type, bson, orm, injector)
   - Run benchmarks before and after changes
   - Block commit if >10% regression
   - See docs/agents/benchmark-agent.md

5. **Security** (for http, rpc, orm, sql, mongo)
   - Review against security checklist
   - See docs/agents/security-agent.md

### Hooks (Implemented in lefthook.yml)

Pre-commit hooks enforce these rules automatically:
- [x] Pre-commit hook: block if `tsgo` typecheck fails
- [x] Pre-commit hook: block if lint fails
- [x] Commit-msg hook: enforce conventional commits
- [ ] Claude hook: warn if trying to modify files without sub-agent (manual)
- [ ] Claude hook: warn if committing without running tests (manual)

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

### Starting New Work

1. Create folder: `cp -r docs/todo/_ISSUE_TEMPLATE docs/todo/<issue-id>`
2. Update "Active Work" table below
3. Read GitHub issue for context (use `gh issue view <number>`)
4. Document approach in `docs/todo/<issue-id>/README.md`
5. Delegate implementation to sub-agents

### Package Improvements

1. Create: `cp docs/todo/packages/_TEMPLATE.md docs/todo/packages/<package>.md`
2. Update package status in tables below
3. Use sub-agents to analyze and improve

---

## Active Work

<!-- Currently being worked on - agents should check here first -->

| Issue | Title | Folder | Status |
|-------|-------|--------|--------|
| - | - | - | - |

## Backlog

### Priority: High

Issues blocking users or causing incorrect behavior.

| Issue | Title | Package | Created |
|-------|-------|---------|---------|
| - | - | - | - |

### Priority: Medium

Issues affecting DX or edge cases.

| Issue | Title | Package | Created |
|-------|-------|---------|---------|
| [#664](https://github.com/deepkit/deepkit-framework/issues/664) | function __types should be hoisted? | type-compiler | 2025-08-11 |
| [#653](https://github.com/deepkit/deepkit-framework/issues/653) | HttpHeader case sensitive in TestingFacade | http | 2025-06-17 |
| [#634](https://github.com/deepkit/deepkit-framework/issues/634) | Named re-exports missing type representations | type-compiler | 2025-03-09 |
| [#601](https://github.com/deepkit/deepkit-framework/issues/601) | exclude declare statements | type-compiler | 2024-07-11 |
| [#600](https://github.com/deepkit/deepkit-framework/issues/600) | Improve tsconfig extends handling | type-compiler | 2024-11-12 |
| [#590](https://github.com/deepkit/deepkit-framework/issues/590) | Ending response at middleware - no log entry | http | 2024-07-06 |
| [#589](https://github.com/deepkit/deepkit-framework/issues/589) | Throwing at HTTP Middlewares | http | 2024-07-06 |
| [#574](https://github.com/deepkit/deepkit-framework/issues/574) | BrokerKeyValue export not found | framework | 2024-06-19 |
| [#565](https://github.com/deepkit/deepkit-framework/issues/565) | validate with generics and arrays | type | 2024-05-08 |
| [#562](https://github.com/deepkit/deepkit-framework/issues/562) | serialize<T> circular import error | type | 2024-05-03 |
| [#555](https://github.com/deepkit/deepkit-framework/issues/555) | No valid runtime type for external imports | type-compiler | 2024-02-16 |
| [#524](https://github.com/deepkit/deepkit-framework/issues/524) | conditional type inference unexpected | type | 2023-12-14 |
| [#509](https://github.com/deepkit/deepkit-framework/issues/509) | Node InferType did not pass test 'isEntityName' | type-compiler | 2025-05-02 |
| [#508](https://github.com/deepkit/deepkit-framework/issues/508) | Improve error "No valid runtime type" | type | 2023-11-16 |
| [#505](https://github.com/deepkit/deepkit-framework/issues/505) | assert circular structure to json | type | 2023-11-10 |
| [#478](https://github.com/deepkit/deepkit-framework/issues/478) | deserialize maximum call stack exceeded | type | 2023-09-29 |
| [#458](https://github.com/deepkit/deepkit-framework/issues/458) | Body parameter in separate file controller | http | 2023-10-04 |
| [#456](https://github.com/deepkit/deepkit-framework/issues/456) | Receive types in Vite from other file | type-compiler | 2023-06-13 |
| [#444](https://github.com/deepkit/deepkit-framework/issues/444) | mongodb BSONError for Array | orm | 2023-05-08 |
| [#430](https://github.com/deepkit/deepkit-framework/issues/430) | Incorrect narrowing of keyof functions | type | 2023-04-12 |
| [#395](https://github.com/deepkit/deepkit-framework/issues/395) | custom identifier in crud routes | orm | 2023-04-13 |

### Enhancement Requests

| Issue | Title | Package | Created |
|-------|-------|---------|---------|
| [#658](https://github.com/deepkit/deepkit-framework/issues/658) | TypeScript 7 support | type-compiler | 2025-06-25 |
| [#636](https://github.com/deepkit/deepkit-framework/issues/636) | hydrate fetched objects in identity map | orm | 2025-03-11 |
| [#609](https://github.com/deepkit/deepkit-framework/issues/609) | ORM adapter for PgLite | orm | 2024-09-05 |
| [#582](https://github.com/deepkit/deepkit-framework/issues/582) | Replace faker with maintained version | core | 2024-06-27 |
| [#575](https://github.com/deepkit/deepkit-framework/issues/575) | Batch mechanism in Message Queue | broker | 2024-06-17 |
| [#572](https://github.com/deepkit/deepkit-framework/issues/572) | Add light theme in documentation | website | 2024-06-07 |
| [#567](https://github.com/deepkit/deepkit-framework/issues/567) | Observability tools | framework | 2024-05-11 |
| [#548](https://github.com/deepkit/deepkit-framework/issues/548) | API SDK extraction | framework | 2024-08-08 |
| [#492](https://github.com/deepkit/deepkit-framework/issues/492) | Deepkit Broker improvements | broker | 2024-05-22 |
| [#488](https://github.com/deepkit/deepkit-framework/issues/488) | RPC with HTTP streams | rpc | 2023-10-11 |
| [#441](https://github.com/deepkit/deepkit-framework/issues/441) | CORS support | http | 2023-04-15 |
| [#439](https://github.com/deepkit/deepkit-framework/issues/439) | Better middleware handling | http | 2023-05-08 |
| [#419](https://github.com/deepkit/deepkit-framework/issues/419) | Support for CUID and NanoId | type | 2023-03-07 |
| [#390](https://github.com/deepkit/deepkit-framework/issues/390) | Simpler query for simple updates | orm | 2022-12-02 |
| [#380](https://github.com/deepkit/deepkit-framework/issues/380) | Babel plugin for type-compiler | type-compiler | 2022-09-26 |

### Documentation

| Issue | Title | Created |
|-------|-------|---------|
| [#641](https://github.com/deepkit/deepkit-framework/issues/641) | Migrations guide for Nest users | 2025-04-02 |
| [#593](https://github.com/deepkit/deepkit-framework/issues/593) | DeepkitLoader setup guide | 2024-07-08 |
| [#591](https://github.com/deepkit/deepkit-framework/issues/591) | Better next() usage docs | 2024-07-06 |
| [#583](https://github.com/deepkit/deepkit-framework/issues/583) | Next.js working setup example | 2025-04-03 |

### Non-Issues (to close/ignore)

| Issue | Title | Reason |
|-------|-------|--------|
| [#666](https://github.com/deepkit/deepkit-framework/issues/666) | Thank you for @deepkit/type | Not an issue - appreciation |
| [#665](https://github.com/deepkit/deepkit-framework/issues/665) | Deepki trademark concern | Off-topic |

---

## Package Improvement Tracking

Each package has standard improvement areas tracked in `docs/todo/packages/<package>.md`.

### Core Packages

| Package | Docs | README | Tests | Perf | Bugs | Status |
|---------|------|--------|-------|------|------|--------|
| type | - | - | - | - | - | Not started |
| type-compiler | - | - | - | - | - | Not started |
| type-spec | - | - | - | - | - | Not started |
| injector | - | - | - | - | - | Not started |
| core | - | - | - | - | - | Not started |

### Application Packages

| Package | Docs | README | Tests | Perf | Bugs | Status |
|---------|------|--------|-------|------|------|--------|
| app | - | - | - | - | - | Not started |
| framework | - | - | - | - | - | Not started |
| http | - | - | - | - | - | Not started |
| rpc | - | - | - | - | - | Not started |

### Data Packages

| Package | Docs | README | Tests | Perf | Bugs | Status |
|---------|------|--------|-------|------|------|--------|
| orm | - | - | - | - | - | Not started |
| bson | - | - | - | - | - | Not started |
| mongo | - | - | - | - | - | Not started |
| sql | - | - | - | - | - | Not started |
| postgres | - | - | - | - | - | Not started |
| mysql | - | - | - | - | - | Not started |
| sqlite | - | - | - | - | - | Not started |

### Infrastructure Packages

| Package | Docs | README | Tests | Perf | Bugs | Status |
|---------|------|--------|-------|------|------|--------|
| broker | - | - | - | - | - | Not started |
| event | - | - | - | - | - | Not started |
| logger | - | - | - | - | - | Not started |
| filesystem | - | - | - | - | - | Not started |
| workflow | - | - | - | - | - | Not started |

### Tooling Packages

| Package | Docs | README | Tests | Perf | Bugs | Status |
|---------|------|--------|-------|------|------|--------|
| vite | - | - | - | - | - | Not started |
| bun | - | - | - | - | - | Not started |
| run | - | - | - | - | - | Not started |

Legend: ✅ Done | 🔄 In Progress | ⚠️ Needs Work | - Not Started

---

## Codebase Analysis Issues

Issues discovered through codebase analysis (not from GitHub).

| ID | Title | Package | Severity | Folder |
|----|-------|---------|----------|--------|
| - | - | - | - | - |

---

## Completed

| Issue | Title | Completed | PR/Commit |
|-------|-------|-----------|-----------|
| [#682](https://github.com/deepkit/deepkit-framework/issues/682) | remove const enum everywhere | 2025-11-29 | [#683](https://github.com/deepkit/deepkit-framework/pull/683) |
| [#614](https://github.com/deepkit/deepkit-framework/issues/614) | HttpQuery validator expression leaks | 2025-02-15 | 4d1a13ec |
| [#612](https://github.com/deepkit/deepkit-framework/issues/612) | Optional chaining SyntaxError | 2026-01-16 | 02c2a6c9 |
| [#598](https://github.com/deepkit/deepkit-framework/issues/598) | Missing shebang in bin/deepkit-sql.js | 2026-01-16 | 7bb2b6f1 |
| [#573](https://github.com/deepkit/deepkit-framework/issues/573) | [bson] make sure NaN is serialized as 0 | 2026-01-18 | 8578bb4f |
| [#676](https://github.com/deepkit/deepkit-framework/issues/676) | [bson] Improve error message | 2026-01-18 | 1367b606 |
| [#668](https://github.com/deepkit/deepkit-framework/issues/668) | query.count() throws error with pagination | 2026-01-18 | 86a8e7ec |
| [#577](https://github.com/deepkit/deepkit-framework/issues/577) | Wrong error message in union validation | 2026-01-18 | 759326d9, 6500cf72 |

---

## Issue Folder Structure

Each issue folder should contain:

```
docs/todo/<issue-id>/
├── README.md       # Issue description, context, approach
├── notes.md        # Investigation notes, findings
├── tasks.md        # Sub-tasks checklist (if complex)
└── comments/       # GitHub comments sync (if needed)
```

## Sync Information

- **Last GitHub sync**: 2026-01-16
- **Open issues**: 50
- **Tracked here**: 48 (excluding non-issues)
