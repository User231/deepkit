import { entity, PrimaryKey, Reference } from '@7b/reflection';
import { User } from './user.js';


@entity.name('user-credentials')
export class UserCredentials {
    password: string = '';

    constructor(public user: User & PrimaryKey & Reference) {
    }
}
