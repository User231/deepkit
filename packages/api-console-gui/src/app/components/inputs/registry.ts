import { TypeRegistry } from '@7b/reflection';
import { ClassType } from '@7b/runtime';
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class InputRegistry {
    registry = new TypeRegistry<ClassType>();
}
