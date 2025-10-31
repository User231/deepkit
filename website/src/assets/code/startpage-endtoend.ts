import {AutoIncrement, PrimaryKey,
    MinLength, Unique} from '@d7/type';

type Username = string & Unique & MinLength<4>;

class User {
    id: number & PrimaryKey & AutoIncrement = 0;

    created: Date = new Date;
    firstName: string = '';
    lastName: string = '';
    birthDate?: Date;

    constructor(
        public username: Username
    ) {}
}

type CreateUser = Omit<User, 'id' | 'created'>;
