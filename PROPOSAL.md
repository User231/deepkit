# 0x7B Framework Proposal

> A new TypeScript backend & tooling framework inspired by Spring, Symfony, and Laravel.
> Formerly Deepkit — renamed due to trademark issues.

## Design Philosophy

0x7B follows SOLID principles and provides a cohesive set of libraries for building modern full-stack applications.

**Core Values**:
- **Clear responsibilities**: Focused packages with well-defined boundaries
- **Minimal dependencies**: No hidden bloat, drivers and heavy libs are optional peers
- **Tree-shaking first**: All packages ship as pure ESM with side-effect-free exports
- **Cross-runtime support**: Node, Deno, Bun, Browser
- **Full-stack ready**: From CLI tools to UI components
- **Zero dependencies** (core packages): Build on standards, not on npm

---

## Package Structure

### @7b/runtime
**Abstraction over JavaScript runtimes, benchmarks, core utilities**

Zero dependencies. Pure utilities for cross-runtime support.

```typescript
import { isNode, isBrowser, sleep, classToString } from '@7b/runtime';
import { BenchSuite } from '@7b/runtime/bench';
```

---

### @7b/reflection
**Type reflection and type compiler**

Runtime type information for TypeScript without decorators (uses compiler plugin).

```typescript
import { typeOf, ReflectionClass } from '@7b/reflection';
import { is, assert } from '@7b/reflection/guards';

const reflection = ReflectionClass.from<User>();
console.log(reflection.getProperties());
```

---

### @7b/codec
**Binary, BSON, JSON: Serialization, validation, and encodings**

Fast serialization and validation without JIT compilation.

```typescript
import { serialize, deserialize, validate } from '@7b/codec';

const bson = serialize<User>(user, 'bson');
const json = serialize<User>(user, 'json');
const errors = validate<User>(data);
```

---

### @7b/core
**CLI, DI container, logger, typed events, stopwatch, lifecycle**

Application framework with dependency injection, logging, and CLI tools.

```typescript
import { App, Logger, Injector } from '@7b/core';

const app = new App();

app.command('greet', (logger: Logger, name: string) => {
  logger.log(`Hello, ${name}!`);
});

await app.run();
```

---

### @7b/io
**Networking and I/O primitives: HTTP, RPC, Broker, Filesystem**

Modular networking stack with optional peer dependencies.

```typescript
// HTTP Server
import { HttpServer, route } from '@7b/io/http';

class ApiController {
  @route.get('/users/:id')
  getUser(id: number) {
    return { id, name: 'John' };
  }
}

// RPC (optional peer: rxjs)
import { RpcServer } from '@7b/io/rpc';

// Broker (optional peer: ioredis)
import { Broker } from '@7b/io/broker';

// Filesystem (optional peers: @aws-sdk/client-s3, basic-ftp, etc.)
import { Filesystem } from '@7b/io/fs';
import { S3Filesystem } from '@7b/io/fs/s3';
```

---

### @7b/db
**DBAL, ORM, PostgreSQL, SQLite, MySQL, MongoDB adapters**

Type-safe ORM with multiple database adapters.

```typescript
import { Database, entity, PrimaryKey } from '@7b/db';
import { PostgresAdapter } from '@7b/db/postgres';

@entity
class User {
  id: number & PrimaryKey = 0;
  email: string = '';
  name: string = '';
}

const db = new Database({
  adapter: new PostgresAdapter('postgresql://localhost/mydb')
});

const users = await db.query(User).filter({ name: 'John' }).find();
```

**Adapters** (each with minimal deps, drivers as optional peers):
- `@7b/db/postgres` - PostgreSQL (peer: pg)
- `@7b/db/mysql` - MySQL (peer: mysql2)
- `@7b/db/sqlite` - SQLite (peer: better-sqlite3)
- `@7b/db/mongo` - MongoDB (no deps, native protocol)

---

### @7b/ui
**Angular UI components and frontend integrations**

Optional peer dependencies: angular, rxjs

```typescript
import { ApiConsoleModule } from '@7b/ui/api-console';
import { DebugModule } from '@7b/ui/debug';
import { OrmBrowserModule } from '@7b/ui/orm-browser';
```

