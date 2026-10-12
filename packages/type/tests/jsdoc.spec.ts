import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { ReflectionClass, ReflectionFunction, ReflectionMethod, typeOf } from '../src/reflection/reflection.js';
import { TypeEnum } from '../src/reflection/type.js';

test('description available on Interface and Type alias', () => {
    /** @description user interface */
    interface IUser {
        username: string;
    }

    /** @description user type declaration */
    type IUser2 = {
        username: string;
    };

    const reflectTypeInterface = ReflectionClass.from(typeOf<IUser>());
    expect(reflectTypeInterface.description).toEqual('user interface');
    expect(reflectTypeInterface.type.description).toEqual('user interface');

    const reflectTypeObjectLiteral = ReflectionClass.from(typeOf<IUser2>());
    expect(reflectTypeObjectLiteral.description).toEqual('user type declaration');
    expect(reflectTypeObjectLiteral.type.description).toEqual('user type declaration');
});

test('description available on ReflectionClass', () => {
    class MyDate {}

    /** @description user class */
    class User {
        myDate?: MyDate;
        created: Date = new Date();
    }
    const reflection = ReflectionClass.from(typeOf<User>());
    expect(reflection.description).toEqual('user class');
});

test('description available on ReflectionFunction and ReflectionMethod', () => {
    class MyDate {}
    /** @description user class */
    class User {
        myDate?: MyDate;
        created: Date = new Date();
    }
    /** @description getUser function */
    function getUser(): User {
        return new User();
    }

    class FunctionContainer {
        /** @description getUser member */
        getUser(): User {
            return new User();
        }
    }

    const reflectionFunction = ReflectionFunction.from(getUser);
    expect(reflectionFunction.getDescription()).toEqual('getUser function');

    const fc = new FunctionContainer();
    const reflection = ReflectionClass.from(typeOf<FunctionContainer>());
    const method: ReflectionMethod = reflection.getMethod('getUser');
    expect(method.description).toEqual('getUser member');
});

test('description available on TypeEnum', () => {
    /** @description results enum */
    enum RESULTS {
        SUCCESS = 'success',
        FAILURE = 'failure',
    }
    const type = typeOf<RESULTS>() as TypeEnum;
    expect(type.description).toEqual('results enum');
});

test('a doc comment without @description is the description', () => {
    /**
     * The person who signed in.
     *
     * Spans two paragraphs; tags end it.
     * @deprecated use Account
     */
    interface IUser {
        /** The handle shown in the UI. */
        username: string;
        // a line comment is not documentation
        age: number;
        /* nor is a plain block comment */
        email: string;
        /** @description explicit wins */
        role: string;
    }

    const reflection = ReflectionClass.from(typeOf<IUser>());
    expect(reflection.description).toEqual('The person who signed in.\n\nSpans two paragraphs; tags end it.');
    expect(reflection.getProperty('username').getDescription()).toEqual('The handle shown in the UI.');
    expect(reflection.getProperty('age').getDescription()).toEqual('');
    expect(reflection.getProperty('email').getDescription()).toEqual('');
    expect(reflection.getProperty('role').getDescription()).toEqual('explicit wins');

    /** Order a shop can place. */
    type Order = {
        /** ISO currency code */
        currency: string;
        items: number;
    };
    const order = ReflectionClass.from(typeOf<Order>());
    expect(order.description).toEqual('Order a shop can place.');
    expect(order.getProperty('currency').getDescription()).toEqual('ISO currency code');

    /** Summarises a user. */
    class Summary {
        /** Count of items. */
        count: number = 0;
        /** Describe it. */
        describe(/** the locale */ locale: string): string {
            return locale;
        }
    }
    const summary = ReflectionClass.from(typeOf<Summary>());
    expect(summary.description).toEqual('Summarises a user.');
    expect(summary.getProperty('count').getDescription()).toEqual('Count of items.');
    expect(summary.getMethod('describe').getDescription()).toEqual('Describe it.');
    expect(summary.getMethod('describe').getParameter('locale').parameter.description).toEqual('the locale');
});
