import { mergeApplicationConfig } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import type { BootstrapContext } from '@angular/platform-browser';

import { AppComponent } from './app/app.component';
import { config } from './app/app.config.server';

export { platformServer } from '@angular/platform-server';
export { Router } from '@angular/router';

// Angular 19+ passes a `BootstrapContext` (carrying the server platform ref) to the
// server bootstrap fn; it MUST be forwarded as the 3rd arg of `bootstrapApplication`,
// otherwise route extraction / SSR throws NG0401 "Missing Platform" (PLATFORM_NOT_FOUND).
export const bootstrap = (context: BootstrapContext) => {
    return bootstrapApplication(
        AppComponent,
        mergeApplicationConfig(config, {
            providers: [],
        }),
        context,
    );
};

export default bootstrap;
