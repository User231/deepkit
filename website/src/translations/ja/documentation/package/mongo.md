# API `@d7/mongo`

```shell
npm install @d7/mongo
```

スタンドアロンの MongoDB ドライバーと Deepkit ORM 用のデータベースアダプターです。

```typescript
import { MongoDatabaseAdapter } from '@d7/mongo';
import { Database } from '@d7/orm';

const adapter = new MongoDatabaseAdapter('mongodb://localhost:27017/mydatabase');

const database = new Database(adapter);
```

<api-docs package="@d7/mongo"></api-docs>