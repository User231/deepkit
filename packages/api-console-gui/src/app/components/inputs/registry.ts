import { TypeRegistry } from '@d7/type';
import { ClassType } from '@d7/core';
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class InputRegistry {
    registry = new TypeRegistry<ClassType>();
}
