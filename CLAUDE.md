# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## When Working on Issues or Improvements

If asked to fix bugs, improve packages, or work on GitHub issues:

**Read `docs/todo.md` first.** It contains complete agent instructions including:
- How to continue existing work
- How to delegate to sub-agents (you are the orchestrator)
- Rules for commits, tests, and documentation
- Active work and prioritized backlog

**Init prompt for new session**: `open docs/todo.md and continue the work`

## Project Overview

Deepkit Framework is a high-performance, modular TypeScript framework for backend applications based on **runtime types**. The core innovation is the `@deepkit/type-compiler` which transforms TypeScript types into runtime-accessible metadata, enabling features like validation, serialization, and dependency injection to work directly with TypeScript types.

**Key Innovation:** TypeScript types are converted to bytecode at compile time and executed by a runtime VM, eliminating schema duplication across validation, serialization, database, and DI layers.

## Vision and Goals

Deepkit aims to solve the **schema fragmentation problem** in TypeScript:
- **One type definition** works everywhere: validation, serialization, database, HTTP, RPC, DI
- **10-100x faster** than alternatives (class-validator, Zod, etc.)
- **Zero-decorator DI**: Dependency injection works on pure TypeScript without `@Injectable()`
- **Full-stack type safety**: Same types work from frontend to database

See `docs/VISION.md` for competitive analysis and strategic direction.

## Prerequisites

- **Node.js >= 20** is required
- **libpq5** and **libpq-dev** must be installed (for PostgreSQL tests)
- **Yarn 4.x** via corepack for package management

## Build and Development Commands

```bash
# Initial setup (REQUIRED)
yarn
npm run postinstall  # Builds type-compiler

# Development
npm run tsc          # TypeScript build
npm run tsc-watch    # Watch mode

# Testing
npm run test                    # All tests
npm run test packages/type/     # Package tests
node --expose-gc --max_old_space_size=3048 node_modules/jest/bin/jest.js packages/type/tests/serializer.spec.ts  # Single file

# Full build
npm run build        # Full build (several minutes)
npm run clean        # Clean artifacts
```

**Critical:** Always run `npm run postinstall` after cloning or when type-compiler changes.

## Architecture Overview

### Type System Pipeline

```
TypeScript types → type-compiler → ReflectionOp bytecode → processor VM → Type objects
                    (build time)     (Packed arrays)       (runtime)     (JIT compiled)
```

### Package Hierarchy

```
@deepkit/core                 → Utilities, CompilerContext
    ↓
@deepkit/type-spec           → ReflectionOp bytecode definitions (~90 ops)
    ↓
@deepkit/type-compiler       → TypeScript transformer
    ↓
@deepkit/type                → Runtime types, validation, serialization
    ↓
@deepkit/injector            → DI container (types as tokens)
    ↓
@deepkit/app                 → Application container, CLI, config
    ↓
@deepkit/http, /rpc, /orm    → Communication and data layers
    ↓
@deepkit/framework           → Full framework integration
```

See `docs/ARCHITECTURE.md` for detailed data flow diagrams.

## Code Standards

**Formatting:** Prettier via lefthook pre-commit
- 4-space indent for TypeScript
- Single quotes, trailing commas
- Import order: third-party → `@deepkit/*` → relative

**Patterns:**
- `ReceiveType<T>` + `resolveReceiveType()` for runtime type access
- Type annotations via intersection: `string & MinLength<3>`
- JIT compilation via `CompilerContext` for performance

## Key Patterns

### Runtime Type Reflection
```typescript
function example<T>(type?: ReceiveType<T>): Type {
    return resolveReceiveType(type);
}
```

### Type Annotations
```typescript
class User {
    id: number & PrimaryKey & AutoIncrement = 0;
    email: string & Email = '';
}
```

### Zero-Decorator DI
```typescript
class Service {
    constructor(private db: Database, private logger: Logger) {}
}
```

## Testing

- Jest with custom resolver for monorepo
- Tests require type-compiler: `npm run postinstall`
- Memory flags: `--expose-gc --max_old_space_size=3048`
- External services needed for some tests: MongoDB, PostgreSQL, MySQL

See `docs/TESTING.md` for test strategy and edge cases.

## Performance

Deepkit achieves extreme performance through JIT compilation:
- **Serialization**: ~32M ops/sec (100x faster than class-transformer)
- **Validation**: ~26M ops/sec (270x faster than class-validator)
- **BSON**: 13x faster than official bson-js

See `docs/BENCHMARKS.md` for tracking methodology.

## Documentation Structure

```
docs/
├── ARCHITECTURE.md   # Technical architecture, data flows
├── TESTING.md        # Test strategy, coverage, edge cases
├── BENCHMARKS.md     # Performance tracking
├── VISION.md         # Goals, competition, strategy
├── CONTRIBUTING.md   # Development workflow
├── PACKAGES.md       # Package reference guide
├── QUALITY.md        # QA processes
├── ROADMAP.md        # Future plans
│
├── team/             # Team roles (pipeline-based workflow)
│   ├── README.md     # Team intro & pipeline diagram
│   ├── lead.md       # 🧑‍💼 Max - Orchestrator
│   ├── perf.md       # 🏎️ Turbo - Performance guardian
│   ├── security.md   # 🔒 Sam - Security reviewer
│   ├── dx.md         # 🎨 Devon - DX advocate
│   ├── docs.md       # 📝 Dana - Documentation keeper
│   └── impact.md     # 🌊 River - Impact analyst
│
└── todo/             # Issue and task tracking
    ├── todo.md       # Main tracker (GitHub issues, codebase issues)
    ├── _ISSUE_TEMPLATE/
    ├── packages/     # Per-package improvement checklists
    └── <issue-id>/   # Issue-specific work folders
```

## Task Tracking

All task tracking and agent workflow instructions are in `docs/todo.md`.

### Quick Reference

- **Workflow**: `docs/todo.md` (pipeline & backlog)
- **Team roles**: `docs/team/` (who does what)
- **Issue tracking**: `docs/todo/<issue-id>/`

### Pre-commit Hooks (lefthook.yml)

Commits are automatically blocked if:
- Typecheck fails (`npm run typecheck`)
- Lint fails (prettier)
- Commit message doesn't follow conventional format

## Working with This Codebase

### When Making Changes

1. **Run tests** for affected packages
2. **Check performance** if touching hot paths (type, bson, orm)
3. **Update tests** for bug fixes (regression tests)
4. **Consider edge cases** (null, undefined, unions, generics)

### Key Files

| Area | Key Files |
|------|-----------|
| Type compiler | `packages/type-compiler/src/compiler.ts` |
| Runtime processor | `packages/type/src/reflection/processor.ts` |
| Serialization | `packages/type/src/serializer.ts` |
| DI container | `packages/injector/src/injector.ts` |
| Query builder | `packages/orm/src/query.ts` |
| HTTP kernel | `packages/http/src/kernel.ts` |

### Disabling Reflection

```typescript
/** @reflection never */
interface InternalType { }
```

## Project Context

- **Creator**: Marc J. Schmidt (Deepkit UG, Germany)
- **License**: MIT
- **Funding**: 100% self-financed
- **GitHub**: ~3,400 stars, growing adoption
- **Competition**: NestJS (decorator-heavy), tRPC (Zod schemas), Express (manual)

## Success Criteria

When working on this project, optimize for:
1. **Type safety**: Runtime must match compile-time guarantees
2. **Performance**: No regressions, maintain benchmark leadership
3. **Simplicity**: Prefer solutions using native TypeScript types
4. **Integration**: Components should work seamlessly together
