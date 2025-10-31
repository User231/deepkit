import { App } from '@d7/app';
import { expect, test } from '@jest/globals';
import { ApiConsoleModule } from '../src/module.js';
import { HttpKernel, HttpModule, HttpRequest } from '@d7/http';
import { ApiEntryPoints } from '@d7/api-console-gui/src/api';
import { reflect, ReflectionKind, TypeObjectLiteral } from '@d7/type';
import { serializeBSON } from '@d7/bson';

test('type api', () => {
    const type = reflect(ApiEntryPoints);
    // const serialized = serializeType(type);

    const v: TypeObjectLiteral = {
        kind: ReflectionKind.objectLiteral, types: [
            { kind: ReflectionKind.propertySignature, name: 'v', type: type, parent: Object as any }
        ]
    };

    //todo: this hangs. investigate why
    serializeBSON({
        v: {
            httpRoutes: [],
            rpcActions: [],
        }
    }, undefined, v);
});

test('module basic functionality', async () => {
    const app = new App({
        imports: [
            new ApiConsoleModule({ path: '/my-api' }),
            new HttpModule()
        ]
    });

    const http = app.get(HttpKernel);

    {
        const response = await http.request(HttpRequest.GET('/my-api'));
        expect(response.statusCode).toBe(200);
        expect(response.bodyString).toContain('/my-api');
    }
});
