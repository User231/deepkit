# Documentation

Deepkit is an open-source TypeScript framework for backend applications freely available under the MIT license, designed to help you build scalable and maintainable backend applications. It's designed to work in the browser and Node.js, but can run in any proper JavaScript environment.

Here you find chapters for the different components of Deepkit and API references for all our packages.

If you need help, please feel free to join our [Discord server](https://discord.com/invite/PtfVf7B8UU) or open an issue 
on [GitHub](https://github.com/marcj/d7).

## Chapters


- [App](/documentation/app.md) - Write your first application with Deepkit based on the command line interface.
- [Framework](/documentation/framework.md) - Add application (HTTP/RPC) server, API docs, debugger, integration tests, and more to your application.
- [Runtime Types](/documentation/runtime-types.md) - Learn about TypeScript runtime types, and to validate and transform data.
- [Dependency Injection](/documentation/dependency-injection.md) - Dependency injection container, inversion of control, and dependency inversion.
- [Filesystem](/documentation/filesystem.md) - Filesystem abstraction to work with local and remote files systems in unified way.
- [Broker](/documentation/broker.md) - Message broker abstraction to work with distributed L2 cache, pub/sub, queues, central atomic locks, or key-value store.
- [HTTP](/documentation/http.md) - HTTP server abstraction to build type-safe endpoints.
- [RPC](/documentation/rpc.md) - Remote procedure call abstraction to connect frontend with backend, or to connect multiple backend services.
- [ORM](/documentation/orm.md) - ORM and DBAL to store and query data in a type-safe way.
- [Desktop-UI](/documentation/desktop-ui/getting-started) - Build GUI applications with Deepkit's Angular-based UI framework.

## API Reference

Following is a complete list of all Deepkit packages with links to their API documentation.

### Composition

- [@d7/app](/documentation/package/app.md)
- [@d7/framework](/documentation/package/framework.md)
- [@d7/http](/documentation/package/http.md)
- [@d7/angular-ssr](/documentation/package/angular-ssr.md)

### Infrastructure

- [@d7/rpc](/documentation/package/rpc.md)
- [@d7/rpc-tcp](/documentation/package/rpc-tcp.md)
- [@d7/broker](/documentation/package/broker.md)
- [@d7/broker-redis](/documentation/package/broker-redis.md)

### Filesystem

- [@d7/filesystem](/documentation/package/filesystem.md)
- [@d7/filesystem-ftp](/documentation/package/filesystem-ftp.md)
- [@d7/filesystem-sftp](/documentation/package/filesystem-sftp.md)
- [@d7/filesystem-s3](/documentation/package/filesystem-s3.md)
- [@d7/filesystem-google](/documentation/package/filesystem-google.md)
- [@d7/filesystem-database](/documentation/package/filesystem-database.md)

### Database

- [@d7/orm](/documentation/package/orm.md)
- [@d7/mysql](/documentation/package/mysql.md)
- [@d7/postgres](/documentation/package/postgres.md)
- [@d7/sqlite](/documentation/package/sqlite.md)
- [@d7/mongodb](/documentation/package/mongodb.md)

### Fundamentals

- [@d7/type](/documentation/package/type.md)
- [@d7/event](/documentation/package/event.md)
- [@d7/injector](/documentation/package/injector.md)
- [@d7/template](/documentation/package/template.md)
- [@d7/logger](/documentation/package/logger.md)
- [@d7/workflow](/documentation/package/workflow.md)
- [@d7/stopwatch](/documentation/package/stopwatch.md)

### Tools

- [@d7/api-console](/documentation/package/api-console.md)
- [@d7/devtool](/documentation/package/devtool.md)
- [@d7/desktop-ui](/documentation/package/desktop-ui.md)
- [@d7/orm-browser](/documentation/package/orm-browser.md)
- [@d7/bench](/documentation/package/bench.md)
- [@d7/run](/documentation/package/run.md)

### Core

- [@d7/bson](/documentation/package/bson.md)
- [@d7/core](/documentation/package/core.md)
- [@d7/topsort](/documentation/package/topsort.md)

### Runtime

- [@d7/vite](/documentation/package/vite.md)
- [@d7/bun](/documentation/package/bun.md)
- [@d7/type-compiler](/documentation/package/type-compiler.md)
