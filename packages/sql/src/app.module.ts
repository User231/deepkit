import { AppModule, ConsoleTransport, InjectorContext, Logger } from '@7b/core';
import { DatabaseRegistry } from '@7b/db';
import { MigrationCreateController } from './cli/migration-create-command.js';
import { MigrationDownCommand } from './cli/migration-down-command.js';
import { MigrationUpCommand } from './cli/migration-up-command.js';
import { MigrationPendingCommand } from './cli/migration-pending-command.js';
import { MigrationProvider } from './migration/migration-provider.js';

export const appModule = new AppModule({}, {
    providers: [
        MigrationProvider,
        { provide: DatabaseRegistry, useFactory: (ic: InjectorContext) => new DatabaseRegistry(ic) },
        { provide: Logger, useValue: new Logger([new ConsoleTransport]) }
    ],
    controllers: [
        MigrationCreateController,
        MigrationDownCommand,
        MigrationUpCommand,
        MigrationPendingCommand,
    ]
});
