import { MaxLength } from '@d7/type';
import { cli } from '@d7/app';
import { Logger } from '@d7/logger';
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
