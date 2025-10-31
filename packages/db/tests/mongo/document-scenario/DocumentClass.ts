import {PageCollection} from './PageCollection.js';
import {PageClass} from './PageClass.js';
import {t, ParentReference} from '@7b/reflection';
import {Forward} from '@7b/runtime';

export class DocumentClass {
    @t.primary.mongoId
    _id?: string;

    @t.optional
    name?: string;

    @t.type(PageCollection)
    pages: PageCollection = new PageCollection;

    @t.type(() => PageClass)
    page?: Forward<PageClass>;
}

export class ClassWithUnmetParent {
    @t.type(ClassWithUnmetParent).parentReference
    parent?: ClassWithUnmetParent;
}
