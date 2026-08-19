import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { typeOf } from '@deepkit/type';

import { buildSchema } from '../src/engine.js';
import { checkInputCompatibility, checkOutputCompatibility } from '../src/schema-compat.js';

const schema = buildSchema(`
    type Query { viewer: Viewer, users: [User!]! }
    type Viewer {
        id: ID!
        name: String!
        age: Int
        role: Role!
        organization: Organization
    }
    type Organization { id: ID!, title: String!, members: [User!]! }
    interface User { id: ID! }
    type CurrentUser implements User { id: ID!, email: String! }
    type FormerUser implements User { id: ID! }
    enum Role { ADMIN, MEMBER }
    input Filter { text: String, limit: Int! = 10, strict: Boolean }
    type Mutation { rename(id: ID!, title: String, filter: Filter): Viewer }
`);

const out = (type: any, gql: any, covered?: Set<string>) => checkOutputCompatibility(type, gql, 'test', { schema, coveredFields: covered });
const viewerField = schema.getQueryType()!.getFields()['viewer'];
const usersField = schema.getQueryType()!.getFields()['users'];
const renameField = schema.getMutationType()!.getFields()['rename'];

interface GoodViewer {
    id: string;
    name: string;
    age: number | null;
    role: 'ADMIN' | 'MEMBER';
    organization: { id: string; title: string; members: never[] } | null;
}

test('output: a complete shape passes, including nested objects and never[] lists', () => {
    expect(out(typeOf<GoodViewer>(), viewerField.type)).toEqual([]);
    expect(out(typeOf<GoodViewer | null>(), viewerField.type)).toEqual([]);
});

test('output: nullability violations are named', () => {
    interface Bad {
        id: string | null;
        name: string;
        role: 'ADMIN';
    }
    const errors = out(typeOf<Bad>(), viewerField.type);
    expect(errors.some(error => error.includes('.id') && error.includes('null'))).toBe(true);
});

test('output: a missing non-null property is an error, a missing nullable one is not', () => {
    interface Missing {
        id: string;
        role: 'ADMIN';
        // name missing (String!), age missing (Int — fine), organization missing (fine)
    }
    const errors = out(typeOf<Missing>(), viewerField.type);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('Viewer.name');
});

test('output: an optional property cannot satisfy a non-null field', () => {
    interface Optional {
        id: string;
        name?: string;
        role: 'ADMIN';
    }
    const errors = out(typeOf<Optional>(), viewerField.type);
    expect(errors.some(error => error.includes('.name') && error.includes('optional'))).toBe(true);
});

test('output: enum literals must be a subset; arbitrary strings are rejected', () => {
    interface WrongEnum {
        id: string;
        name: string;
        role: 'OWNER';
    }
    expect(out(typeOf<WrongEnum>(), viewerField.type).some(error => error.includes("'OWNER'"))).toBe(true);

    interface StringEnum {
        id: string;
        name: string;
        role: string;
    }
    expect(out(typeOf<StringEnum>(), viewerField.type).some(error => error.includes('literal union'))).toBe(true);
});

test('output: abstract types dispatch on __typename literals', () => {
    type Users = ({ __typename: 'CurrentUser'; id: string; email: string } | { __typename: 'FormerUser'; id: string })[];
    expect(out(typeOf<Users>(), usersField.type)).toEqual([]);

    type NoTypename = { id: string }[];
    expect(out(typeOf<NoTypename>(), usersField.type).some(error => error.includes('__typename'))).toBe(true);

    type WrongTypename = { __typename: 'Viewer'; id: string }[];
    expect(out(typeOf<WrongTypename>(), usersField.type).some(error => error.includes('not a possible type'))).toBe(true);
});

test('output: a wrong __typename on a concrete type is caught', () => {
    interface Lying {
        __typename: 'Organization';
        id: string;
        name: string;
        role: 'ADMIN';
    }
    expect(out(typeOf<Lying>(), viewerField.type).some(error => error.includes('__typename'))).toBe(true);
});

test('output: coveredFields exempts properties answered by field resolvers', () => {
    interface WithoutMembers {
        id: string;
        title: string;
    }
    const gqlOrganization = schema.getType('Organization')!;
    const errors = checkOutputCompatibility(typeOf<WithoutMembers>(), gqlOrganization as any, 'test', {
        schema,
        coveredFields: new Set(['Organization.members']),
    });
    expect(errors).toEqual([]);
});

test('output: Record<string, unknown> is rejected — the untyped escape hatch is closed', () => {
    const errors = out(typeOf<Record<string, unknown>>(), viewerField.type);
    expect(errors.length).toBeGreaterThan(0);
});

test('input: nullable arguments must admit null, and undefined unless defaulted', () => {
    const title = renameField.args.find(argument => argument.name === 'title')!;
    expect(checkInputCompatibility(typeOf<string>(), title.type, 'test', { schema }).some(error => error.includes('null'))).toBe(true);
    expect(checkInputCompatibility(typeOf<string | null | undefined>(), title.type, 'test', { schema })).toEqual([]);
    // optional parameter: undefined is admitted by optionality, null must still be declared
    expect(checkInputCompatibility(typeOf<string | null>(), title.type, 'test', { schema }, { optional: true, hasDefault: false })).toEqual([]);
});

test('input: enums must be accepted in full', () => {
    const filter = renameField.args.find(argument => argument.name === 'filter')!;
    interface NarrowFilter {
        text?: string | null;
        limit: number;
        strict?: boolean | null;
    }
    expect(checkInputCompatibility(typeOf<NarrowFilter | null | undefined>(), filter.type, 'test', { schema })).toEqual([]);
});

test('input: a missing property drops client data — error; a required extra property can never arrive — error', () => {
    const filter = renameField.args.find(argument => argument.name === 'filter')!;
    interface MissingText {
        limit: number;
        strict?: boolean | null;
    }
    expect(checkInputCompatibility(typeOf<MissingText | null | undefined>(), filter.type, 'test', { schema }).some(error => error.includes('text') && error.includes('dropped'))).toBe(true);

    interface Extra {
        text?: string | null;
        limit: number;
        strict?: boolean | null;
        mode: string;
    }
    expect(checkInputCompatibility(typeOf<Extra | null | undefined>(), filter.type, 'test', { schema }).some(error => error.includes('mode') && error.includes('never be populated'))).toBe(true);
});

test('input: Int! with schema default may omit undefined; ID! requires plain string', () => {
    const filter = renameField.args.find(argument => argument.name === 'filter')!;
    interface DefaultedLimit {
        text?: string | null;
        limit: number; // Int! = 10 — always present after coercion
        strict?: boolean | null;
    }
    expect(checkInputCompatibility(typeOf<DefaultedLimit | null | undefined>(), filter.type, 'test', { schema })).toEqual([]);

    const id = renameField.args.find(argument => argument.name === 'id')!;
    expect(checkInputCompatibility(typeOf<string>(), id.type, 'test', { schema })).toEqual([]);
    expect(checkInputCompatibility(typeOf<'fixed'>(), id.type, 'test', { schema }).length).toBeGreaterThan(0);
});
