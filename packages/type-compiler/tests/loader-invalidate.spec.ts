/**
 * The loader in a LONG-LIVED host (a bundler's dev server): a file that changes
 * after another file's reflection read it must be read again, or the type it
 * gained keeps reflecting as unknown until the process restarts.
 *
 * @see packages/type-compiler/src/loader.ts `invalidate`, `transformWithDependencies`
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { after, before, describe, test } from 'node:test';
import { tmpdir } from 'os';
import { join } from 'path';

import { expect } from '@deepkit/run/expect';

import { DeepkitLoader } from '../src/loader.js';

let dir: string;
before(() => {
    // Kept as given (a symlinked temp dir on macOS): invalidate() must cope with either spelling.
    dir = mkdtempSync(join(tmpdir(), 'deepkit-loader-invalidate-'));
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2020', module: 'es2020', moduleResolution: 'node' }, reflection: true }));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const mainSource = `
import { typeOf } from '@deepkit/type';
import { Later } from './dep';
export const later = typeOf<Later>();
`;

describe('DeepkitLoader - invalidate', () => {
    test('a type added to a dependency reflects after invalidate, and the dependency is reported', () => {
        const loader = new DeepkitLoader({ reflection: 'default' });
        const dep = join(dir, 'dep.ts');
        const main = join(dir, 'main.ts');
        writeFileSync(dep, `export interface First { a: string }\n`);

        // First transform: `Later` does not exist yet → no reflection import for it.
        const before = loader.transformWithDependencies(mainSource, main);
        expect(before.code).not.toContain('__ΩLater');
        expect(before.dependencies).toContain(dep);

        // The dependency gains the type. Without invalidation the resolver's
        // cached copy of dep.ts still lacks it.
        writeFileSync(dep, `export interface First { a: string }\nexport interface Later { b: number }\n`);
        const stale = loader.transform(mainSource, main);
        expect(stale).not.toContain('__ΩLater');

        loader.invalidate(dep);
        const fresh = loader.transform(mainSource, main);
        expect(fresh).toContain('__ΩLater');
        expect(fresh).toContain("from './dep'");
    });

    test('transforming a file itself refreshes what other files resolve through it', () => {
        const loader = new DeepkitLoader({ reflection: 'default' });
        const dep = join(dir, 'dep2.ts');
        const main = join(dir, 'main2.ts');
        const source = mainSource.replace("'./dep'", "'./dep2'");
        writeFileSync(dep, `export interface First { a: string }\n`);
        expect(loader.transform(source, main)).not.toContain('__ΩLater');

        // The bundler hands the loader the dependency's NEW source (it changed
        // and was re-transformed) — that alone must refresh the resolver's copy.
        const grown = `export interface First { a: string }\nexport interface Later { b: number }\n`;
        writeFileSync(dep, grown);
        loader.transform(grown, dep);
        expect(loader.transform(source, main)).toContain('__ΩLater');
    });
});
