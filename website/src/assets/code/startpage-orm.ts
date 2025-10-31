import { AutoIncrement, MaxLength, MinLength,
    PrimaryKey, Unique } from '@d7/type';
import { Database } from '@d7/orm';
import { SqliteDatabaseAdapter } from '@d7/sql';

type Username = string & Unique & MinLength<3> & MaxLength<20>;

class User {
    id: number & AutoIncrement & PrimaryKey = 0;
    created: Date = new Date;

    constructor(
        public username: Username
    ) {
    }
}


const database = new Database(SqliteDatabaseAdapter(':memory:'), [User]);
await database.migrate(); //create tables

database.persist(new User('Peter'));

const user = await database.query(User)
    .find({ username: 'Peter' })
    .findOne();
