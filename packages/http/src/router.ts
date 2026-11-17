/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { MiddlewareRegistry, MiddlewareRegistryEntry } from '@deepkit/app';
import { Builder, ClassType, DeepkitError, Ref, arg, fn, getClassName, isArray, isClass, urlJoin } from '@deepkit/core';
import { InjectorContext, InjectorModule, getScope } from '@deepkit/injector';
import { Logger, LoggerInterface } from '@deepkit/logger';
import {
    ReflectionClass,
    ReflectionFunction,
    ReflectionKind,
    ReflectionParameter,
    SerializationOptions,
    Serializer,
    Type,
    entity,
    pushTypeErrorWhen,
    serializer,
} from '@deepkit/type';

import { HttpControllers } from './controllers.js';
import { HttpAction, HttpController, HttpDecorator, getActions, httpClass } from './decorator.js';
import { HtmlResponse, JSONResponse, Redirect, Response } from './http.js';
import { HttpMiddleware, HttpMiddlewareConfig, HttpMiddlewareFn } from './middleware.js';
import {
    HttpRequest,
    HttpRequestPositionedParameters,
    HttpRequestQuery,
    HttpRequestResolvedParameters,
    HttpResponse,
} from './model.js';
import { CorsOptions, HttpConfig } from './module.config.js';
import {
    ParameterForRequestParser,
    ParameterLoaderPlan,
    parseRoutePathToRegex,
    planParameterLoader,
    writeParameterLoader,
    writeRequestValues,
} from './request-parser.js';

export type RouteParameterResolverForInjector = (
    injector: InjectorContext,
) => HttpRequestPositionedParameters | Promise<HttpRequestPositionedParameters>;

interface ResolvedController {
    parameters: RouteParameterResolverForInjector;
    routeConfig: RouteConfig;
    uploadedFiles: { [name: string]: UploadedFile };
    middlewares?: (injector: InjectorContext) => HttpMiddlewareFn[];
}

/** One route as the router's function is built from it: see `HttpRouter.planRoute`. */
interface RoutePlan {
    routeConfig: RouteConfig;
    /** The methods the route answers, upper-cased; none means every method. */
    methods: string[];
    matcher: { path: string } | { prefix: string; regex: RegExp };
    middlewares: ResolvedController['middlewares'];
    parameters: ParameterLoaderPlan | undefined;
}

export const UploadedFileSymbol = Symbol('UploadedFile');

@entity.name('@deepkit/UploadedFile')
export class UploadedFile {
    /**
     * Validator to ensure the file was provided by the framework, and not the user spoofing it.
     */
    validator!: typeof UploadedFileSymbol | null;

    /**
     * The size of the uploaded file in bytes.
     */
    size!: number;

    /**
     * The local path this file is being written to. Will be deleted when request is handled.
     */
    path!: string;

    /**
     * The name this file had according to the uploading client.
     */
    name!: string | null;

    /**
     * The mime type of this file, according to the uploading client.
     */
    type!: string | null;

    /**
     * A Date object (or `null`) containing the time this file was last written to.
     * Mostly here for compatibility with the [W3C File API Draft](http://dev.w3.org/2006/webapi/FileAPI/).
     */
    lastModifiedDate!: Date | null;

    // /**
    //  * If `options.hash` calculation was set, you can read the hex digest out of this var.
    //  */
    // hash!: string | 'sha1' | 'md5' | 'sha256' | null;
}

// Register type guard for UploadedFile - validates that the file was provided by the framework
serializer.typeGuards.registerClass(UploadedFile, (type, input, b, state) => {
    // Check if input is an UploadedFile with valid validator symbol
    const valid = b.var_(
        b.and(
            b.isType(input, 'object'),
            b.and(
                b.not(b.isNull(input)),
                b.call((v: any, sym: symbol) => v.validator === sym, input, b.lit(UploadedFileSymbol)),
            ),
        ),
    );
    // The error-collection post-hook skips user-defined classes (it assumes the default class
    // handler emitted per-property errors), but a custom class guard like this one replaces that
    // handler and emits nothing on its own. Without this, validate()/HttpBody validation would
    // silently accept a spoofed file object (its `validator` symbol absent) — a security hole.
    pushTypeErrorWhen(b, state, input, b.not(b.getVar(valid)), 'Not an uploaded file');
    return b.getVar(valid);
});

export interface RouteFunctionControllerAction {
    type: 'function';
    //if not set, the root module is used
    module?: InjectorModule<any>;
    fn: (...args: any[]) => any;
}

