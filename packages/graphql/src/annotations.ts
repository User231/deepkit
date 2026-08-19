/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { TypeAnnotation } from '@deepkit/core';

/**
 * Marks a resolver method parameter as receiving the per-request context
 * value (the `contextValue` passed to graphql-js' `execute`), the same way
 * `HttpRequest` parameters receive the request:
 *
 * ```typescript
 * @graphql.query()
 * viewer(context: GraphQLCtx<SessionContext>): Promise<Viewer> { ... }
 * ```
 */
export type GraphQLCtx<T = unknown> = T & TypeAnnotation<'graphqlCtx'>;

/**
 * Marks a parameter of a `@graphql.field()` resolver as receiving the parent
 * object (graphql-js' `source`). The declared type is trusted, not checked —
 * what actually arrives is whatever the parent resolver returned.
 */
export type GraphQLParent<T = unknown> = T & TypeAnnotation<'graphqlParent'>;

/**
 * A GraphQL `ID` carried as a string. Purely declarative — the compatibility
 * checker treats it as `string` — but it lets a resolver's return type read
 * like the schema it satisfies.
 */
export type ID = string & TypeAnnotation<'graphqlId'>;
