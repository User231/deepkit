import { ClassType } from '@7b/runtime';
import { TypeRegistry } from '@7b/reflection';
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ComponentRegistry {
    inputRegistry = new TypeRegistry<ClassType>();
    cellRegistry = new TypeRegistry<ClassType>();
}
