// Import mapping from old @deepkit/* packages to new @7b/* packages
// This file is used by the import update automation script

module.exports = {
  // @7b/runtime consolidates: core, bench, run, bun
  '@deepkit/core': '@7b/runtime',
  '@deepkit/bench': '@7b/runtime',
  '@deepkit/run': '@7b/runtime',
  '@deepkit/bun': '@7b/runtime',
  
  // @7b/reflection consolidates: type, type-compiler, type-spec
  '@deepkit/type': '@7b/reflection',
  '@deepkit/type-compiler': '@7b/reflection',
  '@deepkit/type-spec': '@7b/reflection',
  
  // @7b/codec consolidates: bson
  '@deepkit/bson': '@7b/codec',
  
  // @7b/core consolidates: app, injector, logger, event, stopwatch, workflow, template, topsort
  '@deepkit/app': '@7b/core',
  '@deepkit/injector': '@7b/core',
  '@deepkit/logger': '@7b/core',
  '@deepkit/event': '@7b/core',
  '@deepkit/stopwatch': '@7b/core',
  '@deepkit/workflow': '@7b/core',
  '@deepkit/template': '@7b/core',
  '@deepkit/topsort': '@7b/core',
  
  // @7b/io consolidates: http, rpc, rpc-tcp, broker, broker-redis, core-rxjs, filesystem*
  '@deepkit/http': '@7b/io/http',
  '@deepkit/rpc': '@7b/io/rpc',
  '@deepkit/rpc-tcp': '@7b/io/rpc',
  '@deepkit/broker': '@7b/io/broker',
  '@deepkit/broker-redis': '@7b/io/broker',
  '@deepkit/core-rxjs': '@7b/io',
  '@deepkit/filesystem': '@7b/io/fs',
  '@deepkit/filesystem-aws-s3': '@7b/io/fs',
  '@deepkit/filesystem-ftp': '@7b/io/fs',
  '@deepkit/filesystem-sftp': '@7b/io/fs',
  '@deepkit/filesystem-google': '@7b/io/fs',
  '@deepkit/filesystem-database': '@7b/io/fs',
  
  // @7b/db consolidates: orm, sql, postgres, mysql, sqlite, mongo, orm-integration
  '@deepkit/orm': '@7b/db',
  '@deepkit/sql': '@7b/db',
  '@deepkit/postgres': '@7b/db/postgres',
  '@deepkit/mysql': '@7b/db/mysql',
  '@deepkit/sqlite': '@7b/db/sqlite',
  '@deepkit/mongo': '@7b/db/mongo',
  '@deepkit/orm-integration': '@7b/db',
  
  // @7b/ui consolidates: ui-library, type-angular, angular-ssr, desktop-ui, consoles, browsers
  '@deepkit/ui-library': '@7b/ui',
  '@deepkit/type-angular': '@7b/ui',
  '@deepkit/angular-ssr': '@7b/ui',
  '@deepkit/desktop-ui': '@7b/ui',
  '@deepkit/api-console-api': '@7b/ui',
  '@deepkit/api-console-gui': '@7b/ui',
  '@deepkit/api-console-module': '@7b/ui',
  '@deepkit/framework-debug-api': '@7b/ui',
  '@deepkit/framework-debug-gui': '@7b/ui',
  '@deepkit/orm-browser': '@7b/ui',
  '@deepkit/orm-browser-api': '@7b/ui',
  '@deepkit/orm-browser-gui': '@7b/ui',
  
  // Special case: framework
  '@deepkit/framework': '@7b/core',
  '@deepkit/framework-integration': '@7b/core',
};
