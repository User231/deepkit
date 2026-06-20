# Migrating to Deepkit v2

Deepkit v2 is a ground-up rewrite of the framework's performance core — the JIT
engine (`@deepkit/core`), the type serializer (`@deepkit/type`), and BSON
(`@deepkit/bson`). It delivers order-of-magnitude speedups (see
[`BENCHMARKS.md`](./BENCHMARKS.md)) plus **CSP compliance** and a cleaner public API.

Most application code needs **no changes**. The breaking changes below affect you
only if you (a) serialize/deserialize BSON directly, (b) relied on `joinWith()`
controlling reference serialization, or (c) extended the serializer internals.

- **Minimum runtime:** Node.js **≥ 20**.
- **TypeScript:** the type-compiler is pinned to TypeScript **5.8.x**.

---

## At a glance

| Area | v1 | v2 | Who is affected |
|---|---|---|---|
| `& Reference` serialization | depended on runtime state (`isReferenceInstance()`) | **always FK** (primary key); opt into nested with `& Inline` | anyone relying on `joinWith()` changing JSON/RPC output |
| BSON serializer return | `(data) => Uint8Array` | `(data) => [Uint8Array, number]` (zero-copy tuple) | direct `@deepkit/bson` users |
| BSON low-level exports | `Writer`, `BaseParser`, `getBSONSizer`, `AutoBuffer`, `stringByteLength`, `ValueWithBSONSerializer` | **removed** | code building BSON wire frames by hand |
| `getBsonEncoder` | that name | renamed **`getBSONEncoder`** | direct callers |
| Serializer extension | `TemplateState` / `addSetter` string templates | `jit.ts` expression-tree `Builder` / `Ref` | custom serializers |
| `filter()` / `orderBy()` typing | open `[key: string]: any` | strict — keyed to entity properties | code with typo'd or dynamically-keyed filters/sorts (now a compile error) |
| Errors | plain `Error` | `DeepkitError` subclasses with `DK-####` codes | code that `catch`es by message |

---

## 1. `& Reference` now always serializes as a foreign key

In v1, whether a `Reference` serialized as a nested object or an FK depended on
the runtime state of the object (`isReferenceInstance()`), which was hard to
predict. **v2 makes it type-driven and deterministic:** a `& Reference` always
serializes as its primary key.

```ts
import { Reference, Inline } from '@deepkit/type';

class Post {
    // v2: always serializes as FK, e.g. { author: 2 }
    author: User & Reference;

    // Opt into nested output for JSON and RPC. Throws if the relation is not loaded.
    // ORM/MongoDB storage is ALWAYS FK regardless of Inline.
    editor: User & Reference & Inline;

    // Inline for JSON output only (not RPC BSON):
    reviewer: User & Reference & Inline<{ only: ['json'] }>;
}
```

**Migration:** if you previously used `query.joinWith('author')` so the serialized
response embedded the joined entity, that no longer affects serialization. Express
the intent on the type instead with `& Inline`. `joinWith()` still controls what is
*loaded* from the database — only its incidental effect on *serialization output* is
gone.

---

## 2. BSON API overhaul

Only relevant if you call `@deepkit/bson` directly. The ORM and the HTTP-RPC bridge
are already migrated internally — typical apps are unaffected.

### 2.1 Serializer returns a zero-copy tuple

```ts
// v1
const serialize = getBSONSerializer<User>();
const bytes: Uint8Array = serialize(user);

// v2 — returns [sharedBuffer, size]
const serialize = getBSONSerializer<User>();
const [buffer, size]: SerializeResult = serialize(user);
```

> ⚠️ **The buffer is a globally shared scratch buffer**, reused across every
> serializer call. If you need to keep the bytes beyond the next serialize call,
> **copy them**: `const out = buffer.slice(0, size);`

### 2.2 Removed and renamed exports

| Removed | Replacement |
|---|---|
| `Writer` | build the frame from the serializer tuple; no public low-level writer |
| `BaseParser` | use `deserializeBSON` / `getBSONEncoder().decode` |
| `getBSONSizer()` | the size is the 2nd element of `SerializeResult` |
| `stringByteLength()` | — (internal) |
| `AutoBuffer` | — (internal; serializer manages its own buffer) |
| `BSONBinarySerializer` | compose via `getBSONEncoder` |
| `ValueWithBSONSerializer` | annotate the type (`MongoId`/`UUID`/`BinaryBigInt`); the `any` path now honors a `BSONValue { value, type }` wrapper |

