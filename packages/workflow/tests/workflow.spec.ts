import { test } from 'node:test';

import { EventDispatcher, EventToken, eventDispatcher } from '@deepkit/event';
import { InjectorContext, InjectorModule } from '@deepkit/injector';
import { expect } from '@deepkit/run/expect';
import { Stopwatch } from '@deepkit/stopwatch';

import { WorkflowEvent, createWorkflow } from '../src/workflow.js';

class EndEvent extends WorkflowEvent {
    test: string = 'hi';
}

const workflow1 = createWorkflow(
    'myFlow',
    {
        start: WorkflowEvent,
        doIt: WorkflowEvent,
        failed: WorkflowEvent,
        success: WorkflowEvent,
        end: EndEvent,
    },
    {
        start: 'doIt',
        doIt: ['failed', 'success'],
        success: 'end',
        failed: 'end',
    },
);

test('workflow', async () => {
    expect(workflow1.onDoIt).toBeInstanceOf(EventToken);

    const w = workflow1.create('start', new EventDispatcher(), new Stopwatch());
    expect(w.state.get()).toBe('start');
    expect(w.isDone()).toBe(false);

    expect(w.can('doIt')).toBe(true);
    expect(w.can('failed')).toBe(false);
    expect(w.can('success')).toBe(false);
    expect(w.can('end')).toBe(false);

    await expect(w.apply('success')).rejects.toThrow('Can not apply state change from start->success');

    await w.apply('doIt');
    expect(w.state.get()).toBe('doIt');
    expect(w.isDone()).toBe(false);

    expect(w.can('doIt')).toBe(false);
    expect(w.can('failed')).toBe(true);
    expect(w.can('success')).toBe(true);
    expect(w.can('end')).toBe(false);
    expect(w.isDone()).toBe(false);

    await w.apply('success');
    await expect(w.apply('end')).rejects.toThrow('State end got the wrong event. Expected EndEvent, got WorkflowEvent');
    await w.apply('end', new EndEvent());

    expect(w.isDone()).toBe(true);
    expect(w.state.get()).toBe('end');
});

test('workflow events', async () => {
    const dispatcher = new EventDispatcher(InjectorContext.forProviders([]));
    const w = workflow1.create('start', dispatcher, new Stopwatch());

    let called = false;
    dispatcher.listen(workflow1.onDoIt, async () => {
        called = true;
    });

    await w.apply('doIt');

    expect(called).toBe(true);
    expect(w.state.get()).toBe('doIt');
});

test('workflow events listener', async () => {
    let called = false;

    class Listener {
        @eventDispatcher.listen(workflow1.onDoIt)
        onDoIt() {
            called = true;
        }
    }

    const module = new InjectorModule([Listener]);
    const dispatcher = new EventDispatcher(new InjectorContext(module));
    const w = workflow1.create('start', dispatcher, new Stopwatch());

    dispatcher.registerListener(Listener, module);

    await w.apply('doIt');

    expect(called).toBe(true);
    expect(w.state.get()).toBe('doIt');
});

test('workflow events apply next', async () => {
    const dispatcher = new EventDispatcher(InjectorContext.forProviders([]));
    const w = workflow1.create('start', dispatcher, new Stopwatch());

    let endCalled = false;
    dispatcher.listen(workflow1.onDoIt, async event => {
        event.next('success');
    });

    dispatcher.listen(workflow1.onSuccess, async event => {
        event.next('end', new EndEvent());
    });

    dispatcher.listen(workflow1.onEnd, async event => {
        expect(event.test).toBe('hi');
        endCalled = true;
    });

    await w.apply('doIt');

    expect(w.state.get()).toBe('end');
    expect(endCalled).toBe(true);
});

test('workflow events apply next invalid', async () => {
    const dispatcher = new EventDispatcher(InjectorContext.forProviders([]));
    const w = workflow1.create('start', dispatcher, new Stopwatch());

    dispatcher.listen(workflow1.onDoIt, async event => {
        event.next('end');
    });

    await expect(w.apply('doIt')).rejects.toThrow('Can not apply state change from doIt->end');
});

