# API `@d7/postgres`

```shell
npm install @d7/postgres
```

```typescript
import { PostgresDatabaseAdapter } from '@d7/mongo';
import { Database } from '@d7/orm';

const adapter = new PostgresDatabaseAdapter('postgres://user:password@localhost/mydatabase');
// const adapter = new PostgresDatabaseAdapter({ host: 'localhost', database: 'postgres', user: 'postgres' });

const database = new Database(adapter);
```


<api-docs package="@d7/postgres"></api-docs>