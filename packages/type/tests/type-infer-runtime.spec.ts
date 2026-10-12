import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { typeInfer } from '../src/reflection/processor.js';
import { ReflectionClass, typeOf } from '../src/reflection/reflection.js';
import { InlineRuntimeType, ReflectionKind, Type, TypeLiteral, TypeObjectLiteral, TypePropertySignature, stringifyResolvedType, typeDecorators, widenLiteral } from '../src/reflection/type.js';
import { serialize } from '../src/serializer-facade.js';
import { Entity, Maximum, MinLength, Reference, Unique, entityAnnotation, float } from '../src/type-annotations.js';
import { validate } from '../src/validator.js';
import { IMPORTED_IDS } from './fixtures/as-const-ids.js';
import { expectEqualType } from './utils.js';

const symbol = Symbol();

test('primitives', () => {
    expectEqualType(typeInfer('asd'), { kind: ReflectionKind.literal, literal: 'asd' } as Type);
    expectEqualType(typeInfer(23), { kind: ReflectionKind.literal, literal: 23 } as Type);
    expectEqualType(typeInfer(true), { kind: ReflectionKind.literal, literal: true } as Type);
    expectEqualType(typeInfer(false), { kind: ReflectionKind.literal, literal: false } as Type);
    expectEqualType(typeInfer(12n), { kind: ReflectionKind.literal, literal: 12n } as Type);
    expectEqualType(typeInfer(symbol), { kind: ReflectionKind.literal, literal: symbol } as Type);
});

test('widen literal', () => {
    expectEqualType(widenLiteral(typeInfer('asd') as TypeLiteral), { kind: ReflectionKind.string }, { noOrigin: true });
    expectEqualType(widenLiteral(typeInfer(23) as TypeLiteral), { kind: ReflectionKind.number }, { noOrigin: true });
    expectEqualType(widenLiteral(typeInfer(true) as TypeLiteral), { kind: ReflectionKind.boolean }, { noOrigin: true });
    expectEqualType(widenLiteral(typeInfer(false) as TypeLiteral), { kind: ReflectionKind.boolean }, { noOrigin: true });
    expectEqualType(widenLiteral(typeInfer(12n) as TypeLiteral), { kind: ReflectionKind.bigint }, { noOrigin: true });
    expectEqualType(widenLiteral(typeInfer(symbol) as TypeLiteral), { kind: ReflectionKind.symbol }, { noOrigin: true });
});

test('container', () => {
    expectEqualType(typeInfer([123, 'abc', 'bcd']), typeOf<(number | string)[]>() as any, { noOrigin: true });
    expectEqualType(typeInfer(new Set()), typeOf<Set<any>>(), { noOrigin: true });
    expectEqualType(typeInfer(new Map()), typeOf<Map<any, any>>(), { noOrigin: true });
    expectEqualType(typeInfer(new Set(['a', 32])), typeOf<Set<string | number>>() as any, { noOrigin: true });
    expectEqualType(
        typeInfer(
            new Map([
                [1, 'hello'],
                [3, 'yes'],
            ]),
        ),
        typeOf<Map<number, string>>() as any,
        { noOrigin: true },
    );
});

test('container widening is permanent: (typeof arr)[number] never resurrects a literal', () => {
    // Regression: the container-widened element type kept its literal `origin`, and the
    // end-of-program narrowOriginalLiteral() — which exists for the DIRECT scalar case
    // (`const x = 'a'; typeof x` => 'a') — un-widened the program RESULT whenever a later op
    // (index access) made the element type the result: `(typeof IDS)[number]` resolved to the
    // FIRST literal 'google', and serializing any sibling value silently rewrote it.
    // A mutable array (no `as const`) is `string[]` in TypeScript too, so its element is string.
    const IDS = ['google', 'github', 'microsoft'];
    type K = (typeof IDS)[number];
    const k = typeOf<K>();
    expect(k.kind).toBe(ReflectionKind.string);
    expect((k as any).literal).toBe(undefined);

    // The widened element type itself carries no origin.
    const arr = typeInfer(['google', 'github', 'microsoft']);
    expect(arr.kind).toBe(ReflectionKind.array);
    expect((arr as any).type.kind).toBe(ReflectionKind.string);
    expect((arr as any).type.origin).toBe(undefined);

    // Wire shape: values must round-trip untouched through the indexed type.
    interface View {
        oauth: K[];
    }
    expect(serialize<View>({ oauth: ['google', 'github'] })).toEqual({ oauth: ['google', 'github'] });

    // The direct scalar behavior is unchanged: typeof a const string is its literal.
    const s = 'a';
    const st = typeOf<typeof s>();
    expect(st.kind).toBe(ReflectionKind.literal);
    expect((st as TypeLiteral).literal).toBe('a');
});

