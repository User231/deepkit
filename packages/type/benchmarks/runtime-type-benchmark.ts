/**
 * Comparable benchmark to typescript-runtime-type-benchmarks
 * https://github.com/moltar/typescript-runtime-type-benchmarks
 *
 * Tests the same data structure and operations used in that benchmark.
 *
 * Old Deepkit (before jit.ts): ~4.6M ops/s
 * Top competitor (typia): ~76M ops/s
 *
 * Run: node --import @deepkit/run benchmarks/runtime-type-benchmark.ts
 */
import { typeOf } from '../src/reflection/reflection.js';
import { cast } from '../src/serializer-facade.js';
import { createTypeGuardFunction, getSerializeFunction, serializer } from '../src/serializer/index.js';
import { getValidatorFunction, is } from '../src/typeguard.js';

// The exact interface from the benchmark
interface ToBeChecked {
    number: number;
    negNumber: number;
    maxNumber: number;
    string: string;
    longString: string;
    boolean: boolean;
    deeplyNested: {
        foo: string;
        num: number;
        bool: boolean;
    };
}

// The exact test data from the benchmark
const validateData: ToBeChecked = Object.freeze({
    number: 1,
    negNumber: -1,
    maxNumber: Number.MAX_VALUE,
    string: 'string',
    longString:
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Vivendum intellegat et qui, ei denique consequuntur vix. Semper aeterno percipit ut his, sea ex utinam referrentur repudiandae. No epicuri hendrerit consetetur sit, sit dicta adipiscing ex, in facete detracto deterruisset duo. Quot populo ad qui. Sit fugit nostrum et. Ad per diam dicant interesset, lorem iusto sensibus ut sed. No dicam aperiam vis. Pri posse graeco definitiones cu, id eam populo quaestio adipiscing, usu quod malorum te. Ex nam agam veri, dicunt efficiantur ad qui, ad legere adversarium sit. Commune platonem mel id, brute adipiscing duo an. Vivendum intellegat et qui, ei denique consequuntur vix. Offendit eleifend moderatius ex vix, quem odio mazim et qui, purto expetendis cotidieque quo cu, veri persius vituperata ei nec. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
    boolean: true,
    deeplyNested: {
        foo: 'bar',
        num: 1,
        bool: false,
    },
});

// Data with extra keys (should be stripped in parseSafe)
const dataWithExtraKeys = {
    ...validateData,
    extraAttribute: 'foo',
    deeplyNested: {
        ...validateData.deeplyNested,
        extraNestedAttribute: 'bar',
    },
};

// Pre-compile functions for fair comparison
const type = typeOf<ToBeChecked>();
const isToBeChecked = getValidatorFunction<ToBeChecked>(); // Pre-compiled validator
const isToBeCheckedLoose = createTypeGuardFunction(type, serializer, true); // With loose validation
const deserializeFn = getSerializeFunction(type, serializer.deserializeRegistry);

// Benchmark helper with DCE prevention
function benchmark(name: string, fn: () => any, iterations: number = 2_000_000): number {
    const acc: any[] = [];

    // Warmup
    for (let i = 0; i < 50000; i++) acc.push(fn());
    acc.length = 0;

    // Run multiple times, take best
    const runs: number[] = [];
    for (let run = 0; run < 3; run++) {
        const start = performance.now();
        for (let i = 0; i < iterations; i++) acc.push(fn());
        const end = performance.now();
        runs.push(iterations / ((end - start) / 1000));
        acc.length = 0;
    }

    runs.sort((a, b) => b - a);
    const ops = Math.round(runs[0]);
    console.log(`${name.padEnd(40)} ${(ops / 1e6).toFixed(1).padStart(6)}M ops/s`);
    return ops;
}

console.log('=== typescript-runtime-type-benchmarks comparison ===\n');
console.log('Data: 6 primitives + 1 nested object (3 primitives)\n');

// Verify correctness first
console.log('--- Correctness Check ---');
const result = cast<ToBeChecked>(dataWithExtraKeys);
console.log('Extra keys stripped:', !('extraAttribute' in result));
console.log('Nested extra keys stripped:', !('extraNestedAttribute' in result.deeplyNested));
console.log('Data valid:', JSON.stringify(result) === JSON.stringify(validateData));
console.log('');

