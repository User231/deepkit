/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

/**
 * The graphql-js engine, re-exported.
 *
 * This package OWNS the `graphql` dependency; consumers import the engine API
 * from here and never from `graphql` directly. graphql-js enforces single-copy
 * usage with `instanceof` realm checks (a `GraphQLSchema` built by one copy is
 * rejected by another), so the only safe arrangement is one importer: every
 * schema, document and error object in a process then comes from the same
 * module instance regardless of how the consumer's resolver walks
 * node_modules.
 *
 * The `graphql` shorthand function is deliberately NOT re-exported — its name
 * belongs to this package's decorator.
 */
export {
    parse,
    print,
    visit,
    validate,
    execute,
    subscribe,
    specifiedRules,
    NoSchemaIntrospectionCustomRule,
    getOperationAST,
    Kind,
    buildASTSchema,
    buildSchema,
    printSchema,
    GraphQLError,
    GraphQLSchema,
    GraphQLObjectType,
    GraphQLScalarType,
    isObjectType,
    isInterfaceType,
    isUnionType,
    isEnumType,
    isScalarType,
    isInputObjectType,
    isListType,
    isNonNullType,
    isIntrospectionType,
    isAbstractType,
    getNamedType,
    getNullableType,
    defaultFieldResolver,
} from 'graphql';

export type {
    ASTNode,
    DocumentNode,
    OperationDefinitionNode,
    ExecutionResult,
    FragmentDefinitionNode,
    SelectionSetNode,
    GraphQLFieldResolver,
    GraphQLResolveInfo,
    GraphQLOutputType,
    GraphQLInputType,
    GraphQLField,
    GraphQLArgument,
    GraphQLNamedType,
    GraphQLAbstractType,
} from 'graphql';