test('typeof an `as const` array is the readonly tuple of its literals, read at compile time', () => {
    // The runtime value cannot carry the assertion, so the compiler reads the initializer:
    // `(typeof IDS)[number]` is the literal union TypeScript gives it, and validates as one.
    const IDS = ['google', 'github', 'microsoft'] as const;
    type K = (typeof IDS)[number];

    const tuple = typeOf<typeof IDS>();
    expect(tuple.kind).toBe(ReflectionKind.tuple);
    expect((tuple as any).readonly).toBe(true);
    expect(stringifyResolvedType(tuple)).toBe(`['google', 'github', 'microsoft']`); // stringify prints no readonly on tuples

    const k = typeOf<K>();
    expect(k.kind).toBe(ReflectionKind.union);
    expect(stringifyResolvedType(k)).toBe(`'google' | 'github' | 'microsoft'`);

    interface View {
        oauth: K[];
    }
    expect(serialize<View>({ oauth: ['google', 'github'] })).toEqual({ oauth: ['google', 'github'] });
    expect(validate<View>({ oauth: ['google'] })).toEqual([]);
    expect(validate<View>({ oauth: ['gitlab'] }).length).toBe(1);

    // The assertion is seen through parentheses and `satisfies`.
    const WRAPPED = ['a', 'b'] as const satisfies readonly string[];
    expect(stringifyResolvedType(typeOf<(typeof WRAPPED)[number]>())).toBe(`'a' | 'b'`);

    // Every literal kind, nested, and an object literal with readonly members.
    const MIXED = { name: 'x', count: 3, neg: -1, on: true, none: null, big: 1n, list: ['p', 2] } as const;
    const mixed = typeOf<typeof MIXED>() as TypeObjectLiteral;
    expect(mixed.kind).toBe(ReflectionKind.objectLiteral);
    const names = mixed.types.map(v => (v as TypePropertySignature).name);
    expect(names).toEqual(['name', 'count', 'neg', 'on', 'none', 'big', 'list']);
    expect(mixed.types.every(v => (v as TypePropertySignature).readonly === true)).toBe(true);
    expect(stringifyResolvedType(typeOf<(typeof MIXED)['name']>())).toBe(`'x'`);
    expect(stringifyResolvedType(typeOf<(typeof MIXED)['neg']>())).toBe(`-1`);
    expect(stringifyResolvedType(typeOf<(typeof MIXED)['none']>())).toBe(`null`);
    expect(stringifyResolvedType(typeOf<(typeof MIXED)['list']>())).toBe(`['p', 2]`);
    expect((typeOf<(typeof MIXED)['list']>() as any).readonly).toBe(true);
    expect(stringifyResolvedType(typeOf<keyof typeof MIXED>())).toBe(`'name' | 'count' | 'neg' | 'on' | 'none' | 'big' | 'list'`);

    // Not fully literal: a reference or a call keeps the runtime inference (no widening of the
    // whole into `never`), so the element stays string as before.
    const other = 'z';
    const WITH_REF = ['a', other] as const;
    expect(typeOf<(typeof WITH_REF)[number]>().kind).toBe(ReflectionKind.string);
    const FROM_CALL = ['a', 'b'].map(v => v) as unknown as readonly ['a', 'b'];
    expect(typeOf<(typeof FROM_CALL)[number]>().kind).toBe(ReflectionKind.string);
});

test('typeof an imported `as const` array reflects its literals', () => {
    type K = (typeof IMPORTED_IDS)[number];
    expect(stringifyResolvedType(typeOf<K>())).toBe(`'alpha' | 'beta'`);
    expect(validate<{ id: K }>({ id: 'gamma' }).length).toBe(1);
});

test('class', () => {
    class User {}

    expectEqualType(typeInfer(new User()), typeOf<User>());
    expectEqualType(typeInfer(new Date('')), typeOf<Date>());
});

test('object', () => {
    expectEqualType(typeInfer({ a: 'hello' }), typeOf<{ a: string }>() as any, { noOrigin: true });
    expectEqualType(typeInfer({ a: 123 }), typeOf<{ a: number }>() as any, { noOrigin: true });
    expectEqualType(typeInfer({ a: true }), typeOf<{ a: boolean }>() as any, { noOrigin: true });
    expectEqualType(typeInfer({ a: 12n }), typeOf<{ a: bigint }>() as any, { noOrigin: true });
    expectEqualType(typeInfer({ a: symbol }), typeOf<{ a: symbol }>() as any, { noOrigin: true });
    expectEqualType(typeInfer({ a: new Date() }), typeOf<{ a: Date }>() as any, { noOrigin: true });
    expectEqualType(typeInfer({ a: (b: string): void => undefined }), typeOf<{ a(b: string): void }>() as any, { noOrigin: true });
    expectEqualType(
        typeInfer({
            a(b: string): void {},
        }),
        typeOf<{ a(b: string): void }>() as any,
        { noOrigin: true },
    );
});

