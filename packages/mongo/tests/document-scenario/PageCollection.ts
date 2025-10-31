import {PageClass} from "./PageClass.js";
import {t} from "@d7/type";

export class PageCollection {
    constructor(
        @t.array(() => PageClass).decorated
        private readonly pages: PageClass[] = []
    ) {
    }

    public get(index: number): PageClass | null {
        return this.pages[index] || null
    }

    public count(): number {
        return this.pages.length;
    }
}