```ts
// v1
import { getBsonEncoder } from '@deepkit/bson';
// v2 — capitalization fixed
import { getBSONEncoder } from '@deepkit/bson';

const enc = getBSONEncoder<User>();
const bytes = enc.encode(user);   // returns a copy, safe to keep
const back  = enc.decode(bytes);
```

### 2.3 New exports

- `getBSONEncoder<T>()` — high-level encode/decode pair (encode returns an owned copy).
- `deserializeBSONWithoutOptimiser()` — public slow-path deserializer (no shape-learning JIT).
- `SerializeResult` — the `[buffer: Uint8Array, size: number]` tuple alias.

---

## 3. New serializer internals (`jit.ts` Builder)

`@deepkit/type` and `@deepkit/bson` are now built on a new expression-tree
`Builder` in `@deepkit/core` (`jit.ts`) instead of the string-concatenating
`CompilerContext`. `CompilerContext` is retained for back-compat, so existing
callers keep working — but if you wrote a **custom serializer** against the old
template API, it must be ported:

| v1 (`TemplateState`) | v2 (`Builder` / `Ref`) |
|---|---|
| `state.accessor` | the `input: Ref` argument |
| `state.addSetter(x)` | `return x` |
| `state.setContext(...)` / `setVariable(...)` | `b.call(fn, …)` / `b.lit(value)` |
| `executeTemplates(...)` | `ctx.build(type, input)` |
| `serializeObjectLiteral(...)` | `handleObjectLiteral(...)` |
| `ContainerAccessor` | `input.get(key)` |
| `state.parentTypes` (depth) | `ctx.depth` (root entity = 0, its props = 1) |

A handler is now `(type, input: Ref, b: Builder, ctx) => Ref` — it **returns** the
transformed expression rather than emitting strings. To *replace* (not chain) a
default handler, use `HandlerRegistry.replaceKind` / `replaceClass` / `replaceBinary`.
See `packages/sql/src/serializer/sql-serializer.ts` and
`packages/mysql/src/mysql-serializer.ts` for worked examples.

### CSP / restricted runtimes

The new Builder can run as a closure-based **executor** (no `new Function`), so
`@deepkit/type` and `@deepkit/bson` now work under a strict Content-Security-Policy
(no `unsafe-eval`), in Cloudflare Workers / Vercel Edge, and similar sandboxes. In
those environments you lose the type-specialized compiled path (and its peak
throughput) but everything stays correct — the engine still JITs the interpreter to
machine code. On Node/Deno/Bun nothing changes: the full JIT path is used.

---

## 4. Error handling: coded `DeepkitError`s

Every package now throws `DeepkitError` subclasses carrying a stable code
(`DK-T###` type, `DK-B###` bson, `DK-O###` orm, `DK-H###` http, `DK-R###` rpc,
`DK-I###` injector, `DK-MG/PG/MY/SQ###` for the DB adapters) instead of plain
`Error`. If you matched on `error.message` substrings, switch to the code:

```ts
try { /* … */ } catch (e) {
    if (e instanceof DeepkitError && e.code === 'DK-T200') { /* serialization */ }
}
```

---

## 5. New features you may want to adopt

- **`NanoId`** type with validation + serialization.
- **`isStrict<T>()`** (no coercion) and **`isWeak<T>()`** (minimal, max-speed) guards.
- **HTTP**: built-in **CORS** middleware; Express-compat `req.get()` / `req.header()`.
- **type-compiler**: tsconfig `extends` as an array; improved `DeepkitLoader`.
- **filesystem-aws-s3**: `forcePathStyle` for MinIO and other S3-compatible services.
- **framework**: custom CRUD identifier fields; faker replaced with `@faker-js/faker`.

---

## 6. Testing note (contributors)

The framework's own tests moved from **Jest → `node:test`** via the
`@deepkit/run` loader. `expect()` comes from the `@deepkit/run/expect` shim;
`describe`/`test` from `node:test`. Run `docker compose up -d` then `npm run test`.
This does not affect your application's test setup — only Deepkit's internal suite.

---

## Getting help

- Release notes (highlights, breaking changes, bug fixes): [`../CHANGELOG.md`](../CHANGELOG.md)
- Benchmark tables and methodology: [`BENCHMARKS.md`](./BENCHMARKS.md)
- Architecture and data-flow: [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- Per-package reference: [`PACKAGES.md`](./PACKAGES.md)
