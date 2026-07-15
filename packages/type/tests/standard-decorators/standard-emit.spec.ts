import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { typeSettings } from '../../src/core.js';
import { entity, t } from '../../src/decorator.js';
import { ReflectionClass } from '../../src/reflection/reflection.js';
import { ValidatorError, validate } from '../../src/validator.js';

/**
 * This directory's tsconfig.json disables experimentalDecorators, so these files genuinely
 * compile as standard (TC39) decorators — real emit, not hand-invoked ABI (that's
 * ../decorator-builder-standard.spec.ts). The rest of the repo stays legacy.
 */

test('@entity class decorator under standard emit', () => {
    @entity.name('standardDecEntity')
    class Product {
        title: string = '';
    }

    //class decorators run eagerly in both modes: registered at definition time.
    expect(typeSettings.registeredEntities['standardDecEntity']).toBe(Product);

    const reflection = ReflectionClass.from(Product);
    expect(reflection.name).toBe('standardDecEntity');
});

test('member @t.validator under standard emit (deferred, drained by reflection)', () => {
    class Email {
        constructor(public email: string) {}

        @t.validator
        validator(): ValidatorError | void {
            if (this.email === '') return new ValidatorError('email', 'Invalid email');
        }
    }

    const reflection = ReflectionClass.from(Email);
    expect(reflection.validationMethod).toBe('validator');

    const emptyEmail = new Email('');
    expect(validate<Email>(emptyEmail)).toEqual([{ path: '', code: 'email', message: 'Invalid email', value: emptyEmail }]);
    expect(validate<Email>(new Email('asd'))).toEqual([]);
});

test('@(entity.name().collection()) fluent chain under standard emit', () => {
    @(entity.name('standardDecChained').collection('standard_dec_chained'))
    class Row {
        id: number = 0;
    }

    const reflection = ReflectionClass.from(Row);
    expect(reflection.name).toBe('standardDecChained');
    expect(reflection.collectionName).toBe('standard_dec_chained');
});
