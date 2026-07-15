/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { getClassName } from './core.js';
import { toFastProperties } from './perf.js';

type AsyncMethod = (...args: any[]) => Promise<any>;

/**
 * A method decorator working under both decorator ABIs: legacy (experimentalDecorators)
 * and standard (TC39, TS 5+).
 */
type DualMethodDecorator = ((value: AsyncMethod, context: ClassMethodDecoratorContext) => AsyncMethod) &
    ((target: object, propertyKey: string, descriptor: TypedPropertyDescriptor<AsyncMethod>) => void);

/**
 * Builds a decorator from a `wrap(original, name)` function, dispatching on the decorator ABI:
 * standard mode returns the replacement method, legacy mode mutates the descriptor.
 */
function wrapMethod(wrap: (orig: any, name: string) => any): DualMethodDecorator {
    return function (target: any, context: any, descriptor?: any): any {
        if ('object' === typeof context && context !== null && 'string' === typeof context.kind) {
            //standard (TC39) ABI: target IS the method, the return value replaces it.
            return wrap(target, String(context.name));
        }
        descriptor.value = wrap(descriptor.value, String(context));
        return descriptor;
    } as any;
}

/**
 * Logs every call to this method on stdout.
 *
 * @group Decorators
 */
export function log() {
    return wrapMethod(function (orig: any, propertyKey: string) {
        return function (this: any, ...args: any[]) {
            const a = args.map(v => typeof v).join(',');
            console.info(getClassName(this) + '::' + propertyKey + '(' + a + ')');
            return orig.apply(this, args);
        };
    });
}

/**
 * Makes sure that calls to this async method are stacked up and are called one after another and not parallel.
 *
 * @group Decorators
 */
export function stack() {
    return wrapMethod(function (orig: any, propertyKey: string) {
        return async function (this: any, ...args: any[]) {
            const name = '__c_' + propertyKey;

            if ((this as any)[name] === undefined) {
                (this as any)[name] = null;
                toFastProperties(this);
            }

            while ((this as any)[name]) {
                await (this as any)[name];
            }

            (this as any)[name] = (orig as any).apply(this, args);

            try {
                return await (this as any)[name];
            } finally {
                (this as any)[name] = null;
            }
        };
    });
}

/**
 * Makes sure that this async method is only running once at a time. When this method is running and it is tried
 * to call it another times, that call is "dropped" and it returns simply the result of the previous running call (waiting for it to complete first).
 *
 * @group Decorators
 */
export function singleStack() {
    return wrapMethod(function (orig: any, propertyKey: string) {
        return async function (this: any, ...args: any[]) {
            const name = '__sc_' + propertyKey;

            if ((this as any)[name] === undefined) {
                (this as any)[name] = null;
                toFastProperties(this);
            }

            if ((this as any)[name]) {
                return await (this as any)[name];
            }

            (this as any)[name] = (orig as any).apply(this, args);

            try {
                return await (this as any)[name];
            } finally {
                (this as any)[name] = null;
            }
        };
    });
}
