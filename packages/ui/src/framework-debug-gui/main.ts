import { provideRpcWebSocketClient } from '@7b/io/rpc';
import { provideApiConsoleRegistry, provideOrmBrowserRegistry, provideState, routes as apiConsoleRoutes, routes as ormBrowserRoutes } from '@7b/ui';
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
