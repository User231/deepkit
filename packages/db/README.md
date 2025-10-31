# @7b/db

Database ORM and adapters for PostgreSQL, MySQL, SQLite, and MongoDB.

## Features

- Type-safe query builder
- Migrations
- Relations and joins
- Transactions
- Connection pooling
- Multiple database support

## Installation

```bash
npm install @7b/db
```

### Database Adapters

```bash
# PostgreSQL
npm install @7b/db/postgres pg

# MySQL
npm install @7b/db/mysql mysql2

# SQLite
npm install @7b/db/sqlite better-sqlite3

# MongoDB
npm install @7b/db/mongo
```

## Usage

```typescript
import { entity, PrimaryKey, AutoIncrement } from '@7b/reflection';
import { Database } from '@7b/db';
import { PostgresAdapter } from '@7b/db/postgres';

@entity
class User {
  id: number & PrimaryKey & AutoIncrement = 0;
  name: string = '';
  email: string = '';
}

const database = new Database(new PostgresAdapter('postgres://localhost/mydb'));

// Type-safe queries
const users = await database.query(User)
  .filter({ name: { $regex: /john/i } })
  .limit(10)
  .find();

// Migrations
await database.migrate();
```

## Documentation

See the [full documentation](https://deepkit.io/documentation/database) for details.
