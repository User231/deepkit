/**
 * Runs in a subprocess with --disallow-code-generation-from-strings (what a strict CSP without
 * 'unsafe-eval' is to V8): everything `@deepkit/type` builds must fall back to the interpreter,
 * and nothing in the package may need `new Function` for itself. Spawned by csp-fallback.spec.ts;
 * prints "ok" on success, throws otherwise.
 */
import { canJIT } from '@deepkit/core';

import { cast, deserialize, is, serialize, validate } from '../index.js';

if (canJIT) throw new Error('expected canJIT=false under --disallow-code-generation-from-strings');

interface Tag {
    id: number;
    label: string;
}
class Model {
    id: number = 0;
    name: string = '';
    active: boolean = false;
    score?: number;
    created: Date = new Date(0);
    tags: Tag[] = [];
    meta: Record<string, string | number> = {};
    kind: 'a' | 'b' | 'c' = 'a';
    big: bigint = 0n;
    bytes: Uint8Array = new Uint8Array();
}

function same(a: unknown, b: unknown, what: string): void {
    // Keys are sorted: optional properties are written after the required ones, in every mode.
    const show = (v: unknown) =>
        JSON.stringify(v, (_k, x) => {
            if (typeof x === 'bigint') return `${x}n`;
            if (x && typeof x === 'object' && !Array.isArray(x))
                return Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1)));
            return x;
        });
    if (show(a) !== show(b)) throw new Error(`${what}: ${show(a)} !== ${show(b)}`);
}

const json = {
    id: 12,
    name: 'hello',
    active: true,
    score: 1.5,
    created: '2026-01-01T00:00:00.123Z',
    tags: [
        { id: 1, label: 'x' },
        { id: 2, label: 'y' },
    ],
    meta: { a: 'b', c: 2 },
    kind: 'b',
    big: '9007199254740993',
    bytes: 'AQID',
};

const model = deserialize<Model>(json);
if (!(model instanceof Model)) throw new Error('deserialize: not a Model');
if (!(model.created instanceof Date) || model.created.getTime() !== Date.UTC(2026, 0, 1, 0, 0, 0, 123))
    throw new Error('deserialize: created');
if (model.big !== 9007199254740993n) throw new Error('deserialize: big');
same([...model.bytes], [1, 2, 3], 'deserialize: bytes');
same(model.tags, json.tags, 'deserialize: tags');

same(serialize<Model>(model), json, 'serialize');
same(serialize<Model>(cast<Model>(json)), json, 'cast');

if (!is<Model>(model)) throw new Error('is: a Model is not a Model');
if (is<Model>({ ...model, id: 'twelve' })) throw new Error('is: accepted a string id');
if (is<Tag[]>([{ id: 1 }])) throw new Error('is: accepted a tag without a label');

same(validate<Model>(model), [], 'validate: valid');
same(
    validate<Tag>({ id: 'one', label: 2 }).map(e => e.path),
    ['id', 'label'],
    'validate: paths',
);

let refused = false;
try {
    cast<Tag>({ id: 'one', label: 'x' });
} catch {
    refused = true;
}
if (!refused) throw new Error('cast: accepted a string id');

type Shape = { kind: 'circle'; r: number } | { kind: 'rect'; w: number; h: number };
same(
    deserialize<Shape[]>([
        { kind: 'rect', w: 1, h: 2 },
        { kind: 'circle', r: 3 },
    ]),
    [
        { kind: 'rect', w: 1, h: 2 },
        { kind: 'circle', r: 3 },
    ],
    'union',
);
if (is<Shape>({ kind: 'rect', r: 3 })) throw new Error('is: accepted a rect with a radius');

console.log('ok');
