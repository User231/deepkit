<div align="center">
  <img src="https://deepkit.io/assets/images/deepkit_logo.svg" alt="Deepkit Logo" width="200">
  <h1>Deepkit Framework</h1>
  <p><strong>The TypeScript framework with runtime types</strong></p>

  <a href="https://www.npmjs.com/package/@deepkit/type"><img alt="npm" src="https://img.shields.io/npm/v/@deepkit/type.svg" /></a>
  <a href="https://discord.gg/U24mryk7Wq"><img alt="Discord" src="https://img.shields.io/discord/759513055117180999?label=Discord" /></a>
  <a href="https://github.com/deepkit/deepkit-framework/actions/workflows/main.yml"><img alt="CI" src="https://github.com/deepkit/deepkit-framework/actions/workflows/main.yml/badge.svg" /></a>
  <a href="https://opensource.org/licenses/MIT"><img alt="License" src="https://img.shields.io/badge/License-MIT-blue.svg" /></a>
</div>

---

TypeScript types disappear at runtime. Deepkit changes that.

Define your types once and use them everywhere—validation, serialization, database, HTTP, RPC, and dependency injection. No schema duplication. No code generation. Just TypeScript.

## The Problem

In traditional TypeScript development, you define your types, then redefine them for runtime use:

```typescript
// 1. TypeScript interface
interface User {
  id: number;
  email: string;
  createdAt: Date;
}

// 2. Zod schema for validation
const UserSchema = z.object({
  id: z.number(),
  email: z.string().email(),
  createdAt: z.date(),
});

// 3. TypeORM entity for database
@Entity()
class UserEntity {
  @PrimaryColumn()
  id!: number;

  @Column()
  email!: string;

  @Column()
  createdAt!: Date;
}

// Three definitions for the same thing.
```

## The Solution

With Deepkit, one definition works everywhere:

```typescript
import { PrimaryKey, AutoIncrement, Email, MinLength } from '@deepkit/type';

class User {
  id: number & PrimaryKey & AutoIncrement = 0;
  email: string & Email = '';
  createdAt: Date = new Date();

  constructor(public username: string & MinLength<3>) {}
}

// Validation, serialization, database, HTTP, DI — all from the same type.
```

## Features

- **Runtime Types** — TypeScript types preserved at runtime via a compiler plugin
- **Type Annotations** — Validation constraints via intersection types (`string & MinLength<3>`)
- **Zero-Decorator DI** — Dependency injection works on pure TypeScript, no `@Injectable()` needed
- **End-to-End Types** — Same types for frontend, API, transport, and database
- **Type-First ORM** — Database schema inferred directly from TypeScript types
- **Binary RPC** — Type-safe WebSocket/TCP communication with automatic serialization
- **High Performance** — JIT-compiled validation, serialization, and dependency injection
- **Modular** — Use only what you need from 40+ independent packages

## Quick Start

```bash
npm init @deepkit/app@latest my-app
cd my-app
npm start
```

## Runtime Types

The core innovation. TypeScript types become available at runtime:

```typescript
import { cast, validate, serialize, typeOf } from '@deepkit/type';

interface User {
  id: number;
  registered: Date;
  username: string;
}

// Deserialize JSON to typed objects (strings become Dates, etc.)
const user = cast<User>({
  id: 1,
  registered: '2024-01-15T10:30:00Z',
  username: 'peter'
});
user.registered instanceof Date; // true

// Validate data against type
validate<User>({ id: 'not a number' });
// [{ path: 'id', message: 'Not a number' }]

// Serialize to JSON-safe output
serialize<User>(user);
// { id: 1, registered: '2024-01-15T10:30:00.000Z', username: 'peter' }

// Full runtime type reflection
const type = typeOf<User>();
```

## Type-Safe HTTP

Types flow through to your HTTP layer with automatic validation and serialization:

```typescript
import { App } from '@deepkit/app';
import { FrameworkModule } from '@deepkit/framework';
import { http, HttpBody } from '@deepkit/http';
import { MinLength, Positive, Email, PrimaryKey, AutoIncrement } from '@deepkit/type';

class User {
  id: number & PrimaryKey & AutoIncrement = 0;
  createdAt: Date = new Date();

  constructor(
    public username: string & MinLength<3>,
    public email: string & Email
  ) {}
}

class UserController {
  @http.GET('/user/:id')
  get(id: number & Positive): User {
    // id is guaranteed to be a positive number
    return new User('peter', 'peter@example.com');
  }

  @http.POST('/user')
  create(body: HttpBody<Pick<User, 'username' | 'email'>>): User {
    // body is validated and deserialized
    return new User(body.username, body.email);
  }
}

new App({
  controllers: [UserController],
  imports: [new FrameworkModule({ debug: true })]
}).run();
```

