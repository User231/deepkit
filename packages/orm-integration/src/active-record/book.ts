import { ActiveRecord } from '@d7/orm';
import { AutoIncrement, BackReference, entity, PrimaryKey, Reference } from '@d7/type';
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
