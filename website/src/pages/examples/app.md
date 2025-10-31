title: Simple CLI command using Deepkit App

```typescript title=app.ts
import { App } from '@d7/app';

const app = new App();
app.command('hello', () => {
    console.log('Hello World!');
});

app.run();
```

```bash
./node_modules/.bin/ts-node app.ts hello
```

##-------------------------------------------------##
