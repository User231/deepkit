import { Component, Input, OnChanges, OnInit } from '@angular/core';
import { TypeEnum } from '@d7/type';

@Component({ template: `{{ keyValueMap ? keyValueMap[model] : model }}` })
export class EnumCellComponent implements OnChanges, OnInit {
    @Input() model: any;
    @Input() type!: TypeEnum;

    keyValueMap?: any;

    ngOnInit() {
        this.load();
    }

    ngOnChanges() {
        this.load();
    }

    load() {
        this.keyValueMap = {};
        for (const [label, value] of Object.entries(this.type.enum)) {
            this.keyValueMap[value as any] = label;
        }
    }
}