---

## Dependency Graph

```
@7b/runtime
  ↓
@7b/reflection
  ↓
@7b/codec
  ↓
@7b/core
  ↓
@7b/io ────→ @7b/db ────→ @7b/ui
```

**Optional Peer Dependencies**:
- `@7b/io/rpc` → rxjs
- `@7b/io/broker` → ioredis
- `@7b/io/fs/*` → Various storage drivers (AWS SDK, FTP clients, etc.)
- `@7b/db/postgres` → pg
- `@7b/db/mysql` → mysql2
- `@7b/db/sqlite` → better-sqlite3
- `@7b/ui` → angular, rxjs

---

## Getting Started

### Installation

```bash
# Core framework
npm install @7b/core @7b/reflection

# Add HTTP server
npm install @7b/io

# Add database support
npm install @7b/db @7b/db/postgres pg
```

### Basic Application

```typescript
import { App, Logger } from '@7b/core';
import { HttpServer, route } from '@7b/io/http';
import { Database } from '@7b/db';
import { PostgresAdapter } from '@7b/db/postgres';

// Configuration
class Config {
  database: string = 'postgresql://localhost/mydb';
  port: number = 3000;
}

// HTTP Controller
class ApiController {
  @route.get('/')
  home() {
    return { message: 'Welcome to 0x7B!' };
  }

  @route.get('/users/:id')
  async getUser(id: number, db: Database) {
    return await db.query(User).filter({ id }).findOne();
  }
}

// Application Setup
const app = new App();

// Register HTTP server
app.use(HttpServer);

// Register database with factory
app.use({
  provide: Database,
  useFactory: (config: Config) => new Database({
    adapter: new PostgresAdapter(config.database)
  })
});

// Register controller
app.use(ApiController);

// CLI command
app.command('hello', (logger: Logger, name: string = 'World') => {
  logger.log(`Hello, ${name}!`);
});

// Run the application
await app.run();
```

### Run Commands

```bash
# Start HTTP server
node app.js server:start

# Run CLI command
node app.js hello John

# Get help
node app.js --help
```

---

## Key Differences from Deepkit

### 1. No JIT Compilation

**Deepkit**: Uses `new Function()` to generate optimized serializers at runtime
**0x7B**: Build-time code generation + interpreter for dynamic cases

**Benefits**:
- Works in strict CSP environments
- Better debugging experience
- Cross-runtime compatible
- More maintainable code

### 2. Fewer Packages

**Deepkit**: 57+ packages
**0x7B**: ~7-10 packages with clear boundaries

**Benefits**:
- Easier to learn and navigate
- Simpler dependency management
- More predictable API surface
- Better tree-shaking

### 3. Pure ESM

**Deepkit**: CommonJS with ESM exports
**0x7B**: Pure ESM only (Node 20+)

**Benefits**:
- Smaller bundle sizes
- Better tree-shaking
- Modern standard
- Future-proof

### 4. Optional Peer Dependencies

**Deepkit**: Many packages depend on heavy libraries
**0x7B**: Heavy libraries are optional peers

**Benefits**:
- Install only what you use
- No hidden bloat
- Faster installation
- Smaller node_modules

### 5. Simplified API

**Deepkit**: Powerful but sometimes complex
**0x7B**: Layered API with sensible defaults

**Benefits**:
- Easier to get started
- Better documentation
- Gradual learning curve
- Still powerful when needed

---

## Performance Strategy

### Without JIT, How Do We Stay Fast?

#### 1. Build-Time Code Generation

The TypeScript compiler plugin generates optimized code at build time:

```typescript
// You write:
const json = serialize<User>(user, 'json');

// Compiler generates:
const json = __serialize_User_json_optimized(user);
```

#### 2. Monomorphic Code Patterns

Help V8 optimize by using stable object shapes:

```typescript
// Generated code uses inline, monomorphic property access
function __serialize_User_json_optimized(obj: User): string {
  return `{"id":${obj.id},"name":"${escapeString(obj.name)}"}`;
}
```

