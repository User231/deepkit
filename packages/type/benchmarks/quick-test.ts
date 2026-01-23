/** @reflection 2 */
import { deserialize, serialize } from '../index.js';

class SmallModel {
    ready?: boolean;
    tags: string[] = [];
    priority: number = 0;
    constructor(
        public id: number,
        public name: string,
    ) {}
}

const data = { name: 'test', id: 1, tags: ['a', 'b', 'c'], priority: 5, ready: true };

// Warm up
for (let i = 0; i < 1000; i++) {
    deserialize<SmallModel>(data);
}

// Quick benchmark
const iterations = 100000;

const start = performance.now();
for (let i = 0; i < iterations; i++) {
    deserialize<SmallModel>(data);
}
const elapsed = performance.now() - start;

console.log('SmallModel deserialize:');
console.log('  ops/sec:', Math.round((iterations / elapsed) * 1000).toLocaleString());
console.log('  µs/op:', ((elapsed / iterations) * 1000).toFixed(3));

// Test serialize
const instance = deserialize<SmallModel>(data);
const start2 = performance.now();
for (let i = 0; i < iterations; i++) {
    serialize<SmallModel>(instance);
}
const elapsed2 = performance.now() - start2;

console.log('SmallModel serialize:');
console.log('  ops/sec:', Math.round((iterations / elapsed2) * 1000).toLocaleString());
console.log('  µs/op:', ((elapsed2 / iterations) * 1000).toFixed(3));

// Simple array test
interface Item {
    id: number;
    name: string;
}
const arrayData: Item[] = [];
for (let i = 0; i < 100; i++) {
    arrayData.push({ id: i, name: `item-${i}` });
}

for (let i = 0; i < 100; i++) {
    deserialize<Item[]>(arrayData);
}

const iterations2 = 1000;
const start3 = performance.now();
for (let i = 0; i < iterations2; i++) {
    deserialize<Item[]>(arrayData);
}
const elapsed3 = performance.now() - start3;

console.log('Array[100] deserialize:');
console.log('  ops/sec:', Math.round((iterations2 / elapsed3) * 1000).toLocaleString());
console.log('  µs/op:', ((elapsed3 / iterations2) * 1000).toFixed(3));
console.log('  µs/item:', (((elapsed3 / iterations2) * 1000) / 100).toFixed(3));
