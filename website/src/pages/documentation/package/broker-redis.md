# API `@d7/broker-redis`

```sh
npm install @d7/broker-redis
```

Provides a Redis-based implementation of the D7 Broker. This uses ioredis under the hood.

This adapter does not implement the queue adapter of Deepkit Broker.

```typescript
import { BrokerKeyValue, BrokerBus } from '@d7/broker';
import { BrokerRedisAdapter } from '@d7/broker-redis';
import { ConsoleLogger } from '@d7/logger';

const adapter = new RedisBrokerAdapter({
    preifx: 'myapp:',
    host: 'localhost',
    port: 6379,
    // password: 'your-password', // Optional, if your Redis server requires authentication
    // db: 0, // Optional, to specify a different Redis database
}, new ConsoleLogger());

const keyValye = new BrokerKeyValue(adapter);
const bus = new BrokerBus(adapter);
// ...
```

<api-docs package="@d7/broker-redis"></api-docs>