export interface RouteClassControllerAction {
    type: 'controller';
    //if not set, the root module is used
    module?: InjectorModule<any>;
    controller: ClassType;
    methodName: string;
}

export function getRouteActionLabel(action: RouteClassControllerAction | RouteFunctionControllerAction): string {
    if (action.type === 'controller') return `${getClassName(action.controller)}.${action.methodName}`;
    return action.fn.name;
}

export class RouteConfig {
    public baseUrl: string = '';

    public responses: { statusCode: number; description: string; type?: Type }[] = [];

    public description: string = '';
    public groups: string[] = [];
    public category: string = '';

    public returnType?: Type;

    public serializationOptions?: SerializationOptions;
    public serializer?: Serializer;

    /**
     * When assigned defines where this route came from.
     */
    public module?: InjectorModule<any>;

    resolverForToken: Map<any, ClassType> = new Map();

    middlewares: { config: HttpMiddlewareConfig; module?: InjectorModule<any> }[] = [];

    resolverForParameterName: Map<string, ClassType> = new Map();

    /**
     * An arbitrary data container the user can use to store app specific settings/values.
     */
    data = new Map<any, any>();

    constructor(
        public readonly name: string,
        public readonly httpMethods: string[],
        public readonly path: string,
        public readonly action: RouteClassControllerAction | RouteFunctionControllerAction,
        public internal: boolean = false,
    ) {}

    getReflectionFunction(): ReflectionFunction {
        return this.action.type === 'controller'
            ? ReflectionClass.from(this.action.controller).getMethod(this.action.methodName)
            : ReflectionFunction.from(this.action.fn);
    }

    getSchemaForResponse(statusCode: number): Type | undefined {
        if (!this.responses.length) return;
        for (const response of this.responses) {
            if (response.statusCode === statusCode) return response.type;
        }
        return;
    }

    getFullPath(): string {
        let path = this.baseUrl ? urlJoin(this.baseUrl, this.path) : this.path;
        if (!path.startsWith('/')) path = '/' + path;
        return path;
    }
}

export class ParsedRoute {
    public regex?: string;

    public pathParameterNames: { [name: string]: number } = {};

    protected parameters: ParameterForRequestParser[] = [];

    constructor(public routeConfig: RouteConfig) {}

    addParameter(property: ReflectionParameter): ParameterForRequestParser {
        const parameter = new ParameterForRequestParser(property);
        this.parameters.push(parameter);
        return parameter;
    }

    getParameters(): ParameterForRequestParser[] {
        return this.parameters;
    }

    getParameter(name: string): ParameterForRequestParser {
        for (const parameter of this.parameters) {
            if (parameter.getName() === name) return parameter;
        }
        throw new DeepkitError('DK-H004', `No route parameter with name ${name} defined.`);
    }
}

export function parseRouteControllerAction(routeConfig: RouteConfig): ParsedRoute {
    const parsedRoute = new ParsedRoute(routeConfig);

    const parameters = routeConfig.getReflectionFunction().getParameters();
    const parsedPath = parseRoutePathToRegex(routeConfig.getFullPath(), parameters);
    parsedRoute.regex = parsedPath.regex;
    parsedRoute.pathParameterNames = parsedPath.parameterNames;

    for (const property of parameters) {
        const parsedParameter = parsedRoute.addParameter(property);
        // Use typePath (from HttpPath name option) if available, otherwise use parameter name
        const pathName = parsedParameter.typePath ?? property.name;
        parsedParameter.regexPosition = parsedPath.parameterNames[pathName];
    }

    return parsedRoute;
}

export function dotToUrlPath(dotPath: string): string {
    if (-1 === dotPath.indexOf('.')) return dotPath;

    return dotPath.replace(/\./g, '][').replace('][', '[') + ']';
}

export interface RouteParameterResolver {
    resolve(context: RouteParameterResolverContext): any | Promise<any>;
}

export interface RouteParameterResolverContext {
    token: ClassType | string | symbol | any;
    route: RouteConfig;
    request: HttpRequest;

    /**
     * The parameter name (variable name).
     */
    name: any;

    /**
     * The raw parameter value from the path, if the parameter is defined in the path (e.g. /user/:name).
     * If not in the path, you have to use `parameters.<name>` instead.
     */
    value: any;

    query: HttpRequestQuery;
    parameters: HttpRequestResolvedParameters;
    type: ReflectionParameter;
}

