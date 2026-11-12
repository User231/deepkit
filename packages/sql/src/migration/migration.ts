/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

export interface Migration {
    databaseName: string;
    version: number;
    name?: string;

    up(): string[];

    down(): string[];
}

/**
 * The migrations the ledger does not hold, in version order.
 *
 * Pending is a SET DIFFERENCE against the applied versions, never "newer than
 * the latest applied": a migration written on a branch carries the timestamp of
 * the day it was written, so it can merge BELOW a version another branch already
 * shipped. Comparing against the latest version alone skips it forever on every
 * database that is past it, and nothing says so.
 */
export function unappliedMigrations<T extends Migration>(
    migrations: readonly T[],
    appliedVersions: Iterable<number>,
): T[] {
    const applied = new Set(appliedVersions);
    return migrations.filter(migration => !applied.has(migration.version)).sort((a, b) => a.version - b.version);
}
