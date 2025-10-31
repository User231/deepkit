# Bench

```typescript
// benchmarks/test.ts
import { benchmark, run } from '@d7/bench';

let i = 0;

benchmark('test', () => {
    i += 10;
});

void run();
```

```sh
node --import @d7/run benchmarks/test.ts 
```
