import { ClassType } from '@7b/runtime';
import { InjectorModule } from '@7b/core';

export class HttpControllers {
    constructor(public readonly controllers: {controller: ClassType, module: InjectorModule<any>}[] = []) {
    }

    public add(controller: ClassType, module: InjectorModule<any>) {
        this.controllers.push({controller, module});
    }
}
