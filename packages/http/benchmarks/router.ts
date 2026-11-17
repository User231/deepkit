/*
 * What the router's generated functions cost: `HttpRouter.resolve()` (which route a request is
 * for) with the route's parameter loader, and a whole request through the kernel.
 *
 *   cd packages/http
 *   node --import @deepkit/run benchmarks/router.ts                                # as the process runs it
 *   DEEPKIT_JIT_MODE=interpreted node --import @deepkit/run benchmarks/router.ts   # interpreted
 *
 * Times do not travel between machines: its use is before-and-after on one machine, run a few
 * times each way.
 */
import { getJitMode } from '@deepkit/core';

import { http } from '../src/decorator.js';
import { HttpBody, HttpQueries, HttpQuery, HttpRequest, RequestBuilder } from '../src/model.js';
import { HttpRouter } from '../src/router.js';
import { createHttpKernel } from '../tests/utils.js';

class Counter {
    count = 0;
}

interface Paging {
    page?: number;
    size?: number;
}

interface NewUser {
    name: string;
    age: number;
}

class Controller {
    constructor(private counter: Counter) {}

    @http.GET('/')
    index() {
        return 'index';
    }

    @http.GET('/health')
    health() {
        return 'ok';
    }

    @http.GET('/users')
    users(paging: HttpQueries<Paging>) {
        return paging.page ?? 0;
    }

    @http.GET('/users/:id')
    user(id: number) {
        return id;
    }

    @http.GET('/users/:id/posts/:slug')
    post(id: number, slug: string, draft?: HttpQuery<boolean>) {
        return slug;
    }

    @http.POST('/users')
    create(user: HttpBody<NewUser>) {
        return user.age;
    }

    @http.GET('/counted/:id')
    counted(id: number, counter: Counter) {
        return ++counter.count;
    }

    @http.GET('/files/:name')
    file(name: string) {
        return name;
    }

    @http.PUT('/users/:id')
    update(id: number, user: HttpBody<NewUser>) {
        return id;
    }

    @http.DELETE('/users/:id')
    remove(id: number) {
        return id;
    }
}

/** Which route, and its parameters — for the routes whose loader needs neither an injector nor a body. */
const RESOLVED: [string, string, string][] = [
    ['a path with no parameter, first in the list', 'GET', '/'],
    ['a path with no parameter', 'GET', '/health'],
    ['a path parameter that is a number', 'GET', '/users/1234'],
    ['two path parameters and a query', 'GET', '/users/1234/posts/the-title?draft=true'],
    ['an object from the query string', 'GET', '/users?page=3&size=20'],
    ['the last route of the list', 'DELETE', '/users/77'],
    ['no route', 'GET', '/nothing/here'],
];

/** Whole requests: the workflow, the injector, the controller and the response around the router. */
const REQUESTS: [string, () => RequestBuilder][] = [
    ['GET with a path parameter', () => HttpRequest.GET('/users/1234')],
    ['GET with a path parameter and a provider', () => HttpRequest.GET('/counted/5')],
    ['POST with a JSON body', () => HttpRequest.POST('/users').json({ name: 'Ada', age: 36 })],
];

async function best(rounds: number, turns: number, once: () => unknown): Promise<number> {
    let fastest = Infinity;
    for (let round = 0; round < rounds; round++) {
        const started = process.hrtime.bigint();
        for (let i = 0; i < turns; i++) await once();
        fastest = Math.min(fastest, Number(process.hrtime.bigint() - started) / turns);
    }
    return fastest;
}

function bestSync(rounds: number, turns: number, once: () => unknown): number {
    let fastest = Infinity;
    for (let round = 0; round < rounds; round++) {
        const started = process.hrtime.bigint();
        for (let i = 0; i < turns; i++) once();
        fastest = Math.min(fastest, Number(process.hrtime.bigint() - started) / turns);
    }
    return fastest;
}

async function main(): Promise<void> {
    const scale = Number(process.env.SCALE || 1);
    console.log(`http router — mode ${getJitMode()}`);

    const router = HttpRouter.forControllers([Controller]);
    for (const [label, method, url] of RESOLVED) {
        const once = () => {
            const resolved = router.resolve(method, url);
            return resolved ? resolved.parameters(undefined as any) : undefined;
        };
        bestSync(1, 20_000 * scale, once);
        const ns = bestSync(5, 200_000 * scale, once);
        console.log(`  resolve + parameters  ${label.padEnd(46)} ${ns.toFixed(0).padStart(6)} ns`);
    }

    const kernel = createHttpKernel([Controller], [Counter]);
    for (const [label, make] of REQUESTS) {
        const once = async () => {
            const response = await kernel.request(make());
            if (response.statusCode !== 200) throw new Error(`${label}: status ${response.statusCode}`);
        };
        await best(1, 2_000 * scale, once);
        const ns = await best(5, 10_000 * scale, once);
        console.log(`  kernel.request        ${label.padEnd(46)} ${(ns / 1000).toFixed(2).padStart(6)} µs`);
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
