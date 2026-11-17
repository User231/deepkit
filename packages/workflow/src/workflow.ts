/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import {
    Builder,
    ClassType,
    DeepkitError,
    ExtractClassType,
    Ref,
    arg,
    capitalize,
    fnAsync,
    getClassName,
    isArray,
    toFastProperties,
} from '@deepkit/core';
import {
    BaseEvent,
    EventDispatcher,
    EventToken,
    isEventListenerContainerEntryCallback,
    isEventListenerContainerEntryService,
} from '@deepkit/event';
import { InjectorContext, injectedFunction } from '@deepkit/injector';
import { FrameCategory, Stopwatch } from '@deepkit/stopwatch';
import { ReflectionClass } from '@deepkit/type';

interface WorkflowTransition<T> {
    from: keyof T & string;
    to: keyof T & string;
    label?: string;
}

/** `run(context, event)`, to be called later by somebody who has neither. */
function deferred<C, E, R>(run: (context: C, event: E) => R, context: C, event: E): () => R {
    return () => run(context, event);
}

export class WorkflowEvent extends BaseEvent {
    public nextState?: any;
    public nextStateEvent?: any;

    clearNext() {
        this.nextState = undefined;
        this.nextStateEvent = undefined;
    }

    /**
     * @see WorkflowNextEvent.next
     */
    next(nextState: string, event?: any) {
        this.nextState = nextState;
        this.nextStateEvent = event;
    }

    hasNext(): boolean {
        return this.nextState !== undefined;
    }
}

export type WorkflowPlaces = { [name: string]: ClassType<WorkflowEvent> };

export interface WorkflowNextEvent<T extends WorkflowPlaces> {
    nextState?: keyof T & string;

    /**
     * Schedule to apply the next workflow step when all event listeners have been called.
     */
    next<S extends keyof T & string>(nextState: S, event?: ExtractClassType<T[S]>): void;
}

export type WorkflowDefinitionEvents<T extends WorkflowPlaces> = {
    [K in keyof T & string as `on${Capitalize<K>}`]: EventToken<
        BaseEvent & Omit<ExtractClassType<T[K]>, 'next' | 'nextState'> & WorkflowNextEvent<T>
    >;
};

export class WorkflowDefinition<T extends WorkflowPlaces> {
    public transitions: WorkflowTransition<T>[] = [];
    public tokens: { [name in keyof T]?: EventToken<any> } = {};
    public next: { [name in keyof T]?: (keyof T & string)[] } = {};

    public symbol = Symbol('workflow');

    constructor(
        public readonly name: string,
        public readonly places: T,
        transitions: WorkflowTransitions<T> = {},
    ) {
        for (const placeName in this.places) {
            if (!this.places.hasOwnProperty(placeName)) continue;
            const token = new EventToken(name + '.' + placeName, this.places[placeName] as any);
            this.tokens[placeName] = token;
            (this as any)['on' + capitalize(placeName)] = token;
        }
        for (const [i, value] of Object.entries(transitions)) {
            if (isArray(value)) {
                for (const v of value) this.addTransition(i, v);
            } else if (value !== undefined) {
                this.addTransition(i, value);
            }
        }
        toFastProperties(this.tokens);
        toFastProperties(this.next);
    }

    getEventToken<K extends keyof T>(name: K): EventToken<ExtractClassType<T[K]>> {
        if (!this.tokens[name]) throw new WorkflowError(`No event token found for ${String(name)}`);

        return this.tokens[name]!;
    }

    addTransition(from: keyof T & string, to: keyof T & string, label?: string) {
        this.transitions.push({ from, to, label });
        if (!this.next[from]) this.next[from] = [];
        this.next[from]!.push(to);
    }

    public create(
        state: keyof T & string,
        eventDispatcher: EventDispatcher,
        stopwatch: Stopwatch,
        injector?: InjectorContext,
    ): Workflow<T> {
        return new Workflow(
            this,
            new WorkflowStateSubject(state),
            eventDispatcher,
            injector || eventDispatcher.injector,
            stopwatch,
        );
    }

    getTransitionsFrom(state: keyof T & string): (keyof T & string)[] {
        return this.next[state]! || [];
    }

