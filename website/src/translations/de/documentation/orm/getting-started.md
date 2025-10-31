# Erste Schritte

Deepkit bietet eine Datenbank-ORM, die den Zugriff auf Datenbanken auf moderne Weise ermöglicht.
Entitäten werden einfach mit TypeScript Types definiert:

```typescript
import { entity, PrimaryKey, AutoIncrement, 
    Unique, MinLength, MaxLength } from '@d7/type';

type Username = string & Unique & MinLength<2> & MaxLength<16>;

// Entity als Class
@entity.name('user')
class User {
    id: number & PrimaryKey & AutoIncrement = 0;
    created: Date = new Date;
    firstName?: string;
    lastName?: string;

    constructor(
        public username: Username,
        public email: string & Unique,
    ) {}
}

// oder als Interface
interface User {
    id: number & PrimaryKey & AutoIncrement;
    created: Date;
    firstName?: string;
    lastName?: string;
    username: Username;
    email: string & Unique;
}
```

Beliebige TypeScript Types und Validation Decorators von Deepkit können verwendet werden, um die Entity vollständig zu definieren.
Das Entity Type-System ist so konzipiert, dass diese Types oder Classes auch in anderen Bereichen wie HTTP Routes, RPC Actions oder Frontend verwendet werden können. Das verhindert zum Beispiel, dass man einen User mehrfach in der gesamten Anwendung verteilt definiert hat.

## Installation

Da Deepkit ORM auf Runtime Types basiert, muss `@d7/type` bereits korrekt installiert sein.
Siehe [Installation von Runtime Types](../runtime-types/getting-started.md).

Wenn dies erfolgreich erledigt ist, können `@d7/orm` selbst und ein Datenbank-Adapter installiert werden.

Wenn Classes als Entities verwendet werden sollen, muss `experimentalDecorators` in der tsconfig.json aktiviert sein:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true
  }
}
```

Sobald die Library installiert ist, kann ein Datenbank-Adapter installiert werden und dessen API kann direkt verwendet werden.

### SQLite

```sh
npm install @d7/orm @d7/sqlite
```

```typescript
import { SQLiteDatabaseAdapter } from '@d7/sqlite';

const database = new Database(new SQLiteDatabaseAdapter('./example.sqlite'), [User]);
const database = new Database(new SQLiteDatabaseAdapter(':memory:'), [User]);
```

### MySQL

```sh
npm install @d7/orm @d7/mysql
```

```typescript
import { MySQLDatabaseAdapter } from '@d7/mysql';

const database = new Database(new MySQLDatabaseAdapter({
    host: 'localhost',
    port: 3306
}), [User]);
```

### Postgres

```sh
npm install @d7/orm @d7/postgres
```

```typescript
import { PostgresDatabaseAdapter } from '@d7/postgres';

const database = new Database(new PostgresDatabaseAdapter({
    host: 'localhost',
    port: 3306
}), [User]);
```

### MongoDB

```sh
npm install @d7/orm @d7/bson @d7/mongo
```

```typescript
import { MongoDatabaseAdapter } from '@d7/mongo';

const database = new Database(new MongoDatabaseAdapter('mongodb://localhost/mydatabase'), [User]);
```

## Verwendung

In erster Linie wird das `Database` Objekt verwendet. Sobald es instanziiert wurde, kann es in der gesamten Anwendung zum Abfragen oder Manipulieren von Daten genutzt werden. Die Verbindung zur Datenbank wird lazy initialisiert.

Dem `Database` Objekt wird ein Adapter übergeben, der aus den Datenbank-Adapter-Libraries stammt.

```typescript
import { SQLiteDatabaseAdapter } from '@d7/sqlite';
import { entity, PrimaryKey, AutoIncrement } from '@d7/type';
import { Database } from '@d7/orm';

async function main() {
    @entity.name('user')
    class User {
        public id: number & PrimaryKey & AutoIncrement = 0;
        created: Date = new Date;

        constructor(public name: string) {
        }
    }

    const database = new Database(new SQLiteDatabaseAdapter('./example.sqlite'), [User]);
    await database.migrate(); // Tabellen erstellen

    await database.persist(new User('Peter'));

    const allUsers = await database.query(User).find();
    console.log('all users', allUsers);
}

main();
```

### Datenbank

### Verbindung

#### Read Replica

## Repository

## Index

## Groß-/Kleinschreibung

## Zeichensätze

## Collations

## Batching

## Caching

## Multitenancy

## Naming Strategy

## Locking

### Optimistic Locking

### Pessimistic Locking

## Custom Types

## Logging

## Migration

## Seeding

## Direkter Datenbankzugriff

### SQL

### MongoDB

## Plugins