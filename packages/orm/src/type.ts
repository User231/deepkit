/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { DeepkitError } from '@deepkit/core';
import { Changes, PrimaryKeyFields, PrimaryKeyType, ReflectionClass, ValidationErrorItem } from '@deepkit/type';

import { DatabasePersistenceChangeSet } from './database-adapter.js';
import { DatabaseQueryModel } from './query.js';

export interface OrmEntity {}

export type PatchResult<T> = {
    modified: number;
    returning: { [name in keyof T & string]?: T[name][] };
    primaryKeys: PrimaryKeyType<T>[];
};
export type DeleteResult<T> = { modified: number; primaryKeys: PrimaryKeyFields<T>[] };

export class DatabaseError extends DeepkitError {
    constructor(code: string, message: string, options?: { cause?: Error }) {
        super(code, message, options);
    }
}

/**
 * Wraps whatever error into a DatabaseError, if it's not already a DatabaseError.
 */
export function ensureDatabaseError(error: Error | string): Error {
    if ('string' === typeof error) return new DatabaseError('DK-O001', error);
    if (error instanceof DatabaseError) return error;

    return new DatabaseError('DK-O001', error.message, { cause: error });
}

/**
 * Appends the reason a wrapper error is hiding. The write wrappers below carry a generic
 * message ("Could not upsert X into database") and keep the driver's own words on `cause` —
 * but `${error}` and `error.message`, which is how logs, retry lines and health endpoints
 * render an error, never walk a cause chain. So the reason belongs IN the message: the
 * cause's first line (a nested DeepkitError puts its code/docs block on later lines),
 * appended once, and skipped when the wrapper already restates it.
 */
function withCause(message: string, cause?: Error): string {
    const reason = cause?.message?.split('\n')[0].trim();
    return !reason || message.includes(reason) ? message : `${message}: ${reason}`;
}

export class DatabaseInsertError extends DatabaseError {
    constructor(
        public readonly entity: ReflectionClass<any>,
        public readonly items: OrmEntity[],
        message: string,
        options?: { cause?: Error },
    ) {
        super('DK-O010', withCause(message, options?.cause), options);
    }
}

export class DatabaseUpdateError extends DatabaseError {
    constructor(
        public readonly entity: ReflectionClass<any>,
        public readonly changeSets: DatabasePersistenceChangeSet<any>[],
        message: string,
        options?: { cause?: Error },
    ) {
        super('DK-O011', withCause(message, options?.cause), options);
    }
}

export class DatabasePatchError extends DatabaseError {
    constructor(
        public readonly entity: ReflectionClass<any>,
        public readonly query: DatabaseQueryModel<any>,
        public readonly changeSets: Changes<any>,
        message: string,
        options?: { cause?: Error },
    ) {
        super('DK-O012', withCause(message, options?.cause), options);
    }
}

export class DatabaseDeleteError extends DatabaseError {
    public readonly query?: DatabaseQueryModel<any>;
    public readonly items?: OrmEntity[];

    constructor(
        public readonly entity: ReflectionClass<any>,
        message: string,
        options?: { cause?: Error },
    ) {
        super('DK-O013', withCause(message, options?.cause), options);
    }
}

export class DatabaseValidationError extends DatabaseError {
    constructor(
        public readonly classSchema: ReflectionClass<any>,
        public readonly errors: ValidationErrorItem[],
    ) {
        super(
            'DK-O020',
            `Validation error for class ${classSchema.name || classSchema.getClassName()}:\n${errors.map(v => v.toString()).join(',\n')}`,
        );
    }
}

export class UniqueConstraintFailure extends DatabaseError {
    constructor(message: string, options?: { cause?: Error }) {
        super('DK-O100', message, options);
    }
}
