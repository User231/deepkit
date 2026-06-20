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
import { QueryCustomFields, QueryFieldNames, convertQueryFilter } from '@deepkit/orm';
import { ReflectionClass, ReflectionKind, Type, deserialize, isMongoIdType, resolvePath, serialize, serializer } from '@deepkit/type';

import './mongo-serializer';
import { mongoSerializer } from './mongo-serializer.js';
import { FilterQuery } from './query.model.js';

/**
 * `resolvePath` returns the {@link TypeProperty}/{@link TypePropertySignature} at a path, but
 * `serialize`/`deserialize` need the property's *value* type — the new (v2) serializer passes a
 * bare `property` kind through unchanged, so a `MongoId`/`UUID` filter value would never reach its
 * decorator and would be sent as a plain string (no match). Unwrap to the inner value type.
 */
function resolveValueType(path: string, type: Type): Type {
    const resolved = resolvePath(path, type);
    return resolved.kind === ReflectionKind.property || resolved.kind === ReflectionKind.propertySignature
        ? resolved.type
        : resolved;
}

export function convertClassQueryToMongo<T, K extends keyof T, Q extends FilterQuery<T>>(
    classType: ReflectionClass<T> | ClassType,
    query: Q,
    fieldNamesMap: QueryFieldNames = {},
    customMapping: {
        [name: string]: (name: string, value: any, fieldNamesMap: { [name: string]: boolean }) => any;
    } = {},
): Q {
    const schema = ReflectionClass.from(classType);
    return convertQueryFilter(
        schema,
        query,
        (convertClassType: ReflectionClass<any>, path: string, value: any) => {
            // An explicit undefined/null filter value means "IS NULL" (e.g. soft-delete's
            // {deletedAt: undefined}); emit null directly. Passing undefined to serialize either
            // throws for object-typed fields or yields undefined that BSON drops (losing the clause).
            if (value === undefined || value === null) return null;
            const type = resolveValueType(path, schema.type);
            // An empty MongoId string is the unassigned sentinel, not a valid 24-char ObjectId;
            // filtering by it must match nothing (IS NULL) rather than crash the BSON ObjectId writer.
            if (value === '' && isMongoIdType(type)) return null;
            return serialize(value, undefined, mongoSerializer, undefined, type);
        },
        fieldNamesMap,
        customMapping,
    );
}

export function convertPlainQueryToMongo<T, K extends keyof T>(
    classType: ClassType<T>,
    target: FilterQuery<T>,
    fieldNamesMap: QueryFieldNames = {},
    customMapping: QueryCustomFields = {},
): { [path: string]: any } {
    return convertQueryFilter(
        classType,
        target,
        (convertClassType: ReflectionClass<any>, path: string, value: any) => {
            // See convertClassQueryToMongo: an explicit undefined/null means "IS NULL".
            if (value === undefined || value === null) return null;
            const type = resolveValueType(path, convertClassType.type);
            if (value === '' && isMongoIdType(type)) return null;
            const classValue = deserialize(value, undefined, serializer, undefined, type);
            return serialize(classValue, undefined, mongoSerializer, undefined, type);
        },
        fieldNamesMap,
        customMapping,
    );
}
