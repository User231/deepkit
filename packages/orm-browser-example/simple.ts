import { AutoIncrement, entity, PrimaryKey, t } from '@d7/type';
import { Database } from '@d7/orm';
import { SQLiteDatabaseAdapter } from '@d7/sqlite';

@entity.name('group')
export class Group {
    public id: number & PrimaryKey & AutoIncrement = 0;
    created: Date = new Date;

    constructor(
        public name: string
    ) {
    }
}

const database = new Database(new SQLiteDatabaseAdapter('./example.sqlite'), [Group]);