    /**
     * The function `Workflow.apply()` runs: one async function for the whole definition, built
     * once per event dispatcher from the listeners registered at that moment.
     *
     * It is built with the JIT of `@deepkit/core` — compiled where code generation is allowed,
     * interpreted where it is not — and reads:
     *
     *     while (true) {
     *         const currentState = state.get();
     *         switch (nextState) {
     *             case <place>: {
     *                 <the transition must be declared, and the event of the place's type>
     *                 const frame = stopwatch.start(<name.place>, FrameCategory.workflow);
     *                 try {
     *                     await frame.run(<the place's listeners, in order>);
     *                     state.set(<place>);
     *                 } finally {
     *                     frame.end();
     *                 }
     *             }
     *         }
     *         if (event.nextState) { nextState = event.nextState; event = <its event>; continue; }
     *         return;
     *     }
     */
    public buildApplier(
        eventDispatcher: EventDispatcher,
    ): (
        scopedContext: InjectorContext,
        state: WorkflowState<T>,
        nextState: keyof T & string,
        event: WorkflowEvent,
        stopwatch: Stopwatch,
    ) => Promise<void> {
        return fnAsync<void>(
            arg('scopedContext'),
            arg('state'),
            arg('nextState'),
            arg('event'),
            arg('stopwatch'),
            (b: Builder, scopedContext: Ref, state: Ref, firstState: Ref, firstEvent: Ref, stopwatch: Ref) => {
                // What a listener may replace: the place to go to next, and its event.
                const nextState = b.var_(firstState, 'nextState');
                const event = b.var_(firstEvent, 'event');

                b.while_(b.lit(true), () => {
                    const currentState = b.let(b.method(state, 'get'), 'currentState');

                    const places = Object.entries(this.places).map(([place, eventType]): [string, () => void] => {
                        const allowedFrom = this.transitions.filter(v => v.to === place);
                        const listeners = this.buildListeners(place, eventDispatcher);

                        return [
                            place,
                            () => {
                                if (allowedFrom.length) {
                                    const allowed = allowedFrom
                                        .map(v => b.eq(currentState, b.lit(v.from)))
                                        .reduce((either, next) => b.or(either, next));
                                    b.if_(b.not(allowed), () => {
                                        b.throw_(
                                            b.new_(
                                                WorkflowError,
                                                b.concat(
                                                    b.lit('Can not apply state change from '),
                                                    currentState,
                                                    b.lit('->'),
                                                    b.getVar(nextState),
                                                    b.lit(`. There's no transition between them or it was blocked.`),
                                                ),
                                            ),
                                        );
                                    });
                                }
                                b.if_(b.not(b.isInstance(b.getVar(event), eventType)), () => {
                                    b.throw_(
                                        b.new_(
                                            WorkflowError,
                                            b.concat(
                                                b.lit(
                                                    `State ${place} got the wrong event. Expected ${getClassName(eventType)}, got `,
                                                ),
                                                b.call(getClassName, b.getVar(event)),
                                            ),
                                        ),
                                    );
                                });

                                const frame = b.let(
                                    b.method(
                                        stopwatch,
                                        'start',
                                        b.lit(this.name + '.' + place),
                                        b.lit(FrameCategory.workflow),
                                    ),
                                    'frame',
                                );
                                b.try_(
                                    () => {
                                        // The frame runs the listeners as a function of its own:
                                        // theirs, with the context and the event of this call bound.
                                        b.await_(
                                            b.method(
                                                frame,
                                                'run',
                                                b.call(deferred, b.lit(listeners), scopedContext, b.getVar(event)),
                                            ),
                                        );
                                        b.exec(b.method(state, 'set', b.lit(place)));
                                    },
                                    { finally: () => b.exec(b.method(frame, 'end')) },
                                );
                            },
                        ];
                    });
                    b.switch_(b.getVar(nextState), places);

                    b.if_(b.get(b.getVar(event), 'nextState'), () => {
                        b.setVar(nextState, b.get(b.getVar(event), 'nextState'));
                        b.setVar(event, b.or(b.get(b.getVar(event), 'nextStateEvent'), b.new_(WorkflowEvent)));
                        b.continue_();
                    });
                    b.return_();
                });
            },
        );
    }

