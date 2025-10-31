import { Server } from '@d7/broker';
import { RpcTcpClientAdapter } from '@d7/rpc-tcp';
import { BrokerConfig } from './module.config.js';

export function getBrokerServers(config: BrokerConfig): Server[] {
    const servers: Server[] = [];
    const hosts = Array.isArray(config.host) ? config.host : [config.host];
    for (const host of hosts) {
        servers.push({ url: '', transport: new RpcTcpClientAdapter(host) });
    }
    return servers;
}
