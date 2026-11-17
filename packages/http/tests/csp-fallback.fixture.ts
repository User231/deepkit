/**
 * Run with `--disallow-code-generation-from-strings` by `csp-fallback.spec.ts`: a whole HTTP
 * application — the kernel, the workflow of a request, the router and its parameter loaders, the
 * injector, a middleware, a listener, the type converters — with no function built from a string.
 * Prints `ok`; anything else is the failure.
 */
import { canJIT, getRuntimeCapabilities } from '@deepkit/core';
import { eventDispatcher } from '@deepkit/event';

import { http } from '../src/decorator.js';
import { httpWorkflow } from '../src/http.js';
import { HttpMiddleware, httpMiddleware } from '../src/middleware.js';
import { HttpBody, HttpQuery, HttpRequest, HttpResponse } from '../src/model.js';
import { createHttpKernel } from './utils.js';

function assert(condition: unknown, message: string): void {
    if (!condition) throw new Error('csp-fallback: ' + message);
}

function same(actual: unknown, expected: unknown, message: string): void {
    assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`);
}

// The process really is one that cannot build code.
let built = false;
try {
    new Function('return 1')();
    built = true;
} catch {}
assert(!built, 'new Function() was allowed: the flag is not in effect');
assert(canJIT === false && getRuntimeCapabilities().newFunction === false, 'the JIT believes it can compile');

class Counter {
    count = 0;
}

class RequestState {
    constructor(public counter: Counter) {
        counter.count++;
    }
}

interface NewUser {
    name: string;
    age: number;
}

class Controller {
    constructor(private counter: Counter) {}

    @http.GET('/users/:id')
    user(id: number, state: RequestState, verbose: HttpQuery<boolean> = false) {
        return { id, verbose, requests: state.counter.count };
    }

    @http.POST('/users')
    create(user: HttpBody<NewUser>) {
        return { name: user.name, older: user.age + 1 };
    }

    @http.GET('/count')
    count() {
        return this.counter.count;
    }
}

class Stamp implements HttpMiddleware {
    execute(req: HttpRequest, res: HttpResponse, next: (err?: any) => void) {
        res.setHeader('x-stamp', 'stamped');
        next();
    }
}

const seen: string[] = [];

class Listener {
    @eventDispatcher.listen(httpWorkflow.onController)
    onController(event: typeof httpWorkflow.onController.event) {
        seen.push(event.request.url || '');
    }
}

async function main(): Promise<void> {
    const kernel = createHttpKernel(
        [Controller],
        [Counter, Stamp, { provide: RequestState, scope: 'http' }],
        [Listener],
        [httpMiddleware.for(Stamp)],
    );

    const user = await kernel.request(HttpRequest.GET('/users/42?verbose=true'));
    same(
        [user.statusCode, user.json, user.getHeader('x-stamp')],
        [200, { id: 42, verbose: true, requests: 1 }, 'stamped'],
        'GET /users/42',
    );

    const again = await kernel.request(HttpRequest.GET('/users/7'));
    same([again.statusCode, again.json], [200, { id: 7, verbose: false, requests: 2 }], 'GET /users/7');

    const created = await kernel.request(HttpRequest.POST('/users').json({ name: 'Ada', age: 36 }));
    same([created.statusCode, created.json], [200, { name: 'Ada', older: 37 }], 'POST /users');

    const invalid = await kernel.request(HttpRequest.POST('/users').json({ name: 'Ada', age: 'old' }));
    assert(invalid.statusCode === 400, 'an invalid body is refused: ' + invalid.statusCode);

    const notANumber = await kernel.request(HttpRequest.GET('/users/seven'));
    assert(notANumber.statusCode === 400, 'an invalid path parameter is refused: ' + notANumber.statusCode);

    const missing = await kernel.request(HttpRequest.GET('/nowhere'));
    assert(missing.statusCode === 404, 'an unknown path is not found: ' + missing.statusCode);

    // Three requests had their state made: the two that were served, and the one whose path
    // parameter was refused — its providers are resolved before its parameters are validated.
    const count = await kernel.request(HttpRequest.GET('/count'));
    same([count.statusCode, count.json], [200, 3], 'GET /count');

    same(
        seen,
        ['/users/42?verbose=true', '/users/7', '/users', '/count'],
        'the listener saw each request that reached a controller',
    );
    console.log('ok');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
