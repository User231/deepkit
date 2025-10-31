import { Flag } from '@7b/core';

export class BaseCommand {
    /**
     * @description Sets the migration directory.
     */
    protected migrationDir: string & Flag = '';
}
