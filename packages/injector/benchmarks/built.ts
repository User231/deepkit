/*
 * What an injector's generated functions cost: resolving what is already made, making what is not,
 * and BUILDING the injector of a module.
 *
 *   cd packages/injector
 *   node --import @deepkit/run benchmarks/built.ts                                # as the process runs it
 *   DEEPKIT_JIT_MODE=interpreted node --import @deepkit/run benchmarks/built.ts   # interpreted
 *
 * Every provider of every request goes through these functions. Times do not travel between
 * machines: its use is before-and-after on one machine, run a few times each way.
 */
import { getJitMode } from '@deepkit/core';

import { InjectorContext } from '../src/injector.js';
import { InjectorModule } from '../src/module.js';

class Config {
    debug = false;
}

class Database {
    constructor(public config: Config) {}
}

class Logger {
    constructor(public config: Config) {}
}

class Session {
    constructor(
        public database: Database,
        public logger: Logger,
    ) {}
}

class Handler {
    constructor(
        public session: Session,
        public database: Database,
        public config: Config,
    ) {}
}

class Fresh {
    constructor(public logger: Logger) {}
}

class Shared {}

class Imported {
    constructor(public shared: Shared) {}
}

function best(turns: number, once: () => unknown): number {
    let fastest = Infinity;
    for (let round = 0; round < 5; round++) {
        const started = process.hrtime.bigint();
        for (let i = 0; i < turns; i++) once();
        fastest = Math.min(fastest, Number(process.hrtime.bigint() - started) / turns);
    }
    return fastest;
}

function report(label: string, ns: number): void {
    console.log(`  ${label.padEnd(58)} ${ns.toFixed(1).padStart(8)} ns`);
}

function main(): void {
    const scale = Number(process.env.SCALE || 1);
    console.log(`injector — mode ${getJitMode()}`);

    const library = new InjectorModule([Shared, Imported]).addExport(Shared, Imported);
    const root = new InjectorModule([
        Config,
        Database,
        Logger,
        { provide: Session, scope: 'http' },
        { provide: Handler, scope: 'http' },
        { provide: Fresh, transient: true },
        { provide: 'both', useValue: 'global' },
        { provide: 'both', useValue: 'request', scope: 'http' },
    ]).addImport(library);
    const context = new InjectorContext(root);

    const singleton = context.resolve(undefined, Database);
    const scoped = context.resolve(root, Handler);
    const transient = context.resolve(root, Fresh);
    const imported = context.resolve(root, Imported);
    const scope = context.createChildScope('http');
    scope.get(Handler);
    singleton();
    imported();

    report(
        'a resolver, singleton already made',
        best(2_000_000 * scale, () => singleton()),
    );
    report(
        'a resolver, scoped instance already made',
        best(2_000_000 * scale, () => scoped(scope.scope)),
    );
    report(
        'a resolver, provider of an imported module',
        best(2_000_000 * scale, () => imported()),
    );
    report(
        'context.get(), singleton already made',
        best(2_000_000 * scale, () => context.get(Database)),
    );
    report(
        'scope.get(), scoped instance already made',
        best(2_000_000 * scale, () => scope.get(Handler)),
    );
    report(
        'scope.get(), a token with a provider per scope',
        best(2_000_000 * scale, () => scope.get('both')),
    );
    report(
        'a transient: made on every call (1 dependency)',
        best(1_000_000 * scale, () => transient()),
    );
    report(
        'a new scope, and a Handler made in it (2 scoped, 5 deps)',
        best(500_000 * scale, () => scoped(context.createChildScope('http').scope)),
    );
    report(
        'scope.set() of a scoped instance',
        best(1_000_000 * scale, () => scope.set(Session, undefined)),
    );
    report(
        'a new scope alone',
        best(500_000 * scale, () => context.createChildScope('http')),
    );

    // Building: N tokens, each a Handler of its own with three dependencies, every third scoped.
    for (const count of [50, 300]) {
        const providers: any[] = [Config, Database, Logger, Session];
        for (let i = 0; i < count; i++) {
            providers.push({ provide: 'handler' + i, useClass: Handler, scope: i % 3 === 0 ? 'http' : undefined });
        }
        const times: number[] = [];
        for (let round = 0; round < 7; round++) {
            const started = process.hrtime.bigint();
            const module = new InjectorModule(providers);
            new InjectorContext(module).getInjector(module);
            times.push(Number(process.hrtime.bigint() - started) / 1e6);
        }
        console.log(
            `  ${`build the injector of ${count + 4} providers`.padEnd(58)} ${Math.min(...times)
                .toFixed(2)
                .padStart(8)} ms (the first: ${times[0].toFixed(1)} ms)`,
        );
    }
}

main();
