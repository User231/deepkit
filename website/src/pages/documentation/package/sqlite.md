# API `@d7/sqlite`

```shell
npm install @d7/sqlite
```

```typescript
import { SQLiteDatabaseAdapter } from '@d7/sqlite';
import { Database } from '@d7/orm';

const adapter = new SQLiteDatabaseAdapter(':memory');

const database = new Database(adapter);
```

<api-docs package="@d7/sqlite"></api-docs>
