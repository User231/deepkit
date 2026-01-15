# Deepkit Benchmark Infrastructure

Performance benchmarking infrastructure for Deepkit Framework.

## Directory Structure

```
benchmarks/
├── src/
│   ├── suite.ts              # BenchSuite class for defining benchmarks
│   ├── runner.ts             # Main benchmark runner and CLI
│   ├── utils.ts              # Warmup, V8 introspection, memory tracking
│   └── reporter/
│       ├── json.ts           # JSON output for CI/CD integration
│       ├── console.ts        # Console output with colors
│       └── comparison.ts     # Baseline comparison for regression detection
├── baselines/                # Stored baseline results for comparison
├── package.json
├── tsconfig.json
└── README.md
```

## Installation

```bash
cd benchmarks
npm install
```

## Writing Benchmarks

Create a file with `.bench.ts` extension:

```typescript
import { BenchSuite } from './src/suite';
import { warmup } from './src/utils';

export default function() {
    const suite = new BenchSuite('My Benchmark');

    // Warmup the function before benchmarking
    const myFunction = () => { /* ... */ };
    warmup(myFunction);

    // Add synchronous benchmark
    suite.add('sync operation', () => {
        myFunction();
    });

    // Add async benchmark
    suite.addAsync('async operation', async () => {
        await someAsyncFunction();
    });

    // Add benchmark with category (p0 = critical, p1 = important, p2 = comprehensive)
    suite.add('critical path', () => {
        criticalFunction();
    }, { category: 'p0' });

    return suite;
}
```

## Running Benchmarks

```bash
# Run all benchmarks
npm run benchmark

# Run with specific options
npx ts-node src/runner.ts --help

# Run only P0 (critical) benchmarks
npx ts-node src/runner.ts -c p0

# Filter benchmarks by name
npx ts-node src/runner.ts -f "serialize"

# Output JSON results
npx ts-node src/runner.ts -j results.json

# Track memory usage
npx ts-node src/runner.ts -m
```

## Baseline Comparison

```bash
# Save current results as baseline
npx ts-node src/runner.ts --save-baseline

# Compare against baseline (fails if regressions > 20%)
npx ts-node src/runner.ts --compare-baseline
```

## Categories

Benchmarks can be categorized by priority:

- **p0**: Critical path benchmarks - always run, must not regress
- **p1**: Important benchmarks - run in normal mode
- **p2**: Comprehensive benchmarks - run in full mode

```typescript
suite.add('critical', fn, { category: 'p0' });
suite.add('important', fn, { category: 'p1' });
suite.add('comprehensive', fn, { category: 'p2' });
```

## V8 Introspection

For detailed V8 optimization information, run Node with native syntax:

```bash
node --allow-natives-syntax --expose-gc src/runner.ts
```

This enables:
- `GetOptimizationStatus()` - Check if function is optimized
- `OptimizeFunctionOnNextCall()` - Force optimization
- `forceGC()` - Trigger garbage collection

## Memory Tracking

Enable memory tracking to see heap usage per benchmark:

```typescript
const suite = new BenchSuite('Memory Test', 1, { trackMemory: true });
```

Or via CLI:
```bash
npx ts-node src/runner.ts -m
```

## API Reference

### BenchSuite

```typescript
class BenchSuite {
    constructor(name: string, maxTime?: number, options?: { trackMemory?: boolean });

    add(title: string, fn: () => unknown, options?: BenchmarkOptions): void;
    addAsync(title: string, fn: () => Promise<void>, options?: BenchmarkOptions): void;
    pipelining(title: string, fn: () => Promise<unknown>, options?: PipelineOptions): void;

    run(options?: object): void;
    runAsync(): Promise<void>;
    runByCategory(category: BenchmarkCategory): Promise<void>;
}
```

### Utilities

```typescript
// Warmup functions for V8 optimization
warmup(fn: () => unknown, times?: number): void;
warmupAsync(fn: () => Promise<unknown>, times?: number): Promise<void>;

// V8 introspection (requires --allow-natives-syntax)
GetOptimizationStatus(fn: Function): OptimizationStatus | undefined;
OptimizeFunctionOnNextCall(fn: Function): void;
HasFastProperties(obj: unknown): boolean | undefined;

// Memory utilities (requires --expose-gc)
forceGC(): void;
getMemorySnapshot(): MemorySnapshot;
formatBytes(bytes: number): string;
```

## CI/CD Integration

Example GitHub Actions workflow:

```yaml
- name: Run Benchmarks
  run: |
    cd benchmarks
    npm install
    npx ts-node src/runner.ts --compare-baseline -j results.json

- name: Upload Results
  uses: actions/upload-artifact@v3
  with:
    name: benchmark-results
    path: benchmarks/results.json
```
