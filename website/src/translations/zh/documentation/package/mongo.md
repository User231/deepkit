# API `@d7/mongo`

```shell
npm install @d7/mongo
```

独立的 MongoDB 驱动以及用于 Deepkit ORM 的数据库适配器。

```typescript
import { MongoDatabaseAdapter } from '@d7/mongo';
import { Database } from '@d7/orm';

const adapter = new MongoDatabaseAdapter('mongodb://localhost:27017/mydatabase');

const database = new Database(adapter);
```

<api-docs package="@d7/mongo"></api-docs>