# Development

## Prerequisites

D7 uses NPM and Lerna to manage this monorepo. Local package linking is managed through the NPM Workspaces.

Make sure `libpq5` and `libpq-dev` are installed. 
These are needed for Postgres client `pg`, which is used in `@d7/postgres`.\
See [Ubuntu requirements setup](docs/setup-env-ubuntu.md) for detailed steps for an Ubuntu system.

Node >= v20 is needed.

## Getting Started

```shell
git clone https://github.com/marcj/d7.git
cd d7
yarn
```

Make sure the compiler is built first and injected to node_modules:

```shell
npm run postinstall
```

When installation is finished you can build the packages:

```shell
d7 » npm run build
```

This could take several minutes.
You should see the build messages and a _success_ summary in the end:

```shell
> build
> build
> tsc --build tsconfig.json && tsc --build tsconfig.esm.json && lerna run build

lerna notice cli v7.4.1

    ✔  @d7/core:build (320ms)
    ✔  @d7/topsort:build (324ms)
    ✔  @d7/type-spec:build (324ms)
    ✔  @d7/core-rxjs:build (326ms)
    ✔  @d7/filesystem:build (326ms)
    ...
    ✔  @d7/api-console-gui:build (19s)
    ✔  @d7/api-console-module:build (297ms)
    ✔  @d7/orm-browser-gui:build (21s)
    ✔  @d7/framework-debug-gui:build (29s)
    ✔  @d7/orm-browser:build (295ms)

 ——————————————————————————————————————————————

 >  Lerna (powered by Nx)   Successfully ran target build for 43 projects (1m)
```

You can try running some tests

```shell
npm run test packages/type/
```

If everything went fine you can try out the example app:

```shell
d7 » cd packages/example-app
d7/packages/example-app » npm run app
```

That should give you a _usage_ message of the app.

To start the app server:

```shell
d7/packages/example-app » npm run start
```

```shell
...
2023-01-05T23:22:02.199Z [LOG] HTTP listening at http://0.0.0.0:8080
2023-01-05T23:22:02.199Z [LOG] Debugger enabled at http://0.0.0.0:8080/_debug/
2023-01-05T23:22:02.199Z [LOG] Server started.
```


## Making changes 

In order to make sure that all packages are built correctly and that Jest understands cross-package references you
should run the included build watcher commands during local development. Usually it's enough to run the `tsc-watch`,
but when ESM packages are consumed for example by our Angular apps, you need to run `tsc-watch:esm` as well.

```shell
d7 » npm run tsc-watch
d7 » npm run tsc-watch:esm
```

## Using d7 checkout with own project

This describes one way how to use a development version (git checkout) or your own fork of d7 with your
own project.

Add `npm-local-development` package to your project:

```shell
my-project » npm i npm-local-development --save-dev
```

Put a `.links.json` file in your project (not d7):

```json
{
"@d7/core": "../d7/packages/core",
"@d7/bson": "../d7/packages/bson",
"@d7/type": "../d7/packages/type",
"@d7/mongo": "../d7/packages/mongo",
"@d7/type-compiler": "../d7/packages/type-compiler",
"@d7/sql": "../d7/packages/sql",
"@d7/injector": "../d7/packages/injector",
"@d7/rpc": "../d7/packages/rpc",
"@d7/http": "../d7/packages/http",
"@d7/event": "../d7/packages/event",
"@d7/logger": "../d7/packages/logger",
"@d7/framework": "../d7/packages/framework",
"@d7/app": "../d7/packages/app",
"@d7/postgres": "../d7/packages/postgres",
"@d7/sqlite": "../d7/packages/sqlite",
"@d7/orm": "../d7/packages/orm"
}
```

Adapt the path of `../d7` to the checkout path of your d7.

In your project's `package.json` add a script:

```json
{
    "scripts": {
        "link": "npm-local-development ."
    }
}
```

Run

```shell
my-project » npm run link
```

Whenever you updated some packages in your project run `npm run link`.
