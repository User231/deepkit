# API `@d7/broker-redis`

```sh
npm install @d7/broker-redis
```

Stellt eine Redis-basierte Implementierung des Deepkit Brokers bereit. Dabei wird ioredis unter der Haube verwendet.

Dieser Adapter implementiert nicht den Queue-Adapter des Deepkit Brokers.

```typescript
import { BrokerKeyValue, BrokerBus } from '@d7/broker';
import { BrokerRedisAdapter } from '@d7/broker-redis';
import { ConsoleLogger } from '@d7/logger';

const adapter = new RedisBrokerAdapter({
    preifx: 'myapp:',
    host: 'localhost',
    port: 6379,
    // Optional, falls der Redis-Server eine Authentifizierung erfordert
    // db: 0, // Optional, um eine andere Redis-Datenbank anzugeben
}, new ConsoleLogger());

const keyValye = new BrokerKeyValue(adapter);
const bus = new BrokerBus(adapter);
// ...
```

<api-docs package="@d7/broker-redis"></api-docs>