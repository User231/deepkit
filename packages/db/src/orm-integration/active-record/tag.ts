import { AutoIncrement, entity, PrimaryKey, Unique } from '@7b/reflection';
import { ActiveRecord } from '@7b/db';

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
