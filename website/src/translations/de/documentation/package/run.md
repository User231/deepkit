# API `@d7/run`

```sh
npm install @d7/run
```

Eine einfache Möglichkeit, TypeScript-Code ohne einen Build-Schritt auszuführen.

Dieses Tool ist primär für den Einsatz in Deepkits eigener Test-Suite gedacht, kann jedoch auch in eigenen Projekten verwendet werden.

```typescript
import { typeOf } from '@d7/type';

console.log(typeOf<string>());
```

```sh
node --import @d7/run test.ts 
```

<api-docs package="@d7/run"></api-docs>