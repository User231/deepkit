/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

/*
 * The JIT lives in `./jit/` since 2026-11-17 — `jit/index.ts` says which module holds what.
 * This file is kept so that every import of `./src/jit.js` reads what it always read.
 */
export * from './jit/index.js';
export { default } from './jit/index.js';
