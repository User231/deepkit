/**
 * Compare Deepkit JIT-generated code against hand-optimized V8 patterns.
 *
 * Uses accumulator arrays to prevent DCE (dead code elimination).
 */
import { ReflectionClass } from '../src/reflection/reflection.js';
import { getSerializeFunction, serializer } from '../src/serializer/index.js';

// Test models
class SmallModel {
    ready?: boolean;
    tags: string[] = [];
    priority: number = 0;
    constructor(
        public id: number,
        public name: string,
    ) {}
}

class AllRequired {
    tags: string[] = [];
    priority: number = 0;
    constructor(
        public id: number,
        public name: string,
    ) {}
}

// Get Deepkit serializers
const smallModelFn = getSerializeFunction(ReflectionClass.from(SmallModel).type, serializer.serializeRegistry);
const allRequiredFn = getSerializeFunction(ReflectionClass.from(AllRequired).type, serializer.serializeRegistry);

// Hand-optimized functions matching our generated patterns
function handDirectReturn(s0: any) {
    return { tags: s0.tags, priority: s0.priority, id: s0.id, name: s0.name };
}

function handVarReturn(s0: any) {
    var s3 = { tags: s0.tags, priority: s0.priority, id: s0.id, name: s0.name };
    return s3;
}

function handWithOptional(s0: any) {
    var s3 = { tags: s0.tags, priority: s0.priority, id: s0.id, name: s0.name } as any;
    if ('ready' in s0) {
        s3.ready = s0.ready ?? null;
    }
    return s3;
}

// Test inputs
const modelWithReady = new SmallModel(1, 'test');
modelWithReady.tags = ['a', 'b'];
modelWithReady.priority = 5;
modelWithReady.ready = true;

const modelWithoutReady = new SmallModel(2, 'test2');
modelWithoutReady.tags = ['c'];
modelWithoutReady.priority = 3;

const modelAllRequired = new AllRequired(1, 'test');
modelAllRequired.tags = ['a', 'b'];
modelAllRequired.priority = 5;

// Benchmark with DCE prevention
function benchmark(name: string, fn: () => any, iterations: number = 2_000_000): number {
    const acc: any[] = [];

    // Warmup
    for (let i = 0; i < 10000; i++) acc.push(fn());
    acc.length = 0;

    // Benchmark
    const start = performance.now();
    for (let i = 0; i < iterations; i++) acc.push(fn());
    const end = performance.now();

    const ops = iterations / ((end - start) / 1000);
    console.log(`${name.padEnd(35)} ${(ops / 1e6).toFixed(1).padStart(6)}M ops/s (len=${acc.length})`);
    return ops;
}

console.log('=== V8-realistic benchmark (with DCE prevention) ===\n');

console.log('--- Deepkit JIT Generated ---');
benchmark('AllRequired (direct)', () => allRequiredFn(modelAllRequired, {}));
benchmark('SmallModel WITH ready', () => smallModelFn(modelWithReady, {}));
benchmark('SmallModel WITHOUT ready', () => smallModelFn(modelWithoutReady, {}));

console.log('\n--- Hand-written Baseline ---');
benchmark('handDirectReturn', () => handDirectReturn(modelAllRequired));
benchmark('handVarReturn', () => handVarReturn(modelAllRequired));
benchmark('handWithOptional (has ready)', () => handWithOptional(modelWithReady));
benchmark('handWithOptional (no ready)', () => handWithOptional(modelWithoutReady));

console.log('\n=== Generated Code Comparison ===');
console.log('\nAllRequired JIT:');
console.log(allRequiredFn.toString());
console.log('\nSmallModel JIT:');
console.log(smallModelFn.toString());
