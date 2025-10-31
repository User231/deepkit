# @7b/reflection

Runtime type system and reflection for TypeScript.

## Features

- Runtime type information without decorators
- Type serialization and deserialization
- Type guards and validation
- Type introspection and manipulation
- TypeScript compiler integration

## Installation

```bash
npm install @7b/reflection
```

## Usage

```typescript
import { serialize, deserialize, validates } from '@7b/reflection';

interface User {
  id: number;
  name: string;
  email: string;
}

const user: User = { id: 1, name: 'Alice', email: 'alice@example.com' };

// Serialize with type information
const json = serialize<User>(user);

// Validate at runtime
if (validates<User>(data)) {
  // data is confirmed to be User type
}
```

## Documentation

See the [full documentation](https://deepkit.io/documentation/runtime-types) for details.
