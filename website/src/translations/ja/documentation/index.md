# ドキュメント

Deepkit は、MIT ライセンスの下で自由に利用できるオープンソースの TypeScript フレームワークで、スケーラブルで保守しやすいバックエンドアプリケーションの構築を支援します。ブラウザと Node.js で動作するように設計されていますが、適切な JavaScript 環境であればどこでも実行できます。

ここでは Deepkit のさまざまなコンポーネントに関する章と、すべてのパッケージの API リファレンスを見つけることができます。

ヘルプが必要な場合は、[Discord サーバー](https://discord.com/invite/PtfVf7B8UU) に参加するか、[GitHub](https://github.com/marcj/d7) で issue を作成してください。

## 章


- [アプリ](/documentation/app.md) - コマンドラインインターフェイス (CLI) を使って Deepkit で最初のアプリケーションを作成します。
- [フレームワーク](/documentation/framework.md) - アプリケーションに (HTTP/RPC) サーバー、API ドキュメント、デバッガ、統合テストなどを追加します。
- [ランタイム型](/documentation/runtime-types.md) - TypeScript のランタイム型について学び、データの検証と変換を行います。
- [依存性注入](/documentation/dependency-injection.md) - 依存性注入コンテナ、制御の反転、依存性逆転。
- [ファイルシステム](/documentation/filesystem.md) - ローカルおよびリモートのファイルシステムを統一的に扱うためのファイルシステム抽象化。
- [ブローカー](/documentation/broker.md) - 分散 L2 キャッシュ、Pub/Sub、キュー、中央のアトミックロック、キー・バリューストアを扱うためのメッセージブローカー抽象化。
- [HTTP](/documentation/http.md) - 型安全なエンドポイントを構築するための HTTP サーバー抽象化。
- [RPC](/documentation/rpc.md) - フロントエンドとバックエンド、または複数のバックエンドサービスを接続するためのリモートプロシージャコール (RPC) 抽象化。
- [ORM](/documentation/orm.md) - 型安全にデータを保存およびクエリするための ORM と DBAL。
- [デスクトップ UI](/documentation/desktop-ui/getting-started) - Deepkit の Angular ベースの UI フレームワークで GUI アプリケーションを構築します。

## API リファレンス

以下は、すべての Deepkit パッケージとその API ドキュメントへのリンクの完全な一覧です。

### 構成

- [@d7/app](/documentation/package/app.md)
- [@d7/framework](/documentation/package/framework.md)
- [@d7/http](/documentation/package/http.md)
- [@d7/angular-ssr](/documentation/package/angular-ssr.md)

### インフラストラクチャ

- [@d7/rpc](/documentation/package/rpc.md)
- [@d7/rpc-tcp](/documentation/package/rpc-tcp.md)
- [@d7/broker](/documentation/package/broker.md)
- [@d7/broker-redis](/documentation/package/broker-redis.md)

### ファイルシステム

- [@d7/filesystem](/documentation/package/filesystem.md)
- [@d7/filesystem-ftp](/documentation/package/filesystem-ftp.md)
- [@d7/filesystem-sftp](/documentation/package/filesystem-sftp.md)
- [@d7/filesystem-s3](/documentation/package/filesystem-s3.md)
- [@d7/filesystem-google](/documentation/package/filesystem-google.md)
- [@d7/filesystem-database](/documentation/package/filesystem-database.md)

### データベース

- [@d7/orm](/documentation/package/orm.md)
- [@d7/mysql](/documentation/package/mysql.md)
- [@d7/postgres](/documentation/package/postgres.md)
- [@d7/sqlite](/documentation/package/sqlite.md)
- [@d7/mongodb](/documentation/package/mongodb.md)

### 基礎

- [@d7/type](/documentation/package/type.md)
- [@d7/event](/documentation/package/event.md)
- [@d7/injector](/documentation/package/injector.md)
- [@d7/template](/documentation/package/template.md)
- [@d7/logger](/documentation/package/logger.md)
- [@d7/workflow](/documentation/package/workflow.md)
- [@d7/stopwatch](/documentation/package/stopwatch.md)

### ツール

- [@d7/api-console](/documentation/package/api-console.md)
- [@d7/devtool](/documentation/package/devtool.md)
- [@d7/desktop-ui](/documentation/package/desktop-ui.md)
- [@d7/orm-browser](/documentation/package/orm-browser.md)
- [@d7/bench](/documentation/package/bench.md)
- [@d7/run](/documentation/package/run.md)

### コア

- [@d7/bson](/documentation/package/bson.md)
- [@d7/core](/documentation/package/core.md)
- [@d7/topsort](/documentation/package/topsort.md)

### ランタイム

- [@d7/vite](/documentation/package/vite.md)
- [@d7/bun](/documentation/package/bun.md)
- [@d7/type-compiler](/documentation/package/type-compiler.md)