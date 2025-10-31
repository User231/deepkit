# データベースファイルシステム

このアダプターにより、データベース ORM をファイルシステムのバックエンドとして使用できます。これは、すべてのファイルとフォルダーがデータベースに保存されることを意味します。

```sh
npm install @d7/filesystem-database @d7/orm
```

## 使用方法

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