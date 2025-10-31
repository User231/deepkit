title: First Application using Deepkit Framework

The framework package of Deepkit at `@d7/framework` is a module you can import that provides features like application server (http/rpc),
debugger and profiler GUI, and other. It is not required to run a simple Deepkit App.

```typescript title=app.ts
import { App } from '@d7/app';
import { FrameworkModule } from '@d7/framework';

const app = new App({
    imports: [new FrameworkModule({debug: true})],
});

app.command('hello', () => {
    console.log('Hello World!');
});

app.run();
```

Then you see all available commands from the framework module:

```bash
ts-node app.ts
```


##-------------------------------------------------##
