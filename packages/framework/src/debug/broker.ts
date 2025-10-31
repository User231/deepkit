import { BrokerBus, BrokerDeepkitAdapter } from '@7b/io/broker';
import { FrameworkConfig } from '../module.config.js';
import { getBrokerServers } from '../broker.js';

export class DebugBrokerBus extends BrokerBus {
    constructor(config: FrameworkConfig) {
        super(new BrokerDeepkitAdapter({ servers: getBrokerServers(config.broker) }));
    }
}
