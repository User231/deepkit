import { LoggerInterface } from '@7b/core';
import { SQLiteDatabase, User } from '../database.js';
import { cli, Flag } from '@7b/core';

@cli.controller('users')
export class UsersCommand {
    constructor(protected logger: LoggerInterface, protected database: SQLiteDatabase) {
    }

    async execute(id: number[] & Flag = []): Promise<any> {
        this.logger.log('Loading users ...', id);
        // const users = await this.database.query(User).find();
        // console.table(users);
    }
}
