/**
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { BenchSuite } from '@deepkit/bench';
import { Maximum, Negative, guard } from '@deepkit/type';

/**
 * Validation benchmark - compares Deepkit type validation performance
 *
 * This benchmark tests validation of a typical data structure with:
 * - Primitive types (number, boolean, string)
 * - Constraint validators (Negative, Maximum)
 * - Arrays
 * - Nested objects
 */

// Test data model using Deepkit's type-based validation
interface Model {
    number: number;
    negNumber: number & Negative;
    maxNumber: number & Maximum<500>;
    strings: string[];
    longString: string;
    boolean: boolean;
    deeplyNested: {
        foo: string;
        num: number;
        bool: boolean;
    };
}

// Sample valid data for benchmarking
const validData = {
    number: 1,
    negNumber: -1,
    maxNumber: 200,
    strings: ['a', 'b', 'c'],
    longString:
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Vivendum intellegat et qui, ei denique consequuntur vix. Semper aeterno percipit ut his, sea ex utinam referrentur repudiandae. No epicuri hendrerit consetetur sit, sit dicta adipiscing ex, in facete detracto deterruisset duo. Quot populo ad qui. Sit fugit nostrum et. Ad per diam dicant interesset, lorem iusto sensibus ut sed. No dicam aperiam vis. Pri posse graeco definitiones cu, id eam populo quaestio adipiscing, usu quod malorum te. Ex nam agam veri, dicunt efficiantur ad qui, ad legere adversarium sit. Commune platonem mel id, brute adipiscing duo an. Vivendum intellegat et qui, ei denique consequuntur vix. Offendit eleifend moderatius ex vix, quem odio mazim et qui, purto expetendis cotidieque quo cu, veri persius vituperata ei nec. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
    boolean: true,
    deeplyNested: {
        foo: 'bar',
        num: 1,
        bool: false,
    },
};

// Sample invalid data for benchmarking invalid case
const invalidData = {
    ...validData,
    negNumber: 100, // Should be negative
};

export default async function () {
    const suite = new BenchSuite('type/validation');

    // Pre-compile the guard function
    const validate = guard<Model>();

    // Sanity checks
    if (!validate(validData)) {
        throw new Error('Valid data should pass validation');
    }
    if (validate(invalidData)) {
        throw new Error('Invalid data should fail validation');
    }

    // Benchmark: Validate valid data (common case)
    suite.add('deepkit validate (valid)', () => {
        validate(validData);
    });

    // Benchmark: Validate invalid data (error path)
    suite.add('deepkit validate (invalid)', () => {
        validate(invalidData);
    });

    return suite;
}
