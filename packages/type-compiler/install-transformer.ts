#!/usr/bin/env node

/**
 * This script installs the deepkit/type transformer (that extracts automatically types and adds the correct @t decorator) to the typescript node_modules.
 *
 * The critical section that needs adjustment is in the `function getScriptTransformers` in `node_modules/typescript/lib/tsc.js`.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';

let to = process.argv[2] || process.cwd();

function getPatchId(id: string): string {
    return 'deepkit_type_patch_' + id;
}

function getCode(deepkitDistPath: string, varName: string, id: string): string {
    return `
        //${getPatchId(id)}
        try {
            var typeTransformer;
            try {
                typeTransformer = require('@deepkit/type-compiler');
            } catch (error) {
                typeTransformer = require(${JSON.stringify(deepkitDistPath)});
            }
            if (typeTransformer) {
                if (!customTransformers) ${varName} = {};
                if (!${varName}.before) ${varName}.before = [];
                let alreadyPatched = false;
                for (let fn of ${varName}.before) {
                    if (fn && fn.name === 'deepkitTransformer') alreadyPatched = true;
                }
                if (!alreadyPatched) {
                    if (!${varName}.before.includes(typeTransformer.transformer)) ${varName}.before.push(typeTransformer.transformer);

                    if (!${varName}.afterDeclarations) ${varName}.afterDeclarations = [];
                    if (!${varName}.afterDeclarations.includes(typeTransformer.declarationTransformer)) {
                        ${varName}.afterDeclarations.push(typeTransformer.declarationTransformer);
                    }
                }
            }
        } catch (e) {
        }
        //${getPatchId(id)}-end
    `;
}

function isPatched(code: string, id: string) {
    return code.includes(getPatchId(id));
}

const patchId = 'patchGetTransformers';

function patchGetTransformers(deepkitDistPath: string, code: string): string {
    const find = /function getTransformers\([^)]+\)\s*{/;
    if (!code.match(find)) return '';

    code = code.replace(find, function (a) {
        return a + '\n    ' + getCode(deepkitDistPath, 'customTransformers', patchId);
    });

    return code;
}

if (to + '/dist/cjs' === __dirname) {
    to = join(to, '..'); //we exclude type-compiler/node_modules
}

const typeScriptPath = dirname(require.resolve('typescript', { paths: [to] }));
// Use forward slashes - works on all platforms and avoids Windows backslash escape issues (#356)
const deepkitDistPath = relative(typeScriptPath, __dirname).replace(/\\/g, '/');

const paths = ['tsc.js', '_tsc.js', 'typescript.js'];

// A patched (or already-patched) install is the success condition. If the typescript install
// exists but NO file could be patched, the injection point (`function getTransformers(...)`)
// changed shape — reflection would silently stop being emitted, so fail LOUDLY instead.
let effective = 0;

for (const fileName of paths) {
    const file = join(typeScriptPath, fileName);
    if (!existsSync(file)) continue;
    const original = readFileSync(file, 'utf8');
    if (isPatched(original, patchId)) {
        effective++;
        continue;
    }
    const content = patchGetTransformers(deepkitDistPath, original);
    if (!content) continue;
    writeFileSync(file, content);
    effective++;
    console.log('Deepkit Type: Injected TypeScript transformer at', file);
}

if (effective === 0) {
    console.error(
        'Deepkit Type: FAILED to inject the TypeScript transformer into ' +
            typeScriptPath +
            ' — no known injection point (`function getTransformers(...)`) matched.' +
            ' This TypeScript version is likely incompatible with the patch; reflection would NOT be emitted by tsc.',
    );
    process.exit(1);
}
