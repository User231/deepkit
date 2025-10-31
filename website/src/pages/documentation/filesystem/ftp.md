# FTP Filesystem

This adapter allows you to use an FTP server as filesystem.

It is part of `@d7/filesystem-ftp` which needs to be installed separately.

```sh
npm install @d7/filesystem-ftp
```

## Usage

```typescript
import { Filesystem } from '@d7/filesystem';
import { FilesystemFtpAdapter } from '@d7/filesystem-ftp';

const adapter = new FilesystemFtpAdapter({
    root: 'folder',
    host: 'localhost',
    port: 21,
    username: 'user',
    password: 'password',
});
const filesystem = new Filesystem(adapter);
```

Note: You should not store your credentials in the code directly. Instead, use environment variables or [App Configuration](./app.md#configuration).

## Permissions

If the FTP server is running in a Unix environment, you can set the permissions of the files and folders using the `permissions` option just like with the [local filesystem adapter](./local.md).

```typescript
const adapter = new FilesystemFtpAdapter({
    // ...
    permissions: {
        file: {
            public: 0o644,
            private: 0o600,
        },
        directory: {
            public: 0o755,
            private: 0o700,
        }
    }
});


const filesystem = new Filesystem(adapter);

filesystem.write('/hello-public.txt', 'hello world', 'public');
filesystem.write('/hello-private.txt', 'hello world', 'private');
```

Here the file `/hello-public.txt` will be created with the permissions `0o644` and `/hello-private.txt` with `0o600`.
