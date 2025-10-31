# Dokumentation

Deepkit ist ein Open-Source-TypeScript-Framework für Backend-Anwendungen, frei unter der MIT-Lizenz verfügbar, entwickelt, um Ihnen beim Erstellen skalierbarer und wartbarer Backend-Anwendungen zu helfen. Es ist dafür ausgelegt, im Browser und in Node.js zu funktionieren, kann jedoch in jeder geeigneten JavaScript-Umgebung laufen.

Hier finden Sie Kapitel zu den verschiedenen Komponenten von Deepkit und API-Referenzen für alle unsere Pakete.

Wenn Sie Hilfe benötigen, treten Sie gerne unserem [Discord-Server](https://discord.com/invite/PtfVf7B8UU) bei oder eröffnen Sie ein Issue
auf [GitHub](https://github.com/marcj/d7).

## Kapitel


- [App](/documentation/app.md) - Schreiben Sie Ihre erste Anwendung mit Deepkit basierend auf der Befehlszeilenschnittstelle.
- [Framework](/documentation/framework.md) - Fügen Sie Ihrer Anwendung (HTTP/RPC-)Server, API-Dokumentation, Debugger, Integrationstests und mehr hinzu.
- [Runtime Types](/documentation/runtime-types.md) - Erfahren Sie mehr über TypeScript-Laufzeit-Typen sowie das Validieren und Transformieren von Daten.
- [Dependency Injection](/documentation/dependency-injection.md) - Dependency-Injection-Container, Inversion of Control und Abhängigkeitsumkehr.
- [Filesystem](/documentation/filesystem.md) - Dateisystemabstraktion zur einheitlichen Arbeit mit lokalen und entfernten Dateisystemen.
- [Broker](/documentation/broker.md) - Message-Broker-Abstraktion für verteilten L2-Cache, Pub/Sub, Queues, zentrale atomare Sperren oder Key-Value-Store.
- [HTTP](/documentation/http.md) - HTTP-Server-Abstraktion zum Aufbau typsicherer Endpunkte.
- [RPC](/documentation/rpc.md) - Abstraktion für Remote Procedure Calls, um Frontend mit Backend zu verbinden oder mehrere Backend-Dienste zu koppeln.
- [ORM](/documentation/orm.md) - ORM und DBAL, um Daten typsicher zu speichern und abzufragen.
- [Desktop-UI](/documentation/desktop-ui/getting-started) - Erstellen Sie GUI-Anwendungen mit dem auf Angular basierenden UI-Framework von Deepkit.

## API-Referenz

Im Folgenden finden Sie eine vollständige Liste aller Deepkit-Pakete mit Links zu deren API-Dokumentation.

### Komposition

- [@d7/app](/documentation/package/app.md)
- [@d7/framework](/documentation/package/framework.md)
- [@d7/http](/documentation/package/http.md)
- [@d7/angular-ssr](/documentation/package/angular-ssr.md)

### Infrastruktur

- [@d7/rpc](/documentation/package/rpc.md)
- [@d7/rpc-tcp](/documentation/package/rpc-tcp.md)
- [@d7/broker](/documentation/package/broker.md)
- [@d7/broker-redis](/documentation/package/broker-redis.md)

### Dateisystem

- [@d7/filesystem](/documentation/package/filesystem.md)
- [@d7/filesystem-ftp](/documentation/package/filesystem-ftp.md)
- [@d7/filesystem-sftp](/documentation/package/filesystem-sftp.md)
- [@d7/filesystem-s3](/documentation/package/filesystem-s3.md)
- [@d7/filesystem-google](/documentation/package/filesystem-google.md)
- [@d7/filesystem-database](/documentation/package/filesystem-database.md)

### Datenbank

- [@d7/orm](/documentation/package/orm.md)
- [@d7/mysql](/documentation/package/mysql.md)
- [@d7/postgres](/documentation/package/postgres.md)
- [@d7/sqlite](/documentation/package/sqlite.md)
- [@d7/mongodb](/documentation/package/mongodb.md)

### Grundlagen

- [@d7/type](/documentation/package/type.md)
- [@d7/event](/documentation/package/event.md)
- [@d7/injector](/documentation/package/injector.md)
- [@d7/template](/documentation/package/template.md)
- [@d7/logger](/documentation/package/logger.md)
- [@d7/workflow](/documentation/package/workflow.md)
- [@d7/stopwatch](/documentation/package/stopwatch.md)

### Werkzeuge

- [@d7/api-console](/documentation/package/api-console.md)
- [@d7/devtool](/documentation/package/devtool.md)
- [@d7/desktop-ui](/documentation/package/desktop-ui.md)
- [@d7/orm-browser](/documentation/package/orm-browser.md)
- [@d7/bench](/documentation/package/bench.md)
- [@d7/run](/documentation/package/run.md)

### Kern

- [@d7/bson](/documentation/package/bson.md)
- [@d7/core](/documentation/package/core.md)
- [@d7/topsort](/documentation/package/topsort.md)

### Laufzeit

- [@d7/vite](/documentation/package/vite.md)
- [@d7/bun](/documentation/package/bun.md)
- [@d7/type-compiler](/documentation/package/type-compiler.md)