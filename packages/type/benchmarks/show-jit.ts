import { ReflectionClass } from '../src/reflection/reflection.js';
import { getSerializeFunction, serializer } from '../src/serializer/index.js';

class SmallModel {
    ready?: boolean;
    tags: string[] = [];
    priority: number = 0;
    constructor(
        public id: number,
        public name: string,
    ) {}
}

// No optional properties - should be full literal
class AllRequired {
    tags: string[] = [];
    priority: number = 0;
    constructor(
        public id: number,
        public name: string,
    ) {}
}

const type = ReflectionClass.from(SmallModel).type;
const typeAllRequired = ReflectionClass.from(AllRequired).type;

console.log('=== SmallModel (1 optional) ===');
const fnSmall = getSerializeFunction(type, serializer.serializeRegistry);
console.log(fnSmall.toString());

console.log('');
console.log('=== AllRequired (no optionals) ===');
const fnAllReq = getSerializeFunction(typeAllRequired, serializer.serializeRegistry);
console.log(fnAllReq.toString());

// Benchmark
function benchmark(name: string, fn: () => any, iterations: number = 5_000_000): number {
    for (let i = 0; i < 100000; i++) fn();
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    const end = performance.now();
    return Math.round(iterations / ((end - start) / 1000));
}

function formatOps(ops: number): string {
    if (ops >= 1_000_000) return (ops / 1_000_000).toFixed(0) + 'M';
    return (ops / 1_000).toFixed(0) + 'K';
}

const modelSmall = new SmallModel(1, 'test');
modelSmall.tags = ['a', 'b'];
modelSmall.priority = 5;
modelSmall.ready = true; // Set the optional property

const modelSmallNoReady = new SmallModel(2, 'test2');
modelSmallNoReady.tags = ['c'];
modelSmallNoReady.priority = 3;
// Don't set ready

const modelAllReq = new AllRequired(1, 'test');
modelAllReq.tags = ['a', 'b'];
modelAllReq.priority = 5;

console.log('');
console.log('=== PERFORMANCE (3 runs, take best) ===');

function benchBest(name: string, fn: () => any): number {
    const results: number[] = [];
    for (let run = 0; run < 3; run++) {
        results.push(benchmark(name, fn));
    }
    return Math.max(...results);
}

console.log(`SmallModel WITH ready:     ${formatOps(benchBest('small-with', () => fnSmall(modelSmall)))} ops/s`);
console.log(
    `SmallModel WITHOUT ready:  ${formatOps(benchBest('small-without', () => fnSmall(modelSmallNoReady)))} ops/s`,
);
console.log(`AllRequired (direct ret):  ${formatOps(benchBest('allreq', () => fnAllReq(modelAllReq)))} ops/s`);

// Test actual functionality
const serializeFn = getSerializeFunction(type, serializer.serializeRegistry);
const model = new SmallModel(1, 'test');
model.ready = true;
model.tags = ['a', 'b'];
model.priority = 5;

console.log('\n--- Functional Test ---');
const serialized = serializeFn(model);
console.log('Serialized:', JSON.stringify(serialized));
