/**
 * Runs in a subprocess of jit-mode.spec.ts: the mode a process starts in comes from its
 * environment, which a test cannot change for itself after `jit.ts` was imported.
 * Prints one JSON line.
 */
import { Builder, Ref, arg, canJIT, compilesFunctions, fn, fnJITTop, getJitMode } from '../src/jit.js';

let built = 0;
const NativeFunction = globalThis.Function;
globalThis.Function = new Proxy(NativeFunction, {
    construct(target, args) {
        built++;
        return Reflect.construct(target, args);
    },
});

const double = fn(arg(), (b: Builder, n: Ref) => b.mul(n, b.lit(2)));
const triple = fnJITTop(arg(), (b: Builder, n: Ref) => b.mul(n, b.lit(3)));

console.log(
    JSON.stringify({
        mode: getJitMode(),
        canJIT,
        compiles: compilesFunctions(),
        built,
        answers: [double(4), triple(4)],
    }),
);
