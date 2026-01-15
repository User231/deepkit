/**
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { BenchSuite } from '../../bench';
import { InjectorContext, InjectorModule } from '@deepkit/injector';

/**
 * Injector benchmark variant - tests additional DI patterns
 *
 * This benchmark tests:
 * - Direct injector.get() performance
 * - Scoped service resolution through module reference
 * - Context-based injector retrieval
 * - Child scope creation overhead
 * - Child scope creation with injector retrieval
 */

export default async function() {
    const suite = new BenchSuite('framework/injector2');

    class Service1 {
    }

    class Service2 {
    }

    class ScopedService {
    }

    const module1 = new InjectorModule([Service1, Service2, { provide: ScopedService, scope: 'http' }]);

    const context = new InjectorContext(module1);
    const injector = context.getInjector(module1);
    const scoped = context.createChildScope('http');

    // Warmup to ensure JIT optimization kicks in
    for (let i = 0; i < 100_000; i++) {
        injector.get(Service1);
        injector.get(Service2);
        scoped.get(ScopedService, module1);
    }

    // Verify setup works
    if (!(injector.get(Service1) instanceof Service1)) {
        throw new Error('Service1 resolution failed');
    }
    if (!(scoped.get(ScopedService, module1) instanceof ScopedService)) {
        throw new Error('ScopedService resolution failed');
    }

    suite.add('injector.get(Service)', () => {
        injector.get(Service1);
    }, { category: 'p0' });

    suite.add('scoped.get(ScopedService)', () => {
        scoped.get(ScopedService, module1);
    }, { category: 'p0' });

    suite.add('context.getInjector(module1).get(Service)', () => {
        context.getInjector(module1).get(Service1);
    }, { category: 'p0' });

    suite.add('context.createChildScope(\'http\')', () => {
        context.createChildScope('http');
    }, { category: 'p0' });

    suite.add('context.createChildScope(\'http\').getInjector(module1)', () => {
        context.createChildScope('http').getInjector(module1);
    }, { category: 'p0' });

    return suite;
}