## More Features

**Dependency Injection** — Types are injection tokens. No decorators required.
```typescript
class UserService {
  constructor(private db: Database, private logger: Logger) {}
}
```
[Learn more →](https://deepkit.io/documentation/dependency-injection)

**ORM** — Database schema from TypeScript types. Supports PostgreSQL, MySQL, SQLite, MongoDB.
```typescript
const db = new Database(new SQLiteDatabaseAdapter('app.db'), [User]);
await db.persist(new User('peter', 'peter@example.com'));
```
[Learn more →](https://deepkit.io/documentation/orm)

**RPC** — Type-safe remote procedure calls over WebSocket/TCP with automatic serialization.
[Learn more →](https://deepkit.io/documentation/rpc)

## Packages

**Core**
- `@deepkit/type` — Runtime type system, validation, serialization
- `@deepkit/type-compiler` — TypeScript transformer
- `@deepkit/injector` — Dependency injection
- `@deepkit/app` — Application container and CLI

**Web**
- `@deepkit/http` — HTTP router with automatic serialization
- `@deepkit/rpc` — Binary RPC protocol
- `@deepkit/framework` — Full framework integrating all components

**Database**
- `@deepkit/orm` — Database-agnostic ORM
- `@deepkit/sql` — SQL query builder
- `@deepkit/postgres`, `@deepkit/mysql`, `@deepkit/sqlite`, `@deepkit/mongo`

**Infrastructure**
- `@deepkit/broker` — Message broker and cache
- `@deepkit/filesystem` — Virtual filesystem (local, S3, GCS, FTP)
- `@deepkit/logger` — Structured logging
- `@deepkit/event` — Event system

[View all packages →](https://deepkit.io/documentation/packages)

## Documentation

- [Introduction](https://deepkit.io/documentation/introduction)
- [Runtime Types](https://deepkit.io/documentation/runtime-types)
- [Dependency Injection](https://deepkit.io/documentation/dependency-injection)
- [HTTP](https://deepkit.io/documentation/http)
- [ORM](https://deepkit.io/documentation/orm)
- [RPC](https://deepkit.io/documentation/rpc)

## Community Packages

- [OpenAPI](https://github.com/hanayashiki/deepkit-openapi) — Automatic OpenAPI doc and Swagger UI generation
- [Serverless Adapter](https://github.com/H4ad/serverless-adapter) — Run on AWS Lambda, Azure, Digital Ocean
- [REST](https://github.com/deepkit-rest/rest) — Declarative REST API development
- [Stripe](https://github.com/deepkit-community/modules/tree/master/packages/stripe) — Stripe API and webhook integration
- [GraphQL](https://github.com/marcus-sa/deepkit-graphql/tree/main/packages/core) — GraphQL server support
- [Apollo Server](https://github.com/marcus-sa/deepkit-graphql/tree/main/packages/apollo) — Apollo integration
- [Remix](https://github.com/marcus-sa/deepkit-modules/tree/main/packages/remix) — Remix framework integration
- [Remix Validated Form](https://github.com/marcus-sa/deepkit-modules/tree/main/packages/remix-validated-form) — Form validation for Remix
- [Nx Webpack Plugin](https://github.com/marcus-sa/deepkit-modules/tree/main/packages/nx-webpack-plugin) — Nx build tool integration

## Examples

- [Full Application](https://github.com/deepkit/deepkit-framework/blob/master/packages/example-app/app.ts) — HTTP, RPC, CLI, and ORM
- [Minimal HTTP Server](https://github.com/deepkit/deepkit-framework/blob/master/packages/example-app/slim.ts) — HTTP router without full framework
- [Bookstore](https://github.com/marcj/deepkit-bookstore) — REST CRUD API with API Console
- [Webpack](https://github.com/marcj/deepkit-webpack) — Type compiler with Webpack
- [GraphQL + ORM](https://github.com/marcus-sa/deepkit-graphql/tree/main/examples/orm-integration) — GraphQL server with ORM
- [Remix](https://github.com/marcus-sa/deepkit-modules/tree/main/apps/example-remix) — Remix with Deepkit backend
- [Angular SSR](https://github.com/marcus-sa/deepkit-angular-template) — Angular SSR with RPC

## Contributing

See [DEVELOPMENT.md](./DEVELOPMENT.md) for setup instructions.

```bash
git clone https://github.com/deepkit/deepkit-framework.git
cd deepkit-framework
npm install
npm run postinstall  # Required: builds the type compiler
npm run build
```

## License

MIT
