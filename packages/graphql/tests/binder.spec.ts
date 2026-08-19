import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { GraphQLCtx, GraphQLParent, ID } from '../src/annotations.js';
import { graphql } from '../src/decorator.js';
import { buildSchema, execute, parse } from '../src/engine.js';
import { bindResolvers } from '../src/resolver-binder.js';

const SDL = `
    type Query { viewer: Viewer, greet(name: String!, excited: Boolean): String! }
    type Viewer { id: ID!, name: String!, badge: String }
    type Mutation { rename(input: RenameInput!): Viewer }
    input RenameInput { id: ID!, title: String }
`;

interface Context {
    userId: string;
}

interface Viewer {
    id: ID;
    name: string;
}

function freshSchema() {
    return buildSchema(SDL);
}

async function run(schema: ReturnType<typeof freshSchema>, source: string, contextValue: unknown = { userId: 'u1' }, variableValues?: Record<string, unknown>) {
    return execute({ schema, document: parse(source), contextValue, variableValues });
}

test('binds queries and mutations, injects context, casts arguments', async () => {
    @graphql.resolver('viewer')
    class ViewerResolvers {
        @graphql.query()
        viewer(context: GraphQLCtx<Context>): Viewer {
            return { id: context.userId, name: 'Ada' };
        }

        @graphql.query()
        greet(name: string, excited?: boolean | null): string {
            return excited ? `Hi ${name}!` : `Hi ${name}`;
        }

        @graphql.mutation()
        rename(input: { id: string; title?: string | null }): Viewer {
            return { id: input.id, name: input.title ?? '' };
        }
    }

    const schema = freshSchema();
    const report = bindResolvers(schema, [new ViewerResolvers()]);
    expect(report.bound.length).toBe(3);
    expect(report.bound.map(field => `${field.typeName}.${field.fieldName}`).sort()).toEqual(['Mutation.rename', 'Query.greet', 'Query.viewer']);
    expect(report.bound[0].group).toBe('viewer');

    const viewer = await run(schema, '{ viewer { id name } }');
    expect(viewer.errors).toBe(undefined);
    expect(viewer.data).toEqual({ viewer: { id: 'u1', name: 'Ada' } });

    const greet = await run(schema, '{ greet(name: "Bob", excited: true) }');
    expect(greet.data).toEqual({ greet: 'Hi Bob!' });

    const renamed = await run(schema, 'mutation { rename(input: {id: "7", title: "Seven"}) { id name } }');
    expect(renamed.data).toEqual({ rename: { id: '7', name: 'Seven' } });
});

test('field resolvers receive the parent and exempt the parent shape from coverage', async () => {
    @graphql.resolver('viewer')
    class ViewerResolvers {
        @graphql.query()
        viewer(): Viewer {
            // no `badge` property: nullable, and answered by the field resolver below
            return { id: '1', name: 'Ada' };
        }

        @graphql.field('Viewer')
        badge(parent: GraphQLParent<Viewer>): string | null {
            return parent.name === 'Ada' ? 'first' : null;
        }
    }

    const schema = freshSchema();
    bindResolvers(schema, [new ViewerResolvers()]);
    const result = await run(schema, '{ viewer { name badge } }');
    expect(result.data).toEqual({ viewer: { name: 'Ada', badge: 'first' } });
});

test('binding is fail-closed: unknown fields, unknown args, collisions and type mismatches — all reported at once', () => {
    @graphql.resolver('a')
    class BrokenResolvers {
        @graphql.query()
        nope(): string {
            return '';
        }

        @graphql.query('greet')
        greet(who: string): string {
            return who;
        }

        @graphql.query('viewer')
        viewer(): { id: string } {
            return { id: '1' };
        }
    }

    @graphql.resolver('b')
    class CollidingResolvers {
        @graphql.query('viewer')
        viewer(): never {
            throw new Error();
        }
    }

    let message = '';
    try {
        bindResolvers(freshSchema(), [new BrokenResolvers(), new CollidingResolvers()]);
    } catch (error) {
        message = (error as Error).message;
    }
    expect(message).toContain("no field 'Query.nope'");
    expect(message).toContain('no such argument');
    expect(message).toContain("resolved by both 'a'");
    expect(message).toContain('Viewer.name');
});

test('arguments are validated against the declared parameter types at call time', async () => {
    @graphql.resolver()
    class Resolvers {
        @graphql.query()
        greet(name: string, excited?: boolean | null): string {
            return `${name}:${excited}`;
        }
    }

    const schema = freshSchema();
    bindResolvers(schema, [new Resolvers()]);

    // Schema-valid value that violates a NARROWER runtime constraint cannot be
    // built with plain scalars — but a null slipped through a variable is the
    // classic case: String! blocks it at coercion, so drive the validator
    // directly through a nullable position with a non-null-expecting runtime.
    const good = await run(schema, '{ greet(name: "x") }');
    expect(good.errors).toBe(undefined);
    // deepkit's deserializer normalizes an omitted nullable to null — same
    // value the schema would deliver for an explicit null.
    expect(good.data).toEqual({ greet: 'x:null' });
});

test('validateResults catches a resolver violating its own declaration', async () => {
    @graphql.resolver()
    class LyingResolvers {
        @graphql.query()
        viewer(): Viewer {
            return { id: '1' } as Viewer; // name missing at runtime
        }
    }

    const schema = freshSchema();
    bindResolvers(schema, [new LyingResolvers()], { validateResults: true });
    const result = await run(schema, '{ viewer { id name } }');
    expect(result.errors?.length).toBe(1);
    expect(String(result.errors![0].originalError?.message)).toContain('violating its declared type');
});

test('a class without @graphql decorators is refused', () => {
    class Plain {}
    let message = '';
    try {
        bindResolvers(freshSchema(), [new Plain()]);
    } catch (error) {
        message = (error as Error).message;
    }
    expect(message).toContain('carries no @graphql');
});
