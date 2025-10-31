import { ClassType } from '@d7/core';
import { TypeRegistry } from '@d7/type';
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ComponentRegistry {
    inputRegistry = new TypeRegistry<ClassType>();
    cellRegistry = new TypeRegistry<ClassType>();
}