#### 3. Lazy Optimization

For dynamic types, start with interpreter and optimize hot paths:

```typescript
const serializer = createSerializer(unknownType);
// First 100 calls: use interpreter
// After 100 calls: generate optimized version from template
```

#### 4. Pre-Generated Templates

Common patterns are pre-generated and optimized:

```typescript
// Simple object with known properties
if (isSimpleObject(type)) {
  return optimizedObjectSerializer;
}

// Array of primitives
if (isArrayOfPrimitives(type)) {
  return optimizedArraySerializer;
}

// Fallback to interpreter
return interpreterSerializer;
```

---

## Migration from Deepkit

### Automated Migration Tool

```bash
npx @7b/migrate
```

**What it does**:
1. Updates package.json dependencies
2. Rewrites import statements
3. Updates API calls with breaking changes
4. Generates migration report

### Manual Migration Steps

1. **Update Dependencies**
   ```bash
   npm uninstall @deepkit/core @deepkit/type @deepkit/app
   npm install @7b/runtime @7b/reflection @7b/codec @7b/core
   ```

2. **Update Imports**
   ```typescript
   // Before
   import { isClass } from '@deepkit/core';
   import { serialize } from '@deepkit/type';
   
   // After
   import { isClass } from '@7b/runtime';
   import { serialize } from '@7b/codec';
   ```

3. **Update Application Setup**
   ```typescript
   // Before
   import { App } from '@deepkit/app';
   import { FrameworkModule } from '@deepkit/framework';
   
   const app = new App({ imports: [new FrameworkModule()] });
   
   // After
   import { App } from '@7b/core';
   import { HttpServer } from '@7b/io/http';
   
   const app = new App();
   app.use(HttpServer);
   ```

4. **Rebuild**
   ```bash
   npm run build
   ```

---

## Roadmap

### Phase 1: Foundation (Q1 2025)
- [ ] Core runtime utilities
- [ ] Type reflection system (no JIT)
- [ ] Serialization & validation
- [ ] Basic benchmarks

### Phase 2: Application Framework (Q2 2025)
- [ ] DI container
- [ ] CLI framework
- [ ] Logging system
- [ ] Event system

### Phase 3: Networking (Q2-Q3 2025)
- [ ] HTTP server & router
- [ ] RPC framework
- [ ] Message broker
- [ ] Filesystem abstraction

### Phase 4: Database (Q3 2025)
- [ ] ORM core
- [ ] PostgreSQL adapter
- [ ] MySQL adapter
- [ ] SQLite adapter
- [ ] MongoDB adapter

### Phase 5: UI & Tools (Q4 2025)
- [ ] Angular UI library
- [ ] API Console
- [ ] Debug tools
- [ ] ORM Browser

### Phase 6: Stable Release (Q4 2025)
- [ ] 1.0 Release
- [ ] Migration guide
- [ ] Complete documentation
- [ ] Example applications

---

## Contributing

We're in the planning phase and welcome feedback on:
- Package structure
- API design
- Performance strategy
- Migration approach

**Join the discussion**:
- GitHub Issues
- Discord: https://discord.gg/U24mryk7Wq

---

## License

MIT

---

## FAQ

### Why rename from Deepkit?

European Union trademark ruling requires the change due to "no genuine use" determination.

### Why 0x7B?

It's hexadecimal for the `{` character (curly brace), which is fundamental to JavaScript/TypeScript. Simple, memorable, no trademark issues.

### Will Deepkit be maintained?

The Deepkit packages will enter maintenance mode. Critical bugs will be fixed, but new features will go to 0x7B.

### Can I use Deepkit and 0x7B together?

Not recommended. They share similar APIs but are incompatible. Use the migration tool to switch.

### What about performance?

We aim to match or exceed Deepkit's performance using build-time optimization instead of runtime JIT compilation.

### When will 0x7B be ready?

Target: Q4 2025 for stable 1.0 release. Alpha/beta releases will come sooner for early adopters.

### How stable is the API?

Still in design phase. Expect changes before 1.0. We'll use semantic versioning after 1.0.
