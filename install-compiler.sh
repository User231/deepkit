#!/usr/bin/env sh

set -e;

tsc --build packages/type-compiler/tsconfig.json;
node packages/type-compiler/dist/cjs/install-transformer.js;
