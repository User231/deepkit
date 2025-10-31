import { Flag } from '@d7/app';

export class BaseCommand {
    /**
     * @description Sets the migration directory.
     */
    protected migrationDir: string & Flag = '';
}
