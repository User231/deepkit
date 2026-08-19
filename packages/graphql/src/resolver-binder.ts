/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { GraphQLField, GraphQLObjectType, GraphQLSchema, isObjectType } from 'graphql';

import { ClassType } from '@deepkit/core';
import {
    ReflectionClass,
    ReflectionKind,
    Type,
    ValidationError,
    ValidationErrorItem,
    getSerializeFunction,
    serializer,
    typeAnnotation,
    validateFunction,
} from '@deepkit/type';

import { GraphQLFieldMetadata, getResolverMetadata } from './decorator.js';
import { checkInputCompatibility, checkOutputCompatibility } from './schema-compat.js';

/**
 * Binds decorated resolver classes onto an EXISTING GraphQLSchema — the
 * contract-first counterpart of schema generation: the schema (usually parsed
 * from checked-in SDL) stays the single source of what the API looks like,
 * and the runtime types of every resolver method are proven against it before
 * a single request runs.
 *
 * Everything is fail-closed and reported in one pass:
 *  - a resolver naming a type or field the schema does not have,
 *  - two resolvers claiming the same field,
 *  - a parameter that matches no argument of its field,
 *  - a declared return type that could produce what the schema cannot
 *    serialize (checkOutputCompatibility),
 *  - a parameter type that would reject what the schema can deliver
 *    (checkInputCompatibility).
 *
 * Arguments are deserialized and validated against the declared parameter
 * types with precompiled functions (the router's pattern); a mismatch throws
 * `ValidationError` from the resolver, for the transport layer to map.
 */
export interface BoundField {
    typeName: string;
    fieldName: string;
    group: string;
    className: string;
    methodName: string;
}

export interface BindReport {
    bound: BoundField[];
}

export interface BindOptions {
    /**
     * Additionally validate every resolver RETURN VALUE against its declared
     * type at runtime (precompiled). A violation throws — it means the
     * resolver lied about its own declaration. Costs per-call work; meant for
     * development and tests, not production hot paths.
     */
    validateResults?: boolean;
}

interface ParamPlan {
    kind: 'context' | 'parent' | 'argument';
    name: string;
    deserialize?: (value: unknown) => unknown;
    validate?: (value: unknown) => ValidationErrorItem[];
    type?: Type;
}

