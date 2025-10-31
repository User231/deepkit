# @7b/io

Networking and I/O primitives for HTTP, RPC, message brokers, and filesystem operations.

## Features

- HTTP server and router
- RPC framework with type safety
- Message broker integration (Redis, memory)
- Filesystem adapters (local, S3, FTP, SFTP, Google Cloud Storage)
- WebSocket support
- Streaming capabilities

## Installation

```bash
npm install @7b/io
```

### Optional Peer Dependencies

```bash
# For RPC
npm install rxjs

# For Redis broker
npm install ioredis

# For filesystem adapters
npm install @aws-sdk/client-s3  # AWS S3
npm install basic-ftp           # FTP
npm install ssh2-sftp-client    # SFTP
npm install @google-cloud/storage # Google Cloud
```

## Usage

### HTTP Server

```typescript
import { App } from '@7b/core';
import { HttpServer, route } from '@7b/io/http';

class ApiController {
  @route.get('/api/users')
  getUsers() {
    return [{ id: 1, name: 'Alice' }];
  }
}

const app = new App();
app.use(HttpServer);
app.use(ApiController);
app.run();
```

### RPC

```typescript
import { rpc } from '@7b/io/rpc';

class UserController {
  @rpc.action()
  async getUser(id: number) {
    return { id, name: 'Alice' };
  }
}
```

## Documentation

See the [full documentation](https://deepkit.io/documentation) for details.
