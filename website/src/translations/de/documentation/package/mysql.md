# API `@d7/mysql`

```shell
npm install @d7/mysql
```

```typescript
import { MySQLDatabaseAdapter } from '@d7/mysql';
import { Database } from '@d7/orm';

const adapter = new PostgresDatabaseAdapter('mysql://user:password@localhost/mydatabase');
// const adapter = new MySQLDatabaseAdapter({host: 'localhost', port: 3306});

const database = new Database(adapter);
```

<api-docs package="@d7/mysql"></api-docs>