    /**
     * The listeners of one place as an async function `(scopedContext, event)`: each is awaited in
     * its order, and none runs once one has stopped the event's propagation.
     *
     * Called while {@link buildApplier} declares its function, it is that function's nested
     * function.
     */
    protected buildListeners(place: string, eventDispatcher: EventDispatcher): Function {
        const listeners = eventDispatcher.getListeners(this.tokens[place]!);
        listeners.sort((a, b) => {
            if (a.order > b.order) return +1;
            if (a.order < b.order) return -1;
            return 0;
        });

        return fnAsync<void>(arg('scopedContext'), arg('event'), (b: Builder, scopedContext: Ref, event: Ref) => {
            const unlessStopped = (call: () => void) => {
                b.if_(b.not(b.get(event, 'immediatePropagationStopped')), call);
            };

            for (const listener of listeners) {
                const injector = listener.module
                    ? eventDispatcher.injector.getInjector(listener.module)
                    : eventDispatcher.injector.getRootInjector();

                if (isEventListenerContainerEntryCallback(listener)) {
                    const callback = injectedFunction(listener.fn, injector, 1);
                    unlessStopped(() => {
                        b.await_(b.call(callback, b.get(scopedContext, 'scope'), event));
                    });
                } else if (isEventListenerContainerEntryService(listener)) {
                    // The listener's instance is resolved by the first event that reaches it and
                    // kept for every call after — it outlives the call, so it is not a variable.
                    const resolved = b.lit<{ instance?: any }>({ instance: undefined });
                    const resolveArgs = [b.lit(listener.classType)];
                    if (listener.module) resolveArgs.push(b.lit(listener.module));

                    const method = ReflectionClass.from(listener.classType).getMethod(listener.methodName);
                    const withDependencies =
                        method.getParameters().length > 1
                            ? injectedFunction(
                                  (event, classInstance, ...args: any[]) => {
                                      return classInstance[listener.methodName](event, ...args);
                                  },
                                  injector,
                                  2,
                                  method.type,
                                  1,
                              )
                            : undefined;

                    unlessStopped(() => {
                        b.if_(b.not(b.get(resolved, 'instance')), () => {
                            b.set(resolved, 'instance', b.method(scopedContext, 'get', ...resolveArgs));
                        });
                        const instance = b.get(resolved, 'instance');
                        b.await_(
                            withDependencies
                                ? b.call(withDependencies, b.get(scopedContext, 'scope'), event, instance)
                                : b.method(instance, listener.methodName, event),
                        );
                    });
                }
            }
        });
    }
}

type WorkflowTransitions<T extends WorkflowPlaces> = { [name in keyof T]?: (keyof T & string) | (keyof T & string)[] };

export function createWorkflow<T extends WorkflowPlaces>(
    name: string,
    definition: T,
    transitions: WorkflowTransitions<T> = {},
): WorkflowDefinition<T> & WorkflowDefinitionEvents<T> {
    return new WorkflowDefinition(name, definition, transitions) as any;
}

export interface WorkflowState<T> {
    get(): keyof T & string;

    set(v: keyof T & string): void;
}

export class WorkflowStateSubject<T extends WorkflowPlaces> implements WorkflowState<T> {
    constructor(public value: keyof T & string) {}

    get() {
        return this.value;
    }

    set(v: keyof T & string) {
        this.value = v;
    }
}

export class WorkflowError extends DeepkitError {
    constructor(message: string, options?: { cause?: Error }) {
        super('DK-W001', message, options);
    }
}

export class Workflow<T extends WorkflowPlaces> {
    protected events: { [name in keyof T]?: Function } = {};

    constructor(
        public definition: WorkflowDefinition<T>,
        public state: WorkflowState<T>,
        private eventDispatcher: EventDispatcher,
        private injector: InjectorContext,
        private stopwatch: Stopwatch,
    ) {}

    can(nextState: keyof T & string): boolean {
        return this.definition.getTransitionsFrom(this.state.get()).includes(nextState);
    }

    /**
     * @throws WorkflowError when next state is not possible to apply.
     */
    apply<K extends keyof T>(nextState: K, event?: ExtractClassType<T[K]>): Promise<void> {
        let fn = (this.eventDispatcher as any)[this.definition.symbol];
        if (!fn) {
            fn = (this.eventDispatcher as any)[this.definition.symbol] = this.definition.buildApplier(
                this.eventDispatcher,
            );
        }

        return fn(
            this.injector,
            this.state,
            nextState,
            event || (new WorkflowEvent() as ExtractClassType<T[K]>),
            this.stopwatch,
        );
    }

    isDone(): boolean {
        return this.definition.getTransitionsFrom(this.state.get()).length === 0;
    }
}
