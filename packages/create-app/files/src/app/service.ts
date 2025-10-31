import { Logger } from '@d7/logger';

export class Service {
    constructor(private logger: Logger) {
    }

    doIt(): boolean {
        this.logger.log('Hello from the Service');
        return true;
    }
}
