/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { ClassType } from '@deepkit/core';
import {
    ClassDecoratorResult,
    PropertyDecoratorResult,
    createClassDecoratorContext,
    createPropertyDecoratorContext,
    mergeDecorator,
} from '@deepkit/type';

/**
 * What a single `@graphql.query()/mutation()/field()` decoration recorded:
 * which schema field the method claims to resolve.
 */
export class GraphQLFieldMetadata {
    methodName!: string;
    classType!: ClassType;

    kind: 'query' | 'mutation' | 'field' = 'query';

    /** The schema field name. Defaults to the method name. */
    name: string = '';

    /**
     * For `kind: 'field'`: the object type carrying the field. For roots it is
     * resolved from the schema (`schema.getQueryType()` etc.) at bind time —
     * the schema, not the decorator, knows what the root types are called.
     */
    typeName: string = '';
}

export class GraphQLResolverMetadata {
    classType?: ClassType;

    /**
     * Free-form label for the contributing unit (a module, a domain, a legacy
     * lib) — carried through to the bind report and collision errors so "who
     * answers this field?" has an answer better than a class name.
     */
    group: string = '';

    fields = new Map<string, GraphQLFieldMetadata>();
}

class GraphQLClassApi {
    t = new GraphQLResolverMetadata();

    resolver(group: string = '') {
        this.t.group = group;
    }

    addField(methodName: string, field: GraphQLFieldMetadata) {
        this.t.fields.set(methodName, field);
    }

    onDecorator(classType: ClassType) {
        this.t.classType = classType;
    }
}

export const graphqlClass: ClassDecoratorResult<typeof GraphQLClassApi> = createClassDecoratorContext(GraphQLClassApi);

class GraphQLPropertyApi {
    t = new GraphQLFieldMetadata();

    onDecorator(classType: ClassType, property: string | undefined) {
        if (!property) return;
        this.t.methodName = property;
        this.t.classType = classType;
        if (!this.t.name) this.t.name = property;
        graphqlClass.addField(property, this.t)(classType);
    }

    /** Resolves a field on the schema's query root type. */
    query(name?: string) {
        this.t.kind = 'query';
        if (name) this.t.name = name;
    }

    /** Resolves a field on the schema's mutation root type. */
    mutation(name?: string) {
        this.t.kind = 'mutation';
        if (name) this.t.name = name;
    }

    /**
     * Resolves a field on an arbitrary object type — the GraphQL counterpart
     * of a computed property. The parent value is received via a
     * {@link GraphQLParent} parameter.
     */
    field(typeName: string, name?: string) {
        this.t.kind = 'field';
        this.t.typeName = typeName;
        if (name) this.t.name = name;
    }
}

export const graphqlProperty: PropertyDecoratorResult<typeof GraphQLPropertyApi> =
    createPropertyDecoratorContext(GraphQLPropertyApi);

export const graphql: typeof graphqlClass & typeof graphqlProperty = mergeDecorator(
    graphqlClass,
    graphqlProperty,
) as any;

/**
 * The recorded metadata for a resolver class, inherited members included —
 * `undefined` when the class carries no `@graphql` decorators at all.
 */
export function getResolverMetadata<T>(classType: ClassType<T>): GraphQLResolverMetadata | undefined {
    const parent = Object.getPrototypeOf(classType);
    const parentMetadata = parent ? getResolverMetadata(parent) : undefined;

    const data = graphqlClass._fetch(classType);
    if (!data) return parentMetadata;

    if (!parentMetadata) return data;

    const merged = new GraphQLResolverMetadata();
    merged.classType = data.classType ?? parentMetadata.classType;
    merged.group = data.group || parentMetadata.group;
    merged.fields = new Map([...parentMetadata.fields, ...data.fields]);
    return merged;
}
