#!/usr/bin/env node

import { App } from '@7b/core';
import { ConsoleTransport, Logger } from '@7b/core';
import { CreateController } from './src/controller/create.js';

new App({
    controllers: [CreateController],
    providers: [{ provide: Logger, useValue: new Logger([new ConsoleTransport]) }]
}).run(['create', ...process.argv.slice(2)]);
