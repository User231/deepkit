import { provideRpcWebSocketClient } from '@7b/io/rpc';
import { provideState } from '@7b/ui';
import { State } from './app/state';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app/routes';
import { provideApiConsoleRegistry, routes as apiConsoleRoutes } from '@7b/ui';
import { provideOrmBrowserRegistry, routes as ormBrowserRoutes } from '@7b/ui';
import { provideZonelessChangeDetection } from '@angular/core';
import { EventDispatcher } from '@7b/core';

bootstrapApplication(AppComponent, {
    providers: [
        EventDispatcher,
        provideZonelessChangeDetection(),
        provideRpcWebSocketClient(undefined, { 4200: 8080 }),
        provideState(State),
        provideRouter([
            ...routes,
            ...apiConsoleRoutes,
            ...ormBrowserRoutes,
        ], withHashLocation()),
        provideApiConsoleRegistry(),
        provideOrmBrowserRegistry(),
    ],
})
    .catch(err => console.error(err));
