# API Comparison: Deepkit vs 0x7B

This document provides detailed API comparisons between the current Deepkit framework and the proposed 0x7B framework.

## Table of Contents

- [Type System & Reflection](#type-system--reflection)
- [Serialization & Validation](#serialization--validation)
- [Dependency Injection](#dependency-injection)
- [HTTP Server](#http-server)
- [RPC](#rpc)
- [ORM & Database](#orm--database)
- [CLI & Application](#cli--application)
- [Events](#events)
- [Logging](#logging)

---

## Type System & Reflection

### Current: Deepkit

```typescript
import { typeOf, ReflectionClass, ReflectionKind } from '@deepkit/type';
import { serialize, deserialize, cast, validates, is } from '@deepkit/type';

// Type reflection
interface User {
  id: number;
  name: string;
  email: string;
}

const type = typeOf<User>();
const reflection = ReflectionClass.from<User>();

// Get properties
for (const property of reflection.getProperties()) {
  console.log(property.name, property.type.kind);
}

// Type guards
if (is<User>(data)) {
  // data is User
}

// Validation
const errors = validates<User>(data);
if (errors.length > 0) {
  console.log(errors);
}

// Casting (coercion)
const user = cast<User>(data);
```

### Proposed: 0x7B

```typescript
import { typeOf, ReflectionClass, ReflectionKind } from '@7b/reflection';
import { is, assert, validates } from '@7b/reflection/guards';
import { serialize, deserialize, cast } from '@7b/codec';

// Type reflection (same API)
interface User {
  id: number;
  name: string;
  email: string;
}

const type = typeOf<User>();
const reflection = ReflectionClass.from<User>();

// Get properties (same API)
for (const property of reflection.getProperties()) {
  console.log(property.name, property.type.kind);
}

// Type guards (moved to /guards)
if (is<User>(data)) {
  // data is User
}

// Validation (moved to @7b/codec)
const errors = validates<User>(data);
if (errors.length > 0) {
  console.log(errors);
}

// Casting (moved to @7b/codec)
const user = cast<User>(data);
```

**Key Changes**:
- Type guards separated into `/guards` submodule
- Serialization/validation moved to `@7b/codec`
- Reflection stays in `@7b/reflection`
- Same API surface, different package organization

---

## Serialization & Validation

### Current: Deepkit

```typescript
import { serialize, deserialize } from '@deepkit/type';
import { getBSONSerializer, getBSONDeserializer } from '@deepkit/bson';
import { validate, validates, ValidationError } from '@deepkit/type';

interface User {
  id: number;
  name: string;
  email: string & Email;
}

// JSON serialization (built into @deepkit/type)
const json = serialize<User>(user);
const user2 = deserialize<User>(json);

// BSON serialization (separate package)
const bsonSerializer = getBSONSerializer<User>();
const bson = bsonSerializer(user);

const bsonDeserializer = getBSONDeserializer<User>();
const user3 = bsonDeserializer(bson);

// Validation
const errors = validates<User>(data);
if (errors.length === 0) {
  // valid
}

// Or throw on invalid
const user4 = validate<User>(data); // throws ValidationError
```

### Proposed: 0x7B

```typescript
import { 
  serialize, 
  deserialize, 
  validate, 
  validates,
  ValidationError 
} from '@7b/codec';

interface User {
  id: number;
  name: string;
  email: string & Email;
}

// Unified serialization API
const json = serialize<User>(user, 'json');
const bson = serialize<User>(user, 'bson');
const msgpack = serialize<User>(user, 'msgpack');

// Unified deserialization API
const user2 = deserialize<User>(json, 'json');
const user3 = deserialize<User>(bson, 'bson');

// Validation (same API)
const errors = validates<User>(data);
if (errors.length === 0) {
  // valid
}

// Or throw on invalid (same API)
const user4 = validate<User>(data); // throws ValidationError

// Custom serialization formats
import { registerSerializer } from '@7b/codec';

registerSerializer('custom', {
  serialize: (value, type) => { /* ... */ },
  deserialize: (data, type) => { /* ... */ }
});

const custom = serialize<User>(user, 'custom');
```

**Key Changes**:
- Unified API for all serialization formats
- Single package `@7b/codec` instead of `@deepkit/type` + `@deepkit/bson`
- Format specified as parameter, not separate functions
- Extensible serialization system
- Same validation API

**Performance Strategy**:
```typescript
// Build-time optimization
// User writes:
const json = serialize<User>(user, 'json');

// Compiler plugin generates:
const json = __7b_serialize_User_json(user);

// Where __7b_serialize_User_json is generated at build time:
function __7b_serialize_User_json(obj: User): string {
  return `{"id":${obj.id},"name":"${__7b_escape(obj.name)}","email":"${__7b_escape(obj.email)}"}`;
}
```

---

## Dependency Injection

### Current: Deepkit

```typescript
import { App, AppModule } from '@deepkit/app';
import { InjectorContext, injector } from '@deepkit/injector';

// Define services
class DatabaseService {
  connect() { /* ... */ }
}

class UserService {
  constructor(private db: DatabaseService) {}
  
  getUsers() { /* ... */ }
}

// Module definition
class MyModule extends AppModule {
  providers = [DatabaseService, UserService];
}

// Application
const app = new App({
  imports: [new MyModule()]
});

// Get service from injector
const userService = app.get(UserService);

// Factory providers
const app2 = new App({
  providers: [
    {
      provide: DatabaseService,
      useFactory: (config: Config) => new DatabaseService(config.dbUrl)
    }
  ]
});

// Injection scopes
@injector.transient
class TransientService {}

@injector.singleton
class SingletonService {}
```

### Proposed: 0x7B

```typescript
import { App, Injector, provide, inject } from '@7b/core';

// Define services (no decorators needed by default)
class DatabaseService {
  connect() { /* ... */ }
}

class UserService {
  constructor(private db: DatabaseService) {}
  
  getUsers() { /* ... */ }
}

// Application (simpler registration)
const app = new App();

// Auto-registration (class as provider)
app.use(DatabaseService);
app.use(UserService);

// Get service from injector
const userService = app.get(UserService);

// Factory providers (same API)
app.use({
  provide: DatabaseService,
  useFactory: (config: Config) => new DatabaseService(config.dbUrl)
});

// Value providers
app.use({
  provide: 'API_KEY',
  useValue: process.env.API_KEY
});

// Injection scopes with decorators (opt-in)
import { transient, singleton } from '@7b/core/decorators';

@transient
class TransientService {}

@singleton
class SingletonService {}

// Or functional API
app.use(TransientService, { scope: 'transient' });

// Tagged providers
app.use(PostgresAdapter, { tags: ['database', 'adapter'] });

// Get all tagged services
const adapters = app.getTagged('adapter');
```

**Key Changes**:
- Simpler registration with `app.use()`
- No mandatory module classes (but still supported)
- Decorators are optional
- More flexible provider API
- Tagged services for easier discovery
- Same underlying DI mechanism

---

## HTTP Server

### Current: Deepkit

```typescript
import { App } from '@deepkit/app';
import { FrameworkModule } from '@deepkit/framework';
import { http, HttpRouter, HttpRequest, HttpResponse } from '@deepkit/http';

// Controller with decorators
class UserController {
  @http.GET('/users')
  async listUsers() {
    return [{ id: 1, name: 'John' }];
  }
  
  @http.GET('/users/:id')
  async getUser(id: number) {
    return { id, name: 'John' };
  }
  
  @http.POST('/users')
  async createUser(
    @http.body() user: User,
    request: HttpRequest
  ) {
    return { id: 123, ...user };
  }
}

// Application setup
const app = new App({
  imports: [new FrameworkModule()],
  controllers: [UserController]
});

app.run();

// Manual router
const router = new HttpRouter();
router.get('/users', async () => {
  return [{ id: 1, name: 'John' }];
});
```

### Proposed: 0x7B

```typescript
import { App } from '@7b/core';
import { HttpServer, route, body } from '@7b/io/http';
import type { HttpRequest, HttpResponse } from '@7b/io/http';

// Controller with decorators (similar API)
class UserController {
  @route.get('/users')
  async listUsers() {
    return [{ id: 1, name: 'John' }];
  }
  
  @route.get('/users/:id')
  async getUser(id: number) {
    return { id, name: 'John' };
  }
  
  @route.post('/users')
  async createUser(
    @body() user: User,
    request: HttpRequest
  ) {
    return { id: 123, ...user };
  }
}

// Application setup (simpler)
const app = new App();
app.use(HttpServer);
app.use(UserController);

app.run();

// Functional API (alternative to decorators)
const app2 = new App();
app2.use(HttpServer);

app2.route('GET', '/users', async () => {
  return [{ id: 1, name: 'John' }];
});

app2.route('GET', '/users/:id', async (id: number) => {
  return { id, name: 'John' };
});

// Manual router (lower level)
import { HttpRouter } from '@7b/io/http';

const router = new HttpRouter();
router.get('/users', async () => {
  return [{ id: 1, name: 'John' }];
});
```

**Key Changes**:
- `@http` → `@route` (shorter, clearer)
- No `FrameworkModule` needed
- Direct `app.use()` for registration
- Functional API as alternative to decorators
- Same underlying routing mechanism

---

## RPC

### Current: Deepkit

```typescript
import { App } from '@deepkit/app';
import { FrameworkModule } from '@deepkit/framework';
import { rpc } from '@deepkit/rpc';
import { RpcKernel } from '@deepkit/rpc';

// RPC Controller
class UserRpcController {
  @rpc.action()
  async getUser(id: number): Promise<User> {
    return { id, name: 'John', email: 'john@example.com' };
  }
  
  @rpc.action()
  async updateUser(id: number, data: Partial<User>): Promise<User> {
    return { id, ...data };
  }
}

// Server
const app = new App({
  imports: [new FrameworkModule()],
  controllers: [UserRpcController]
});

// Client
import { RpcClient } from '@deepkit/rpc';

const client = new RpcClient('ws://localhost:8080');
const controller = client.controller<UserRpcController>();

const user = await controller.getUser(123);
```

### Proposed: 0x7B

```typescript
import { App } from '@7b/core';
import { RpcServer, rpc } from '@7b/io/rpc';
import { RpcClient } from '@7b/io/rpc/client';

// RPC Controller (same API)
class UserRpcController {
  @rpc.action()
  async getUser(id: number): Promise<User> {
    return { id, name: 'John', email: 'john@example.com' };
  }
  
  @rpc.action()
  async updateUser(id: number, data: Partial<User>): Promise<User> {
    return { id, ...data };
  }
}

// Server (simpler setup)
const app = new App();
app.use(RpcServer);
app.use(UserRpcController);

// Client (same API)
const client = new RpcClient('ws://localhost:8080');
const controller = client.controller<UserRpcController>();

const user = await controller.getUser(123);

// Alternative: Functional API
const app2 = new App();
app2.use(RpcServer);

app2.rpc('getUser', async (id: number): Promise<User> => {
  return { id, name: 'John', email: 'john@example.com' };
});
```

**Key Changes**:
- Same decorator API
- Simpler server setup
- Optional functional API
- RxJS remains optional peer dependency
- Same transport protocols

---

## ORM & Database

### Current: Deepkit

```typescript
import { entity, PrimaryKey, AutoIncrement, Reference } from '@deepkit/type';
import { Database } from '@deepkit/orm';
import { PostgresAdapter } from '@deepkit/postgres';

// Entity definition
@entity.name('users')
class User {
  id: number & PrimaryKey & AutoIncrement = 0;
  name: string = '';
  email: string = '';
  posts?: Post[] & BackReference;
}

@entity.name('posts')
class Post {
  id: number & PrimaryKey & AutoIncrement = 0;
  title: string = '';
  content: string = '';
  author?: User & Reference;
  authorId?: number;
}

// Database setup
const database = new Database({
  adapter: new PostgresAdapter('postgresql://localhost/mydb'),
  entities: [User, Post]
});

// Queries
const users = await database.query(User).find();
const user = await database.query(User).filter({ id: 1 }).findOne();
const users2 = await database.query(User)
  .filter({ name: { $regex: /john/i } })
  .limit(10)
  .find();

// Relations
const user3 = await database.query(User)
  .filter({ id: 1 })
  .joinWith('posts')
  .findOne();

// Transactions
await database.transaction(async (session) => {
  const user = session.query(User).findOne();
  user.name = 'New Name';
  await session.persist(user);
});
```

### Proposed: 0x7B

```typescript
import { entity, PrimaryKey, AutoIncrement, Reference, BackReference } from '@7b/db';
import { Database } from '@7b/db';
import { PostgresAdapter } from '@7b/db/postgres';

// Entity definition (same API)
@entity.name('users')
class User {
  id: number & PrimaryKey & AutoIncrement = 0;
  name: string = '';
  email: string = '';
  posts?: Post[] & BackReference;
}

@entity.name('posts')
class Post {
  id: number & PrimaryKey & AutoIncrement = 0;
  title: string = '';
  content: string = '';
  author?: User & Reference;
  authorId?: number;
}

// Database setup (same API)
const database = new Database({
  adapter: new PostgresAdapter('postgresql://localhost/mydb'),
  entities: [User, Post]
});

// Queries (same API)
const users = await database.query(User).find();
const user = await database.query(User).filter({ id: 1 }).findOne();
const users2 = await database.query(User)
  .filter({ name: { $regex: /john/i } })
  .limit(10)
  .find();

// Relations (same API)
const user3 = await database.query(User)
  .filter({ id: 1 })
  .joinWith('posts')
  .findOne();

// Transactions (same API)
await database.transaction(async (session) => {
  const user = await session.query(User).findOne();
  user.name = 'New Name';
  await session.persist(user);
});

// Repository pattern (new)
class UserRepository {
  constructor(private db: Database) {}
  
  async findByEmail(email: string): Promise<User | undefined> {
    return this.db.query(User).filter({ email }).findOne();
  }
  
  async findActive(): Promise<User[]> {
    return this.db.query(User).filter({ active: true }).find();
  }
}
```

**Key Changes**:
- Minimal API changes (mostly compatible)
- All database code in `@7b/db`
- Adapters in subpackages (`@7b/db/postgres`, etc.)
- Optional repository pattern support
- Same powerful query builder
- Same migration system

---

## CLI & Application

### Current: Deepkit

```typescript
import { App, cli } from '@deepkit/app';
import { Logger } from '@deepkit/logger';

// Commands with decorators
class MyCommands {
  @cli.command('greet')
  greet(
    @cli.arg name: string,
    @cli.flag loud: boolean = false,
    logger: Logger
  ) {
    const message = `Hello, ${name}!`;
    logger.log(loud ? message.toUpperCase() : message);
  }
}

// Application
const app = new App({
  providers: [MyCommands]
});

app.run();
```

### Proposed: 0x7B

```typescript
import { App, command, arg, flag } from '@7b/core';
import { Logger } from '@7b/core';

// Commands with decorators (similar API)
class MyCommands {
  @command('greet')
  greet(
    @arg name: string,
    @flag loud: boolean = false,
    logger: Logger
  ) {
    const message = `Hello, ${name}!`;
    logger.log(loud ? message.toUpperCase() : message);
  }
}

// Application
const app = new App();
app.use(MyCommands);
app.run();

// Functional API (alternative)
const app2 = new App();

app2.command('greet', (name: string, logger: Logger, loud: boolean = false) => {
  const message = `Hello, ${name}!`;
  logger.log(loud ? message.toUpperCase() : message);
});

app2.run();

// With metadata
app2.command('greet', {
  description: 'Greet someone',
  args: {
    name: { description: 'Name to greet', required: true }
  },
  flags: {
    loud: { description: 'Shout the greeting', default: false }
  }
}, (name: string, logger: Logger, loud: boolean = false) => {
  const message = `Hello, ${name}!`;
  logger.log(loud ? message.toUpperCase() : message);
});
```

**Key Changes**:
- Simpler `@command` instead of `@cli.command`
- Simpler `@arg` and `@flag` instead of `@cli.arg` and `@cli.flag`
- Functional API as alternative
- Same DI integration
- Same command execution

---

## Events

### Current: Deepkit

```typescript
import { EventDispatcher, EventToken } from '@deepkit/event';

// Define event
class UserCreatedEvent {
  constructor(public user: User) {}
}

// Listen to event
class UserListener {
  @eventDispatcher.listen(UserCreatedEvent)
  onUserCreated(event: UserCreatedEvent) {
    console.log('User created:', event.user);
  }
}

// Dispatch event
class UserService {
  constructor(private dispatcher: EventDispatcher) {}
  
  async createUser(data: User) {
    const user = await this.db.save(data);
    await this.dispatcher.dispatch(new UserCreatedEvent(user));
    return user;
  }
}

// Alternative: event tokens
const userCreated = new EventToken<User>('user.created');

class UserListener2 {
  @eventDispatcher.listen(userCreated)
  onUserCreated(user: User) {
    console.log('User created:', user);
  }
}
```

### Proposed: 0x7B

```typescript
import { EventDispatcher, listen } from '@7b/core';

// Define event (same)
class UserCreatedEvent {
  constructor(public user: User) {}
}

// Listen to event (same decorator, different import)
class UserListener {
  @listen(UserCreatedEvent)
  onUserCreated(event: UserCreatedEvent) {
    console.log('User created:', event.user);
  }
}

// Dispatch event (same API)
class UserService {
  constructor(private dispatcher: EventDispatcher) {}
  
  async createUser(data: User) {
    const user = await this.db.save(data);
    await this.dispatcher.dispatch(new UserCreatedEvent(user));
    return user;
  }
}

// Functional API (new)
const app = new App();

app.on(UserCreatedEvent, (event) => {
  console.log('User created:', event.user);
});

// Event priority
app.on(UserCreatedEvent, (event) => {
  console.log('High priority listener');
}, { priority: 100 });

// Async events
await app.emit(new UserCreatedEvent(user));
```

**Key Changes**:
- Shorter `@listen` decorator
- Same event dispatch mechanism
- New functional API with `app.on()` and `app.emit()`
- Priority support
- Same performance

---

## Logging

### Current: Deepkit

```typescript
import { Logger } from '@deepkit/logger';

class UserService {
  constructor(private logger: Logger) {}
  
  createUser() {
    this.logger.log('Creating user');
    this.logger.warning('Deprecated API');
    this.logger.error('Failed to create user');
  }
}

// Scoped logger
const logger = new Logger(['user-service']);
logger.log('Message'); // [user-service] Message

// Custom logger
import { MemoryLogger } from '@deepkit/logger';
const memLogger = new MemoryLogger();
```

### Proposed: 0x7B

```typescript
import { Logger } from '@7b/core';

class UserService {
  constructor(private logger: Logger) {}
  
  createUser() {
    this.logger.log('Creating user');
    this.logger.warn('Deprecated API'); // .warning → .warn
    this.logger.error('Failed to create user');
  }
}

// Scoped logger (same API)
const logger = new Logger(['user-service']);
logger.log('Message'); // [user-service] Message

// Custom logger (same API)
import { MemoryLogger } from '@7b/core';
const memLogger = new MemoryLogger();

// Structured logging (new)
logger.log('User created', { userId: 123, email: 'test@example.com' });

// Log levels
logger.debug('Debug message');
logger.info('Info message');
logger.warn('Warning message');
logger.error('Error message');

// Child loggers
const childLogger = logger.child({ component: 'auth' });
childLogger.log('Authenticated'); // [user-service:auth] Authenticated
```

**Key Changes**:
- `.warning()` → `.warn()` (standard naming)
- Structured logging support
- Child logger support
- Standard log levels
- Same injection mechanism

---

## Summary of Key API Changes

### Package Consolidation
- 57+ packages → ~7-10 focused packages
- Related functionality grouped together
- Subpackages for logical separation

### Import Simplification
- Fewer imports needed
- Clearer package boundaries
- Better tree-shaking

### API Consistency
- Consistent naming across packages
- Functional alternatives to decorators
- Better TypeScript inference

### Performance
- Build-time optimization instead of runtime JIT
- Same or better performance
- Better debugging experience

### Developer Experience
- Simpler application setup
- Less boilerplate
- More predictable API
- Better documentation

---

## Migration Path

Most APIs remain compatible or have simple renames:

1. **Update package names**: `@deepkit/*` → `@7b/*`
2. **Update imports**: Group related imports from consolidated packages
3. **Rename decorators**: `@http.*` → `@route.*`, `@cli.*` → remove prefix
4. **Update serialization**: Use unified API with format parameter
5. **Simplify app setup**: Remove `FrameworkModule`, use `app.use()`

The migration tool will handle most of these changes automatically.
