# 文档

Deepkit 是一个面向后端应用的开源 TypeScript 框架，在 MIT 许可下免费提供，旨在帮助你构建可扩展且易维护的后端应用。它被设计用于在浏览器和 Node.js 中工作，但也可以在任何合适的 JavaScript 环境中运行。

在这里你可以找到 Deepkit 各个组件的章节以及我们所有包的 API 参考。

如果你需要帮助，欢迎加入我们的[Discord 服务器](https://discord.com/invite/PtfVf7B8UU)或在 [GitHub](https://github.com/marcj/d7) 上提交 issue。

## 章节


- [应用](/documentation/app.md) - 基于命令行界面，使用 Deepkit 编写你的第一个应用。
- [框架](/documentation/framework.md) - 为你的应用添加应用（HTTP/RPC）服务器、API 文档、调试器、集成测试等。
- [运行时类型](/documentation/runtime-types.md) - 了解 TypeScript 运行时类型，以及如何验证与转换数据。
- [依赖注入](/documentation/dependency-injection.md) - 依赖注入容器、控制反转与依赖倒置。
- [文件系统](/documentation/filesystem.md) - 文件系统抽象，以统一方式处理本地与远程文件系统。
- [消息代理](/documentation/broker.md) - 消息代理抽象，用于处理分布式二级缓存、发布/订阅、队列、集中式原子锁或键值存储。
- [HTTP](/documentation/http.md) - HTTP 服务器抽象，用于构建类型安全的端点。
- [RPC](/documentation/rpc.md) - 远程过程调用抽象，用于连接前端与后端，或连接多个后端服务。
- [ORM](/documentation/orm.md) - ORM 与 DBAL，以类型安全的方式存储和查询数据。
- [桌面 UI](/documentation/desktop-ui/getting-started) - 使用 Deepkit 基于 Angular 的 UI 框架构建 GUI 应用。

## API 参考

以下是所有 Deepkit 包的完整列表及其 API 文档链接。

### 组成

- [@d7/app](/documentation/package/app.md)
- [@d7/framework](/documentation/package/framework.md)
- [@d7/http](/documentation/package/http.md)
- [@d7/angular-ssr](/documentation/package/angular-ssr.md)

### 基础设施

- [@d7/rpc](/documentation/package/rpc.md)
- [@d7/rpc-tcp](/documentation/package/rpc-tcp.md)
- [@d7/broker](/documentation/package/broker.md)
- [@d7/broker-redis](/documentation/package/broker-redis.md)

### 文件系统

- [@d7/filesystem](/documentation/package/filesystem.md)
- [@d7/filesystem-ftp](/documentation/package/filesystem-ftp.md)
- [@d7/filesystem-sftp](/documentation/package/filesystem-sftp.md)
- [@d7/filesystem-s3](/documentation/package/filesystem-s3.md)
- [@d7/filesystem-google](/documentation/package/filesystem-google.md)
- [@d7/filesystem-database](/documentation/package/filesystem-database.md)

### 数据库

- [@d7/orm](/documentation/package/orm.md)
- [@d7/mysql](/documentation/package/mysql.md)
- [@d7/postgres](/documentation/package/postgres.md)
- [@d7/sqlite](/documentation/package/sqlite.md)
- [@d7/mongodb](/documentation/package/mongodb.md)

### 基础

- [@d7/type](/documentation/package/type.md)
- [@d7/event](/documentation/package/event.md)
- [@d7/injector](/documentation/package/injector.md)
- [@d7/template](/documentation/package/template.md)
- [@d7/logger](/documentation/package/logger.md)
- [@d7/workflow](/documentation/package/workflow.md)
- [@d7/stopwatch](/documentation/package/stopwatch.md)

### 工具

- [@d7/api-console](/documentation/package/api-console.md)
- [@d7/devtool](/documentation/package/devtool.md)
- [@d7/desktop-ui](/documentation/package/desktop-ui.md)
- [@d7/orm-browser](/documentation/package/orm-browser.md)
- [@d7/bench](/documentation/package/bench.md)
- [@d7/run](/documentation/package/run.md)

### 核心

- [@d7/bson](/documentation/package/bson.md)
- [@d7/core](/documentation/package/core.md)
- [@d7/topsort](/documentation/package/topsort.md)

### 运行时

- [@d7/vite](/documentation/package/vite.md)
- [@d7/bun](/documentation/package/bun.md)
- [@d7/type-compiler](/documentation/package/type-compiler.md)