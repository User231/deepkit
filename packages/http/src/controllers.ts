import { ClassType } from '@d7/core';
import { InjectorModule } from '@d7/injector';

export class HttpControllers {
    constructor(public readonly controllers: {controller: ClassType, module: InjectorModule<any>}[] = []) {
    }

    public add(controller: ClassType, module: InjectorModule<any>) {
        this.controllers.push({controller, module});
    }
}
