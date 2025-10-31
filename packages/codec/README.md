# @7b/codec

High-performance binary serialization (BSON) and encoding utilities.

## Features

- Fast BSON serialization and deserialization
- Type-safe encoding and decoding
- Streaming support
- Optimized for performance

## Installation

```bash
npm install @7b/codec
```

## Usage

```typescript
import { serialize, deserialize } from '@7b/codec';

interface User {
  id: number;
  name: string;
  active: boolean;
}

const user: User = { id: 1, name: 'Alice', active: true };

// Serialize to BSON
const bson = serialize<User>(user, 'bson');

// Deserialize from BSON
const restored = deserialize<User>(bson, 'bson');
```

## Documentation

See the [full documentation](https://deepkit.io/documentation/serialization) for details.
