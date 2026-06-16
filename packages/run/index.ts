import { existsSync, readFileSync } from 'fs';
import { register } from 'node:module';
import Module from 'node:module';

import { transpile } from './shared.js';

// Hook CJS resolution to try .ts/.tsx when .js not found (.tsx covers JSX sources, e.g. the
// @deepkit/template tests and its `jsx-runtime`).
// @ts-ignore
const originalResolveFilename = Module._resolveFilename;
// @ts-ignore
Module._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
    try {
        return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch (e: any) {
        if (e.code === 'MODULE_NOT_FOUND' && request.endsWith('.js')) {
            for (const ext of ['.ts', '.tsx']) {
                try {
                    return originalResolveFilename.call(this, request.replace(/\.js$/, ext), parent, isMain, options);
                } catch {
                    // try next extension
                }
            }
        }
        throw e;
    }
};

// CJS extension handler for require() calls - always outputs CommonJS. `.tsx` shares the handler;
// the type compiler + tsconfig `jsx` settings emit the JSX runtime calls during transpile.
// @ts-ignore
Module._extensions['.ts'] = function (module: any, filename: string) {
    const source = readFileSync(filename, 'utf8');
    const { output } = transpile(source, filename, 'commonjs');
    module._compile(output, filename);
};
// @ts-ignore
Module._extensions['.tsx'] = Module._extensions['.ts'];

// ESM loader hooks for import statements
// @ts-ignore
register('./hooks.js', import.meta.url);
