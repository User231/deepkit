# @7b/core

Application framework with dependency injection, CLI, logging, and event system.

## Features

- Powerful dependency injection container
- CLI command framework
- Structured logging
- Type-safe event system
- Application lifecycle management
- Stopwatch for performance monitoring
- Workflow orchestration

## Installation

```bash
npm install @7b/core
```

## Usage

```typescript
import { App, Logger, cli } from '@7b/core';

class MyService {
  constructor(private logger: Logger) {}

  @cli.command('hello')
  hello(name: string) {
    this.logger.log(`Hello, ${name}!`);
  }
}

const app = new App();
app.use(MyService);
app.run();
```

## Documentation

See the [full documentation](https://deepkit.io/documentation/framework) for details.