export function bindResolvers(schema: GraphQLSchema, instances: object[], options: BindOptions = {}): BindReport {
    const errors: string[] = [];
    const bindings: {
        instance: object;
        classType: ClassType;
        group: string;
        metadata: GraphQLFieldMetadata;
        type: GraphQLObjectType;
        field: GraphQLField<unknown, unknown>;
    }[] = [];
    const claimed = new Map<string, { group: string; className: string }>();

    // ─── Pass 1: locate every claimed field, detect collisions ───
    for (const instance of instances) {
        const classType = instance.constructor as ClassType;
        const resolverMetadata = getResolverMetadata(classType);
        if (!resolverMetadata || resolverMetadata.fields.size === 0) {
            errors.push(`${classType.name}: carries no @graphql.query()/mutation()/field() decorators.`);
            continue;
        }
        const group = resolverMetadata.group || classType.name;

        for (const metadata of resolverMetadata.fields.values()) {
            const label = `${classType.name}.${metadata.methodName}`;

            let type: GraphQLObjectType | undefined | null;
            if (metadata.kind === 'query') type = schema.getQueryType();
            else if (metadata.kind === 'mutation') type = schema.getMutationType();
            else {
                const named = schema.getType(metadata.typeName);
                if (!named) {
                    errors.push(`${label}: no type '${metadata.typeName}' in the schema.`);
                    continue;
                }
                if (!isObjectType(named)) {
                    errors.push(`${label}: '${metadata.typeName}' is not an object type — it cannot carry resolvers.`);
                    continue;
                }
                type = named;
            }
            if (!type) {
                errors.push(`${label}: the schema has no ${metadata.kind} root type.`);
                continue;
            }

            const field = type.getFields()[metadata.name];
            if (!field) {
                errors.push(`${label}: no field '${type.name}.${metadata.name}' in the schema.`);
                continue;
            }

            const key = `${type.name}.${metadata.name}`;
            const existing = claimed.get(key);
            if (existing) {
                errors.push(
                    `${key} is resolved by both '${existing.group}' (${existing.className}) ` +
                        `and '${group}' (${classType.name}).`,
                );
                continue;
            }
            claimed.set(key, { group, className: classType.name });
            bindings.push({ instance, classType, group, metadata, type, field });
        }
    }

    // Fields answered by explicit field resolvers are exempt from the
    // property-coverage requirement on returned parent objects.
    const coveredFields = new Set(
        bindings
            .filter(binding => binding.metadata.kind === 'field')
            .map(binding => `${binding.type.name}.${binding.metadata.name}`),
    );

    // ─── Pass 2: prove the runtime types against the schema ─────
    const bound: BoundField[] = [];
    for (const binding of bindings) {
        const { classType, metadata, type, field } = binding;
        const label = `${classType.name}.${metadata.methodName}`;
        const reflection = ReflectionClass.from(classType).getMethod(metadata.methodName);

        const plans: ParamPlan[] = [];
        for (const parameter of reflection.getParameters()) {
            if (typeAnnotation.getType(parameter.type, 'graphqlCtx') !== undefined) {
                plans.push({ kind: 'context', name: parameter.name });
                continue;
            }
            if (typeAnnotation.getType(parameter.type, 'graphqlParent') !== undefined) {
                if (metadata.kind !== 'field') {
                    errors.push(
                        `${label}(${parameter.name}): GraphQLParent is only available on @graphql.field() resolvers.`,
                    );
                    continue;
                }
                plans.push({ kind: 'parent', name: parameter.name });
                continue;
            }

            const argument = field.args.find(candidate => candidate.name === parameter.name);
            if (!argument) {
                const available = field.args.length
                    ? `arguments are: ${field.args.map(candidate => candidate.name).join(', ')}`
                    : 'the field takes no arguments';
                errors.push(
                    `${label}(${parameter.name}): ${type.name}.${metadata.name} has no such argument — ${available}.`,
                );
                continue;
            }

            errors.push(
                ...checkInputCompatibility(
                    parameter.type,
                    argument.type,
                    `${label}(${parameter.name})`,
                    { schema },
                    {
                        optional: parameter.isOptional(),
                        hasDefault: argument.default !== undefined,
                    },
                ),
            );
            plans.push({
                kind: 'argument',
                name: parameter.name,
                type: parameter.type,
                deserialize: getSerializeFunction(parameter.type, serializer.deserializeRegistry),
                validate: validateFunction(serializer, parameter.type),
            });
        }

        const returnType = unwrapPromise(reflection.getReturnType());
        errors.push(
            ...checkOutputCompatibility(returnType, field.type, `${label} → ${type.name}.${metadata.name}`, {
                schema,
                coveredFields,
            }),
        );

        if (errors.length) continue; // still collect every remaining problem

        attach(binding.instance, classType, metadata, field, plans, options, returnType);
        bound.push({
            typeName: type.name,
            fieldName: metadata.name,
            group: binding.group,
            className: classType.name,
            methodName: metadata.methodName,
        });
    }

    if (errors.length) {
        throw new Error(`GraphQL resolver binding failed:\n- ${errors.join('\n- ')}`);
    }

    return { bound };
}

function unwrapPromise(type: Type): Type {
    return type.kind === ReflectionKind.promise ? type.type : type;
}

function attach(
    instance: object,
    classType: ClassType,
    metadata: GraphQLFieldMetadata,
    field: GraphQLField<unknown, unknown>,
    plans: ParamPlan[],
    options: BindOptions,
    returnType: Type,
): void {
    const method = (instance as Record<string, (...args: unknown[]) => unknown>)[metadata.methodName].bind(instance);
    const validateResult = options.validateResults ? validateFunction(serializer, returnType) : undefined;
    const label = `${classType.name}.${metadata.methodName}`;

    field.resolve = (source: unknown, args: Record<string, unknown>, context: unknown) => {
        const values = plans.map(plan => {
            if (plan.kind === 'context') return context;
            if (plan.kind === 'parent') return source;
            const value = plan.deserialize!(args ? args[plan.name] : undefined);
            const failures = plan.validate!(value);
            if (failures.length)
                throw ValidationError.from(
                    failures.map(failure => ({ ...failure, path: `${plan.name}.${failure.path}`.replace(/\.$/, '') })),
                );
            return value;
        });

        const result = method(...values);
        if (!validateResult) return result;

        return Promise.resolve(result).then(resolved => {
            const failures = validateResult(resolved);
            if (failures.length) {
                throw new Error(
                    `${label} returned a value violating its declared type: ` +
                        failures.map(failure => `${failure.path}: ${failure.message}`).join(', '),
                );
            }
            return resolved;
        });
    };
}
