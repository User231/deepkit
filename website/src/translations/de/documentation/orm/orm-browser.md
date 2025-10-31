# ORM Browser

Deepkit ORM Browser ist ein webbasiertes Tool, um das Datenbankschema und die Daten zu erkunden. Es basiert auf dem Deepkit Framework und kann mit jeder von Deepkit ORM unterstützten Datenbank verwendet werden.

![ORM Browser](/assets/screenshots-orm-browser/content-editing.png)

## Installation

Deepkit ORM Browser ist Teil des Deepkit Frameworks und wird aktiviert, wenn der Debug-Modus eingeschaltet ist.

```typescript
import { App } from '@d7/app';
import { Database } from '@d7/orm';

class MyController {
    @http.GET('/')
    index() {
        return 'Hello World';
    }
}

class MainDatabase extends Database {
    constructor() {
        super(new DatabaseAdapterSQLite());
    }
}

new App({
    controllers: [MyController],
    providers: [MainDatabase],
    imports: [new FrameworkModule({debug: true})],
}).run();
```

Alternativ kannst du Deepkit ORM Browser als eigenständiges Paket installieren.

```bash
npm install @d7/orm-browser
```

```typescript
// database.ts
import { Database } from '@d7/orm';

class MainDatabase extends Database {
    constructor() {
        super(new DatabaseAdapterSQLite());
    }
}

export const database = new MainDatabase();
```

Als Nächstes kann der Deepkit ORM Browser-Server gestartet werden.

```sh
./node_modules/.bin/deepkit-orm-browser database.ts
```

Deepkit ORM Browser ist nun unter http://localhost:9090 verfügbar.