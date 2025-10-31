import { ActiveRecord } from '@7b/db';
import { AutoIncrement, BackReference, entity, PrimaryKey, Reference } from '@7b/reflection';
import { User } from '../bookstore/user.js';
import { BookTag } from './book-tag.js';
import { Tag } from './tag.js';

@entity.name('active-record-book')
export class Book extends ActiveRecord {
    public id?: number & PrimaryKey & AutoIncrement;

    tags: Tag[] & BackReference<{via: typeof BookTag}> = [];

    constructor(
        public author: User & Reference,
        public title: string,
    ) {
        super();
    }
}
