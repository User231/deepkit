# Database Filesystem

This adapter allows you to use an Database ORM as filesystem backend. This means all files and folders are stored in the database.

```sh
npm install @d7/filesystem-database @d7/orm
```

## Usage

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
