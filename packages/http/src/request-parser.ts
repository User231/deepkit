import formidable, { Fields, Files, Options } from 'formidable';
import type IncomingForm from 'formidable/Formidable.js';
import qs from 'qs';

import {
    Builder,
    ClassType,
    DeepkitError,
    Ref,
    arg,
    asyncOperation,
    fn,
    fnAsync,
    isDeclaring,
    isObject,
} from '@deepkit/core';
import { DependenciesUnmetError, InjectorContext, InjectorModule } from '@deepkit/injector';
import {
    ReflectionKind,
    ReflectionParameter,
    Type,
    ValidationError,
    ValidationErrorItem,
    assertType,
    findMember,
    getSerializeFunction,
    getValidatorFunction,
    hasDefaultValue,
    isOptional,
    resolveReceiveType,
    serializer,
    stringifyType,
    typeAnnotation,
    typeToObject,
} from '@deepkit/type';

import {
    BodyValidationError,
    HttpRequest,
    HttpRequestPositionedParameters,
    ValidatedBody,
    createRequestWithCachedBody,
    getRegExp,
} from './model.js';
import { HttpParserOptions } from './module.config.js';
import {
    RouteConfig,
    RouteParameterResolverForInjector,
    UploadedFile,
    UploadedFileSymbol,
    getRouteActionLabel,
} from './router.js';

// formidable returns arrays for values when the type is multipart or formdata
// adapted from https://www.npmjs.com/package/formidable/v/3.5.4#helpers
// https://github.com/node-formidable/formidable/blob/v3.5.3/src/helpers/firstValues.js
// keeps arrays with more than one element
function extractValues(form: IncomingForm, fields: Fields): Record<string, unknown> {
    const formType = (form as any).type;
    if (formType !== 'multipart' && formType !== 'form-data') return fields;
    return Object.fromEntries(
        Object.entries(fields).map(([key, value]) => {
            if (!Array.isArray(value)) {
                return [key, value];
            } else if (value.length === 1) {
                return [key, value[0]];
            } else {
                return [key, value];
            }
        }),
    );
}

function parseBody(options: HttpParserOptions, req: HttpRequest, foundFiles: { [name: string]: UploadedFile }) {
    const { multipartJsonKey, ...formidableOptions } = options;
    const form = formidable(
        Object.assign(
            {
                allowEmptyFiles: true,
                minFileSize: 0,
            },
            formidableOptions as Options,
        ),
    );
    return asyncOperation(async (resolve, reject) => {
        function parseData(fields: Fields, files: Files) {
            const fileEntries = Object.entries(files);

            // formidable turns JSON arrays into numerically keyed objects, so we convert them back
            if (
                '0' in fields &&
                fileEntries.length === 0 &&
                Object.keys(fields).every((key, idx) => parseInt(key) === idx)
            ) {
                return resolve(Object.values(fields));
            }

            let extractedFields = extractValues(form, fields);
            if (multipartJsonKey && typeof extractedFields[multipartJsonKey] === 'string') {
                try {
                    const { [multipartJsonKey]: json, ...otherFields } = extractedFields;
                    const parsed = JSON.parse(extractedFields[multipartJsonKey]);
                    extractedFields = { ...otherFields, ...parsed };
                } catch (e) {
                    // couldn't parse JSON, ignore
                }
            }

            for (const [name, files] of fileEntries) {
                if (!files) continue;
                const file = files[0];
                if (!file) continue;
                if (!file.filepath || 'string' !== typeof file.filepath) continue;
                if (!file.size || 'number' !== typeof file.size) continue;

                foundFiles[name] = {
                    validator: UploadedFileSymbol,
                    size: file.size,
                    path: file.filepath,
                    name: file.originalFilename || null,
                    type: file.mimetype || null,
                    lastModifiedDate: null,
                };
            }
            const body = { ...extractedFields, ...foundFiles };
            resolve(body);
        }

        if (req.body) {
            const [fields, files] = await form.parse(createRequestWithCachedBody(req, req.body));
            parseData(fields, files);
        }

        const chunks: Buffer[] = [];

        function read(chunk: Buffer) {
            chunks.push(chunk);
        }

        req.on('data', read);
        req.once('end', () => {
            req.body = Buffer.concat(chunks);
            req.off('data', read);
        });
        req.once('error', () => req.off('data', read));

        const [fields, files] = await form.parse(req);
        parseData(fields, files);
    });
}

