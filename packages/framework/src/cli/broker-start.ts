import { cli, Command } from '@d7/app';
import { BrokerServer } from '../broker/broker.js';

/**
 * @description Starts the broker server manually.
 */
@cli.controller('server:broker:start')
export class ServerStartController implements Command {
    constructor(
        protected server: BrokerServer,
    ) {
    }

    async execute(): Promise<void> {
        await this.server.start();
    }
}
