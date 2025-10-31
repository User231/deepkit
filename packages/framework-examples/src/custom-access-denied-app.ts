#!/usr/bin/env ts-node

/*

This example demonstrates how to overwrite the AccessDenied event and print your own response.

*/

import { App, FrameworkModule, eventDispatcher } from '@7b/core';
import { HtmlResponse, http, HttpAccessDeniedError, httpWorkflow } from '@7b/io/http';

@http.controller()
class ApiController {
    @http.GET()
    startPage() {
        throw new HttpAccessDeniedError();
    }
}

class AuthListener {
    @eventDispatcher.listen(httpWorkflow.onAccessDenied)
    async onAccessDenied(event: typeof httpWorkflow.onAccessDenied.event) {
        event.send(new HtmlResponse('Please login first.', 403));
    }
}

new App({
    listeners: [
        AuthListener
    ],
    controllers: [ApiController],
    imports: [
        new FrameworkModule(),
    ],
}).run();
