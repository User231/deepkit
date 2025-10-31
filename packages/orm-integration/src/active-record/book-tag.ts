import { AutoIncrement, entity, PrimaryKey, Reference } from '@d7/type';
import { ActiveRecord } from '@d7/orm';
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
