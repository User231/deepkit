import { AutoIncrement, entity, PrimaryKey, Unique } from '@d7/type';
import { ActiveRecord } from '@d7/orm';

@entity.name('active-record-tag')
export class Tag extends ActiveRecord {
    public id?: number & PrimaryKey & AutoIncrement;
    created: Date = new Date;
    stars: number = 0;

    constructor(
        public name: string & Unique,
    ) {
        super();
    }
}
