import { MaxLength } from '@7b/reflection';
import { Logger, cli } from '@7b/core';
import { Service } from '../app/service';

@cli.controller('hello')
export class HelloWorldControllerCli {
    constructor(private logger: Logger, private service: Service) {
    }

    async execute(name: string & MaxLength<6> = 'World') {
        this.service.doIt();
        this.logger.log(`Hello ${name}!`);
    }
}
