import { provideRpcWebSocketClient } from '@d7/rpc';
import { provideState } from '@d7/desktop-ui';
import { State } from './app/state';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app/routes';
import { provideApiConsoleRegistry, routes as apiConsoleRoutes } from '@d7/api-console-gui';
import { provideOrmBrowserRegistry, routes as ormBrowserRoutes } from '@d7/orm-browser-gui';
import { provideZonelessChangeDetection } from '@angular/core';
import { EventDispatcher } from '@d7/event';

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
