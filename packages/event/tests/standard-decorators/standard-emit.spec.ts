import { test } from 'node:test';

import { expect } from '@deepkit/run/expect';

import { EventToken, eventClass, eventDispatcher } from '../../src/event.js';

/**
 * This directory's tsconfig.json disables experimentalDecorators, so these files genuinely
 * compile as standard (TC39) decorators. Listener classes are member-decorator-only, so the
 * lazy drain path (eventClass._fetch — the only listener read site) is exercised.
 */

test('@eventDispatcher.listen under standard emit', () => {
    const MyEvent = new EventToken('standard-dec-event');

    class Listener {
        @eventDispatcher.listen(MyEvent)
        onMyEvent(): void {}

        @eventDispatcher.listen(MyEvent, 5)
        late(): void {}
    }

    const config = eventClass._fetch(Listener);
    expect(config).not.toBe(undefined);
    expect(config!.listeners.length).toBe(2);
    expect(config!.listeners[0].eventToken).toBe(MyEvent);
    expect(config!.listeners[0].methodName).toBe('onMyEvent');
    expect(config!.listeners[0].order).toBe(0);
    expect(config!.listeners[1].methodName).toBe('late');
    expect(config!.listeners[1].order).toBe(5);

    //idempotent: a second read must not duplicate listeners.
    expect(eventClass._fetch(Listener)!.listeners.length).toBe(2);
});
