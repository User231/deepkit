import { Component, Input } from '@angular/core';
import { Type } from '@7b/reflection';

@Component({ template: `{{ model }}` })
export class StringCellComponent {
    @Input() model: any;
    @Input() type!: Type;
}
