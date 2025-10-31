#!/usr/bin/env ts-node

/*

This example demonstrates how to overwrite the AccessDenied event and print your own response.

*/

import { App } from '@d7/app';
import { eventDispatcher } from '@d7/event';
import { HtmlResponse, http, HttpAccessDeniedError, httpWorkflow } from '@d7/http';
import { FrameworkModule } from '@d7/framework';

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
