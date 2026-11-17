/**
 * What the router's generated functions do, where `router.spec.ts` and `middleware.spec.ts` do not
 * already say it: the functions `HttpRouter.build()`, `buildUrlResolver()` and the parameter
 * loaders of `request-parser.ts` write. Every test here holds on the source before the move to the
 * JIT as well, except the two at the end, which are about the move itself.
 */
import { test } from 'node:test';

import { Builder, arg, fn } from '@deepkit/core';
import { InjectorContext } from '@deepkit/injector';
import { expect } from '@deepkit/run/expect';
import { getSerializeFunction, getValidatorFunction, serializer, typeOf } from '@deepkit/type';

import { http } from '../src/decorator.js';
import { HttpMiddleware, httpMiddleware } from '../src/middleware.js';
import { HttpBody, HttpQuery, HttpRequest, HttpRequestParser, HttpResponse } from '../src/model.js';
import { planParameterLoader } from '../src/request-parser.js';
import { HttpRouter, RouteParameterResolver, RouteParameterResolverContext } from '../src/router.js';
import { createHttpApp, createHttpKernel } from './utils.js';

test('a request parser takes the path, the headers, the body and the query — each unless it is told not to', async () => {
    interface Everything {
        id?: string;
        'x-token'?: string;
        name?: string;
        q?: string;
    }

    class Controller {
        @http.POST('/items/:id')
        async item(parser: HttpRequestParser<Everything>, without?: HttpQuery<string>) {
            return await parser(without ? { [without]: false } : undefined);
        }
    }

    const kernel = createHttpKernel([Controller]);
    const ask = async (without?: string) => {
        const url = '/items/7?q=asked' + (without ? '&without=' + without : '');
        return (await kernel.request(HttpRequest.POST(url).header('x-token', 'secret').json({ name: 'Ada' }))).json;
    };

    expect(await ask()).toEqual({ id: '7', 'x-token': 'secret', name: 'Ada', q: 'asked' });
    expect(await ask('withPath')).toEqual({ 'x-token': 'secret', name: 'Ada', q: 'asked' });
    expect(await ask('withHeader')).toEqual({ id: '7', name: 'Ada', q: 'asked' });
    expect(await ask('withBody')).toEqual({ id: '7', 'x-token': 'secret', q: 'asked' });
    expect(await ask('withQuery')).toEqual({ id: '7', 'x-token': 'secret', name: 'Ada' });
});

test('a body that is a parameter and a request parser beside it read the same body', async () => {
    class Controller {
        @http.POST('/both')
        async both(body: HttpBody<{ name: string }>, parser: HttpRequestParser<{ name?: string; age?: number }>) {
            const first = await parser();
            const second = await parser({ withHeader: false });
            return [body.name, first, second];
        }

        @http.POST('/invalid')
        async invalid(parser: HttpRequestParser<{ age: number }>) {
            return await parser();
        }
    }

    const kernel = createHttpKernel([Controller]);
    expect((await kernel.request(HttpRequest.POST('/both').json({ name: 'Ada', age: 36 }))).json).toEqual(['Ada', { name: 'Ada', age: 36 }, { name: 'Ada', age: 36 }]);

    // What the parser reads is validated when it is asked for: the controller's call rejects.
    const response = await kernel.request(HttpRequest.POST('/invalid').json({ age: 'old' }));
    expect(response.statusCode).toBe(400);
    expect(response.bodyString).toContain('age');
});

test('a loader that has nothing to wait for answers at once; one that reads the body answers a promise', async () => {
    class Controller {
        @http.GET('/plain')
        plain() {}

        @http.GET('/path/:id')
        path(id: number, page: HttpQuery<number> = 1) {}

        @http.POST('/body')
        body(body: HttpBody<{ name: string }>) {}
    }

    const router = HttpRouter.forControllers([Controller]);

    expect(router.resolve('GET', '/plain')!.parameters(undefined as any)).toBe(undefined);
    expect(router.resolve('GET', '/path/12?page=3')!.parameters(undefined as any)).toEqual({
        arguments: [12, 3],
        parameters: { id: 12, page: 3 },
    });
    expect(router.resolve('GET', '/path/12')!.parameters(undefined as any)).toEqual({
        arguments: [12, undefined],
        parameters: { id: 12, page: undefined },
    });
    expect(() => router.resolve('GET', '/path/twelve')!.parameters(undefined as any)).toThrow('id(type)');
    expect(() => router.resolve('GET', '/path/12?page=three')!.parameters(undefined as any)).toThrow('page(type)');

    const request = HttpRequest.POST('/body').json({ name: 'Ada' }).build();
    const loading = router.resolveRequest(request)!.parameters(undefined as any);
    expect(loading).toBeInstanceOf(Promise);
    expect(await loading).toEqual({ arguments: [{ name: 'Ada' }], parameters: { name: undefined, body: { name: 'Ada' } } });
});

