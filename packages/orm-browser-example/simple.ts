import { AutoIncrement, entity, PrimaryKey, t } from '@7b/reflection';
import { Database } from '@7b/db';
import { SQLiteDatabaseAdapter } from '@7b/db/sqlite';

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