/**
 * Parse a request body the way the ROUTER parses it — form fields plus an
 * {@link UploadedFile} per file part — from a controller that reads its own
 * body instead of declaring an `HttpBody<T>` parameter.
 *
 * A transport that owns its request shape (a GraphQL endpoint serving the
 * multipart request spec, a webhook receiver) cannot go through the compiled
 * route parser: it has no typed body to cast into. Without this it would have
 * to bring a second multipart parser into a process that already has one,
 * with its own limits and its own bugs. Same `parseBody`, same formidable,
 * same options — under a name a hand-written route can call.
 *
 * Files land under their FIELD NAME as `UploadedFile` (`path` is a temp file
 * the framework removes when the request ends); every other field is a string,
 * or a string array when the form repeats a name.
 */
export function parseRequestBody(
    request: HttpRequest,
    options: HttpParserOptions = {},
): Promise<Record<string, unknown>> {
    return parseBody(options, request, {}) as Promise<Record<string, unknown>>;
}

export class ParameterForRequestParser {
    regexPosition?: number;

    constructor(public parameter: ReflectionParameter) {}

    get body() {
        return typeAnnotation.getType(this.parameter.type, 'httpBody') !== undefined;
    }

    get requestParser() {
        return typeAnnotation.getType(this.parameter.type, 'httpRequestParser') !== undefined;
    }

    get bodyValidation() {
        return typeAnnotation.getType(this.parameter.type, 'httpBodyValidation') !== undefined;
    }

    getType(): Type {
        const parser = typeAnnotation.getType(this.parameter.type, 'httpRequestParser');
        if (parser) {
            return parser;
        }

        if (this.bodyValidation) {
            assertType(this.parameter.type, ReflectionKind.class);
            const valueType = findMember('value', this.parameter.type.types);
            if (!valueType || valueType.kind !== ReflectionKind.property)
                throw new DeepkitError('DK-H010', `No property value found at ${stringifyType(this.parameter.type)}`);
            return valueType.type as Type;
        }
        return this.parameter.type;
    }

    get header() {
        return typeAnnotation.getType(this.parameter.type, 'httpHeader') !== undefined;
    }

    get query() {
        return typeAnnotation.getType(this.parameter.type, 'httpQuery') !== undefined;
    }

    get queries() {
        return typeAnnotation.getType(this.parameter.type, 'httpQueries') !== undefined;
    }

    get typePath(): string | undefined {
        const typeOptions =
            typeAnnotation.getType(this.parameter.type, 'httpQueries') ||
            typeAnnotation.getType(this.parameter.type, 'httpQuery') ||
            typeAnnotation.getType(this.parameter.type, 'httpPath') ||
            typeAnnotation.getType(this.parameter.type, 'httpHeader');
        if (!typeOptions) return;
        const options = typeToObject(typeOptions);
        if (isObject(options)) return options.name;
        return;
    }

    getName() {
        return this.parameter.name;
    }

    isPartOfPath(): boolean {
        return (
            typeAnnotation.getType(this.parameter.type, 'httpPath') !== undefined || this.regexPosition !== undefined
        );
    }
}

