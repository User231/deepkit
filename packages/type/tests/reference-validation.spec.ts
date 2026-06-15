/**
 * Regression: a `& Reference` property must validate as EITHER a hydrated instance of the
 * referenced class (carrying the PK) OR the foreign-key value itself. The ORM's doPersist
 * runs `validate(item, schema.type)`, so a hydrated reference (what `database.persist()`
 * receives) used to fail with "Not a valid <PK type>" because `guardReferenceFast` emitted
 * BOTH guard branches unconditionally (ternary) and the non-matching branch pushed spurious
 * errors in error-collection mode. Fixed in serializer/handlers.ts by emitting each branch
 * conditionally (if_).
 */
import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { MongoId, PrimaryKey, Reference, is, validate } from '../index.js';

class Group {
    _id: MongoId & PrimaryKey = '';
    name: string = '';
}

class User {
    _id: MongoId & PrimaryKey = '';
    group?: Group & Reference;
}

test('validate() accepts a hydrated & Reference (error-collection path)', () => {
    const g = new Group();
    g._id = '507f1f77bcf86cd799439011';
    g.name = 'admins';

    const u = new User();
    u._id = '507f191e810c19729de860ea';
    u.group = g; // hydrated reference (full instance)

    const errors = validate<User>(u);
    expect(errors.map(e => e.toString())).toEqual([]);
});

test('validate() accepts the FK value directly', () => {
    const u = new User();
    u._id = '507f191e810c19729de860eb';
    (u as any).group = '507f1f77bcf86cd799439011';

    const errors = validate<User>(u);
    expect(errors.map(e => e.toString())).toEqual([]);
});

test('validate() accepts a PK-only object', () => {
    const u = new User();
    u._id = '507f191e810c19729de860ec';
    (u as any).group = { _id: '507f1f77bcf86cd799439011' };

    const errors = validate<User>(u);
    expect(errors.map(e => e.toString())).toEqual([]);
});

test('validate() accepts an absent optional reference', () => {
    const u = new User();
    u._id = '507f191e810c19729de860ed';

    const errors = validate<User>(u);
    expect(errors.map(e => e.toString())).toEqual([]);
});

test('validate() still REJECTS an invalid FK value', () => {
    const u = new User();
    u._id = '507f191e810c19729de860ee';
    (u as any).group = 'not-a-mongo-id';

    const errors = validate<User>(u);
    expect(errors.length).toBe(1);
    expect(errors[0].path).toBe('group');
});

test('validate() still REJECTS a hydrated reference with an invalid PK', () => {
    const u = new User();
    u._id = '507f191e810c19729de860ef';
    (u as any).group = { _id: 'not-a-mongo-id', name: 'admins' };

    const errors = validate<User>(u);
    expect(errors.length).toBe(1);
    expect(errors[0].path).toBe('group._id');
});

test('is() fast guard still works both ways', () => {
    const g = new Group();
    g._id = '507f1f77bcf86cd799439011';
    g.name = 'admins';

    expect(is<User>({ _id: '507f191e810c19729de860ea', group: g })).toBe(true);
    expect(is<User>({ _id: '507f191e810c19729de860ea', group: '507f1f77bcf86cd799439011' })).toBe(true);
    expect(is<User>({ _id: '507f191e810c19729de860ea', group: 'bad' })).toBe(false);
    expect(is<User>({ _id: '507f191e810c19729de860ea' })).toBe(true);
});
