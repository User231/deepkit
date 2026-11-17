/**
 * A union with SEVERAL object members and nothing that discriminates them by a literal:
 * `Model | Tag`.
 *
 * The serializer checked its members one by one, and the check of an object member was "is an
 * object" — so any object went to the FIRST object member, and a value of the second was
 * written by the first one's properties: `Cannot convert undefined to string at v.name`, or,
 * where both declare the name with another type, a WRONG VALUE with no error (`'x'` written
 * through `value: number` came back as `0`). The member is chosen from the value's properties
 * now, with the weights `@deepkit/type`'s union handler uses.
 *
 * The deserializer chose from the NUMBER of fields wherever the members declare different
 * numbers of properties, and trusted a member's deserializer to throw for a document that is
 * not its own. It does not (a missing property is filled in, an INT is read into a `string`),
 * so a three-field document of a four-property member came back as the three-property member.
 * It chooses from the field NAMES now, for every union.
 *
 * Every case here is checked three ways, in whichever mode the run is in (the suite runs
 * compiled and with `DEEPKIT_JIT_MODE=interpreted`): the bytes are those the official `bson`
 * package writes for the value (so the right member wrote them), they decode to the value, and
 * they decode to it AGAIN (the first decode learns a shape, the repeat runs what was learned).
 */
import * as bson from 'bson';
import { describe, test } from 'node:test';

import { expect } from '@deepkit/run/expect';
import { ReceiveType, resolveReceiveType } from '@deepkit/type';

import { getBSONDeserializer, getBSONSerializer } from '../index.js';

interface Tag {
    id: number;
    label: string;
}

interface Model {
    id: number;
    name: string;
    active: boolean;
}

/** `value` under the same name as `Numbered`, with another type. */
interface Texted {
    id: number;
    value: string;
}

interface Numbered {
    id: number;
    value: number;
}

/** As many REQUIRED properties as `Tag`, more declared: a document of it has 2, 3 or 4 fields. */
interface Wide {
    id: number;
    label: string;
    extra?: string;
    more?: number;
}

/** `Numbered` with one optional property: three declared, two or three written. */
interface NumberedFlagged {
    id: number;
    value: number;
    flag?: boolean;
}

const tag: Tag = { id: 1, label: 'x' };
const model: Model = { id: 2, name: 'n', active: true };
const texted: Texted = { id: 3, value: 'x' };
const numbered: Numbered = { id: 4, value: 5 };

/**
 * Serialize `value` as `T`, expect the official package's bytes for it, and expect them to
 * decode to `value` — twice.
 */
function expectRoundTrip<T>(value: T, type?: ReceiveType<T>): T {
    const resolved = resolveReceiveType(type);
    const [buffer, size] = getBSONSerializer(resolved)(value);
    const bytes = buffer.slice(0, size);
    // The official package refuses an array at the root; its document has the indices as keys.
    const document = Array.isArray(value) ? { ...value } : value;
    expect(Buffer.from(bytes)).toEqual(Buffer.from(bson.serialize(document as any)));

    const deserialize = getBSONDeserializer<T>(resolved);
    const first = deserialize(bytes);
    expect(first).toEqual(value);
    expect(deserialize(bytes)).toEqual(value);
    return first;
}

describe('a union of two object types as a property', () => {
    test('Model | Tag', () => {
        expectRoundTrip<{ v: Model | Tag }>({ v: tag });
        expectRoundTrip<{ v: Model | Tag }>({ v: model });
    });

    test('Tag | Model', () => {
        expectRoundTrip<{ v: Tag | Model }>({ v: tag });
        expectRoundTrip<{ v: Tag | Model }>({ v: model });
    });

    test('one serializer, both members in turn', () => {
        const serialize = getBSONSerializer<{ v: Model | Tag }>();
        const deserialize = getBSONDeserializer<{ v: Model | Tag }>();
        for (const v of [tag, model, model, tag, tag, model]) {
            const [buffer, size] = serialize({ v });
            expect(deserialize(buffer.slice(0, size))).toEqual({ v });
        }
    });

    test('optional and nullable', () => {
        expectRoundTrip<{ v?: Model | Tag }>({ v: tag });
        expectRoundTrip<{ v?: Model | Tag }>({ v: model });
        expectRoundTrip<{ v?: Model | Tag }>({});
        expectRoundTrip<{ v: Model | Tag | null }>({ v: tag });
        expectRoundTrip<{ v: Model | Tag | null }>({ v: model });
        expectRoundTrip<{ v: Model | Tag | null }>({ v: null });
    });

    test('inside a nested object', () => {
        expectRoundTrip<{ outer: { inner: Model | Tag; n: number } }>({ outer: { inner: tag, n: 1 } });
        expectRoundTrip<{ outer: { inner: Tag | Model; n: number } }>({ outer: { inner: model, n: 1 } });
    });

    test('inside a member of a discriminated union', () => {
        type T = { v: { kind: 'a'; x: Model | Tag } | { kind: 'b'; y: number } };
        expectRoundTrip<T>({ v: { kind: 'a', x: tag } });
        expectRoundTrip<T>({ v: { kind: 'a', x: model } });
        expectRoundTrip<T>({ v: { kind: 'b', y: 3 } });
    });

    test('three members', () => {
        type T = { v: Model | Tag | Texted };
        expectRoundTrip<T>({ v: model });
        expectRoundTrip<T>({ v: tag });
        expectRoundTrip<T>({ v: texted });
    });
});

