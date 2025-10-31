import { AutoIncrement, entity, PrimaryKey } from '@7b/reflection';

@entity.name('group')
export class Group {
    public id?: number & PrimaryKey & AutoIncrement;
    created: Date = new Date;

    constructor(
        public name: string
    ) {
    }
}
