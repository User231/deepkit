/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import type { CompilerOptions } from 'typescript';
import ts from 'typescript';

/**
 * The `lib.*.d.ts` files a compiler-options target and `lib` list pull in,
 * in TypeScript's own order — the globals the compiler resolves type names
 * against when a file declares none of its own.
 *
 * Vendored from `@typescript/vfs` 1.6.4 (`knownLibFilesForCompilerOptions`,
 * MIT, Microsoft Corporation) so the compiler's RUNTIME graph no longer
 * loads that package: its module top-level reads the `localStorage` global
 * for a debug switch, and Node 25+ ships that global on by default and emits
 * an ExperimentalWarning for every read without `--localstorage-file` — one
 * warning per process that loads the transformer (every ts-node boot). The
 * package stays a devDependency: the tests use its virtual file system.
 *
 * Same algorithm as upstream: the list is a fixed ORDERED catalogue; the
 * result is its prefix up to the furthest file the target or any `lib`
 * entry names. Upstream notes the list includes files a given TypeScript
 * version may not ship; the caller skips what its resolver cannot find.
 */
export function knownLibFilesForCompilerOptions(compilerOptions: CompilerOptions): string[] {
    const target = compilerOptions.target || ts.ScriptTarget.ES5;
    const lib = compilerOptions.lib || [];

    const targetToCut = ts.ScriptTarget[target].toLowerCase();
    const targetMatches = KNOWN_LIB_FILES.filter(f => f.startsWith('lib.' + targetToCut));
    const targetCutIndex = KNOWN_LIB_FILES.indexOf(targetMatches[targetMatches.length - 1]);

    const libCutIndex = lib.reduce((max, name) => {
        const matches = KNOWN_LIB_FILES.filter(f => f.startsWith('lib.' + name.toLowerCase()));
        if (matches.length === 0) return max;
        return Math.max(max, KNOWN_LIB_FILES.indexOf(matches[matches.length - 1]));
    }, 0);

    return KNOWN_LIB_FILES.slice(0, Math.max(targetCutIndex, libCutIndex) + 1);
}

const KNOWN_LIB_FILES: readonly string[] = [
    'lib.d.ts',
    'lib.core.d.ts',
    'lib.decorators.d.ts',
    'lib.decorators.legacy.d.ts',
    'lib.dom.asynciterable.d.ts',
    'lib.dom.d.ts',
    'lib.dom.iterable.d.ts',
    'lib.webworker.asynciterable.d.ts',
    'lib.webworker.d.ts',
    'lib.webworker.importscripts.d.ts',
    'lib.webworker.iterable.d.ts',
    'lib.scripthost.d.ts',
    'lib.es5.d.ts',
    'lib.es6.d.ts',
    'lib.es7.d.ts',
    'lib.core.es6.d.ts',
    'lib.core.es7.d.ts',
    'lib.es2015.collection.d.ts',
    'lib.es2015.core.d.ts',
    'lib.es2015.d.ts',
    'lib.es2015.generator.d.ts',
    'lib.es2015.iterable.d.ts',
    'lib.es2015.promise.d.ts',
    'lib.es2015.proxy.d.ts',
    'lib.es2015.reflect.d.ts',
    'lib.es2015.symbol.d.ts',
    'lib.es2015.symbol.wellknown.d.ts',
    'lib.es2016.array.include.d.ts',
    'lib.es2016.d.ts',
    'lib.es2016.full.d.ts',
    'lib.es2016.intl.d.ts',
    'lib.es2017.arraybuffer.d.ts',
    'lib.es2017.d.ts',
    'lib.es2017.date.d.ts',
    'lib.es2017.full.d.ts',
    'lib.es2017.intl.d.ts',
    'lib.es2017.object.d.ts',
    'lib.es2017.sharedmemory.d.ts',
    'lib.es2017.string.d.ts',
    'lib.es2017.typedarrays.d.ts',
    'lib.es2018.asyncgenerator.d.ts',
    'lib.es2018.asynciterable.d.ts',
    'lib.es2018.d.ts',
    'lib.es2018.full.d.ts',
    'lib.es2018.intl.d.ts',
    'lib.es2018.promise.d.ts',
    'lib.es2018.regexp.d.ts',
    'lib.es2019.array.d.ts',
    'lib.es2019.d.ts',
    'lib.es2019.full.d.ts',
    'lib.es2019.intl.d.ts',
    'lib.es2019.object.d.ts',
    'lib.es2019.string.d.ts',
    'lib.es2019.symbol.d.ts',
    'lib.es2020.bigint.d.ts',
    'lib.es2020.d.ts',
    'lib.es2020.date.d.ts',
    'lib.es2020.full.d.ts',
    'lib.es2020.intl.d.ts',
    'lib.es2020.number.d.ts',
    'lib.es2020.promise.d.ts',
    'lib.es2020.sharedmemory.d.ts',
    'lib.es2020.string.d.ts',
    'lib.es2020.symbol.wellknown.d.ts',
    'lib.es2021.d.ts',
    'lib.es2021.full.d.ts',
    'lib.es2021.intl.d.ts',
    'lib.es2021.promise.d.ts',
    'lib.es2021.string.d.ts',
    'lib.es2021.weakref.d.ts',
    'lib.es2022.array.d.ts',
    'lib.es2022.d.ts',
    'lib.es2022.error.d.ts',
    'lib.es2022.full.d.ts',
    'lib.es2022.intl.d.ts',
    'lib.es2022.object.d.ts',
    'lib.es2022.regexp.d.ts',
    'lib.es2022.sharedmemory.d.ts',
    'lib.es2022.string.d.ts',
    'lib.es2023.array.d.ts',
    'lib.es2023.collection.d.ts',
    'lib.es2023.d.ts',
    'lib.es2023.full.d.ts',
    'lib.es2023.intl.d.ts',
    'lib.es2024.arraybuffer.d.ts',
    'lib.es2024.collection.d.ts',
    'lib.es2024.d.ts',
    'lib.es2024.full.d.ts',
    'lib.es2024.object.d.ts',
    'lib.es2024.promise.d.ts',
    'lib.es2024.regexp.d.ts',
    'lib.es2024.sharedmemory.d.ts',
    'lib.es2024.string.d.ts',
    'lib.es2025.collection.d.ts',
    'lib.es2025.d.ts',
    'lib.es2025.float16.d.ts',
    'lib.es2025.full.d.ts',
    'lib.es2025.intl.d.ts',
    'lib.es2025.iterator.d.ts',
    'lib.es2025.promise.d.ts',
    'lib.es2025.regexp.d.ts',
    'lib.esnext.array.d.ts',
    'lib.esnext.asynciterable.d.ts',
    'lib.esnext.bigint.d.ts',
    'lib.esnext.collection.d.ts',
    'lib.esnext.d.ts',
    'lib.esnext.date.d.ts',
    'lib.esnext.decorators.d.ts',
    'lib.esnext.disposable.d.ts',
    'lib.esnext.error.d.ts',
    'lib.esnext.float16.d.ts',
    'lib.esnext.full.d.ts',
    'lib.esnext.intl.d.ts',
    'lib.esnext.iterator.d.ts',
    'lib.esnext.object.d.ts',
    'lib.esnext.promise.d.ts',
    'lib.esnext.regexp.d.ts',
    'lib.esnext.sharedmemory.d.ts',
    'lib.esnext.string.d.ts',
    'lib.esnext.symbol.d.ts',
    'lib.esnext.temporal.d.ts',
    'lib.esnext.typedarrays.d.ts',
    'lib.esnext.weakref.d.ts',
];
