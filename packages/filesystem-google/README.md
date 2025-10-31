# Deepkit Google Storage Storage adapter

```typescript
import { Storage } from '@d7/filesystem';
import { StorageGoogleAdapter } from '@d7/filesystem-google';

const storage = new Storage(new StorageGoogleAdapter({
    bucket: 'my-bucket',
    path: 'my-path/',
    projectId: 'my-project-id',
    
    keyFilename: '/path/to/keyfile.json',
    //or
    credentials: {
        client_email: '...',
        private_key: '...',
    }
}));

const files = await storage.files();
await storage.write('test.txt', 'hello world');
```
