# API `@d7/mongo`

```shell
npm install @d7/mongo
```

Deepkit ORM용 독립형 MongoDB 드라이버와 데이터베이스 어댑터입니다.

```typescript
import { MongoDatabaseAdapter } from '@d7/mongo';
import { Database } from '@d7/orm';

const adapter = new MongoDatabaseAdapter('mongodb://localhost:27017/mydatabase');

const database = new Database(adapter);
```

<api-docs package="@d7/mongo"></api-docs>