describe('a union of two object types in an array', () => {
    test('(Model | Tag)[]', () => {
        expectRoundTrip<{ e: (Model | Tag)[] }>({ e: [tag, model, tag, { id: 9, name: 'z', active: false }] });
        expectRoundTrip<{ e: (Model | Tag)[] }>({ e: [] });
    });

    test('(Tag | Model)[]', () => {
        expectRoundTrip<{ e: (Tag | Model)[] }>({ e: [model, tag, model] });
    });

    test('a top-level array', () => {
        expectRoundTrip<(Model | Tag)[]>([tag, model]);
        expectRoundTrip<(Tag | Model)[]>([model, tag]);
    });

    test('rows of one member only', () => {
        expectRoundTrip<{ e: (Model | Tag)[] }>({ e: [tag, { id: 7, label: 'y' }] });
        expectRoundTrip<{ e: (Tag | Model)[] }>({ e: [model, { id: 8, name: 'm', active: false }] });
    });
});

describe('a union of two object types in a record', () => {
    test('Record<string, Model | Tag>', () => {
        expectRoundTrip<{ r: Record<string, Model | Tag> }>({ r: { a: tag, b: model, c: tag } });
    });

    test('Record<string, Tag | Model>', () => {
        expectRoundTrip<{ r: Record<string, Tag | Model> }>({ r: { a: model, b: tag } });
    });

    test('an index signature beside declared properties', () => {
        type T = { n: number; [key: string]: Model | Tag | number };
        expectRoundTrip<T>({ n: 1, a: tag, b: model });
    });
});

describe('a union of two object types at the top level', () => {
    test('Model | Tag, both orders', () => {
        expectRoundTrip<Model | Tag>(tag);
        expectRoundTrip<Model | Tag>(model);
        expectRoundTrip<Tag | Model>(tag);
        expectRoundTrip<Tag | Model>(model);
    });

    test('the same property name with another type', () => {
        expectRoundTrip<Texted | Numbered>(texted);
        expectRoundTrip<Texted | Numbered>(numbered);
        expectRoundTrip<Numbered | Texted>(texted);
        expectRoundTrip<Numbered | Texted>(numbered);
    });
});

describe('members that declare the same property name with different types', () => {
    test('Texted | Numbered as a property', () => {
        expectRoundTrip<{ v: Texted | Numbered }>({ v: texted });
        expectRoundTrip<{ v: Texted | Numbered }>({ v: numbered });
    });

    test('Numbered | Texted as a property — a string is not written as a number', () => {
        // Was no error at all: `'x'` went through `value: number` and decoded as `0`.
        expectRoundTrip<{ v: Numbered | Texted }>({ v: texted });
        expectRoundTrip<{ v: Numbered | Texted }>({ v: numbered });
    });

    test('in an array and in a record', () => {
        expectRoundTrip<{ e: (Texted | Numbered)[] }>({ e: [numbered, texted, numbered] });
        expectRoundTrip<{ e: (Numbered | Texted)[] }>({ e: [texted, numbered] });
        expectRoundTrip<{ r: Record<string, Numbered | Texted> }>({ r: { a: texted, b: numbered } });
    });

    test('the type decides against a member that knows more of the keys', () => {
        // `note` is declared by the first member only, `value` is a number: the second.
        interface TextedNoted {
            id: number;
            value: string;
            note?: string;
        }
        const serialize = getBSONSerializer<{ v: TextedNoted | Numbered }>();
        const [buffer, size] = serialize({ v: { id: 1, value: 5, note: 'n' } as any });
        expect(bson.deserialize(buffer.slice(0, size))).toEqual({ v: { id: 1, value: 5 } });
    });

    test('a literal property that is not a discriminator of the whole union', () => {
        interface Draft {
            state: 'draft';
            title: string;
        }
        interface Published {
            state: string;
            title: string;
            at: number;
        }
        expectRoundTrip<{ v: Draft | Published }>({ v: { state: 'draft', title: 't' } });
        expectRoundTrip<{ v: Draft | Published }>({ v: { state: 'live', title: 't', at: 5 } });
        expectRoundTrip<{ v: Published | Draft }>({ v: { state: 'draft', title: 't' } });
        expectRoundTrip<{ v: Published | Draft }>({ v: { state: 'live', title: 't', at: 5 } });
    });
});

