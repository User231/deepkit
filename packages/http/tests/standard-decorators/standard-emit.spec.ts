import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { getActions, http, httpClass } from '../../src/decorator.js';
import { LegacyBaseController } from '../standard-decorators-legacy-base.js';

/**
 * This directory's tsconfig.json disables experimentalDecorators, so these files genuinely
 * compile as standard (TC39) decorators. HTTP controllers are member-decorator-only (no
 * deepkit class decorator), so this exercises the LAZY drain path: modifiers execute at
 * first getActions/_fetch, not at class definition.
 */

test('@http.GET under standard emit', () => {
    class Controller {
        @http.GET('hello')
        hello(): string {
            return 'hi';
        }

        @(http.POST('world').group('secret'))
        world(): string {
            return 'earth';
        }
    }

    const actions = getActions(Controller);
    expect(actions.length).toBe(2);
    expect(actions[0].methodName).toBe('hello');
    expect(actions[0].path).toBe('hello');
    expect(actions[0].httpMethods).toEqual(['GET']);
    expect(actions[1].methodName).toBe('world');
    expect(actions[1].httpMethods).toEqual(['POST']);
    expect(actions[1].groups).toEqual(['secret']);

    //idempotent: a second read must not duplicate actions.
    expect(getActions(Controller).length).toBe(2);
    expect(httpClass._fetch(Controller)!.getActions().size).toBe(2);
});

test('cross-ABI inheritance: legacy-compiled base, standard-compiled subclass', () => {
    class SubController extends LegacyBaseController {
        @http.GET('sub')
        subAction(): string {
            return 'sub';
        }
    }

    const actions = getActions(SubController);
    const methodNames = actions.map(a => a.methodName).sort();
    expect(methodNames).toEqual(['baseAction', 'subAction']);

    //base class metadata stays keyed on the base class (exact-class semantics).
    const baseActions = getActions(LegacyBaseController);
    expect(baseActions.length).toBe(1);
    expect(baseActions[0].methodName).toBe('baseAction');
});
