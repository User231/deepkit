# 0x7B

**The modern TypeScript framework for building high-performance, type-safe full-stack applications.**

<a href="https://discord.gg/U24mryk7Wq"><img alt="Discord" src="https://img.shields.io/discord/759513055117180999?style=square&label=Discord" /></a>
<a href="https://www.npmjs.com/package/@7b/core"><img alt="npm" src="https://img.shields.io/npm/v/@7b/core.svg?style=square" /></a>
[![CI](https://github.com/marcj/deepkit/actions/workflows/main.yml/badge.svg)](https://github.com/marcj/deepkit/actions/workflows/main.yml)

0x7B is a comprehensive TypeScript framework that brings runtime type information, zero-dependency architecture, and enterprise-grade features for building modern applications. Born from Deepkit, restructured with a focus on simplicity and developer experience.

## Why 0x7B?

We've consolidated **56+ packages into 7 focused packages**, making it dramatically easier to understand, install, and use:

- **🚀 Zero Dependencies**: Core packages have no dependencies - install only what you need
- **📦 Simplified Structure**: 7 logical packages instead of 56+ scattered ones
- **🎯 Better DX**: Cleaner imports, predictable APIs, easier navigation
- **⚡ High Performance**: Runtime type system with advanced serialization
- **🔒 Type Safety**: Full TypeScript support with runtime validation
- **🌐 Full-Stack Ready**: From CLI tools to HTTP servers to database ORMs

## Architecture

```
@7b/runtime      → Zero dependencies: core utilities, decorators, benchmarks
@7b/reflection   → Runtime type system and reflection
@7b/codec        → Binary serialization (BSON) and validation
@7b/core         → Application framework: DI, CLI, logging, events
@7b/io           → Networking: HTTP, RPC, message brokers, filesystem
@7b/db           → Database: ORM, migrations, PostgreSQL, MySQL, SQLite, MongoDB
@7b/ui           → Angular UI components and frontend integrations
```

## Quick Start

### Installation

```bash
# Core framework
npm install @7b/core @7b/reflection

# Add networking
npm install @7b/io

# Add database support
npm install @7b/db @7b/db/postgres
```

### Simple HTTP Server

```typescript
import { App } from '@7b/core';
import { HttpServer, route } from '@7b/io/http';

class HelloController {
  @route.get('/hello/:name')
  hello(name: string) {
    return `Hello, ${name}!`;
  }
}

const app = new App();
app.use(HttpServer);
app.use(HelloController);
app.run();
```

### With Database

```typescript
import { App, Logger } from '@7b/core';
import { HttpServer, route } from '@7b/io/http';
import { Database } from '@7b/db';
import { PostgresAdapter } from '@7b/db/postgres';

interface User {
  id: number;
  name: string;
  email: string;
}

class UserController {
  constructor(private database: Database) {}

  @route.get('/users')
  async getUsers() {
    return await this.database.query(User).find();
  }
}

const app = new App();
app.use(HttpServer);
app.use(UserController);
app.use({
  provide: Database,
  useFactory: () => new Database(new PostgresAdapter('postgres://localhost/mydb'))
});
app.run();
```

## Key Features

### Runtime Type System

0x7B provides full runtime type information without decorators:

```typescript
import { serialize, deserialize } from '@7b/codec';

interface User {
  id: number;
  name: string;
  createdAt: Date;
}

const user: User = { id: 1, name: 'Alice', createdAt: new Date() };
const json = serialize<User>(user, 'json');
const bson = serialize<User>(user, 'bson');
const restored = deserialize<User>(json, 'json');
```

### Dependency Injection

Built-in, powerful DI container:

```typescript
import { App } from '@7b/core';

class Database {
  connect() { /* ... */ }
}

class UserService {
  constructor(private db: Database) {}
}

const app = new App();
app.use(Database);
app.use(UserService);
```

### CLI Commands

```typescript
import { App, cli } from '@7b/core';

class Commands {
  @cli.command('migrate')
  async migrate() {
    console.log('Running migrations...');
  }
}

app.use(Commands);
app.run(); // Run: node app.js migrate
```

### Database ORM

Type-safe queries with support for PostgreSQL, MySQL, SQLite, and MongoDB:

```typescript
import { Database } from '@7b/db';
import { entity, PrimaryKey, AutoIncrement } from '@7b/reflection';

@entity
class User {
  id: number & PrimaryKey & AutoIncrement = 0;
  name: string = '';
  email: string = '';
}

const users = await database.query(User)
  .filter({ name: { $regex: /john/i } })
  .orderBy('createdAt', 'desc')
  .limit(10)
  .find();
```

## Migration from Deepkit

The package consolidation provides a clearer, simpler import structure:

```typescript
// Before (Deepkit)
import { isClass } from '@deepkit/core';
import { serialize } from '@deepkit/type';
import { Database } from '@deepkit/orm';
import { PostgresAdapter } from '@deepkit/postgres';
import { Logger } from '@deepkit/logger';
import { HttpRouter } from '@deepkit/http';

// After (0x7B)
import { isClass } from '@7b/runtime';
import { serialize } from '@7b/reflection';
import { Database } from '@7b/db';
import { PostgresAdapter } from '@7b/db/postgres';
import { Logger } from '@7b/core';
import { HttpServer } from '@7b/io/http';
```

Most APIs remain unchanged - it's primarily import path updates. We provide an automated migration tool:

```bash
npx @7b/migrate
```

## Documentation

- [Full Documentation](https://deepkit.io/documentation/introduction)
- [API Reference](https://deepkit.io/documentation/api)
- [Examples](./examples)

## Community Packages

- [OpenAPI](https://github.com/hanayashiki/deepkit-openapi): Automatic OpenAPI doc and Swagger UI generation
- [Serverless Adapter](https://github.com/H4ad/serverless-adapter): Run on AWS Lambda, Azure, Digital Ocean
- [REST](https://github.com/deepkit-rest/rest): Declarative REST API development
- [Stripe](https://github.com/deepkit-community/modules/tree/master/packages/stripe): Stripe integration
- [GraphQL](https://github.com/marcus-sa/deepkit-graphql): GraphQL server support
- [Remix](https://github.com/marcus-sa/deepkit-modules/tree/main/packages/remix): Remix integration

## Examples

- [HTTP, RPC, and CLI controller](./packages/example-app/app.ts)
- [HTTP router with custom server](./packages/example-app/slim.ts)
- [Bookstore](https://github.com/marcj/deepkit-bookstore): Auto REST CRUD + API Console
- [Webpack](https://github.com/marcj/deepkit-webpack): Type Compiler with Webpack
- [GraphQL](https://github.com/marcus-sa/deepkit-graphql/tree/main/examples/orm-integration): GraphQL with ORM
- [Remix](https://github.com/marcus-sa/deepkit-modules/tree/main/apps/example-remix): Remix application
- [Angular](https://github.com/marcus-sa/deepkit-angular-template): Angular SSR with RPC

## Contributing

We welcome contributions! Please see [DEVELOPMENT.md](./DEVELOPMENT.md) for development setup and guidelines.

## License

MIT License - see [LICENSE](./LICENSE)

## Support

- [Discord Community](https://discord.gg/U24mryk7Wq)
- [GitHub Issues](https://github.com/marcj/deepkit/issues)
- [Documentation](https://deepkit.io)