describe('a union of object types that also holds a primitive', () => {
    test('Model | Tag | string', () => {
        expectRoundTrip<{ v: Model | Tag | string }>({ v: tag });
        expectRoundTrip<{ v: Model | Tag | string }>({ v: model });
        expectRoundTrip<{ v: Model | Tag | string }>({ v: 'hello' });
    });

    test('number | Tag | Model', () => {
        expectRoundTrip<{ v: number | Tag | Model }>({ v: 5 });
        expectRoundTrip<{ v: number | Tag | Model }>({ v: tag });
        expectRoundTrip<{ v: number | Tag | Model }>({ v: model });
    });

    test('Tag | boolean | Model | null in an array', () => {
        expectRoundTrip<{ e: (Tag | boolean | Model | null)[] }>({ e: [model, true, null, tag, false] });
    });

    test('beside an array member', () => {
        expectRoundTrip<{ v: Model | Tag | number[] }>({ v: tag });
        expectRoundTrip<{ v: Model | Tag | number[] }>({ v: model });
        expectRoundTrip<{ v: Model | Tag | number[] }>({ v: [1, 2, 3] });
    });

    test('beside a Date', () => {
        const at = new Date('2026-11-17T10:00:00.000Z');
        expectRoundTrip<{ v: Model | Tag | Date }>({ v: at });
        expectRoundTrip<{ v: Model | Tag | Date }>({ v: tag });
        expectRoundTrip<{ v: Date | Tag | Model }>({ v: model });
    });
});

describe('members that declare different numbers of properties', () => {
    // What the deserializer chose by counting fields.
    test('Model | Wide — a document with as many fields as the other member has properties', () => {
        expectRoundTrip<{ v: Model | Wide }>({ v: { id: 1, label: 'l' } });
        expectRoundTrip<{ v: Model | Wide }>({ v: { id: 1, label: 'l', extra: 'e' } });
        expectRoundTrip<{ v: Model | Wide }>({ v: { id: 1, label: 'l', extra: 'e', more: 3 } });
        expectRoundTrip<{ v: Model | Wide }>({ v: model });
    });

    test('Wide | Model', () => {
        expectRoundTrip<{ v: Wide | Model }>({ v: { id: 1, label: 'l', extra: 'e' } });
        expectRoundTrip<{ v: Wide | Model }>({ v: model });
    });

    test('Texted | NumberedFlagged — a number is not read as a string', () => {
        expectRoundTrip<{ v: Texted | NumberedFlagged }>({ v: { id: 1, value: 5 } });
        expectRoundTrip<{ v: Texted | NumberedFlagged }>({ v: { id: 1, value: 5, flag: true } });
        expectRoundTrip<{ v: Texted | NumberedFlagged }>({ v: texted });
        expectRoundTrip<{ v: NumberedFlagged | Texted }>({ v: { id: 1, value: 5 } });
        expectRoundTrip<{ v: NumberedFlagged | Texted }>({ v: texted });
    });

    test('in an array, in a record and at the top level', () => {
        expectRoundTrip<{ e: (Model | Wide)[] }>({ e: [{ id: 1, label: 'l', extra: 'e' }, model] });
        expectRoundTrip<{ r: Record<string, Model | Wide> }>({ r: { a: { id: 1, label: 'l', extra: 'e' }, b: model } });
        expectRoundTrip<Model | Wide>({ id: 1, label: 'l', extra: 'e' });
        expectRoundTrip<Texted | NumberedFlagged>({ id: 1, value: 5 });
    });

    test('one member declares a subset of the other', () => {
        interface Small {
            a: number;
        }
        interface Large {
            a: number;
            b: number;
        }
        expectRoundTrip<{ v: Small | Large }>({ v: { a: 1 } });
        expectRoundTrip<{ v: Small | Large }>({ v: { a: 1, b: 2 } });
        expectRoundTrip<{ v: Large | Small }>({ v: { a: 1 } });
        expectRoundTrip<{ v: Large | Small }>({ v: { a: 1, b: 2 } });
    });

    test('fields in another order, and one no member declares', () => {
        const deserialize = getBSONDeserializer<{ v: Model | Tag }>();
        const reordered = bson.serialize({ v: { label: 'x', unknown: 1, id: 1 } });
        expect(deserialize(reordered)).toEqual({ v: tag });
        expect(deserialize(reordered)).toEqual({ v: tag });
        const reorderedModel = bson.serialize({ v: { active: true, unknown: 1, name: 'n', id: 2 } });
        expect(deserialize(reorderedModel)).toEqual({ v: model });
    });
});

