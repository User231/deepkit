import { Component, Input } from '@angular/core';
import { Type } from '@d7/type';

@Component({ template: `{{ model }}` })
export class StringCellComponent {
    @Input() model: any;
    @Input() type!: Type;
}
