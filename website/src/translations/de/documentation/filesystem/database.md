# Datenbank-Dateisystem

Dieser Adapter ermöglicht es, eine Datenbank-ORM als Dateisystem-Backend zu verwenden. Das bedeutet, dass alle Dateien und Ordner in der Datenbank gespeichert werden.

```sh
npm install @d7/filesystem-database @d7/orm
```

## Verwendung

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