test('which route: the method, the path, the first that fits, and none', async () => {
    class Controller {
        @http.GET('/users/:id')
        one(id: number) {}

        @http.GET('/users/all')
        shadowed() {}

        @http.POST('/users/:id')
        post(id: number) {}

        @http.ANY('/users')
        any() {}

        @http.GET('/users/:id/posts/:slug')
        post2(id: number, slug: string) {}
    }

    const router = HttpRouter.forControllers([Controller]);
    const action = (method: string, url: string) => (router.resolve(method, url)?.routeConfig.action as any)?.methodName;

    expect(action('GET', '/users/1')).toBe('one');
    // The first route that fits is the route: `/users/all` is `/users/:id` with id "all".
    expect(action('GET', '/users/all')).toBe('one');
    expect(action('POST', '/users/1')).toBe('post');
    expect(action('PUT', '/users/1')).toBe(undefined);
    expect(action('DELETE', '/users')).toBe('any');
    expect(action('GET', '/users?x=1')).toBe('any');
    expect(action('GET', '/users/1/posts/hello')).toBe('post2');
    expect(action('GET', '/users/1/posts')).toBe(undefined);
    expect(action('GET', '/users/')).toBe(undefined);
    expect(action('GET', '/nothing')).toBe(undefined);

    // Every request gets its own files, and the query string is not part of the path.
    const first = router.resolve('GET', '/users/1?x=1')!;
    const second = router.resolve('GET', '/users/2')!;
    expect(first.uploadedFiles).toEqual({});
    expect(first.uploadedFiles).not.toBe(second.uploadedFiles);
    expect(first.parameters(undefined as any)).toEqual({ arguments: [1], parameters: { id: 1 } });
    expect(first.middlewares).toBe(undefined);
});

test('the URL of a route: values as text, encoded where they are a query, and a name nobody has', () => {
    class Id {
        toString() {
            return 'id-7';
        }

        valueOf() {
            return 99;
        }
    }

    class Controller {
        @(http.GET('/users/:id/posts/:slug').name('post'))
        post(id: string, slug: string) {}

        @(http.GET('/search').name('search'))
        search(q: HttpQuery<string>, page?: HttpQuery<number>) {}
    }

    const router = HttpRouter.forControllers([Controller]);

    expect(router.resolveUrl('post', { id: 5, slug: 'hello' })).toBe('/users/5/posts/hello');
    expect(router.resolveUrl('post', { id: new Id(), slug: true })).toBe('/users/id-7/posts/true');
    expect(router.resolveUrl('post', { slug: null })).toBe('/users/undefined/posts/null');
    expect(router.resolveUrl('search', { q: 'a b&c=d' })).toBe('/search?q=a%20b%26c%3Dd');
    expect(router.resolveUrl('search', { q: 'x', page: 2 })).toBe('/search?q=x&page=2');
    expect(router.resolveUrl('search', { page: 0 })).toBe('/search?page=0');
    expect(router.resolveUrl('search')).toBe('/search');

    expect(() => router.resolveUrl('nobody')).toThrow('No route for name nobody found');
    expect(() => router.resolveUrl('nobody')).toThrow('DK-H007');
});

test('the middlewares of a route carry their names, in their order', async () => {
    class Controller {
        @http.GET('/user/:name')
        hello(name: string) {
            return name;
        }
    }

    function plain(req: HttpRequest, res: HttpResponse, next: (err?: any) => void) {
        next();
    }

    class Singleton implements HttpMiddleware {
        execute(req: HttpRequest, res: HttpResponse, next: (err?: any) => void) {
            res.setHeader('singleton', 'yes');
            next();
        }
    }

    let instances = 0;

    class PerRequest implements HttpMiddleware {
        id = ++instances;

        execute(req: HttpRequest, res: HttpResponse, next: (err?: any) => void) {
            res.setHeader('per-request', String(this.id));
            next();
        }
    }

    const app = createHttpApp([Controller], [Singleton, { provide: PerRequest, scope: 'http' }], [], [httpMiddleware.for(plain), httpMiddleware.for(Singleton), httpMiddleware.for(PerRequest)]);
    const router = app.get(HttpRouter);
    const resolved = router.resolve('GET', '/user/ada')!;

    const forRequest = () => resolved.middlewares!(app.get(InjectorContext).createChildScope('http'));
    const first = forRequest();
    expect(first.map(middleware => middleware.name)).toEqual(['plain', 'Singleton', 'PerRequest']);
    expect(first[0]).toBe(plain);
    // The middleware of a request is that request's: another request gets another function.
    const second = forRequest();
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(second[2]).not.toBe(first[2]);

    const kernel = createHttpKernel([Controller], [Singleton, { provide: PerRequest, scope: 'http' }], [], [httpMiddleware.for(plain), httpMiddleware.for(Singleton), httpMiddleware.for(PerRequest)]);
    instances = 0;
    const one = await kernel.request(HttpRequest.GET('/user/ada'));
    const two = await kernel.request(HttpRequest.GET('/user/bob'));
    expect([one.bodyString, one.getHeader('singleton'), one.getHeader('per-request')]).toEqual(['"ada"', 'yes', '1']);
    expect([two.bodyString, two.getHeader('singleton'), two.getHeader('per-request')]).toEqual(['"bob"', 'yes', '2']);
});

