import { Logger } from '@7b/core';

export class Service {
    constructor(private logger: Logger) {
    }

    doIt(): boolean {
        this.logger.log('Hello from the Service');
        return true;
    }
}