test('function', () => {
    expectEqualType(
        typeInfer((a: string): void => undefined),
        typeOf<(a: string) => void>() as any,
        { excludes: ['function'] },
    );
    expectEqualType(
        typeInfer((a: string, b: number): void => undefined),
        typeOf<(a: string, b: number) => void>() as any,
        { excludes: ['function'] },
    );
});

test('dynamic type definition for schema definition', () => {
    const schemas = [
        {
            name: 'User',
            tableName: 'users',
            properties: [{ name: 'username', type: 'string', unique: true, minLength: 6 }],
        },
        {
            name: 'Fiction',
            tableName: 'fictions',
            properties: [
                { name: 'title', type: 'string', minLength: 2 },
                { name: 'price', type: 'float', required: true, max: 999 },
                { name: 'author', type: 'reference', refClassName: 'User' },
            ],
        },
    ];

    //first create TypeObjectLiteral, so we can point to them via references
    const types: { [name: string]: TypeObjectLiteral } = {};
    for (const schema of schemas) {
        const type = (types[schema.name] = { kind: ReflectionKind.objectLiteral, id: 0, types: [] } as TypeObjectLiteral);
        type.typeName = schema.name;
        //@entity decorator / Entity<> type
        entityAnnotation.registerType(type, { name: schema.name, collection: schema.tableName });
    }

    //now populate all the information we have
    for (const schema of schemas) {
        const type = types[schema.name];
        for (const prop of schema.properties) {
            type.types.push(makeProperty(type, prop));
        }
    }

    for (const [name, schema] of Object.entries(types)) {
        // console.log(stringifyResolvedType(schema));
        // console.log(util.inspect(schema, false, null, true));
    }

    expect(validate({ username: '123' }, types['User'])).toEqual([{ path: 'username', code: 'minLength', message: 'Min length is 6', value: '123' }]);

    const userReflection = ReflectionClass.from(types['User']);
    expect(entityAnnotation.getFirst(types['User'])?.collection).toBe('users');
    expect(userReflection.getClassName()).toBe('User');
    expect(userReflection.getCollectionName()).toBe('users');

    function makeProperty(parent: TypeObjectLiteral, prop: { name: string; type: string; minLength?: number; max?: number; required?: boolean; refClassName?: string; unique?: boolean }): TypePropertySignature {
        let type: Type = { kind: ReflectionKind.unknown };

        switch (prop.type) {
            case 'string': {
                type = typeOf<string>();
                break;
            }
            case 'float': {
                type = typeOf<float>();
                break;
            }
            case 'reference': {
                if (!prop.refClassName) throw new Error(`Property ${prop.name} is reference but no refClassName defined`);
                const ref: Type = types[prop.refClassName];
                type = { ...typeOf<InlineRuntimeType<typeof ref>>() }; //we want a copy
                break;
            }
            default:
                throw new Error(`Type ${prop.type} not supported`);
        }

        type.decorators = [];
        type.annotations = {};
        if (prop.max) type.decorators.push(typeOf<Maximum<typeof prop.max>>());
        if (prop.minLength) type.decorators.push(typeOf<MinLength<typeof prop.minLength>>());
        if (prop.unique) type.decorators.push(typeOf<Unique>());
        if (prop.refClassName) type.decorators.push(typeOf<Reference>());

        for (const decorator of type.decorators) {
            for (const decoratorHandler of typeDecorators) decoratorHandler(type.annotations, decorator as TypeObjectLiteral);
        }

        const property: TypePropertySignature = { kind: ReflectionKind.propertySignature, name: prop.name, type, parent };
        if (!prop.required) property.optional = true;

        return property;
    }
});

test('dynamic types validation', () => {
    const type = typeOf<string>();

    type.decorators = [];
    type.annotations = {};
    type.decorators.push(typeOf<MinLength<6>>());

    for (const decorator of type.decorators) {
        for (const decoratorHandler of typeDecorators) decoratorHandler(type.annotations, decorator as TypeObjectLiteral);
    }

    expect(validate('asd', type)).toEqual([{ path: '', code: 'minLength', message: 'Min length is 6', value: 'asd' }]);
});
