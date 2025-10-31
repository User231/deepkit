# Getting Started

Since Deepkit HTTP is based on Runtime Types, it is necessary to have Runtime Types already installed correctly. See [Runtime Type Installation](../runtime-types/getting-started.md).

If this is done successfully, `@d7/app` can be installed or the D7 framework which already uses the library under the hood.

```sh
npm install @d7/http
```

Note that `@d7/http` for the controller API is based on TypeScript annotations and this feature must be enabled accordingly with `experimentalDecorators` once the controller API is used.
If you don't use classes, you don't need to enable this feature.

_File: tsconfig.json_

```json
{
  "compilerOptions": {
    "module": "CommonJS",
    "target": "es6",
    "moduleResolution": "node",
    "experimentalDecorators": true
  },
  "reflection": true
}
```

Once the library is installed, the API of it can be used directly.

## Functional API

The functional API is based on functions and can be registered via the router registry, which can be obtained via the DI container of the app.

```typescript
import { App } from '@d7/app';
import { FrameworkModule } from '@d7/framework';
import { HttpRouterRegistry } from '@d7/http';

const app = new App({
    imports: [new FrameworkModule]
});

const router = app.get(HttpRouterRegistry);

router.get('/', () => {
    return "Hello World!";
});

app.run();
```

Once modules are used, functional routes can also be provided dynamically by modules.

```typescript
import { App, createModuleClass } from '@d7/app';
import { FrameworkModule } from '@d7/framework';
import { HttpRouterRegistry } from '@d7/http';

class MyModule extends createModuleClass({}) {
  override process() {
    this.configureProvider<HttpRouterRegistry>(router => {
      router.get('/', () => {
        return "Hello World!";
      });
    });
  }
}

const app = new App({
  imports: [new FrameworkModule, new MyModule]
});
```

See [Framework Modules](../app/modules), to learn more about App Modules.

## Controller API

The controller API is based on classes and can be registered via the App-API under the option `controllers`.

```typescript
import { App } from '@d7/app';
import { FrameworkModule } from '@d7/framework';
import { http } from '@d7/http';

class MyPage {
    @http.GET('/')
    helloWorld() {
        return "Hello World!";
    }
}

new App({
    controllers: [MyPage],
    imports: [new FrameworkModule]
}).run();
```

Once modules are used, controllers can also be provided by modules.

```typescript
import { App, createModuleClass } from '@d7/app';
import { FrameworkModule } from '@d7/framework';
import { http } from '@d7/http';

class MyPage {
  @http.GET('/')
  helloWorld() {
    return "Hello World!";
  }
}

class MyModule extends createModuleClass({}) {
  override process() {
    this.addController(MyPage);
  }
}

const app = new App({
  imports: [new FrameworkModule, new MyModule]
});
```

To provide controllers dynamically (depending on the configuration option, for example), the `process` hook can be used.

```typescript
class MyModuleConfiguration {
    debug: boolean = false;
}

class MyModule extends createModuleClass({
    config: MyModuleConfiguration
}) {
    override process() {
        if (this.config.debug) {
            class DebugController {
                @http.GET('/debug/')
                root() {
                    return 'Hello Debugger';
                }
            }
            this.addController(DebugController);
        }
    }
}
```

See [Framework Modules](../app/modules), to learn more about App Modules.

## HTTP Server

If Deepkit Framework is used, an HTTP server is already built in. However, the HTTP library can also be used with its own HTTP server without using the D7 framework.

```typescript
import { Server } from 'http';
import { HttpRequest, HttpResponse } from '@d7/http';

const app = new App({
    controllers: [MyPage],
    imports: [new HttpModule]
});

const httpKernel = app.get(HttpKernel);

new Server(
    { IncomingMessage: HttpRequest, ServerResponse: HttpResponse, },
    ((req, res) => {
        httpKernel.handleRequest(req as HttpRequest, res as HttpResponse);
    })
).listen(8080, () => {
    console.log('listen at 8080');
});
```

## HTTP Client

todo: fetch API, validation, und cast.

## Route Names

Routes can be given a unique name that can be referenced when forwarding. Depending on the API, the way a name is defined differs.

```typescript
//functional API
router.get({
    path: '/user/:id',
    name: 'userDetail'
}, (id: number) => {
    return {userId: id};
});

//controller API
class UserController {
    @http.GET('/user/:id').name('userDetail')
    userDetail(id: number) {
        return {userId: id};
    }
}
```

From all routes with a name the URL can be requested by `Router.resolveUrl()`.

```typescript
import { HttpRouter } from '@d7/http';
const router = app.get(HttpRouter);
router.resolveUrl('userDetail', {id: 2}); //=> '/user/2'
```

## Security

## Sessions

