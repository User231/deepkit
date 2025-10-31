import { Database } from '@d7/orm';
import { BlogEntity, CommunityMessage, CommunityMessageVote, DocPageContent } from '@app/common/models';
import { AppConfig } from '@app/server/config';
import { PostgresDatabaseAdapter } from '@d7/postgres';
import { BenchmarkRun } from '@app/common/benchmark';
import { AutoIncrement, entity, Index, PrimaryKey, Reference, Unique } from '@d7/type';
import { FileDataEntity, FileEntity } from '@d7/filesystem-database';

type DbConfig = Pick<AppConfig, 'databaseHost' | 'databaseName' | 'databasePort' | 'databaseUser' | 'databasePassword'>;

@(entity.name('user'))
export class UserEntity {
    id: number & PrimaryKey & AutoIncrement = 0;
    createdAt: Date = new Date();
    updatedAt: Date = new Date();
    hash: string = '';
    role: 'user' | 'moderator' | 'admin' = 'user';

    constructor(
        public email: string & Index = '',
    ) {
    }
}

@(entity.name('session'))
export class SessionEntity {
    id: number & PrimaryKey & AutoIncrement = 0;
    createdAt: Date = new Date();
    updatedAt: Date = new Date();
    expiresAt: Date = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // 30 days

    constructor(
        public user: UserEntity & Reference,
        public token: string & Unique,
    ) {
    }
}

export class MainDatabase extends Database {
    constructor(config: DbConfig) {
        super(
            new PostgresDatabaseAdapter({
                database: config.databaseName,
                host: config.databaseHost,
                password: config.databasePassword,
                port: config.databasePort,
                user: config.databaseUser,
            }), [
                CommunityMessage,
                CommunityMessageVote,
                DocPageContent, BenchmarkRun,
                BlogEntity, UserEntity, SessionEntity,
                FileEntity, FileDataEntity
            ]);
    }
}