export function parseRoutePathToRegex(
    path: string,
    params: ReflectionParameter[],
): { regex: string; parameterNames: { [name: string]: number } } {
    const parameterNames: { [name: string]: number } = {};

    let argumentIndex = 0;
    path = path.replace(/:(\w+)/g, (a, name) => {
        parameterNames[name] = argumentIndex;
        argumentIndex++;
        const parameter = params.find(v => v.name === name);
        if (parameter) {
            const regExp = getRegExp(parameter.type);
            if (regExp instanceof RegExp) {
                return '(' + regExp.source + ')';
            } else if (regExp) {
                return '(' + regExp + ')';
            }
        }
        return String.raw`([^/]+)`;
    });

    return { regex: path, parameterNames };
}

function isTypeUnknown(type: Type): boolean {
    if (type.id) return false; //if is has an id we treat it as nominal type
    return (
        type.kind === ReflectionKind.unknown || type.kind === ReflectionKind.any || type.kind === ReflectionKind.never
    );
}

// ============================================================================
// What a parameter loader reads, and what it is handed out as
// ============================================================================

/**
 * The values of ONE request that the generated functions read: the request, what its path matched,
 * its parsed query string, its headers, and the files its body uploaded.
 */
export interface RequestValues {
    request: Ref;
    match: Ref;
    query: Ref;
    headers: Ref;
    uploadedFiles: Ref;
}

/**
 * A route's parameter loader as it is generated: a function of the request's values and the
 * injector. A function the JIT builds sees its arguments only, so they are passed in — and
 * {@link loaderOf} is what closes over them.
 */
export type ParameterLoader = (
    request: HttpRequest,
    match: ArrayLike<string>,
    query: Record<string, unknown>,
    headers: Record<string, unknown>,
    uploadedFiles: { [name: string]: UploadedFile },
    injector: InjectorContext,
) => HttpRequestPositionedParameters | Promise<HttpRequestPositionedParameters>;

/** `load` for one request: what a route hands out as its `parameters`, to be called with the injector. */
export function loaderOf(
    load: ParameterLoader,
    request: HttpRequest,
    match: ArrayLike<string>,
    query: Record<string, unknown>,
    headers: Record<string, unknown>,
    uploadedFiles: { [name: string]: UploadedFile },
): RouteParameterResolverForInjector {
    return injector => load(request, match, query, headers, uploadedFiles, injector);
}

/** The loader of a route that has no parameter. */
export const noParameters = (() => {}) as unknown as RouteParameterResolverForInjector;

/** What `HttpRequestParser<T>` hands the controller: the request as a `T`, parsed when it is asked for. */
type ParseRequest = (
    options: { withPath?: boolean; withHeader?: boolean; withBody?: boolean; withQuery?: boolean },
    match: ArrayLike<string>,
    headers: Record<string, unknown>,
    query: Record<string, unknown>,
    request: HttpRequest,
    uploadedFiles: { [name: string]: UploadedFile },
    body: { fields?: unknown },
    bodyErrors: unknown[],
) => Promise<unknown>;

/** `parse` for one request — the function an `HttpRequestParser<T>` parameter is. */
function requestParserOf(
    parse: ParseRequest,
    match: ArrayLike<string>,
    headers: Record<string, unknown>,
    query: Record<string, unknown>,
    request: HttpRequest,
    uploadedFiles: { [name: string]: UploadedFile },
    body: { fields?: unknown },
    bodyErrors: unknown[],
): (options?: Parameters<ParseRequest>[0]) => Promise<unknown> {
    return (options = {}) => parse(options, match, headers, query, request, uploadedFiles, body, bodyErrors);
}

/**
 * A provider's value for a parameter, resolved through the injector. How to resolve it is asked
 * once, by the first request, and kept: it outlives the request, so it is held here and not in a
 * variable of the generated function.
 */
function providerOf(module: InjectorModule<any> | undefined, type: Type): (injector: InjectorContext) => unknown {
    let resolve: ((scope: unknown, optional: boolean) => unknown) | undefined;
    return injector => {
        if (!resolve) resolve = (injector as any).resolve(module, type);
        return resolve!(injector.scope, true);
    };
}

/**
 * The first lines of both generated functions: what a request's URL and headers are read into.
 * `query`: `true` parses the query string, `false` leaves it an empty object.
 */
