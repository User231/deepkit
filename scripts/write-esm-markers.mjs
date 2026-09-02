#!/usr/bin/env node
// The last step of `npm run build`: stamp every ESM build output as ES modules.
//
// Each package's `tsconfig.esm.json` emits into `dist/esm`, but the package's
// own package.json says nothing about module type — so Node would read those
// files as CommonJS. A `dist/esm/package.json` of `{"type": "module"}` is the
// standard fix. It used to be written by every package's `build` script, run
// through `lerna run build` — i.e. through Nx, whose task cache treated
// `dist/` as the task's OUTPUT: on a cache hit it deleted the dist tsc had just
// written and copied an older snapshot back in, timestamps included. That
// silently shipped stale framework builds and tripped the app's staleness
// guard on machines where a checkout had touched a source file. This script is
// a plain loop with no cache, no daemon and no restore path — the build's
// output is what tsc wrote, always.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages');
const marker = '{"type": "module"}\n';

let written = 0;
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkg = join(packagesDir, entry.name);
    if (!existsSync(join(pkg, 'tsconfig.esm.json'))) continue; // no ESM build — nothing to mark
    const esm = join(pkg, 'dist', 'esm');
    if (!existsSync(esm)) {
        // tsc --build tsconfig.esm.json emits here; a missing dir means that build never ran.
        console.error(`write-esm-markers: ${esm} does not exist — run \`tsc --build tsconfig.esm.json\` first`);
        process.exit(1);
    }
    writeFileSync(join(esm, 'package.json'), marker);
    written++;
}
console.log(`write-esm-markers: stamped ${written} packages' dist/esm as ES modules`);
