/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

/**
 * JIT2: Unified Expression Tree Architecture
 *
 * This is a complete redesign of the JIT system using a clean expression tree
 * that both JIT compilation and direct execution can use.
 *
 * Key improvements over jit.ts:
 * 1. Single unified tree structure for both modes
 * 2. Clean separation: build tree once, then compile OR interpret
 * 3. No hotfixes needed for recursive types
 * 4. Simpler, more intuitive API
 *
 * @example
 * ```typescript
 * import { fn, arg } from '@deepkit/core/jit2';
 *
 * const serialize = fn(arg<User>(), (b, input) => {
 *     return b.obj({
 *         name: b.get(input, 'name'),
 *         email: b.get(input, 'email'),
 *     });
 * });
 * ```
 */

/*
 * The modules of this folder, each importing only the ones above it:
 *
 *   nodes.ts    the tree: expression and statement kinds, the block
 *   runtime.ts  what the environment allows, and the configuration (mode, threshold, debug)
 *   codegen.ts  the compiled mode: a block as JavaScript source, built with `new Function`
 *   exec.ts     the interpreted mode: a block as nested closures
 *   builder.ts  how a tree is written: Builder, Ref, VarRef (it imports nodes.ts only)
 *   entry.ts    fn / fnJIT / fnJITTop / fnExec and their async twins: a declaration, and which mode runs it
 *
 * This file is the PUBLIC surface, and `../jit.ts` re-exports it. What a module exports for its
 * neighbours only (`CodeGenerator`, `createExecutor`, `interpretedValue`, the `jitThreshold` and
 * `jitDebug` bindings) is not listed here and so is not part of the package.
 */
export * from './nodes.js';
export {
    type RuntimeCapabilities,
    getRuntimeCapabilities,
    canJIT,
    type JitMode,
    setJitMode,
    getJitMode,
    compilesFunctions,
    setJitThreshold,
    setJitDebug,
    getJitThreshold,
} from './runtime.js';
export { sanitizeIdentifier } from './codegen.js';
export * from './builder.js';
export * from './entry.js';
export { default } from './entry.js';
