import { MaxLength } from '@7b/reflection';
import { http } from '@7b/io/http';
import { Service } from '../app/service';

export class HelloWorldControllerHttp {
    constructor(private service: Service) {
    }

    @http.GET('/')
    async index() {
        return `Hello World`;
    }

    @http.GET('/hello/:name')
    async hello(name: string & MaxLength<6> = 'World') {
        this.service.doIt();

        return `Hello ${name}!`;
    }
}
