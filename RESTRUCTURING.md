# 0x7B: Restructuring Deepkit Framework

> **Status**: Discussion/Planning Phase
> 
> This document outlines the plan to restructure the Deepkit framework into 0x7B due to trademark issues. The goal is to create a more focused, performant, and user-friendly framework with excellent DX.

## Table of Contents
- [Overview](#overview)
- [Current State Analysis](#current-state-analysis)
- [Proposed Structure](#proposed-structure)
- [API Changes](#api-changes)
- [Technical Changes](#technical-changes)
- [Migration Strategy](#migration-strategy)
- [Performance Considerations](#performance-considerations)

---

## Overview

### Why the Change?

1. **Trademark Issues**: European Union "no genuine use" ruling requires a rename
2. **Package Consolidation**: 57+ packages is overwhelming for users
3. **Performance**: Need to rethink JIT strategy for better cross-runtime support
4. **Developer Experience**: Simpler, more predictable API surface
5. **Modern Standards**: ESM-first, tree-shakeable, zero-bloat

### New Identity: 0x7B

- **Name**: 0x7B (hexadecimal for the `{` character)
- **Packages**: Focused, cohesive packages with clear boundaries
- **Philosophy**: SOLID principles, minimal dependencies, cross-runtime
- **Inspiration**: Spring, Symfony, Laravel (but for TypeScript)

---

## Current State Analysis

### Package Count: 57+ Packages

#### Core/Foundation (5 packages)
- `@deepkit/core` - Core utilities, decorators, types, perf, timer, network
- `@deepkit/type` - Type reflection, serialization, validation (JIT-based)
- `@deepkit/type-compiler` - TypeScript compiler integration
- `@deepkit/type-spec` - Type specifications
- `@deepkit/bench` - Benchmarking utilities

#### Application Framework (11 packages)
- `@deepkit/app` - Application framework, CLI commands, configuration
- `@deepkit/injector` - Dependency injection container, modules, providers
- `@deepkit/event` - Event system
- `@deepkit/logger` - Logging infrastructure
- `@deepkit/stopwatch` - Performance measurement
- `@deepkit/workflow` - Workflow management
- `@deepkit/template` - Template engine
- `@deepkit/framework` - Full framework integration
- `@deepkit/framework-integration` - Framework integration helpers
- `@deepkit/framework-debug-api` - Debug API
- `@deepkit/framework-debug-gui` - Debug GUI

#### Serialization/Codecs (1 package)
- `@deepkit/bson` - BSON parser/serializer (JIT-based)

#### Networking/IO (6 packages)
- `@deepkit/http` - HTTP server and router
- `@deepkit/rpc` - RPC framework
- `@deepkit/rpc-tcp` - TCP transport for RPC
- `@deepkit/broker` - Message broker
- `@deepkit/broker-redis` - Redis broker adapter
- `@deepkit/core-rxjs` - RxJS integration

#### Filesystem (6 packages)
- `@deepkit/filesystem` - Filesystem abstraction
- `@deepkit/filesystem-aws-s3` - AWS S3 adapter
- `@deepkit/filesystem-ftp` - FTP adapter
- `@deepkit/filesystem-sftp` - SFTP adapter
- `@deepkit/filesystem-google` - Google Cloud Storage adapter
- `@deepkit/filesystem-database` - Database filesystem adapter

#### Database/ORM (10 packages)
- `@deepkit/orm` - ORM base
- `@deepkit/sql` - SQL abstraction layer (DBAL)
- `@deepkit/postgres` - PostgreSQL adapter
- `@deepkit/mysql` - MySQL adapter
- `@deepkit/sqlite` - SQLite adapter
- `@deepkit/mongo` - MongoDB adapter
- `@deepkit/orm-integration` - ORM integration helpers
- `@deepkit/orm-browser` - ORM browser tool
- `@deepkit/orm-browser-api` - ORM browser API
- `@deepkit/orm-browser-gui` - ORM browser GUI

#### UI/Frontend (8 packages)
- `@deepkit/ui-library` - UI component library
- `@deepkit/type-angular` - Angular integration for types
- `@deepkit/angular-ssr` - Angular SSR
- `@deepkit/desktop-ui` - Desktop UI components
- `@deepkit/api-console-api` - API Console API
- `@deepkit/api-console-gui` - API Console GUI
- `@deepkit/api-console-module` - API Console module
- Plus: framework-debug-gui, orm-browser-gui (counted above)

#### Utilities (10 packages)
- `@deepkit/topsort` - Topological sorting
- `@deepkit/run` - Runtime utilities
- `@deepkit/bun` - Bun runtime support
- `@deepkit/vite` - Vite integration
- `@deepkit/create-app` - App scaffolding
- `@deepkit/skeleton` - Project skeleton
- `@deepkit/devtool` - Development tools
- Plus: desktop-ui, example-app, framework-examples (some dev/example packages)

### Dependency Graph (Current)

```
@deepkit/core [dot-prop, to-fast-properties]
  ↓
@deepkit/type [@deepkit/core, @deepkit/type-spec, uuid, buffer]
  ↓
@deepkit/bson [@deepkit/core, @deepkit/type]
  ↓
@deepkit/injector [@deepkit/core, @deepkit/type]
  ↓
@deepkit/app [@deepkit/core, @deepkit/type, @deepkit/injector]
  ↓
@deepkit/http [@deepkit/app, @deepkit/event, @deepkit/logger, ...]
@deepkit/orm [@deepkit/core, @deepkit/type, @deepkit/event, ...]
@deepkit/rpc [@deepkit/bson, @deepkit/core, @deepkit/injector, ...]
  ↓
@deepkit/framework [depends on ~14 @deepkit/* packages]
```

**Issues with Current Structure:**
- Too many packages for users to install and track
- Unclear boundaries between packages
- Deep dependency chains
- Hard to know which package provides which functionality
- Installation overhead with 10+ packages for basic app

---

## Proposed Structure

### Core Package Organization

The framework will be organized into focused packages with clear responsibilities. The structure emphasizes modularity and ease of use rather than a specific package count.

```
@7b/runtime    [no dependencies]
@7b/reflection [@7b/runtime]
@7b/codec      [@7b/runtime, @7b/reflection]
@7b/core       [@7b/runtime, @7b/reflection, @7b/codec]
@7b/io         [@7b/core, @7b/codec]
@7b/db         [@7b/core, @7b/codec]
@7b/ui         [@7b/core, @7b/codec]
```

**Note**: This structure may evolve. Additional packages may be added if they improve clarity and maintainability. The goal is logical organization, not adherence to a specific number.

### Package Responsibilities

#### 1. @7b/runtime

**Purpose**: Abstraction over JavaScript runtimes, benchmarks, core utilities

**Consolidates**:
- `@deepkit/core` (utilities, decorators, types, perf, timer, network, etc.)
- `@deepkit/bench` (benchmarking)
- `@deepkit/run` (runtime utilities)
- `@deepkit/bun` (Bun runtime support)

**Exports**:
```typescript
// Core utilities
export { arrayRemoveItem, asyncOperation, sleep } from './utils';
export { ClassType, isClass, isPromise } from './types';
export { getClassName, getClassTypeFromInstance } from './reflection';

// Decorators
export { decorator } from './decorators';

// Performance
export { Performance, PerformanceTimer } from './perf';
export { ProcessLocker } from './process-locker';

// Benchmarking
export { BenchSuite, bench } from './bench';

// Runtime detection
export { isNode, isBrowser, isBun, isDeno } from './runtime';
```

**Key Features**:
- Zero dependencies
- Pure ESM
- Cross-runtime support (Node, Deno, Bun, Browser)
- Tree-shakeable utilities

---

#### 2. @7b/reflection

**Purpose**: Type reflection and type compiler

**Consolidates**:
- `@deepkit/type` (type system, reflection API)
- `@deepkit/type-compiler` (TypeScript compiler integration)
- `@deepkit/type-spec` (type specifications)

**Exports**:
```typescript
// Type reflection
export { ReflectionClass, ReflectionKind } from './reflection';
export { typeOf, reflect } from './reflection';
export type { Type, TypeClass, TypeProperty } from './type';

// Type guards
export { is, assert, validates } from './guards';

// Type utilities
export { serializer, deserializer } from './serializer-facade';

// Compiler (for build tools)
export { transform } from './compiler';
```

**Key Features**:
- Runtime type information
- Type guards and validation
- No JIT compilation (see Technical Changes section)
- Compiler plugin for TypeScript

---

#### 3. @7b/codec

**Purpose**: Binary, BSON, JSON: Serialization, validation, and encodings

**Consolidates**:
- `@deepkit/bson` (BSON serialization)
- Parts of `@deepkit/type` (serializers, validators, change detection)

**Exports**:
```typescript
// Serializers
export { serialize, deserialize } from './serializer';
export { cast, validate } from './validator';

// BSON
export { getBSONSerializer, getBSONDeserializer } from './bson';
export { BSONParser, BSONEncoder } from './bson';

// JSON
export { jsonSerializer } from './json';

// Validation
export { ValidationError, ValidationErrors } from './validation';
export { validator } from './validator';
```

**Key Features**:
- Fast serialization without JIT
- Validation with detailed error messages
- Support for BSON, JSON, and custom formats
- Change detection for ORMs

---

#### 4. @7b/core

**Purpose**: CLI, DI container, logger, typed events, stopwatch, lifecycle

**Consolidates**:
- `@deepkit/app` (application framework, CLI, configuration)
- `@deepkit/injector` (dependency injection)
- `@deepkit/logger` (logging)
- `@deepkit/event` (event system)
- `@deepkit/stopwatch` (performance monitoring)
- `@deepkit/workflow` (workflow engine)
- `@deepkit/template` (template engine)

**Exports**:
```typescript
// Application
export { App } from './app';
export { AppModule } from './module';

// CLI
export { cli, Command, Flag, Arg } from './cli';

// DI Container
export { Injector, InjectorContext } from './injector';
export { provide, inject } from './provider';

// Logger
export { Logger, LoggerInterface } from './logger';
export { ConsoleLogger, MemoryLogger } from './logger';

// Events
export { EventDispatcher, EventListener } from './event';

// Stopwatch
export { Stopwatch, Profiler } from './stopwatch';

// Templates
export { Template, render } from './template';

// Lifecycle
export { onServerBootstrap, onServerShutdown } from './lifecycle';
```

**Example Usage**:
```typescript
import { App, Logger } from '@7b/core';

class MyService {
  constructor(private logger: Logger) {}
  
  doWork() {
    this.logger.log('Working...');
  }
}

const app = new App();
app.command('work', (service: MyService) => {
  service.doWork();
});

await app.run();
```

---

#### 5. @7b/io

**Purpose**: Networking and I/O primitives: HTTP, RPC, Broker, Filesystem

**Consolidates**:
- `@deepkit/http` (HTTP server and router)
- `@deepkit/rpc` (RPC framework)
- `@deepkit/rpc-tcp` (TCP RPC transport)
- `@deepkit/broker` (message broker)
- `@deepkit/broker-redis` (Redis adapter)
- `@deepkit/core-rxjs` (RxJS integration)
- `@deepkit/filesystem` + all filesystem adapters

**Subpackage Structure**:
```typescript
// @7b/io/http
export { HttpServer, HttpRouter, HttpRequest, HttpResponse } from './http';
export { route, http } from './http/decorators';

// @7b/io/rpc
export { RpcServer, RpcClient, RpcKernel } from './rpc';
export { rpc } from './rpc/decorators';
// Optional peer: rxjs

// @7b/io/broker
export { Broker, BrokerBus } from './broker';
export { RedisBroker } from './broker/redis';
// Optional peer: ioredis

// @7b/io/fs
export { Filesystem, FilesystemAdapter } from './fs';
export { LocalFilesystem } from './fs/local';
export { MemoryFilesystem } from './fs/memory';
export { S3Filesystem } from './fs/s3';
export { FTPFilesystem } from './fs/ftp';
export { SFTPFilesystem } from './fs/sftp';
export { GCSFilesystem } from './fs/gcs';
// Optional peers: @aws-sdk/client-s3, basic-ftp, @google-cloud/storage, ssh2-sftp-client
```

**Example Usage**:
```typescript
import { HttpServer, route } from '@7b/io/http';

class MyController {
  @route.get('/')
  home() {
    return { message: 'Hello World' };
  }
}

const app = new App();
app.use(HttpServer);
await app.run();
```

---

#### 6. @7b/db

**Purpose**: DBAL, ORM, PostgreSQL, SQLite, MySQL, MongoDB adapters

**Consolidates**:
- `@deepkit/orm` (ORM core)
- `@deepkit/sql` (SQL abstraction - DBAL)
- `@deepkit/postgres` (PostgreSQL)
- `@deepkit/mysql` (MySQL)
- `@deepkit/sqlite` (SQLite)
- `@deepkit/mongo` (MongoDB)
- `@deepkit/topsort` (internal utility)

**Subpackage Structure**:
```typescript
// @7b/db (main - ORM core)
export { Database, DatabaseAdapter } from './database';
export { Query, entity, PrimaryKey, AutoIncrement } from './orm';
export { Reference, BackReference } from './orm';

// @7b/db/postgres
export { PostgresAdapter } from './postgres';

// @7b/db/mysql
export { MySQLAdapter } from './mysql';

// @7b/db/sqlite
export { SQLiteAdapter } from './sqlite';
// Optional peer: better-sqlite3

// @7b/db/mongo
export { MongoAdapter } from './mongo';
```

**Example Usage**:
```typescript
import { Database, entity, PrimaryKey } from '@7b/db';
import { PostgresAdapter } from '@7b/db/postgres';

@entity
class User {
  id: number & PrimaryKey = 0;
  name: string = '';
}

const database = new Database({
  adapter: new PostgresAdapter('postgres://localhost/mydb')
});

const users = await database.query(User).find();
```

---

#### 7. @7b/ui

**Purpose**: Angular UI components and frontend integrations

**Consolidates**:
- `@deepkit/ui-library` (UI components)
- `@deepkit/type-angular` (Angular type integration)
- `@deepkit/angular-ssr` (Server-side rendering)
- `@deepkit/desktop-ui` (Desktop UI components)
- `@deepkit/api-console-api` + gui + module (API console)
- `@deepkit/framework-debug-api` + gui (Debug tools)
- `@deepkit/orm-browser` + related (ORM browser)

**Exports**:
```typescript
// Core UI components
export { Button, Input, Select, Table } from './components';

// Angular integration
export { TypeModule } from './angular';

// API Console
export { ApiConsoleModule } from './api-console';

// Debug Tools
export { DebugModule } from './debug';

// ORM Browser
export { OrmBrowserModule } from './orm-browser';
```

**Optional Peers**: `angular`, `rxjs`

---

## API Changes

### Import Path Changes

**Before (Deepkit)**:
```typescript
import { isClass } from '@deepkit/core';
import { serialize, deserialize } from '@deepkit/type';
import { getBSONSerializer } from '@deepkit/bson';
import { App } from '@deepkit/app';
import { Injector } from '@deepkit/injector';
import { Logger } from '@deepkit/logger';
import { HttpRouter } from '@deepkit/http';
import { Database } from '@deepkit/orm';
import { PostgresAdapter } from '@deepkit/postgres';
```

**After (0x7B)**:
```typescript
import { isClass } from '@7b/runtime';
import { serialize, deserialize } from '@7b/codec';
import { getBSONSerializer } from '@7b/codec';
import { App, Injector, Logger } from '@7b/core';
import { HttpRouter } from '@7b/io/http';
import { Database } from '@7b/db';
import { PostgresAdapter } from '@7b/db/postgres';
```

### Simplified Application Setup

**Before (Deepkit)**:
```typescript
import { App } from '@deepkit/app';
import { FrameworkModule } from '@deepkit/framework';
import { Logger } from '@deepkit/logger';
import { HttpRouter } from '@deepkit/http';
import { Database } from '@deepkit/orm';
import { PostgresAdapter } from '@deepkit/postgres';

const app = new App({
  imports: [new FrameworkModule()],
  providers: [
    { provide: Database, useFactory: () => new Database(new PostgresAdapter('postgres://localhost/db')) }
  ]
});
```

**After (0x7B)**:
```typescript
import { App, Logger } from '@7b/core';
import { HttpServer } from '@7b/io/http';
import { Database } from '@7b/db';
import { PostgresAdapter } from '@7b/db/postgres';

const app = new App();
app.use(HttpServer);
app.use({
  provide: Database,
  useFactory: () => new Database(new PostgresAdapter('postgres://localhost/db'))
});
```

### Type System API Simplification

**Before (Deepkit)**:
```typescript
import { serialize, deserialize, cast, validate } from '@deepkit/type';
import { getBSONSerializer } from '@deepkit/bson';

interface User {
  id: number;
  name: string;
  email: string;
}

const serializer = getBSONSerializer<User>();
const bson = serializer(user);
```

**After (0x7B)**:
```typescript
import { typeOf } from '@7b/reflection';
import { serialize, deserialize, cast, validate } from '@7b/codec';

interface User {
  id: number;
  name: string;
  email: string;
}

// Unified serialization API
const bson = serialize<User>(user, 'bson');
const json = serialize<User>(user, 'json');
```

---

## Technical Changes

### 1. Remove JIT Code Generation

**Problem**: Current implementation uses `new Function()` to generate optimized serializers/deserializers at runtime. This has several issues:
- Doesn't work in environments with strict CSP (Content Security Policy)
- Creates debugging challenges
- Not compatible with some edge runtimes
- Hard to maintain and test

**Current Implementation (Deepkit)**:
```typescript
// Simplified example from @deepkit/bson
function createBSONSerializer<T>(type: Type): (value: T) => Uint8Array {
  const code = generateSerializerCode(type);
  return new Function('value', code) as (value: T) => Uint8Array;
}
```

**New Approach (0x7B)**:
```typescript
// Interpreter-based with optional optimization
function createBSONSerializer<T>(type: Type): (value: T) => Uint8Array {
  const schema = compileSchema(type);
  
  // Use pre-compiled serializers for common patterns
  if (isSimpleObject(schema)) {
    return createOptimizedObjectSerializer(schema);
  }
  
  // Fall back to interpreter for complex cases
  return createInterpreterSerializer(schema);
}
```

**Optimization Strategy**:
1. **Static Analysis**: Pre-generate serializers for known types at build time
2. **Common Patterns**: Highly optimized hand-written serializers for common cases
3. **Adaptive**: Track hot paths and create optimized versions for frequently-used types
4. **V8 Optimization**: Structure code to help V8's optimizer (monomorphic call sites, inline caches)

### 2. Achieve "Fast Properties" Without JIT

**V8 Fast Properties**: V8 uses "fast properties" for objects with stable shapes. We can leverage this without JIT:

```typescript
// Bad: Dynamic property access kills optimization
function serialize(obj: any, props: string[]) {
  for (const prop of props) {
    // V8 can't optimize this
    doSomething(obj[prop]);
  }
}

// Good: Static property access enables optimization
function serialize(obj: User) {
  // V8 can inline and optimize this
  doSomething(obj.id);
  doSomething(obj.name);
  doSomething(obj.email);
}
```

**Solution**: Generate TypeScript code at build time:
```typescript
// Build-time code generation plugin
function generateSerializer(type: Type): string {
  const props = getProperties(type);
  return `
    function serialize${type.name}(obj: ${type.name}): Uint8Array {
      const buffer = new Uint8Array(calculateSize(obj));
      let offset = 0;
      ${props.map(p => `
        // Inline, monomorphic property access
        offset = write${getTypeName(p)}(buffer, offset, obj.${p.name});
      `).join('\n')}
      return buffer;
    }
  `;
}
```

### 3. Build-Time Optimization

**Approach**: Move optimization from runtime to build time using TypeScript compiler plugin:

```typescript
// User writes:
const user = serialize<User>({ id: 1, name: 'John' });

// Compiler transforms to:
const user = __serialize_User_optimized({ id: 1, name: 'John' });

// Where __serialize_User_optimized is generated at build time:
function __serialize_User_optimized(obj: User): Uint8Array {
  // Optimized, unrolled, monomorphic code
  const size = 4 + 4 + utf8Length(obj.name);
  const buffer = new Uint8Array(size);
  writeUInt32(buffer, 0, obj.id);
  writeUInt32(buffer, 4, obj.name.length);
  writeString(buffer, 8, obj.name);
  return buffer;
}
```

### 4. Pure ESM with Conditional Exports

**Package Structure**:
```json
{
  "name": "@7b/io",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./http": {
      "types": "./dist/http/index.d.ts",
      "import": "./dist/http/index.js"
    },
    "./rpc": {
      "types": "./dist/rpc/index.d.ts",
      "import": "./dist/rpc/index.js"
    },
    "./broker": {
      "types": "./dist/broker/index.d.ts",
      "import": "./dist/broker/index.js"
    },
    "./fs": {
      "types": "./dist/fs/index.d.ts",
      "import": "./dist/fs/index.js"
    }
  },
  "sideEffects": false
}
```

### 5. Minimal Dependencies

**Core Packages** (runtime, reflection, codec, core): Zero dependencies
**IO Package**: Only essential deps (formidable for multipart, etc.)
**DB Package**: Only query builders, adapters are peer deps
**UI Package**: Angular and RxJS as peer deps

---

## Migration Strategy

### Phase 1: Planning & Discussion (Current)
- Document current API surface
- Design new API
- Gather community feedback
- Create proof-of-concept for JIT removal

### Phase 2: Infrastructure Setup
- Set up new monorepo structure
- Configure build system for 7 packages
- Set up CI/CD for new packages
- Create migration scripts

### Phase 3: Core Package Migration
1. `@7b/runtime` (minimal dependencies, straightforward)
2. `@7b/reflection` (complex, requires JIT removal)
3. `@7b/codec` (complex, requires JIT removal)
4. `@7b/core` (consolidation of many packages)

### Phase 4: Extended Package Migration
5. `@7b/io` (subpackage structure testing)
6. `@7b/db` (subpackage structure testing)
7. `@7b/ui` (Angular integration, optional)

### Phase 5: Testing & Documentation
- Comprehensive test suite for each package
- Performance benchmarks (compare with Deepkit)
- Migration guide for users
- New documentation site
- Example applications

### Phase 6: Release
- Alpha release for early adopters
- Beta release with migration guide
- 1.0 stable release
- Deprecation plan for @deepkit/* packages

### Automated Migration Tool

Provide a CLI tool to help users migrate:

```bash
npx @7b/migrate ./src
```

The tool would:
1. Update package.json dependencies
2. Update import statements
3. Update API calls with breaking changes
4. Generate a migration report

---

## Performance Considerations

### Benchmarks to Maintain

Current Deepkit is known for excellent performance. We must ensure 0x7B maintains or improves:

1. **Serialization Speed**
   - JSON: serialize/deserialize
   - BSON: serialize/deserialize
   - Compare with: JSON.stringify, BSON lib, msgpack

2. **Validation Speed**
   - Simple objects
   - Complex nested objects
   - Arrays and unions
   - Compare with: Zod, Yup, Joi, AJV

3. **ORM Performance**
   - Query building
   - Hydration
   - Relation loading
   - Compare with: TypeORM, Prisma, MikroORM

4. **DI Container**
   - Service resolution
   - Dependency graph building
   - Compare with: Inversify, TSyringe

5. **HTTP Router**
   - Route matching
   - Parameter extraction
   - Compare with: Express, Fastify, Koa

### Target Performance Goals

- **Serialization**: Within 10% of current Deepkit performance
- **Validation**: Faster than Zod, comparable to AJV
- **ORM**: Faster than TypeORM, comparable to Prisma
- **HTTP**: Comparable to Fastify

### Optimization Techniques (Without JIT)

1. **Build-Time Code Generation**
   - Generate optimized serializers at build time
   - TypeScript compiler plugin
   - Zero runtime overhead for common cases

2. **Monomorphic Code**
   - Avoid dynamic property access
   - Use stable object shapes
   - Help V8 optimize hot paths

3. **Inline Caching**
   - Cache frequently-used type metadata
   - Memoize serializer/deserializer functions
   - LRU cache for dynamic types

4. **Lazy Optimization**
   - Start with interpreter for cold paths
   - Track hot paths
   - Generate optimized code for hot paths after N invocations
   - (Still no `new Function`, use pre-generated code)

5. **WASM for Hot Paths**
   - Consider WASM for parsing/serialization
   - Falls back to JS in unsupported environments
   - Optional optimization, not required

---

## Open Questions for Discussion

### 1. Performance Strategy

**Q**: How do we achieve comparable performance without JIT compilation?

**Options**:
- A) Build-time code generation (TypeScript compiler plugin)
- B) Lazy optimization with pre-generated templates
- C) WASM for hot paths
- D) Accept slight performance loss for better compatibility

**Recommendation**: Combination of A and B. Build-time generation for known types, templates for dynamic types.

### 2. API Design Philosophy

**Q**: Should we optimize for simplicity or power?

**Current Deepkit**: Very powerful, sometimes complex
**Options**:
- A) Simpler API, hide advanced features
- B) Keep power, improve documentation
- C) Layered API (simple facade + advanced API)

**Recommendation**: C - Layered API with good defaults

### 3. Breaking Changes

**Q**: How aggressive should we be with breaking changes?

**Options**:
- A) Maximum compatibility with Deepkit
- B) Clean slate, best possible API
- C) Compatible where possible, break where necessary

**Recommendation**: C - Provide migration tool to ease transition

### 4. TypeScript Version Support

**Q**: Which TypeScript versions should we support?

**Current Deepkit**: ~5.8.3
**Options**:
- A) Latest only (5.8+)
- B) Last 2 major versions (5.x, 4.x)
- C) LTS policy

**Recommendation**: A - Latest TypeScript only, easier to maintain

### 5. Runtime Support

**Q**: Which JavaScript runtimes should we officially support?

**Options**:
- A) Node only (simplest)
- B) Node + Deno + Bun
- C) Node + Deno + Bun + Browser + Edge (Cloudflare Workers, etc.)

**Recommendation**: C - True cross-runtime support

---

## Next Steps

1. **Community Feedback**: Gather input on this proposal
2. **Proof of Concept**: Build a minimal working version of @7b/reflection without JIT
3. **Performance Testing**: Benchmark the new approach vs. current Deepkit
4. **API Refinement**: Iterate on the proposed API based on feedback
5. **Implementation**: Begin migration if POC is successful

---

## Contributing to the Discussion

Please provide feedback on:
- Package structure and responsibilities
- API design and naming
- Performance strategy
- Migration approach
- Any concerns or suggestions

Open issues for discussion:
- [GitHub Issues](https://github.com/marcj/deepkit/issues)
- [Discord](https://discord.gg/U24mryk7Wq)
