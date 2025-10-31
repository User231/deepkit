import { Flag, LoggerInterface, cli } from '@7b/core';

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
