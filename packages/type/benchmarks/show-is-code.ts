/**
 * Show generated code for is<T> type guard
 */
import { typeOf } from '../src/reflection/reflection.js';
import { createTypeGuardFunction, serializer } from '../src/serializer/index.js';
import { getValidatorFunction } from '../src/typeguard.js';

interface ToBeChecked {
    number: number;
    negNumber: number;
    maxNumber: number;
    string: string;
    longString: string;
    boolean: boolean;
    deeplyNested: {
        foo: string;
        num: number;
        bool: boolean;
    };
}

const type = typeOf<ToBeChecked>();

console.log('=== Strict validator (getValidatorFunction) ===\n');
const strictValidator = getValidatorFunction<ToBeChecked>();
console.log(strictValidator.toString());

console.log('\n=== Loose validator (createTypeGuardFunction with loose=true) ===\n');
const looseValidator = createTypeGuardFunction(type, serializer, true);
console.log(looseValidator.toString());
