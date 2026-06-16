import { existsSync, readFileSync } from 'fs';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extname } from 'path';
import { init as initCjsLexer, parse as parseCjs } from 'cjs-module-lexer';

import { transpile } from './shared.js';

async function resolveTs(specifier: string, context: any, nextResolve: Function) {
    // Try .ts/.tsx extensions for .js imports or extensionless imports. `.tsx` covers JSX entry
    // files (e.g. @deepkit/template tests and the package's own `jsx-runtime`).
    const variants =
        extname(specifier) === '.js'
            ? [specifier.replace(/\.js$/, '.ts'), specifier.replace(/\.js$/, '.tsx')]
            : [`${specifier}.ts`, `${specifier}.tsx`];

    for (const tsSpecifier of variants) {
        try {
            const url = new URL(tsSpecifier, context.parentURL);
            await stat(url);
            return nextResolve(url.toString(), context);
        } catch {}
    }

    return nextResolve(specifier, context);
}

export async function resolve(specifier: string, context: any, defaultResolve: Function) {
    return resolveTs(specifier, context, defaultResolve);
}

/**
 * When a `.ts` entry is loaded through this loader it runs as a module in the ESM graph, which
 * means every CommonJS dependency it reaches is compiled by Node's ESM CommonJS translator
 * (`loadCJSModule`). That translator names the V8 scripts with `file://` URLs, while the CommonJS
 * `__filename` of the very same modules is a plain filesystem path. Packages that locate native
 * addons by inspecting the call-site stack and comparing frame filenames against `__filename` —
 * most importantly the `bindings` package used by `better-sqlite3` — fail their self-skip and
 * compute the wrong module root, so the `.node` binary can't be found (`Could not locate the
 * bindings file`). Plain `node file.js`/`file.mjs` never hits this because the same packages are
 * loaded by Node's native CommonJS loader, which names scripts with plain paths.
 *
 * The fix below routes `node_modules` CommonJS modules back through the native CommonJS loader
 * (`createRequire`) so their stack frames carry plain filesystem paths again, matching plain Node.
 * The redirect fires only on the package entry the ESM graph reaches; native `require` then pulls
 * the rest of that package's CommonJS subtree through Node's own loader (never re-entering these
 * hooks), so call-site-based native-addon resolution works exactly as it does without the loader.
 *
 * Named exports are reconstructed statically with `cjs-module-lexer` (the same lexer Node uses for
 * its CommonJS<->ESM interop) so `import { foo } from 'some-cjs-pkg'` keeps working. The module
 * itself is executed exactly once, in the shim, on the main thread — the lexer only parses source
 * text and never runs it, so singletons and side effects are preserved.
 */

const VALID_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
// Names that are valid CommonJS export keys but cannot be ESM export bindings.
const RESERVED_EXPORT_NAMES = new Set(['default', '__esModule']);

/**
 * Decide whether an on-disk file is CommonJS the same way Node does: `.cjs` is always CommonJS,
 * `.mjs` never, and `.js` follows the nearest `package.json` `"type"` field (defaulting to
 * CommonJS). Only true CommonJS files may be redirected through the native CommonJS loader — an
 * ESM `.js` file in a `"type": "module"` package must keep loading as ESM.
 */
const packageTypeCache = new Map<string, boolean>();
function isCommonJsFile(filename: string): boolean {
    if (filename.endsWith('.cjs')) return true;
    if (filename.endsWith('.mjs')) return false;
    if (!filename.endsWith('.js')) return false;

    let dir = dirname(filename);
    while (true) {
        const cached = packageTypeCache.get(dir);
        if (cached !== undefined) return cached;
        const pkgPath = join(dir, 'package.json');
        if (existsSync(pkgPath)) {
            let isCjs = true;
            try {
                isCjs = JSON.parse(readFileSync(pkgPath, 'utf8')).type !== 'module';
            } catch {}
            packageTypeCache.set(dir, isCjs);
            return isCjs;
        }
        const parent = dirname(dir);
        if (parent === dir) return true; // no package.json found → Node treats .js as CommonJS
        dir = parent;
    }
}