function filterMiddlewaresForRoute(
    middlewareRawConfigs: MiddlewareRegistryEntry[],
    routeConfig: RouteConfig,
    fullPath: string,
): {
    config: HttpMiddlewareConfig;
    module: InjectorModule<any>;
}[] {
    const middlewares = middlewareRawConfigs.slice(0);
    middlewares.push(...(routeConfig.middlewares as any[]));

    const middlewareConfigs = middlewares.filter(v => {
        if (!(v.config instanceof HttpMiddlewareConfig)) return false;

        if (
            v.config.controllers.length &&
            routeConfig.action.type === 'controller' &&
            !v.config.controllers.includes(routeConfig.action.controller)
        ) {
            return false;
        }

        if (
            v.config.excludeControllers.length &&
            routeConfig.action.type === 'controller' &&
            v.config.excludeControllers.includes(routeConfig.action.controller)
        ) {
            return false;
        }

        if (v.config.modules.length && (!routeConfig.module || !v.config.modules.includes(routeConfig.module))) {
            if (!routeConfig.module) return false;
            for (const module of v.config.modules) {
                if (routeConfig.module.id !== module.id) return false;
            }
        }

        if (v.config.selfModule && v.module.id !== routeConfig.module?.id) return false;

        if (v.config.routeNames.length) {
            let found: boolean = false;
            for (const name of v.config.routeNames) {
                if (name.includes('*')) {
                    const regex = new RegExp('^' + name.replace(/\*/g, '.*') + '$');
                    if (regex.test(routeConfig.name)) {
                        found = true;
                        break;
                    }
                } else if (name === routeConfig.name) {
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }

        if (v.config.excludeRouteNames.length) {
            for (const name of v.config.excludeRouteNames) {
                if (name.includes('*')) {
                    const regex = new RegExp('^' + name.replace(/\*/g, '.*') + '$');
                    if (regex.test(routeConfig.name)) return false;
                } else if (name == routeConfig.name) {
                    return false;
                }
            }
        }

        for (const route of v.config.routes) {
            if (route.httpMethod && !routeConfig.httpMethods.includes(route.httpMethod)) return false;

            if (route.category && route.category !== routeConfig.category) return false;
            if (route.excludeCategory && route.excludeCategory === routeConfig.category) return false;

            if (route.group && !routeConfig.groups.includes(route.group)) return false;
            if (route.excludeGroup && routeConfig.groups.includes(route.excludeGroup)) return false;

            if (route.path || route.pathRegExp) {
                if (!route.pathRegExp && route.path)
                    route.pathRegExp = new RegExp('^' + route.path.replace(/\*/g, '.*') + '$');
                if (route.pathRegExp && !route.pathRegExp.test(fullPath)) return false;
            }
        }

        return true;
    }) as { config: HttpMiddlewareConfig; module: any }[];

    middlewareConfigs.sort((a, b) => {
        return a.config.order - b.config.order;
    });

    return middlewareConfigs;
}

export interface HttpRouterFunctionOptions {
    path: string;
    name?: string;
    methods?: string[];
    description?: string;
    category?: string;
    groups?: string[];

    /**
     * An arbitrary data container the user can use to store app specific settings/values.
     */
    data?: Record<any, any>;

    baseUrl?: string;
    middlewares?: (() => HttpMiddlewareConfig)[];

    serializer?: Serializer;
    serializationOptions?: SerializationOptions;

    resolverForToken?: Map<any, ClassType>;
    resolverForParameterName?: Map<string, ClassType>;

    responses?: { statusCode: number; description: string; type?: Type }[];
}

function convertOptions(
    methods: string[],
    pathOrOptions: string | HttpRouterFunctionOptions,
    defaultOptions: Partial<HttpRouterFunctionOptions>,
): HttpRouterFunctionOptions {
    const options = 'string' === typeof pathOrOptions ? { path: pathOrOptions } : pathOrOptions;
    if (options.methods) return options;
    return { ...options, methods };
}

/**
 * Annotated types like HTMLResponse/JSONResponse are not used for serialization.
 */
function filterValidReturnType(type: Type): Type | undefined {
    if (
        type.kind === ReflectionKind.class &&
        (type.classType === HtmlResponse || type.classType === JSONResponse || type.classType === Response)
    )
        return;
    return type;
}

export abstract class HttpRouterRegistryFunctionRegistrar {
    protected defaultOptions: Partial<HttpRouterFunctionOptions> = {};

    abstract addRoute(routeConfig: RouteConfig): void;

    /**
     * Returns a new registrar object with default options that apply to each registered route through this registrar.
     *
     * ```typescript
     * const registry: HttpRouterRegistry = ...;
     *
     * const secretRegistry = registry.forOptions({groups: ['secret']});
     *
     * secretRegistry.get('/admin/groups', () => {
     * });
     *
     * secretRegistry.get('/admin/users', () => {
     * });
     * ```
     */
    forOptions(options: Partial<HttpRouterFunctionOptions>): HttpRouterRegistryFunctionRegistrar {
        const that = this;
        return new (class extends HttpRouterRegistryFunctionRegistrar {
            defaultOptions = options;

            addRoute(routeConfig: RouteConfig) {
                that.addRoute(routeConfig);
            }
        })();
    }

    public any(pathOrOptions: string | HttpRouterFunctionOptions, callback: (...args: any[]) => any) {
        this.register(convertOptions([], pathOrOptions, this.defaultOptions), callback);
    }

    public add(decorator: HttpDecorator, callback: (...args: any[]) => any) {
        const data = decorator(Object, '_');
        const action = isArray(data) ? data.find(v => v instanceof HttpAction) : undefined;
        if (!action) throw new DeepkitError('DK-H005', 'No HttpAction available');

        const fn = ReflectionFunction.from(callback);
        const routeConfig = createRouteConfigFromHttpAction(
            {
                type: 'function',
                fn: callback,
            },
            action,
        );
        routeConfig.returnType = filterValidReturnType(fn.getReturnType());
        this.addRoute(routeConfig);
    }

    public get(pathOrOptions: string | HttpRouterFunctionOptions, callback: (...args: any[]) => any) {
        this.register(convertOptions(['GET'], pathOrOptions, this.defaultOptions), callback);
    }

    public post(pathOrOptions: string | HttpRouterFunctionOptions, callback: (...args: any[]) => any) {
        this.register(convertOptions(['POST'], pathOrOptions, this.defaultOptions), callback);
    }

    public put(pathOrOptions: string | HttpRouterFunctionOptions, callback: (...args: any[]) => any) {
        this.register(convertOptions(['PUT'], pathOrOptions, this.defaultOptions), callback);
    }

    public patch(pathOrOptions: string | HttpRouterFunctionOptions, callback: (...args: any[]) => any) {
        this.register(convertOptions(['PATCH'], pathOrOptions, this.defaultOptions), callback);
    }

    public delete(pathOrOptions: string | HttpRouterFunctionOptions, callback: (...args: any[]) => any) {
        this.register(convertOptions(['DELETE'], pathOrOptions, this.defaultOptions), callback);
    }

    public options(pathOrOptions: string | HttpRouterFunctionOptions, callback: (...args: any[]) => any) {
        this.register(convertOptions(['OPTIONS'], pathOrOptions, this.defaultOptions), callback);
    }

    public trace(pathOrOptions: string | HttpRouterFunctionOptions, callback: (...args: any[]) => any) {
        this.register(convertOptions(['TRACE'], pathOrOptions, this.defaultOptions), callback);
    }

    public head(pathOrOptions: string | HttpRouterFunctionOptions, callback: (...args: any[]) => any) {
        this.register(convertOptions(['HEAD'], pathOrOptions, this.defaultOptions), callback);
    }

    public redirectCallback(
        pathOrOptions: string | HttpRouterFunctionOptions,
        callback: (request: HttpRequest) => string,
        redirectCode: number = 302,
    ) {
        const options = convertOptions(['GET'], pathOrOptions, this.defaultOptions);
        this.register(options, (request: HttpRequest) => {
            return Redirect.toUrl(callback(request), redirectCode);
        });
    }

    private register(
        options: HttpRouterFunctionOptions,
        callback: (...args: any[]) => any,
        module?: InjectorModule<any>,
    ) {
        const fn = ReflectionFunction.from(callback);

        const routeConfig = new RouteConfig(options.name || '', options.methods || [], options.path, {
            type: 'function',
            fn: callback,
        });
        routeConfig.module = module;
        if (options.responses) routeConfig.responses = options.responses;
        if (options.description) routeConfig.description = options.description;
        if (options.category) routeConfig.category = options.category;
        if (options.groups) routeConfig.groups = options.groups;
        if (options.data) routeConfig.data = new Map(Object.entries(options.data));
        if (options.baseUrl) routeConfig.baseUrl = options.baseUrl;
        if (options.middlewares) {
            routeConfig.middlewares = options.middlewares.map(v => {
                return { config: v(), module };
            });
        }

        if (options.resolverForToken) {
            for (const item of options.resolverForToken) routeConfig.resolverForToken.set(...item);
        }

        if (options.resolverForToken) {
            for (const item of options.resolverForToken) routeConfig.resolverForToken.set(...item);
        }

        if (options.resolverForParameterName) {
            for (const item of options.resolverForParameterName) routeConfig.resolverForParameterName.set(...item);
        }

        routeConfig.serializer = options.serializer;
        routeConfig.serializationOptions = options.serializationOptions;

        routeConfig.returnType = filterValidReturnType(fn.getReturnType());
        this.addRoute(routeConfig);
    }
}

function createRouteConfigFromHttpAction(
    routeAction: RouteClassControllerAction | RouteFunctionControllerAction,
    action: HttpAction,
    module?: InjectorModule<any>,
    controller?: HttpController,
) {
    const routeConfig = new RouteConfig(action.name, action.httpMethods, action.path, routeAction);
    routeConfig.responses = action.responses;
    routeConfig.description = action.description;
    routeConfig.category = action.category;
    routeConfig.groups = action.groups;

    // Build data map: controller settings first, then action overrides
    routeConfig.data = new Map();
    for (const [key, value] of action.data) {
        routeConfig.data.set(key, value);
    }

    // Merge CORS config at registration time (not per-request)
    // Priority: action.cors > controller.cors
    const actionCors = action.data.get('cors') as Partial<CorsOptions> | false | undefined;
    const controllerCors: Partial<CorsOptions> | false | undefined = controller?.cors;

    if (actionCors === false) {
        // Action explicitly disables CORS
        routeConfig.data.set('cors', false);
    } else if (actionCors && typeof actionCors === 'object') {
        // Action has CORS config
        if (controllerCors && typeof controllerCors === 'object') {
            // Merge: controller base + action override (done once at registration)
            routeConfig.data.set('cors', { ...controllerCors, ...actionCors });
        } else {
            routeConfig.data.set('cors', actionCors);
        }
    } else if (controllerCors === false) {
        // Controller disables CORS, no action override
        routeConfig.data.set('cors', false);
    } else if (controllerCors && typeof controllerCors === 'object') {
        // Only controller has config
        routeConfig.data.set('cors', controllerCors);
    }

    if (controller) {
        routeConfig.baseUrl = controller.baseUrl;

        routeConfig.middlewares = controller.middlewares.map(v => {
            return { config: v(), module };
        });
        routeConfig.resolverForToken = new Map(controller.resolverForToken);
        routeConfig.resolverForParameterName = new Map(controller.resolverForParameterName);
    }

    routeConfig.middlewares.push(
        ...action.middlewares.map(v => {
            return { config: v(), module };
        }),
    );

    for (const item of action.resolverForToken) routeConfig.resolverForToken.set(...item);

    for (const item of action.resolverForParameterName) routeConfig.resolverForParameterName.set(...item);

    routeConfig.serializer = action.serializer;
    routeConfig.serializationOptions = action.serializationOptions;
    return routeConfig;
}

export class HttpRouterRegistry extends HttpRouterRegistryFunctionRegistrar {
    protected routes: RouteConfig[] = [];
    private buildId: number = 1;

    public getBuildId(): number {
        return this.buildId;
    }

    public getRoutes(): RouteConfig[] {
        return this.routes;
    }

    public addRouteForController(controller: ClassType, module: InjectorModule<any>) {
        const controllerData = httpClass._fetch(controller);
        if (!controllerData)
            throw new DeepkitError(
                'DK-H006',
                `Http controller class ${getClassName(controller)} has no @http.controller decorator.`,
            );
        const schema = ReflectionClass.from(controller);

        for (const action of getActions(controller)) {
            const routeAction: RouteClassControllerAction = {
                type: 'controller',
                controller,
                module,
                methodName: action.methodName,
            };
            const routeConfig = createRouteConfigFromHttpAction(routeAction, action, module, controllerData);

            routeConfig.module = module;

            if (schema.hasMethod(action.methodName))
                routeConfig.returnType = filterValidReturnType(schema.getMethod(action.methodName).getReturnType());
            this.addRoute(routeConfig);
        }
    }

    public addRoute(routeConfig: RouteConfig) {
        this.routes.push(routeConfig);
        this.buildId++;
    }
}

/**
 * Checks if a middleware class is request-scoped (scope: 'http', 'rpc', etc.)
 * by looking up its provider in the module hierarchy.
 *
 * A middleware is considered request-scoped if:
 * 1. It has an explicit scope like 'http' in its provider definition
 * 2. It's registered with transient: true
 *
 * By default, middleware classes without explicit scope are singletons.
 */
function isRequestScopedMiddleware(middlewareClass: ClassType, module: InjectorModule<any> | undefined): boolean {
    if (!module) return false;

    // Walk up the module hierarchy to find the provider
    let currentModule: InjectorModule<any> | undefined = module;
    while (currentModule) {
        for (const provider of currentModule.getProviders()) {
            if (isClass(provider)) {
                if (provider === middlewareClass) {
                    // Class registered directly without config - it's a singleton
                    return false;
                }
            } else if (provider && typeof provider === 'object' && 'provide' in provider) {
                if (provider.provide === middlewareClass) {
                    const scope = getScope(provider);
                    // Check if it has http/rpc/cli scope or transient
                    if (scope === 'http' || scope === 'rpc' || scope === 'cli') {
                        return true;
                    }
                    if ('transient' in provider && provider.transient === true) {
                        return true;
                    }
                    return false;
                }
            }
        }
        currentModule = currentModule.getParent();
    }

    // Not found in providers - treat as singleton (will be auto-provided)
    return false;
}

/**
 * A middleware whose instance belongs to the request: for each request's injector, the function
 * that resolves the instance and runs it.
 *
 * The function carries the middleware's NAME — the kernel names it in what it logs — and gets it
 * the way JavaScript gives one to a function written as a property's value. That needs the
 * function to BE the value, so nothing here is given runtime types: the type compiler would wrap
 * it in a call, and what a call returns has no name.
 *
 * @reflection never
 */
function perRequestMiddleware(
    name: string,
    instanceOf: (injector: InjectorContext) => HttpMiddleware,
): (injector: InjectorContext) => HttpMiddlewareFn {
    return injector =>
        ({
            [name]: (req: HttpRequest, res: HttpResponse, next: (err?: any) => void) =>
                instanceOf(injector).execute(req, res, next),
        })[name];
}

export class HttpRouter {
    protected fn?: (request: HttpRequest) => ResolvedController | undefined;
    protected buildId: number = 0;
    protected resolveFn?: (name: string, parameters: { [name: string]: any }) => string;

    constructor(
        controllers: HttpControllers,
        private logger: LoggerInterface,
        private config: HttpConfig,
        private middlewareRegistry: MiddlewareRegistry = new MiddlewareRegistry(),
        private registry: HttpRouterRegistry = new HttpRouterRegistry(),
        private injectorContext?: InjectorContext,
    ) {
        for (const controller of controllers.controllers) {
            this.addRouteForController(controller.controller, controller.module);
        }
    }

    getRoutes(): RouteConfig[] {
        return this.registry.getRoutes();
    }

    static forControllers(
        controllers: (ClassType | { module: InjectorModule<any>; controller: ClassType })[],
        middlewareRegistry: MiddlewareRegistry = new MiddlewareRegistry(),
        module: InjectorModule<any> = new InjectorModule(),
        config: HttpConfig = new HttpConfig(),
    ): HttpRouter {
        return new this(
            new HttpControllers(
                controllers.map(v => {
                    return isClass(v) ? { controller: v, module } : v;
                }),
            ),
            new Logger([], []),
            config,
            middlewareRegistry,
        );
    }

    /**
     * Everything about one route that is worked out once, before the router's function is
     * declared: how its path is recognised, its middlewares, and how its parameters are loaded.
     */
    protected planRoute(routeConfig: RouteConfig): RoutePlan {
        const parsedRoute = parseRouteControllerAction(routeConfig);
        const path = routeConfig.getFullPath();
        const pathParamStarter = path.indexOf(':');
        const hasParameters = pathParamStarter !== -1 || parsedRoute.getParameters().length > 0;

        return {
            routeConfig,
            methods: routeConfig.httpMethods.map(v => v.toUpperCase()),
            // A route with parameters is recognised by its pattern, tried only where the path
            // starts like it; one with none is its path.
            matcher: hasParameters
                ? { prefix: path.substr(0, pathParamStarter), regex: new RegExp('^' + parsedRoute.regex + '$') }
                : { path },
            middlewares: this.planMiddlewares(routeConfig),
            parameters: planParameterLoader(this.config.parser, [...parsedRoute.getParameters()], {
                module: routeConfig.module,
                resolverForToken: routeConfig.resolverForToken,
                resolverForParameterName: routeConfig.resolverForParameterName,
                pathParameterNames: parsedRoute.pathParameterNames,
                routeConfig,
            }),
        };
    }

    /**
     * The middlewares of a route as the function the kernel calls with the request's injector.
     * `undefined` for a route that has none.
     */
    protected planMiddlewares(routeConfig: RouteConfig): ResolvedController['middlewares'] {
        const middlewareConfigs = filterMiddlewaresForRoute(
            this.middlewareRegistry.configs,
            routeConfig,
            routeConfig.getFullPath(),
        );
        if (!middlewareConfigs.length) return undefined;

        /** One per middleware: the function of it for the request whose injector this is. */
        const forRequest: ((injector: InjectorContext) => HttpMiddlewareFn)[] = [];
        // Track if all middlewares can be pre-resolved (all singletons)
        let allStatic = true;
        // Pre-resolved middleware functions for static array optimization
        const staticMiddlewareFns: HttpMiddlewareFn[] = [];

        const addStatic = (middleware: HttpMiddlewareFn) => {
            forRequest.push(() => middleware);
            staticMiddlewareFns.push(middleware);
        };

        /** A middleware whose instance is the request's own: resolved per request. */
        const addPerRequest = (
            middleware: ClassType<HttpMiddleware>,
            name: string,
            module: InjectorModule<any> | undefined,
        ) => {
            allStatic = false;
            // Try to use pre-compiled resolver if module's injector is available
            const resolver = module?.injector ? module.injector.getResolver(middleware) : undefined;
            const instanceOf: (injector: InjectorContext) => HttpMiddleware = resolver
                ? injector => resolver(injector.scope)
                : // Fallback to dynamic lookup
                  module
                  ? injector => injector.get(middleware, module)
                  : injector => injector.get(middleware);
            forRequest.push(perRequestMiddleware(name, instanceOf));
        };

        for (const middlewareConfig of middlewareConfigs) {
            for (const middleware of middlewareConfig.config.middlewares) {
                if (!isClass(middleware)) {
                    // Function middleware: always static
                    addStatic(middleware);
                    continue;
                }
                const middlewareName = middleware.name || 'Middleware';

                if (isRequestScopedMiddleware(middleware, middlewareConfig.module)) {
                    // Request-scoped middleware: resolve per-request
                    addPerRequest(middleware, middlewareName, middlewareConfig.module);
                } else if (this.injectorContext) {
                    // Singleton middleware with injector available: pre-resolve at build time
                    try {
                        const instance = this.injectorContext.get(middleware, middlewareConfig.module);
                        const boundExecute = instance.execute.bind(instance);
                        // Set function name for debugging
                        Object.defineProperty(boundExecute, 'name', { value: middlewareName });
                        addStatic(boundExecute);
                    } catch {
                        // Fallback if pre-resolution fails (e.g., dependencies not available)
                        addPerRequest(middleware, middlewareName, middlewareConfig.module);
                    }
                } else {
                    // No injector context available
                    addPerRequest(middleware, middlewareName, middlewareConfig.module);
                }
            }
        }

        // All middlewares are singletons - use pre-built static array
        if (allStatic && staticMiddlewareFns.length > 0) return () => staticMiddlewareFns;

        // Mixed or all request-scoped: build array per request
        return injector => {
            const middlewares = new Array<HttpMiddlewareFn>(forRequest.length);
            for (let i = 0; i < forRequest.length; i++) middlewares[i] = forRequest[i](injector);
            return middlewares;
        };
    }

    public addRoute(routeConfig: RouteConfig) {
        this.registry.addRoute(routeConfig);
    }

    public addRouteForController(controller: ClassType, module: InjectorModule<any>) {
        this.registry.addRouteForController(controller, module);
    }

    /**
     * The function `resolveRequest()` runs: which route a request is for. Built with the JIT of
     * `@deepkit/core` from the routes registered at that moment, it reads
     *
     *     const method = request.method || 'GET'; … path, query, headers, uploadedFiles …
     *     if (method === 'GET' && path.startsWith('/users/')) {
     *         match = path.match(<the route's pattern>);
     *         if (match) return { routeConfig, parameters: <its loader, for this request>, uploadedFiles, middlewares };
     *     }
     *     … the next route …
     *
     * and each route's parameter loader is a nested function of it (`planParameterLoader`).
     */
    protected build(): (request: HttpRequest) => ResolvedController | undefined {
        this.buildId = this.registry.getBuildId();
        // Planned before the declaration: a plan asks `@deepkit/type` and the injector for
        // functions, and those are not to be built as functions of this one.
        const plans = this.getRoutes().map(route => this.planRoute(route));

        return fn<ResolvedController | undefined>(arg('request'), (b: Builder, request: Ref) => {
            const method = b.let(b.or(b.get(request, 'method'), b.lit('GET')), 'method');
            const values = writeRequestValues(b, request, true);
            const match = b.var_<RegExpMatchArray | null | undefined>(undefined, 'match');

            for (const plan of plans) {
                //=> GET,POST /path
                const conditions: Ref[] = [];
                if (plan.methods.length) {
                    conditions.push(
                        plan.methods.map(v => b.eq(method, b.lit(v))).reduce((either, next) => b.or(either, next)),
                    );
                }
                conditions.push(
                    'path' in plan.matcher
                        ? b.eq(values.path, b.lit(plan.matcher.path))
                        : b.method(values.path, 'startsWith', b.lit(plan.matcher.prefix)),
                );

                const resolved = () =>
                    b.obj({
                        routeConfig: b.lit(plan.routeConfig),
                        parameters: writeParameterLoader(b, plan.parameters, {
                            request,
                            match: b.getVar(match),
                            ...values,
                        }),
                        uploadedFiles: values.uploadedFiles,
                        middlewares: b.lit(plan.middlewares),
                    });

                const regex = 'path' in plan.matcher ? undefined : plan.matcher.regex;
                b.if_(
                    conditions.reduce((all, next) => b.and(all, next)),
                    regex
                        ? () => {
                              b.setVar(match, b.method(values.path, 'match', b.lit(regex)));
                              b.if_(b.getVar(match), resolved);
                          }
                        : resolved,
                );
            }
        });
    }

    /**
     * The function `resolveUrl()` runs: the URL of a route, by its name, for the parameters given.
     */
    protected buildUrlResolver(): (name: string, parameters: { [name: string]: any }) => string {
        const routes = this.getRoutes().map(route => ({ route, parsed: parseRouteControllerAction(route) }));

        return fn<string>(arg('name'), arg('parameters'), (b: Builder, name: Ref, parameters: Ref) => {
            b.switch_(
                name,
                routes.map(({ route, parsed }): [unknown, () => Ref] => [
                    route.name,
                    () => {
                        // `/users/:id/posts` is '/users/', the parameter `id` as a string, '/posts'.
                        const parts: Ref[] = [];
                        const path = route.getFullPath();
                        let position = 0;
                        for (const found of path.matchAll(/:(\w+)/g)) {
                            parts.push(b.lit(path.slice(position, found.index)));
                            parts.push(b.call(String, b.get(parameters, found[1])));
                            position = found.index + found[0].length;
                        }
                        parts.push(b.lit(path.slice(position)));
                        const url = b.let(b.concat(...parts), 'url');
                        const query = b.let(b.emptyArr(), 'query');

                        const add = (value: Ref, queryPath: string) => {
                            b.if_(b.neq(value, b.lit(undefined)), () => {
                                b.push(
                                    query,
                                    b.concat(b.lit(dotToUrlPath(queryPath) + '='), b.call(encodeURIComponent, value)),
                                );
                            });
                        };

                        for (const parameter of parsed.getParameters()) {
                            if (!parameter.query && !parameter.queries) continue;
                            const queryPath =
                                parameter.typePath === undefined && parameter.query
                                    ? parameter.parameter.name
                                    : parameter.typePath || '';
                            const value = b.get(parameters, parameter.getName());

                            if (
                                parameter.parameter.type.kind === ReflectionKind.class ||
                                parameter.parameter.type.kind === ReflectionKind.objectLiteral
                            ) {
                                for (const property of ReflectionClass.from(parameter.parameter.type).getProperties()) {
                                    // Each property of the object, where there is an object.
                                    const propertyValue = b.let(
                                        b.ternary(b.isNullish(value), b.lit(undefined), b.get(value, property.name)),
                                    );
                                    add(propertyValue, queryPath ? queryPath + '.' + property.name : property.name);
                                }
                            } else {
                                add(value, queryPath);
                            }
                        }

                        return b.concat(
                            url,
                            b.ternary(
                                b.len(query),
                                b.concat(b.lit('?'), b.method(query, 'join', b.lit('&'))),
                                b.lit(''),
                            ),
                        );
                    },
                ]),
            );
            b.throw_(
                b.new_(DeepkitError, b.lit('DK-H007'), b.concat(b.lit('No route for name '), name, b.lit(' found'))),
            );
        });
    }

    public resolveUrl(routeName: string, parameters: { [name: string]: any } = {}): string {
        if (!this.resolveFn) {
            this.resolveFn = this.buildUrlResolver();
        }

        return this.resolveFn!(routeName, parameters);
    }

    public resolveRequest(request: HttpRequest): ResolvedController | undefined {
        if (!this.fn || this.buildId !== this.registry.getBuildId()) {
            this.fn = this.build();
        }

        return this.fn(request);
    }

    public resolve(method: string, url: string): ResolvedController | undefined {
        method = method.toUpperCase();
        return this.resolveRequest({ url, method } as any);
    }
}
