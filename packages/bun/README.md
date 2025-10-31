# Deepkit Bun Plugin

## Install

```sh
bun init
```

`bunfig.toml`:
```toml
preload = ["@d7/bun"]

[install]
peer = true
```

```sh
bun install @d7/type @d7/type-compiler @d7/core @d7/bun typescript
```

`tsconfig.json`:
```json
{
    "reflection": true
}
```

## Bun test runner

To use the [bun test runner](https://bun.sh/docs/cli/test) instead of Jest add the following to file `bunfig.toml`:

```toml
[test]
preload = ["@d7/bun"]
```
