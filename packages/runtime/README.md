# @7b/runtime

Core runtime utilities for 0x7B framework with **zero dependencies**.

## Features

- Core decorators and reflection helpers
- Benchmarking utilities
- Runtime abstractions for Node.js, Deno, Bun, and browsers
- Type utilities and class helpers
- Performance measurement tools

## Installation

```bash
npm install @7b/runtime
```

## Usage

```typescript
import { isClass, getClassName } from '@7b/runtime';

class MyClass {}

console.log(isClass(MyClass)); // true
console.log(getClassName(MyClass)); // 'MyClass'
```

## Documentation

See the [full documentation](https://deepkit.io/documentation) for details.
