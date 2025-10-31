# 데이터베이스 파일시스템

이 어댑터를 사용하면 데이터베이스 ORM을 파일시스템 백엔드로 사용할 수 있습니다. 즉, 모든 파일과 폴더는 데이터베이스에 저장됩니다.

```sh
npm install @d7/filesystem-database @d7/orm
```

## 사용법

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