let cjsLexerReady: Promise<void> | undefined;
function ensureCjsLexer(): Promise<void> {
    if (!cjsLexerReady) cjsLexerReady = initCjsLexer();
    return cjsLexerReady;
}

/**
 * Statically collect the named exports a CommonJS module exposes, following `module.exports = require('...')`
 * style re-exports the way Node's interop does. Pure source parsing — nothing is executed.
 */
async function collectCjsNamedExports(filename: string, seen = new Set<string>(), depth = 0): Promise<Set<string>> {
    const names = new Set<string>();
    if (depth > 5 || seen.has(filename)) return names;
    seen.add(filename);

    let source: string;
    try {
        source = await readFile(filename, 'utf8');
    } catch {
        return names;
    }

    let parsed: { exports: string[]; reexports: string[] };
    try {
        parsed = parseCjs(source);
    } catch {
        return names;
    }

    for (const name of parsed.exports) {
        if (VALID_IDENTIFIER.test(name) && !RESERVED_EXPORT_NAMES.has(name)) names.add(name);
    }

    if (parsed.reexports.length) {
        const req = createRequire(filename);
        for (const reexport of parsed.reexports) {
            let target: string;
            try {
                target = req.resolve(reexport);
            } catch {
                continue;
            }
            if (!isCommonJsFile(target)) continue;
            for (const name of await collectCjsNamedExports(target, seen, depth + 1)) names.add(name);
        }
    }

    return names;
}

async function loadNodeModulesCjs(url: string): Promise<{ format: 'module'; source: string; shortCircuit: true } | undefined> {
    let filename: string;
    try {
        filename = fileURLToPath(url);
    } catch {
        return undefined;
    }
    if (!existsSync(filename)) return undefined;
    // Only redirect genuine CommonJS — an ESM `.js` file (in a "type": "module" package) must keep
    // loading through the ESM pipeline, otherwise `createRequire()` would refuse it.
    if (!isCommonJsFile(filename)) return undefined;

    await ensureCjsLexer();
    const names = await collectCjsNamedExports(filename);
    const namedList = [...names];

    // Respect the `__esModule` interop marker the way Node's native CJS→ESM translator does:
    // a CommonJS module compiled by TypeScript/Babel sets `exports.__esModule = true` and exposes
    // its real default through `exports.default`. Re-exporting the whole `module.exports` as the
    // ESM default (`export default __cjs`) would bury that real default one level deeper, so
    // `import x from 'pkg'` yields the namespace object instead of `pkg.default` (e.g. formidable's
    // callable export becomes a non-callable object → `formidable_1.default is not a function`).
    // When the marker is absent we keep the legacy behavior: the whole `module.exports` is the default.
    const source =
        `import { createRequire } from 'node:module';\n` +
        `const require = createRequire(${JSON.stringify(url)});\n` +
        `const __cjs = require(${JSON.stringify(filename)});\n` +
        `const __default = __cjs && __cjs.__esModule && 'default' in __cjs ? __cjs.default : __cjs;\n` +
        `export default __default;\n` +
        (namedList.length ? `export const { ${namedList.join(', ')} } = __cjs;\n` : '');

    return { format: 'module', source, shortCircuit: true };
}

export async function load(url: string, context: any, nextLoad: Function) {
    const ext = extname(url);
    if (ext === '.ts' || ext === '.tsx') {
        const path = new URL(url).pathname;
        const source = await readFile(path, 'utf8');
        const { output, format } = transpile(source, path);
        return { format, source: output, shortCircuit: true };
    }

    // Route node_modules CommonJS through the native CommonJS loader so call-site based native-addon
    // resolution (e.g. the `bindings` package) keeps working. See the block comment above.
    // `loadNodeModulesCjs` re-checks that the file really is CommonJS before redirecting.
    if (url.startsWith('file:') && url.includes('/node_modules/') && /\.(c?m?js)$/.test(new URL(url).pathname)) {
        try {
            const redirected = await loadNodeModulesCjs(url);
            if (redirected) return redirected;
        } catch {
            // Fall through to Node's default loading on any failure — never make a module fail to
            // load that would otherwise have loaded.
        }
    }

    return nextLoad(url);
}
