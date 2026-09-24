import { createFilter } from '@rollup/pluginutils';
import type { Plugin } from 'vite';

import { DeepkitLoader, type DeepkitLoaderOptions } from '@deepkit/type-compiler';

export interface Options {
    /**
     * Glob patterns to include. Defaults to ['**\/*.tsx', '**\/*.ts']
     */
    include?: string | string[];

    /**
     * Glob patterns to exclude. Defaults to 'node_modules/**'
     */
    exclude?: string | string[];

    /**
     * Path to tsconfig.json. If not provided, will search from project root.
     */
    tsConfig?: string;

    /**
     * Override reflection mode. If not set, uses tsconfig's reflection option.
     * Set to 'default' to enable reflection for all files regardless of tsconfig.
     * Useful for simple projects without explicit tsconfig reflection configuration.
     */
    reflection?: DeepkitLoaderOptions['reflection'];
}

/**
 * Vite plugin for Deepkit type reflection.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { deepkitType } from '@deepkit/vite';
 *
 * export default {
 *   plugins: [
 *     // Simple usage - enables reflection for all files
 *     deepkitType({ reflection: 'default' })
 *   ]
 * }
 * ```
 *
 * @example
 * ```ts
 * // vite.config.ts - respect tsconfig.json settings
 * import { deepkitType } from '@deepkit/vite';
 *
 * export default {
 *   plugins: [
 *     deepkitType({ tsConfig: './tsconfig.json' })
 *   ]
 * }
 * ```
 */
export function deepkitType(options: Options = {}): Plugin {
    const filter = createFilter(options.include ?? ['**/*.tsx', '**/*.ts'], options.exclude ?? 'node_modules/**');

    const loader = new DeepkitLoader({
        tsConfig: options.tsConfig,
        reflection: options.reflection,
    });

    return {
        name: 'deepkit-type',
        enforce: 'pre',
        transform(code: string, fileName: string) {
            if (!filter(fileName)) return null;

            const { code: transformed, dependencies } = loader.transformWithDependencies(code, fileName);
            // The files this file's reflection read — a barrel, the module a
            // type lives in. Watching them makes Vite re-transform THIS file
            // when one changes (and see them at all when they sit outside the
            // root, an aliased workspace package say).
            for (const dependency of dependencies) this.addWatchFile(dependency);

            return {
                code: transformed,
                map: null,
            };
        },
        // A changed, created or deleted file leaves the loader's caches, so the
        // re-transforms Vite triggers resolve types against the new content.
        // Without this the resolver cache outlived the dev server's files and a
        // type added to a module reflected as `never` until a restart.
        watchChange(id: string) {
            loader.invalidate(id);
        },
    };
}
