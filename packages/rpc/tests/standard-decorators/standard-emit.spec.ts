import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { getActions, rpc, rpcClass } from '../../src/decorators.js';

/**
 * This directory's tsconfig.json disables experimentalDecorators, so these files genuinely
 * compile as standard (TC39) decorators. RPC controllers carry a deepkit CLASS decorator,
 * so this exercises the EAGER drain path: the class decorator applies the stashed member
 * modifiers at class-definition time, like legacy.
 */

test('@rpc.controller + @rpc.action under standard emit', () => {
    @rpc.controller('standard-dec')
    class Controller {
        @rpc.action()
        action(): void {}

        @(rpc.action().group('a'))
        second(): void {}
    }

    //eager: the class decorator drained the member stash at definition time.
    const data = rpcClass._fetch(Controller);
    expect(data!.getPath()).toBe('standard-dec');
    expect(data!.actions.size).toBe(2);

    const actions = getActions(Controller);
    expect(actions.size).toBe(2);
    expect(actions.get('action')!.name).toBe('action');
    expect(actions.get('action')!.groups).toEqual([]);
    expect(actions.get('second')!.name).toBe('second');
    expect(actions.get('second')!.groups).toEqual(['a']);
});

test('rpc inheritance under standard emit', () => {
    @rpc.controller('base')
    class Controller {
        @rpc.action()
        action(): void {}

        @(rpc.action().group('a'))
        second(): void {}
    }

    @rpc.controller('extended')
    class Extended extends Controller {
        @(rpc.action().group('extended'))
        second(): void {}

        @(rpc.action().group('b'))
        third(): void {}
    }

    const actions = getActions(Controller);
    expect(actions.size).toBe(2);
    expect(actions.get('second')!.groups).toEqual(['a']);

    const extendedActions = getActions(Extended);
    expect(extendedActions.size).toBe(3);
    expect(extendedActions.get('second')!.groups).toEqual(['a', 'extended']);
    expect(extendedActions.get('third')!.groups).toEqual(['b']);
});
