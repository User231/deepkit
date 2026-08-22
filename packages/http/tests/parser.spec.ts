import { test } from 'node:test';
import { json } from 'stream/consumers';

import { expect } from '@deepkit/run/expect';

import { HttpBody, HttpRequest } from '../src/model';
import { HttpConfig } from '../src/module.config';
import { parseRequestBody } from '../src/request-parser';
import { HttpRouterRegistry, UploadedFile } from '../src/router';
import { createHttpKernel } from './utils';

test('multipart posts', async () => {
    const httpConfig = new HttpConfig();
    httpConfig.parser.multipartJsonKey = 'json';

    const httpKernel = createHttpKernel(
        (registry: HttpRouterRegistry) => {
            interface Input {
                file: UploadedFile;
                jsonA: string;
                jsonB: number;
                singleField: string;
                multiField: string[];
            }
            registry.post('/', (body: HttpBody<Input>) => body);
        },
        [],
        [],
        [],
        [],
        httpConfig,
    );

    const response = await httpKernel.request(
        HttpRequest.POST('/').multiPart([
            { name: 'file', file: Buffer.from('the quick brown fox jumps over the lazy dog'), fileName: 'fox.txt' },
            {
                name: 'json',
                value: JSON.stringify({
                    jsonA: 'someValue',
                    jsonB: 42,
                }),
            },
            {
                name: 'singleField',
                value: 'singleValue',
            },
            {
                name: 'multiField',
                value: 'firstValue',
            },
            {
                name: 'multiField',
                value: 'secondValue',
            },
        ]),
    );

    expect(response.json).toMatchObject({
        file: {
            name: 'fox.txt',
            size: 43,
            path: expect.any(String),
            type: 'application/octet-stream',
        },
        jsonA: 'someValue',
        jsonB: 42,
        singleField: 'singleValue',
        multiField: ['firstValue', 'secondValue'],
    });
});

test('parseRequestBody reads a multipart body from a hand-written route', async () => {
    // A transport that owns its own request shape — the GraphQL multipart
    // request spec, a webhook — cannot declare an `HttpBody<T>` to cast into,
    // so it asks the framework's parser directly rather than bringing a
    // second multipart implementation into the process.
    const httpKernel = createHttpKernel((registry: HttpRouterRegistry) => {
        registry.post('/raw', async (request: HttpRequest) => {
            const body = await parseRequestBody(request);
            const file = body['0'] as UploadedFile;
            return {
                operations: body.operations,
                map: body.map,
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
            };
        });
    });

    const response = await httpKernel.request(
        HttpRequest.POST('/raw').multiPart([
            { name: 'operations', value: '{"query":"mutation($f: Upload!){ add(file: $f) }","variables":{"f":null}}' },
            { name: 'map', value: '{"0":["variables.f"]}' },
            { name: '0', file: Buffer.from('the quick brown fox'), fileName: 'fox.txt', contentType: 'text/plain' },
        ]),
    );

    expect(response.json).toMatchObject({
        operations: '{"query":"mutation($f: Upload!){ add(file: $f) }","variables":{"f":null}}',
        map: '{"0":["variables.f"]}',
        fileName: 'fox.txt',
        fileSize: 19,
        fileType: 'text/plain',
    });
});
