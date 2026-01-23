/**
 * Analyze deserialize performance bottlenecks.
 *
 * Run: node --import @deepkit/run benchmarks/deserialize-analysis.ts
 */
import { typeOf } from '../src/reflection/reflection.js';
import { getSerializeFunction, serializer } from '../src/serializer/index.js';

interface Simple {
    number: number;
    string: string;
    boolean: boolean;
}

interface WithNested {
    number: number;
    string: string;
    nested: {
        foo: string;
        num: number;
    };
}

const type = typeOf<Simple>();
const typeNested = typeOf<WithNested>();

const deepkitDeserialize = getSerializeFunction(type, serializer.deserializeRegistry);
const deepkitDeserializeNested = getSerializeFunction(typeNested, serializer.deserializeRegistry);

const simpleData = { number: 1, string: 'test', boolean: true };
const nestedData = { number: 1, string: 'test', nested: { foo: 'bar', num: 42 } };

// Various deserialize implementations to test overhead sources
function baseline(s0: any) {
    return { number: s0.number, string: s0.string, boolean: s0.boolean };
}

function withOptionsArg(s0: any, s1: any) {
    return { number: s0.number, string: s0.string, boolean: s0.boolean };
}

function withOptionsInit(s0: any, s1: any) {
    var s2 = s1 ? s1 : {};
    return { number: s0.number, string: s0.string, boolean: s0.boolean };
}

function withInChecks(s0: any, s1: any) {
    var s2 = s1 ? s1 : {};
    var s3: any = {};
    if ('number' in s0) {
        s3.number = s0.number;
    }
    if ('string' in s0) {
        s3.string = s0.string;
    }
    if ('boolean' in s0) {
        s3.boolean = s0.boolean;
    }
    return s3;
}

function withNullChecks(s0: any, s1: any) {
    var s2 = s1 ? s1 : {};
    var s3: any = {};
    if ('number' in s0) {
        if (!(s0.number == null)) {
            s3.number = s0.number;
        }
    }
    if ('string' in s0) {
        if (!(s0.string == null)) {
            s3.string = s0.string;
        }
    }
    if ('boolean' in s0) {
        if (!(s0.boolean == null)) {
            s3.boolean = s0.boolean;
        }
    }
    return s3;
}

function withTypeChecks(s0: any, s1: any) {
    var s2 = s1 ? s1 : {};
    var s3: any = {};
    if ('number' in s0) {
        if (!(s0.number == null)) {
            s3.number = typeof s0.number === 'number' ? s0.number : s0.number;
        }
    }
    if ('string' in s0) {
        if (!(s0.string == null)) {
            s3.string = typeof s0.string === 'string' ? s0.string : s0.string;
        }
    }
    if ('boolean' in s0) {
        if (!(s0.boolean == null)) {
            s3.boolean = typeof s0.boolean === 'boolean' ? s0.boolean : s0.boolean;
        }
    }
    return s3;
}

function withLooselyCheck(s0: any, s1: any) {
    var s2 = s1 ? s1 : {};
    var s3: any = {};
    if ('number' in s0) {
        if (!(s0.number == null)) {
            // This is what adds most overhead - checking loosely mode
            s3.number =
                typeof s0.number === 'number'
                    ? s0.number
                    : s2.loosely !== false && typeof s0.number === 'boolean'
                      ? s0.number
                          ? 1
                          : 0
                      : s0.number;
        }
    }
    if ('string' in s0) {
        if (!(s0.string == null)) {
            var v = s0.string;
            if (
                s2.loosely !== false &&
                (typeof s0.string === 'number' || typeof s0.string === 'boolean' || typeof s0.string === 'bigint')
            ) {
                v = String(s0.string);
            }
            s3.string = v;
        }
    }
    if ('boolean' in s0) {
        if (!(s0.boolean == null)) {
            var v = s0.boolean;
            if (typeof s0.boolean === 'boolean') {
                v = s0.boolean;
            }
            if (s2.loosely !== false && !(typeof s0.boolean === 'boolean')) {
                if (s0.boolean === 'true' || s0.boolean === '1' || s0.boolean === 1) {
                    v = true;
                }
                if (s0.boolean === 'false' || s0.boolean === '0' || s0.boolean === 0) {
                    v = false;
                }
            }
            s3.boolean = v;
        }
    }
    return s3;
}

function benchmark(name: string, fn: () => any, iterations: number = 2_000_000): number {
    const acc: any[] = [];
    for (let i = 0; i < 50000; i++) acc.push(fn());
    acc.length = 0;

    const runs: number[] = [];
    for (let run = 0; run < 3; run++) {
        const start = performance.now();
        for (let i = 0; i < iterations; i++) acc.push(fn());
        const end = performance.now();
        runs.push(iterations / ((end - start) / 1000));
        acc.length = 0;
    }
    runs.sort((a, b) => b - a);
    return Math.round(runs[0]);
}

function formatOps(ops: number): string {
    return (ops / 1e6).toFixed(1) + 'M';
}

console.log('=== Deserialize Overhead Analysis ===\n');
console.log('Testing each layer of overhead to identify bottlenecks.\n');

const baselineResult = benchmark('baseline (direct return)', () => baseline(simpleData));
const optionsArgResult = benchmark('+ options arg', () => withOptionsArg(simpleData, {}));
const optionsInitResult = benchmark('+ options init', () => withOptionsInit(simpleData, {}));
const inChecksResult = benchmark('+ in checks', () => withInChecks(simpleData, {}));
const nullChecksResult = benchmark('+ null checks', () => withNullChecks(simpleData, {}));
const typeChecksResult = benchmark('+ type checks', () => withTypeChecks(simpleData, {}));
const looselyResult = benchmark('+ loosely conversion', () => withLooselyCheck(simpleData, {}));
const deepkitResult = benchmark('deepkit deserialize', () => deepkitDeserialize(simpleData, {}));

console.log('--- Results (Simple: 3 properties) ---');
console.log(`Baseline (direct):      ${formatOps(baselineResult).padStart(7)} ops/s (100%)`);
console.log(
    `+ options arg:          ${formatOps(optionsArgResult).padStart(7)} ops/s (${((optionsArgResult / baselineResult) * 100).toFixed(0)}%)`,
);
console.log(
    `+ options init:         ${formatOps(optionsInitResult).padStart(7)} ops/s (${((optionsInitResult / baselineResult) * 100).toFixed(0)}%)`,
);
console.log(
    `+ in checks:            ${formatOps(inChecksResult).padStart(7)} ops/s (${((inChecksResult / baselineResult) * 100).toFixed(0)}%)`,
);
console.log(
    `+ null checks:          ${formatOps(nullChecksResult).padStart(7)} ops/s (${((nullChecksResult / baselineResult) * 100).toFixed(0)}%)`,
);
console.log(
    `+ type checks:          ${formatOps(typeChecksResult).padStart(7)} ops/s (${((typeChecksResult / baselineResult) * 100).toFixed(0)}%)`,
);
console.log(
    `+ loosely conversion:   ${formatOps(looselyResult).padStart(7)} ops/s (${((looselyResult / baselineResult) * 100).toFixed(0)}%)`,
);
console.log(
    `Deepkit deserialize:    ${formatOps(deepkitResult).padStart(7)} ops/s (${((deepkitResult / baselineResult) * 100).toFixed(0)}%)`,
);

console.log('\n--- Generated Code ---\n');
console.log('Deepkit Simple Deserialize:');
console.log(deepkitDeserialize.toString());
console.log('\nDeepkit Nested Deserialize:');
console.log(deepkitDeserializeNested.toString());
