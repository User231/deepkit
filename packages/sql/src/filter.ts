/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { FilterQuery, convertQueryFilter } from '@deepkit/orm';
import { ReflectionClass, Serializer, getPartialSerializeFunction, resolvePath, serialize } from '@deepkit/type';

import { SqlError } from './error.js';

export function getSqlFilter<T>(
    classSchema: ReflectionClass<any>,
    filter: FilterQuery<T>,
    parameters: { [name: string]: any } = {},
    serializer: Serializer,
): any {
    // A filter value targets a *direct entity column*, so it must serialize exactly like the column
    // does on insert (e.g. UUID → binary Buffer, boolean → 0/1). The SQL serializer keys that special
    // handling off `treeDepth === 1`, which only holds for a property of the entity — serializing a
    // bare scalar via `serialize(value, …, propertyType)` runs at the root (`treeDepth === 0`) and so
    // skips it. Serialize the value as `{ [column]: value }` through the entity's partial serializer
    // (used by the insert path too) so the column reaches depth 1. Deep/JSON paths (a dotted `path`)
    // address nested values *inside* a JSON column and keep the root serialization.
    const partialSerialize = getPartialSerializeFunction(classSchema.type, serializer.serializeRegistry);

    return convertQueryFilter(
        classSchema.getClassType(),
        filter || {},
        (convertClass: ReflectionClass<any>, path: string, value: any) => {
            // Preserve explicit null/undefined verbatim — those become `IS NULL` conditions and must
            // not be coerced (the partial serializer would drop the key for an optional property).
            if (value !== null && value !== undefined && !path.includes('.') && classSchema.hasProperty(path)) {
                return partialSerialize({ [path]: value })[path];
            }
            return serialize(value, undefined, serializer, undefined, resolvePath(path, classSchema.type));
        },
        {},
        {
            $parameter: (name, value) => {
                if (undefined === parameters[value]) {
                    throw new SqlError(
                        'DK-SQL011',
                        `Parameter ${value} not defined in ${classSchema.getClassName()} query.`,
                    );
                }
                return parameters[value];
            },
        },
    );
}