export function writeRequestValues(
    b: Builder,
    request: Ref,
    query: boolean,
): { url: Ref; path: Ref; query: Ref; headers: Ref; uploadedFiles: Ref } {
    const url = b.let(b.or(b.get(request, 'url'), b.lit('/')), 'url');
    const headers = b.let(b.or(b.get(request, 'headers'), b.emptyObj()), 'headers');
    const qPosition = b.let(b.method(url, 'indexOf', b.lit('?')), 'qPosition');
    const uploadedFiles = b.let(b.emptyObj(), 'uploadedFiles');
    const noQuery = b.eq(qPosition, b.lit(-1));
    const path = b.let(b.ternary(noQuery, url, b.method(url, 'substr', b.lit(0), qPosition)), 'path');
    const parsed = query
        ? b.ternary(
              noQuery,
              b.emptyObj(),
              b.method(b.lit(qs), 'parse', b.method(url, 'substr', b.add(qPosition, b.lit(1)))),
          )
        : b.emptyObj();
    return { url, path, query: b.let(parsed, 'query'), headers, uploadedFiles };
}

export function buildRequestParser(
    parseOptions: HttpParserOptions,
    parameters: ReflectionParameter[],
    routeConfig?: RouteConfig,
): (request: HttpRequest) => RouteParameterResolverForInjector {
    const params = parameters.map(v => new ParameterForRequestParser(v));

    //todo: parse path
    let pathRegex = '';
    let pathParameterNames: { [name: string]: number } = {};

    if (routeConfig) {
        const parsedPath = parseRoutePathToRegex(routeConfig.getFullPath(), parameters);
        pathRegex = parsedPath.regex;
        pathParameterNames = parsedPath.parameterNames;

        for (const param of params) {
            // Use typePath (from httpPath annotation) if available, otherwise use parameter name
            const pathName = param.typePath ?? param.parameter.name;
            param.regexPosition = parsedPath.parameterNames[pathName];
        }
    }

    // Everything that asks `@deepkit/type` for a function is done here, before the declaration.
    const plan = planParameterLoader(parseOptions, params, { pathParameterNames, routeConfig });
    const needsQueryString = !!params.find(v => v.query || v.queries || v.requestParser);
    const regex = new RegExp('^' + pathRegex + '$');

    return fn(arg('request'), (b: Builder, request: Ref) => {
        const values = writeRequestValues(b, request, needsQueryString);
        const match = b.let(b.or(b.method(values.path, 'match', b.lit(regex)), b.emptyArr()), 'match');
        return writeParameterLoader(b, plan, { request, match, ...values });
    });
}

/**
 * Re-emit each validation error produced for a single route parameter under the parameter's name.
 *
 * The JIT type guard builds error paths relative to the value it was handed (root = `''` for a
 * scalar, the field name for an object property). It has no notion of *which* route parameter that
 * value came from, so a bad `?page=` reports `(type): …` and a bad `:id` reports `(type): …`. The
 * router knows the name, so we prefix it here: scalar errors become `page(type): …` and nested
 * object errors `entity.field(type): …`, matching the public path semantics every other Deepkit
 * surface (cast/validate) already produces.
 */
function prefixValidationErrors(target: ValidationErrorItem[], source: ValidationErrorItem[], root: string): void {
    for (const item of source) {
        const path = item.path ? root + '.' + item.path : root;
        target.push(new ValidationErrorItem(path, item.code, item.message, item.value));
    }
}

/**
 * Deserialize a single route parameter, re-anchoring any thrown validation error under the
 * parameter's name. Lenient scalar deserializers (e.g. `number`) leave an unconvertible value
 * untouched for the validator to reject, but union/literal deserializers *throw* a rootless
 * `ValidationError` directly — without this the response would read `(type): Cannot convert …`
 * instead of `page(type): …`. A deserializer throw already aborts the whole parse, so re-throwing
 * the prefixed error preserves that fail-fast behavior; it only corrects the path.
 */