describe('a union of two classes', () => {
    class TagClass {
        id: number = 0;
        label: string = '';
    }

    class ModelClass {
        id: number = 0;
        name: string = '';
        active: boolean = false;
    }

    function tagInstance(): TagClass {
        return Object.assign(new TagClass(), tag);
    }

    function modelInstance(): ModelClass {
        return Object.assign(new ModelClass(), model);
    }

    test('instances come back as instances of their own class', () => {
        const backTag = expectRoundTrip<{ v: ModelClass | TagClass }>({ v: tagInstance() });
        expect(backTag.v).toBeInstanceOf(TagClass);
        const backModel = expectRoundTrip<{ v: ModelClass | TagClass }>({ v: modelInstance() });
        expect(backModel.v).toBeInstanceOf(ModelClass);

        expect(expectRoundTrip<{ v: TagClass | ModelClass }>({ v: modelInstance() }).v).toBeInstanceOf(ModelClass);
        expect(expectRoundTrip<{ v: TagClass | ModelClass }>({ v: tagInstance() }).v).toBeInstanceOf(TagClass);
    });

    test('plain objects are written by the member whose properties they have', () => {
        const serialize = getBSONSerializer<{ v: ModelClass | TagClass }>();
        const deserialize = getBSONDeserializer<{ v: ModelClass | TagClass }>();
        for (const [plain, classType] of [
            [tag, TagClass],
            [model, ModelClass],
        ] as const) {
            const [buffer, size] = serialize({ v: plain as any });
            const bytes = buffer.slice(0, size);
            expect(bson.deserialize(bytes)).toEqual({ v: plain });
            const back = deserialize(bytes);
            expect(back.v).toBeInstanceOf(classType);
            expect({ ...back.v }).toEqual(plain);
        }
    });

    test('an instance is its own class, whatever its properties say', () => {
        class Base {
            id: number = 0;
        }
        class Derived extends Base {
            extra?: string;
        }
        // A Derived without `extra` has exactly Base's keys; a Base is never a Derived.
        const serialize = getBSONSerializer<{ e: (Base | Derived)[] }>();
        const [buffer, size] = serialize({ e: [Object.assign(new Derived(), { id: 1 }), new Base()] });
        expect(bson.deserialize(buffer.slice(0, size))).toEqual({ e: [{ id: 1 }, { id: 0 }] });
    });

    test('a class and an interface', () => {
        expectRoundTrip<{ v: ModelClass | Tag }>({ v: tag });
        expect(expectRoundTrip<{ v: Tag | ModelClass }>({ v: modelInstance() }).v).toBeInstanceOf(ModelClass);
    });

    test('in an array', () => {
        const back = expectRoundTrip<{ e: (ModelClass | TagClass)[] }>({ e: [tagInstance(), modelInstance()] });
        expect(back.e[0]).toBeInstanceOf(TagClass);
        expect(back.e[1]).toBeInstanceOf(ModelClass);
    });
});

describe('a value that is no member', () => {
    test('is refused by the member it is nearest to, with the path', () => {
        const serialize = getBSONSerializer<{ v: Model | Tag }>();
        // The keys say which member was meant; the error names what is wrong with it.
        expect(() => serialize({ v: { id: 1, label: 5 } as any })).toThrow('Cannot convert 5 to string at v.label');
        expect(() => serialize({ v: { id: 1, name: 5, active: true } as any })).toThrow('Cannot convert 5 to string at v.name');
    });

    test('a primitive is not an object member', () => {
        const serialize = getBSONSerializer<{ v: Model | Tag }>();
        expect(() => serialize({ v: 'text' as any })).toThrow('No member matched');
        expect(() => serialize({ v: [tag] as any })).toThrow('No member matched');
    });
});
