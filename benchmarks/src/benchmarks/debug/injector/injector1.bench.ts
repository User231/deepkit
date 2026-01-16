/**
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { BenchSuite } from '../../../bench';
import { InjectorContext, InjectorModule } from '@deepkit/injector';

/**
 * Injector benchmark - tests dependency injection resolution performance
 *
 * This benchmark tests:
 * - Simple class instantiation baseline
 * - Simple provider resolution via resolver function
 * - Direct injector.get() for simple providers
 * - Resolution with dependencies
 * - Scoped provider resolution (same scope, reusing instance)
 * - Scoped provider resolution (new scope each time)
 *
 * Uses 200+ providers to simulate a real-world application.
 */

export default async function() {
    class Database { }

    class Database2 { }

    class MyService {
        constructor(database: Database) {
        }
    }

    class ScopedService { }

    const providers: any[] = [
        MyService, Database, Database2, { provide: ScopedService, scope: 'http' },
    ];

    for (let i = 0; i < 200; i++) {
        class Service {
        }

        providers.unshift(Service);
    }

    const root = new InjectorModule(providers);
    const injector = new InjectorContext(root);

    const suite = new BenchSuite('framework/injector1');

    const resolve1 = injector.resolve(root, Database);

    // Verify setup works
    if (!(injector.get(Database) instanceof Database)) {
        throw new Error('Database resolution failed');
    }
    if (!(injector.get(MyService) instanceof MyService)) {
        throw new Error('MyService resolution failed');
    }

    suite.add('base (new Database())', () => {
        new Database();
    }, { category: 'p0' });

    suite.add('get simple resolver', () => {
        resolve1();
    }, { category: 'p0' });

    suite.add('get simple', () => {
        injector.get(Database);
    }, { category: 'p0' });

    suite.add('get with dependency', () => {
        injector.get(MyService);
    }, { category: 'p0' });

    const scoped = injector.createChildScope('http');

    suite.add('get scoped, same scope', () => {
        scoped.get(ScopedService);
    }, { category: 'p0' });

    suite.add('get scoped, new scope', () => {
        const scoped = injector.createChildScope('http');
        scoped.get(ScopedService);
    }, { category: 'p0' });

    return suite;
}
