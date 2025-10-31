import { EfficientState } from '@d7/desktop-ui';
import { EventToken } from '@d7/event';
import { Progress } from '@d7/rpc';
import { Excluded } from '@d7/type';

export const fileQueuedEvent = new EventToken('file.queued');
export const fileAddedEvent = new EventToken('file.added');
export const fileUploadedEvent = new EventToken('file.uploaded');

export interface FileToUpload {
    filesystem: number;
    name: string;
    dir: string;
    data: Uint8Array;
    progress?: Progress;
    done?: true;
    errored?: true;
}

export class VolatileState {
    filesToUpload: FileToUpload[] = [];
}

export class State extends EfficientState {

    volatile: VolatileState & Excluded = new VolatileState();

    media: { view: 'icons' | 'list' } = {
        view: 'icons'
    };
}
