# Package Restructuring: Phase 1 Complete

## ✅ Completed

### 1. File Consolidation
All source files from 56 packages have been consolidated into 7 new packages:

- **@7b/runtime** (packages/runtime)
  - core, bench, run, bun → src/
  
- **@7b/reflection** (packages/reflection)
  - type, type-compiler, type-spec → src/
  
- **@7b/codec** (packages/codec)
  - bson → src/
  
- **@7b/core** (packages/core-consolidated)
  - app, injector, logger, event, stopwatch, workflow, template, topsort → src/
  
- **@7b/io** (packages/io)
  - http, rpc, rpc-tcp, broker, broker-redis, core-rxjs, filesystem* → src/
  
- **@7b/db** (packages/db)
  - orm, sql, postgres, mysql, sqlite, mongo, orm-integration → src/
  
- **@7b/ui** (packages/ui)
  - ui-library, type-angular, angular-ssr, desktop-ui, api-console*, framework-debug*, orm-browser* → src/

### 2. Package Configuration
Created package.json for each new package with:
- Zero hard dependencies (moved to optional peers)
- Proper ESM configuration
- Subpackage exports where applicable (@7b/io/http, @7b/db/postgres, etc.)
- Peer dependency relationships

## ⚠️ Still Required (Critical - Manual Work Needed)

### 3. Import Statement Updates (~10,000+ files)
All import statements across the codebase need updating:

```typescript
// OLD
import { isClass } from '@deepkit/core';
import { serialize } from '@deepkit/type';
import { Database } from '@deepkit/orm';

// NEW
import { isClass } from '@7b/runtime';
import { serialize } from '@7b/codec';
import { Database } from '@7b/db';
```

**Tools needed**:
- AST-based import rewriter (jscodeshift or similar)
- Manual verification of complex imports
- Test after each major batch

### 4. Index File Creation
Each new package needs an index.ts that re-exports everything:

```typescript
// packages/runtime/index.ts
export * from './src/core/index.js';
export * from './src/bench/index.js';
export * from './src/run/index.js';
export * from './src/bun/index.js';
```

### 5. TypeScript Configuration
- Update root tsconfig.json references
- Create tsconfig.json for each new package
- Update paths mappings
- Update lerna.json

### 6. Build System Updates
- Update all package build scripts
- Ensure proper ESM module resolution
- Update Jest configuration
- Update paths in all test files

### 7. Validation
- Run full TypeScript build
- Run all tests
- Check for circular dependencies
- Verify bundle sizes

## 📋 Automation Script for Imports (Required)

Create this script to handle import updates:

```javascript
// scripts/update-imports.js
const jscodeshift = require('jscodeshift');
const fs = require('fs');
const glob = require('glob');

const importMap = {
  '@deepkit/core': '@7b/runtime',
  '@deepkit/type': '@7b/reflection',
  '@deepkit/type-compiler': '@7b/reflection/compiler',
  '@deepkit/bson': '@7b/codec/bson',
  '@deepkit/app': '@7b/core/app',
  '@deepkit/injector': '@7b/core/injector',
  '@deepkit/logger': '@7b/core/logger',
  '@deepkit/event': '@7b/core/event',
  '@deepkit/http': '@7b/io/http',
  '@deepkit/rpc': '@7b/io/rpc',
  '@deepkit/orm': '@7b/db',
  '@deepkit/postgres': '@7b/db/postgres',
  // ... add all 56 mappings
};

function updateImports(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  
  root.find(j.ImportDeclaration).forEach(path => {
    const oldSource = path.node.source.value;
    if (importMap[oldSource]) {
      path.node.source.value = importMap[oldSource];
    }
  });
  
  return root.toSource();
}

// Run on all TypeScript files
glob('packages/**/*.ts', (err, files) => {
  files.forEach(file => {
    const source = fs.readFileSync(file, 'utf8');
    const updated = jscodeshift(source, { path: file }, {});
    fs.writeFileSync(file, updated);
  });
});
```

## 🎯 Next Actions

1. **Create index.ts files** for each new package (manual, ~2 hours)
2. **Run import automation script** (requires script development, ~4 hours)
3. **Update tsconfig files** (manual, ~2 hours)
4. **Fix remaining import issues** (manual verification, ~8 hours)
5. **Update lerna configuration** (~1 hour)
6. **Test build** (iterative, ~4 hours)
7. **Run all tests** (iterative, ~4 hours)

**Total remaining effort**: ~25-30 hours

## 📝 Status

**Phase 1 (File Consolidation)**: ✅ Complete (this commit)
**Phase 2 (Import Updates)**: ⏳ Requires script + manual work
**Phase 3 (Build Config)**: ⏳ Requires manual updates
**Phase 4 (Testing)**: ⏳ After phases 2-3 complete

---

**Current commit** consolidates all files and creates package structure.
**Next session** should focus on import statement updates and index file creation.