test('workflow events apply injector', async () => {
    class MyService {
        data: string = 'myData';
    }

    class Listener {
        constructor(private myService: MyService) {}

        @eventDispatcher.listen(workflow1.onDoIt)
        onDoIt() {
            expect(this.myService).toBeInstanceOf(MyService);
            this.myService.data = 'changedData';
        }
    }

    const module = new InjectorModule([MyService, Listener]);
    const context = new InjectorContext(module);
    const dispatcher = new EventDispatcher(context);
    const w = workflow1.create('start', dispatcher, new Stopwatch());

    dispatcher.registerListener(Listener, module);
    await w.apply('doIt');

    expect(context.get(MyService).data).toBe('changedData');
});

test('listeners run in their order, and none runs once one stopped the propagation', async () => {
    const dispatcher = new EventDispatcher(InjectorContext.forProviders([]));
    const w = workflow1.create('start', dispatcher, new Stopwatch());

    const ran: string[] = [];
    dispatcher.listen(
        workflow1.onDoIt,
        async () => {
            ran.push('third, never');
        },
        30,
    );
    dispatcher.listen(
        workflow1.onDoIt,
        async event => {
            ran.push('second');
            event.stopImmediatePropagation();
        },
        20,
    );
    dispatcher.listen(
        workflow1.onDoIt,
        async () => {
            await new Promise(resolve => setImmediate(resolve));
            ran.push('first');
        },
        10,
    );

    await w.apply('doIt');

    expect(ran).toEqual(['first', 'second']);
    expect(w.state.get()).toBe('doIt');
});

test('a listener that throws leaves the state where it was, and its frame is ended', async () => {
    const dispatcher = new EventDispatcher(InjectorContext.forProviders([]));

    const frames: string[] = [];
    const stopwatch = {
        start(name: string) {
            frames.push('start ' + name);
            return {
                run: async (cb: () => Promise<void>) => {
                    frames.push('run ' + name);
                    await cb();
                    frames.push('ran ' + name);
                },
                end: () => frames.push('end ' + name),
            };
        },
    };
    const w = workflow1.create('start', dispatcher, stopwatch as any);

    dispatcher.listen(workflow1.onDoIt, async event => {
        event.next('success');
    });
    dispatcher.listen(workflow1.onSuccess, async () => {
        throw new Error('the listener failed');
    });

    await expect(w.apply('doIt')).rejects.toThrow('the listener failed');

    expect(w.state.get()).toBe('doIt');
    expect(frames).toEqual(['start myFlow.doIt', 'run myFlow.doIt', 'ran myFlow.doIt', 'end myFlow.doIt', 'start myFlow.success', 'run myFlow.success', 'end myFlow.success']);
});

test('a listener method takes its other parameters from the injector, and its instance is resolved once', async () => {
    class Counter {
        count = 0;
    }

    let instances = 0;

    class Listener {
        constructor() {
            instances++;
        }

        @eventDispatcher.listen(workflow1.onDoIt)
        onDoIt(event: typeof workflow1.onDoIt.event, counter: Counter) {
            counter.count++;
        }
    }

    const module = new InjectorModule([Counter, Listener]);
    const context = new InjectorContext(module);
    const dispatcher = new EventDispatcher(context);
    dispatcher.registerListener(Listener, module);

    await workflow1.create('start', dispatcher, new Stopwatch()).apply('doIt');
    await workflow1.create('start', dispatcher, new Stopwatch()).apply('doIt');

    expect(context.get(Counter).count).toBe(2);
    expect(instances).toBe(1);
});

test('the applier is built once per dispatcher, from the listeners it has then', async () => {
    const dispatcher = new EventDispatcher(InjectorContext.forProviders([]));

    let calls = 0;
    dispatcher.listen(workflow1.onDoIt, async () => {
        calls++;
    });

    const built = workflow1.buildApplier(dispatcher);
    const state = { value: 'start', get: () => state.value, set: (v: string) => (state.value = v) };
    const answered = built(dispatcher.injector, state as any, 'doIt', new WorkflowEvent(), new Stopwatch());
    expect(answered).toBeInstanceOf(Promise);
    await answered;

    expect(calls).toBe(1);
    expect(state.value).toBe('doIt');

    // A place nothing declares is no transition: nothing runs, and the state stays.
    await built(dispatcher.injector, state as any, 'nowhere' as any, new WorkflowEvent(), new Stopwatch());
    expect(state.value).toBe('doIt');
});
