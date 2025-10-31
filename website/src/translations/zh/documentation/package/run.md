# API `@d7/run`

```sh
npm install @d7/run
```

一种无需构建步骤即可运行 TypeScript 代码的简单方式。

此工具主要用于 Deepkit 自身的测试套件，但也可用于你自己的项目。

```typescript
import { typeOf } from '@d7/type';

console.log(typeOf<string>());
```

```sh
node --import @d7/run test.ts 
```

<api-docs package="@d7/run"></api-docs>