test('middlewares that are all the same for every request are one array, handed out as it is', () => {
    class Controller {
        @http.GET('/user/:name')
        hello(name: string) {}
    }

    function first(req: HttpRequest, res: HttpResponse, next: (err?: any) => void) {
        next();
    }

    class Singleton implements HttpMiddleware {
        execute(req: HttpRequest, res: HttpResponse, next: (err?: any) => void) {
            next();
        }
    }

    const app = createHttpApp([Controller], [Singleton], [], [httpMiddleware.for(first), httpMiddleware.for(Singleton)]);
    const router = app.get(HttpRouter);
    const one = router.resolve('GET', '/user/ada')!.middlewares!(undefined as any);
    const two = router.resolve('GET', '/user/bob')!.middlewares!(undefined as any);

    expect(one.map(middleware => middleware.name)).toEqual(['first', 'Singleton']);
    expect(two).toBe(one);
});

test('a parameter that is a provider: required, optional, and resolved through the injector once', async () => {
    class Service {
        constructor(public readonly name: string = 'service') {}
    }

    class Missing {}

    class Controller {
        @http.GET('/service')
        service(service: Service) {
            return service.name;
        }

        @http.GET('/required')
        required(missing: Missing) {
            return 'never';
        }

        @http.GET('/optional')
        optional(missing?: Missing) {
            return missing === undefined ? 'nothing' : 'something';
        }
    }

    const kernel = createHttpKernel([Controller], [Service, { provide: Missing, useFactory: () => undefined as any }]);

    expect((await kernel.request(HttpRequest.GET('/service'))).json).toBe('service');
    expect((await kernel.request(HttpRequest.GET('/service'))).json).toBe('service');
    expect((await kernel.request(HttpRequest.GET('/optional'))).json).toBe('nothing');

    const response = await kernel.request(HttpRequest.GET('/required'));
    expect(response.statusCode).toBe(500);
});

test('requests whose parameter resolver waits keep their own values', async () => {
    class User {
        constructor(public id: number) {}
    }

    class UserResolver implements RouteParameterResolver {
        async resolve(context: RouteParameterResolverContext) {
            // The later a request starts, the sooner its resolver answers: they finish in reverse.
            const id = Number(context.parameters.id);
            await new Promise(resolve => setTimeout(resolve, 30 - id * 5));
            return new User(id);
        }
    }

    @http.resolveParameter(User, UserResolver)
    class Controller {
        @http.GET('/users/:id')
        user(id: number, user: User) {
            return [id, user.id];
        }
    }

    const kernel = createHttpKernel([Controller], [UserResolver]);
    const answers = await Promise.all([1, 2, 3, 4, 5].map(id => kernel.request(HttpRequest.GET('/users/' + id))));

    expect(answers.map(answer => answer.json)).toEqual([
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [5, 5],
    ]);
});

// ── About the move to the JIT itself ─────────────────────────────────────────

test('a route does not make the converters and validators of its types nested functions of the router', () => {
    interface FreshBody {
        title: string;
        tags: string[];
    }

    class Controller {
        @http.POST('/fresh/:id')
        fresh(id: number, body: HttpBody<FreshBody>) {}
    }

    // The router is the first to ask for these types' functions.
    const router = HttpRouter.forControllers([Controller]);
    router.resolve('POST', '/fresh/1');

    // Whoever asks next gets a function of its own — not a marker of the router's declaration.
    const converter = getSerializeFunction(typeOf<FreshBody>(), serializer.deserializeRegistry);
    const validator = getValidatorFunction(undefined, typeOf<FreshBody>());
    expect((converter as { __nestedFnId?: number }).__nestedFnId).toBe(undefined);
    expect((validator as { __nestedFnId?: number }).__nestedFnId).toBe(undefined);
    expect(converter({ title: 't', tags: ['a'] }, { loosely: true })).toEqual({ title: 't', tags: ['a'] });
});

test('a parameter loader is planned before the function that holds it is declared', () => {
    expect(() =>
        fn(arg(), (b: Builder) => {
            planParameterLoader({}, [], {});
            return b.lit(1);
        }),
    ).toThrow('DK-H012');
    expect(planParameterLoader({}, [], {})).toBe(undefined);
});
