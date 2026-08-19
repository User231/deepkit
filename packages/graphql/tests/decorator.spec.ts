import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { getResolverMetadata, graphql } from '../src/decorator.js';

test('resolver metadata records group, kinds, names and target types', () => {
    @graphql.resolver('viewer')
    class ViewerResolvers {
        @graphql.query()
        viewer() {
            return null;
        }

        @graphql.mutation('updateProfile')
        update() {
            return null;
        }

        @graphql.field('Viewer', 'organization')
        organization() {
            return null;
        }
    }

    const metadata = getResolverMetadata(ViewerResolvers)!;
    expect(metadata.group).toBe('viewer');
    expect(metadata.fields.size).toBe(3);

    expect(metadata.fields.get('viewer')!.kind).toBe('query');
    expect(metadata.fields.get('viewer')!.name).toBe('viewer');

    expect(metadata.fields.get('update')!.kind).toBe('mutation');
    expect(metadata.fields.get('update')!.name).toBe('updateProfile');

    const field = metadata.fields.get('organization')!;
    expect(field.kind).toBe('field');
    expect(field.typeName).toBe('Viewer');
    expect(field.name).toBe('organization');
});

test('metadata is inherited and undecorated classes report undefined', () => {
    @graphql.resolver('base')
    class Base {
        @graphql.query()
        a() {
            return null;
        }
    }

    class Derived extends Base {}

    expect(getResolverMetadata(Derived)!.fields.has('a')).toBe(true);

    class Plain {}
    expect(getResolverMetadata(Plain)).toBe(undefined);
});