console.log('--- Benchmark Results ---');

// parseSafe: validate + strip unknown keys (what the benchmark tests)
// With type coercion (loosely mode - default)
const parseSafeResult = benchmark('parseSafe (cast<T>, loosely)', () => cast<ToBeChecked>(dataWithExtraKeys));

// Without type coercion (strict mode)
const parseSafeStrictResult = benchmark('parseSafe (cast<T>, strict)', () =>
    cast<ToBeChecked>(dataWithExtraKeys, { loosely: false }),
);

// assertLoose: just validation, no stripping
const assertLooseResult = benchmark('assertLoose (is<T>)', () => is<ToBeChecked>(validateData));

// Pre-compiled validator (no type resolution overhead)
const precompiledResult = benchmark('assertLoose (precompiled)', () => isToBeChecked(validateData));

// Loose validator (allows some type coercion in checking)
const looseResult = benchmark('assertLoose (loose)', () => isToBeCheckedLoose(validateData));

// Direct deserialize (no unknown key stripping)
const deserializeResult = benchmark('deserialize (JIT fn)', () => deserializeFn(validateData, {}));

// Direct deserialize with strict mode
const deserializeStrictResult = benchmark('deserialize strict (JIT fn)', () =>
    deserializeFn(validateData, { loosely: false }),
);

// Also test serialize direction
const serializeFn = getSerializeFunction(type, serializer.serializeRegistry);
const serializeResult = benchmark('serialize (JIT fn)', () => serializeFn(validateData, {}));

console.log('\n--- Comparison with typescript-runtime-type-benchmarks ---');
console.log('');
console.log('LOOSE ASSERTION (validate only, no object creation):');
console.log(`  Top (ts-auto-guard):   ~84M ops/s`);
console.log(`  typia:                 ~79M ops/s`);
console.log(
    `  Deepkit (loose):       ${(looseResult / 1e6).toFixed(1)}M ops/s (${((looseResult / 84_590_026) * 100).toFixed(1)}%)`,
);
console.log(
    `  Deepkit (strict):      ${(precompiledResult / 1e6).toFixed(1)}M ops/s (${((precompiledResult / 84_590_026) * 100).toFixed(1)}%)`,
);
console.log(`  Deepkit is<T>():       ${(assertLooseResult / 1e6).toFixed(1)}M ops/s (with type resolution overhead)`);
console.log('');
console.log('SAFE PARSING (validate + create new object + strip keys):');
console.log(`  Top (typia):           ~76M ops/s`);
console.log(
    `  Deepkit serialize:     ${(serializeResult / 1e6).toFixed(1)}M ops/s (${((serializeResult / 76_468_474) * 100).toFixed(1)}%)`,
);
console.log('');
console.log('DEEPKIT UNIQUE CAPABILITY (type coercion + validation):');
console.log(`  cast (with coercion):  ${(parseSafeResult / 1e6).toFixed(1)}M ops/s`);
console.log(`  Old Deepkit cast:      ~4.6M ops/s`);

// Hand-written optimal version for comparison
function handOptimal(s0: typeof validateData) {
    return {
        number: s0.number,
        negNumber: s0.negNumber,
        maxNumber: s0.maxNumber,
        string: s0.string,
        longString: s0.longString,
        boolean: s0.boolean,
        deeplyNested: {
            foo: s0.deeplyNested.foo,
            num: s0.deeplyNested.num,
            bool: s0.deeplyNested.bool,
        },
    };
}

console.log('\n--- Theoretical Maximum ---');
const handResult = benchmark('hand-optimized clone', () => handOptimal(validateData));
console.log(`Our serialize vs hand:  ${((serializeResult / handResult) * 100).toFixed(1)}%`);

// Test with no options object overhead
const serializeNoOpts = benchmark('serialize (no opts)', () => serializeFn(validateData, undefined as any));
console.log(`Without opts object:    ${((serializeNoOpts / handResult) * 100).toFixed(1)}% of hand-optimized`);

console.log('\n--- Generated Code ---');
console.log('\nSerialize JIT:');
console.log(serializeFn.toString());