function coerceParam(converter: (value: any, options: { loosely: boolean }) => any, rawValue: any, root: string): any {
    try {
        return converter(rawValue, { loosely: true });
    } catch (error) {
        if (error instanceof ValidationError) {
            const prefixed: ValidationErrorItem[] = [];
            prefixValidationErrors(prefixed, error.errors, root);
            throw new ValidationError(prefixed);
        }
        throw error;
    }
}

/**
 * How a route's parameters are loaded, worked out once: which statements its loader is made of.
 * `undefined` for a route that has no parameter.
 */
export interface ParameterLoaderPlan {
    /** The loader waits: for the request's body, or for a parameter resolver. */
    async: boolean;
    /** Writes the loader's body; called inside its declaration. */
    write(b: Builder, values: RequestValues, injector: Ref): Ref;
}

/** What the statements of a loader are written against. */
interface LoaderScope extends RequestValues {
    b: Builder;
    injector: Ref;
    /** Errors of the path, query and header parameters, each under its parameter's name. */
    validationErrors: Ref;
    /** Errors of the body. */
    bodyErrors: Ref;
    /** The parameters by name. */
    parameters: Ref;
    /** The parsed body: read by the route's own statements… */
    bodyFields(): Ref;
    /** …and shared, as the property `fields` of one object, with the request parsers handed to the controller. */
    body(): Ref;
}

/**
 * Plan the parameter loader of one route. Call it BEFORE the function that will hold the loader is
 * declared: it asks `@deepkit/type` for converters and validators, and those must not be built as
 * functions of somebody else's declaration.
 */
