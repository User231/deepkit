import { AutoIncrement, entity, PrimaryKey, Reference } from '@7b/reflection';
import { ActiveRecord } from '@7b/db';
import { Book } from './book.js';
import { Tag } from './tag.js';

@(entity.name('active-record-book-tag').index(['book', 'tag']))
export class BookTag extends ActiveRecord {
    public id?: number & AutoIncrement & PrimaryKey;

    constructor(
        public book: Book & Reference,
        public tag: Tag & Reference,
    ) {
        super()
    }
}
