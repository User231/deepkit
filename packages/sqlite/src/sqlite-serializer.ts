/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { SqlSerializer, isDirectEntityColumn } from '@deepkit/sql';
import { ReflectionKind } from '@deepkit/type';

class SQLiteSerializer extends SqlSerializer {
    name = 'sqlite';

    protected override registerSerializers() {
        super.registerSerializers();

        // SQLite has no native date type — store dates as ISO strings.
        this.serializeRegistry.replaceClass(Date, (type, input, b) =>
            b.ternary(
                b.isNullish(input),
                input,
                b.call((d: Date) => d.toJSON(), input),
            ),
        );

        // SQLite has no boolean type — store direct entity columns as 0/1.
        this.serializeRegistry.append(ReflectionKind.boolean, (type, input, b, ctx) => {
            if (!isDirectEntityColumn(ctx)) return input;
            return b.ternary(input, b.lit(1), b.lit(0));
        });
    }
}

export const sqliteSerializer = new SQLiteSerializer();
