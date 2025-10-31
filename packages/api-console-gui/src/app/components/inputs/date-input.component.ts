import { Component, EventEmitter, input, model, Output } from '@angular/core';
import { TypeClass } from '@7b/reflection';
import { DataStructure } from '../../store';
import { InputComponent } from '@7b/ui';
import { FormsModule } from '@angular/forms';
import { TypeDecoration } from '../../utils.js';

@Component({
    template: `
      <dui-input round lightFocus type="datetime-local" style="width: 100%"
                 (keydown)="keyDown.emit($event)"
                 [(ngModel)]="model().value" />
    `,
    imports: [
        InputComponent,
        FormsModule,
    ],
})
export class DateInputComponent {
    model = model.required<DataStructure>();
    decoration = input<TypeDecoration>();
    type = input.required<TypeClass>();

    @Output() keyDown = new EventEmitter<KeyboardEvent>();
}
