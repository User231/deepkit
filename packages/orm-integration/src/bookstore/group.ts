import { AutoIncrement, entity, PrimaryKey } from '@d7/type';

@entity.name('group')
export class Group {
    public id?: number & PrimaryKey & AutoIncrement;
    created: Date = new Date;

    constructor(
        public name: string
    ) {
    }
}
