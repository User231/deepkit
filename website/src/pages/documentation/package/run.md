# API `@d7/run`

```sh
npm install @d7/run
```

A simple way to run TypeScript code without the need for a build step.

This tool is primarily meant to be used in Deepkit's own test suite, but can also be used in your own projects.

```typescript
import { typeOf } from '@d7/type';

console.log(typeOf<string>());
```

```sh
node --import @d7/run test.ts 
```

<api-docs package="@d7/run"></api-docs>
