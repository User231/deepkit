# 数据库文件系统

此适配器允许你使用数据库 ORM 作为文件系统后端。这意味着所有文件和文件夹都会存储在数据库中。

```sh
npm install @d7/filesystem-database @d7/orm
```

## 用法

```typescript
import { Filesystem } from '@d7/filesystem';
import { FilesystemDatabaseAdapter } from '@d7/filesystem-database';

const database = new Database(new MemoryDatabaseAdapter());
// const database = new Database(new PostgresDatabaseAdapter());
// const database = new Database(new MongoDatabaseAdapter());
// const database = new Database(new MysqlDatabaseAdapter());
// const database = new Database(new SQLiteDatabaseAdapter());

const adapter = new FilesystemDatabaseAdapter({ database });
const filesystem = new Filesystem(adapter);
```