export function planParameterLoader(
    parseOptions: HttpParserOptions,
    parameters: ParameterForRequestParser[],
    config: {
        module?: InjectorModule<any>;
        resolverForParameterName?: Map<string, ClassType>;
        resolverForToken?: Map<any, ClassType>;
        pathParameterNames?: { [name: string]: number };
        routeConfig?: RouteConfig;
    },
): ParameterLoaderPlan | undefined {
    if (isDeclaring()) {
        throw new DeepkitError(
            'DK-H012',
            'planParameterLoader() was called while a function is being declared. Plan first, declare afterwards: ' +
                'the converters and validators it asks for would be built as functions of that declaration.',
        );
    }

    let enableParseBody = false;
    let requiresAsyncParameters = false;
    let throwsBodyErrors = true;
    let fillsParametersFromPath = false;
    const setParameters: ((s: LoaderScope) => void)[] = [];
    const parameterValues: ((s: LoaderScope) => Ref)[] = [];
    const parameterValidators: ((s: LoaderScope) => void)[] = [];
    const pathParameterNames = config.pathParameterNames || {};

    const looselyOptions = (b: Builder) => b.obj({ loosely: b.lit(true) });

    /** Validate one parameter, and report what is wrong with it under its name. */
    const validateUnderName = (name: string, root: string, validator: Function, onlyIfDefined: boolean) => {
        parameterValidators.push(({ b, parameters, validationErrors }) => {
            const validate = () => {
                const errors = b.let(b.emptyArr(), 'errors');
                b.exec(b.call(validator, b.get(parameters, name), b.obj({ errors })));
                b.exec(b.call(prefixValidationErrors, validationErrors, errors, b.lit(root)));
            };
            // Optional/defaulted query params: when absent the value is left undefined so the
            // handler's own default applies — validating undefined would (on v2) reject it.
            if (onlyIfDefined) b.if_(b.neq(b.get(parameters, name), b.lit(undefined)), validate);
            else validate();
        });
    };

    for (const parameter of parameters) {
        const name = parameter.parameter.name;

        if (parameter.requestParser || parameter.body || parameter.bodyValidation) {
            const type = parameter.getType();
            const validator = getValidatorFunction(undefined, type);
            const converter = getSerializeFunction(type, serializer.deserializeRegistry);

            if (parameter.bodyValidation) {
                parameterValues.push(({ b, parameters, bodyErrors }) =>
                    b.new_(
                        ValidatedBody,
                        b.new_(BodyValidationError, bodyErrors),
                        b.ternary(b.eq(b.len(bodyErrors), b.lit(0)), b.get(parameters, name), b.lit(undefined)),
                    ),
                );
                throwsBodyErrors = false;
            } else {
                parameterValues.push(({ b, parameters }) => b.get(parameters, name));
            }

            if (parameter.requestParser) {
                const pathNames = Object.entries(pathParameterNames);
                setParameters.push(scope => {
                    const { b, parameters } = scope;
                    // The controller calls it when it wants the request as a `T`: a function of
                    // its own, with the values of this request bound.
                    const parse = fnAsync(
                        arg('options'),
                        arg('match'),
                        arg('headers'),
                        arg('query'),
                        arg('request'),
                        arg('uploadedFiles'),
                        arg('body'),
                        arg('bodyErrors'),
                        (
                            b: Builder,
                            options: Ref,
                            match: Ref,
                            headers: Ref,
                            query: Ref,
                            request: Ref,
                            uploadedFiles: Ref,
                            body: Ref,
                            bodyErrors: Ref,
                        ) => {
                            const wanted = (option: string) => b.neq(b.get(options, option), b.lit(false));
                            const res = b.var_(b.emptyObj(), 'res');
                            b.if_(wanted('withPath'), () => {
                                for (const [pathName, index] of pathNames) {
                                    b.set(b.getVar(res), pathName, b.at(match, 1 + index));
                                }
                            });
                            b.if_(wanted('withHeader'), () => {
                                b.exec(b.call(Object.assign, b.getVar(res), headers));
                            });
                            b.if_(wanted('withBody'), () => {
                                b.if_(b.not(b.get(body, 'fields')), () => {
                                    b.set(
                                        body,
                                        'fields',
                                        b.await_(b.call(parseBody, b.lit(parseOptions), request, uploadedFiles)),
                                    );
                                });
                                b.exec(b.call(Object.assign, b.getVar(res), b.get(body, 'fields')));
                            });
                            b.if_(wanted('withQuery'), () => {
                                b.exec(b.call(Object.assign, b.getVar(res), query));
                            });
                            b.setVar(res, b.call(converter, b.getVar(res), looselyOptions(b)));
                            b.exec(b.call(validator, b.getVar(res), b.obj({ errors: bodyErrors })));
                            b.if_(b.len(bodyErrors), () => {
                                b.throw_(b.method(b.lit(ValidationError), 'from', bodyErrors));
                            });
                            return b.getVar(res);
                        },
                    );
                    b.set(
                        parameters,
                        name,
                        b.call(
                            requestParserOf,
                            b.lit(parse),
                            scope.match,
                            scope.headers,
                            scope.query,
                            scope.request,
                            scope.uploadedFiles,
                            scope.body(),
                            scope.bodyErrors,
                        ),
                    );
                });
            } else {
                enableParseBody = true;
                setParameters.push(({ b, parameters, bodyFields }) => {
                    b.set(parameters, name, b.call(converter, bodyFields(), looselyOptions(b)));
                });
                parameterValidators.push(({ b, parameters, bodyErrors }) => {
                    b.exec(b.call(validator, b.get(parameters, name), b.obj({ errors: bodyErrors })));
                });
            }
        } else if (parameter.query || parameter.queries || parameter.header) {
            // Serialize/validate against the parameter's declared inner type, not the
            // ReflectionKind.parameter wrapper. The wrapper has no (de)serialize/validate
            // handler, so passing it makes both no-op and the raw string is returned uncoerced.
            const type = parameter.getType();
            const converter = getSerializeFunction(
                type,
                serializer.deserializeRegistry,
                undefined,
                parameter.getName(),
            );
            const validator = getValidatorFunction(undefined, type);

            let queryPath = parameter.typePath === undefined && !parameter.queries ? name : parameter.typePath;
            // HTTP headers are case-insensitive per RFC 7230, and Node.js lowercases all header names
            if (parameter.header && queryPath) queryPath = queryPath.toLowerCase();
            const keys = queryPath ? queryPath.split('.') : [];
            const fromHeaders = parameter.header;

            const root = parameter.typePath || parameter.getName();
            const optionalQuery =
                isOptional(parameter.parameter.parameter) || hasDefaultValue(parameter.parameter.parameter);

            setParameters.push(({ b, parameters, headers, query }) => {
                // `query.a.b` for a path `a.b`; the whole query for a parameter that takes all of it.
                const raw = b.let(
                    keys.reduce((value, key) => b.get(value, key), fromHeaders ? headers : query),
                    'raw',
                );
                const coerced = b.call(coerceParam, b.lit(converter), raw, b.lit(root));
                b.set(
                    parameters,
                    name,
                    optionalQuery ? b.ternary(b.eq(raw, b.lit(undefined)), b.lit(undefined), coerced) : coerced,
                );
            });

            parameterValues.push(({ b, parameters }) => b.get(parameters, name));
            // Validate into a scratch array, then re-emit each error under the parameter's name so
            // the path reads `page(type)` / `entity.field(type)` instead of a rootless `(type)`.
            validateUnderName(name, root, validator, optionalQuery);
        } else {
            parameterValues.push(({ b, parameters }) => b.get(parameters, name));

            if (parameter.isPartOfPath()) {
                const position = 1 + (parameter.regexPosition || 0);
                if (parameter.parameter.type.kind !== ReflectionKind.class) {
                    // Coerce/validate the raw path string against the declared inner type
                    // (e.g. `number`), not the ReflectionKind.parameter wrapper — the wrapper
                    // has no (de)serialize/validate handler, so it would leave `match[i]` a string.
                    const type = parameter.getType();
                    const converter = getSerializeFunction(
                        type,
                        serializer.deserializeRegistry,
                        undefined,
                        parameter.getName(),
                    );
                    setParameters.push(({ b, parameters, match }) => {
                        b.set(
                            parameters,
                            name,
                            b.call(coerceParam, b.lit(converter), b.at(match, position), b.lit(parameter.getName())),
                        );
                    });

                    // Re-emit under the parameter's name so a bad `:id` reports `id(type): …`.
                    validateUnderName(name, parameter.getName(), getValidatorFunction(undefined, type), false);
                } else {
                    setParameters.push(({ b, parameters, match }) => {
                        b.set(parameters, name, b.at(match, position));
                    });
                }
            }

            const classType =
                parameter.parameter.type.kind === ReflectionKind.class ? parameter.parameter.type.classType : undefined;
            const resolverType =
                config.resolverForParameterName?.get(parameter.getName()) || config.resolverForToken?.get(classType);

            //make sure all parameter values from the path are available, important for parameter resolver
            if (resolverType && config.pathParameterNames) fillsParametersFromPath = true;

            if (!resolverType && !parameter.isPartOfPath() && isTypeUnknown(parameter.parameter.type)) {
                const label = config.routeConfig ? getRouteActionLabel(config.routeConfig?.action) + ' ' : '';
                throw new DeepkitError(
                    'DK-H011',
                    `Parameter ${label}${JSON.stringify(name)} has no runtime type. Runtime types disabled or circular dependencies?`,
                );
            }

            if (resolverType) {
                // A parameter resolver decides the value, whatever the path said.
                requiresAsyncParameters = true;
                const resolveResolver =
                    config.module && config.module.injector
                        ? config.module.injector.getResolver(resolveReceiveType(resolverType))
                        : undefined;

                setParameters.push(({ b, parameters, injector, request, query }) => {
                    const instance = b.let(
                        resolveResolver
                            ? b.call(resolveResolver, b.get(injector, 'scope'))
                            : b.method(
                                  injector,
                                  'get',
                                  b.lit(resolverType),
                                  ...(config.module ? [b.lit(config.module)] : []),
                              ),
                        'resolver',
                    );
                    const context = b.obj({
                        token: b.lit(classType),
                        route: b.lit(config.routeConfig),
                        request,
                        name: b.lit(name),
                        value: b.get(parameters, name),
                        query,
                        parameters,
                        type: b.lit(parameter.parameter),
                    });
                    b.set(parameters, name, b.await_(b.method(instance, 'resolve', context)));
                });
            } else if (!parameter.isPartOfPath()) {
                // Neither the path nor a resolver: a provider.
                const provide = providerOf(config.module, parameter.parameter.type);
                const required = !parameter.parameter.isOptional();
                setParameters.push(({ b, parameters, injector }) => {
                    b.set(parameters, name, b.call(provide, injector));
                    if (required) {
                        b.if_(b.not(b.get(parameters, name)), () => {
                            b.throw_(
                                b.new_(
                                    DependenciesUnmetError,
                                    b.lit(`Parameter ${name} is required but provider returned undefined.`),
                                ),
                            );
                        });
                    }
                });
            }
        }
    }

    if (!setParameters.length) return undefined;
    if (enableParseBody) requiresAsyncParameters = true;
    const hasRequestParser = parameters.some(parameter => parameter.requestParser);

    return {
        async: requiresAsyncParameters,
        write(b, values, injector) {
            const validationErrors = b.let(b.emptyArr(), 'validationErrors');
            const bodyErrors = b.let(b.emptyArr(), 'bodyErrors');
            const parameters = b.let(b.emptyObj(), 'parameters');

            if (fillsParametersFromPath) {
                for (const pathName in pathParameterNames) {
                    b.set(parameters, pathName, b.at(values.match, 1 + pathParameterNames[pathName]));
                }
            }

            // The body is parsed here when a parameter IS the body; a request parser parses it
            // when the controller asks, unless that was done already.
            const bodyFields = enableParseBody
                ? b.await_(b.call(parseBody, b.lit(parseOptions), values.request, values.uploadedFiles), 'bodyFields')
                : b.lit(undefined);
            const body = hasRequestParser ? b.let(b.obj({ fields: bodyFields }), 'body') : undefined;

            const scope: LoaderScope = {
                b,
                ...values,
                injector,
                validationErrors,
                bodyErrors,
                parameters,
                bodyFields: () => bodyFields,
                body: () => body!,
            };
            for (const set of setParameters) set(scope);
            for (const validate of parameterValidators) validate(scope);

            if (throwsBodyErrors) {
                b.if_(b.len(bodyErrors), () => {
                    b.throw_(b.method(b.lit(ValidationError), 'from', bodyErrors));
                });
            }
            b.if_(b.len(validationErrors), () => {
                b.throw_(b.new_(ValidationError, validationErrors));
            });
            return b.obj({ arguments: b.arr(...parameterValues.map(value => value(scope))), parameters });
        },
    };
}

/**
 * Declare the loader a plan describes — the nested function of whatever is being declared — and
 * answer the expression that is the loader of this request.
 */
export function writeParameterLoader(b: Builder, plan: ParameterLoaderPlan | undefined, values: RequestValues): Ref {
    if (!plan) return b.lit(noParameters);
    const define = plan.async ? fnAsync : fn;
    const load = define(
        arg('request'),
        arg('match'),
        arg('query'),
        arg('headers'),
        arg('uploadedFiles'),
        arg('injector'),
        (b: Builder, request: Ref, match: Ref, query: Ref, headers: Ref, uploadedFiles: Ref, injector: Ref) =>
            plan.write(b, { request, match, query, headers, uploadedFiles }, injector),
    );
    return b.call(
        loaderOf,
        b.lit(load),
        values.request,
        values.match,
        values.query,
        values.headers,
        values.uploadedFiles,
    );
}
