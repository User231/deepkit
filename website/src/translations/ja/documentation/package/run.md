# API `@d7/run`

```sh
npm install @d7/run
```

ビルドステップを必要とせずに TypeScript コードを実行する簡単な方法。

このツールは主に Deepkit 独自のテストスイートでの使用を想定していますが、ご自身のプロジェクトでも使用できます。

```typescript
import { typeOf } from '@d7/type';

console.log(typeOf<string>());
```

```sh
node --import @d7/run test.ts 
```

<api-docs package="@d7/run"></api-docs>