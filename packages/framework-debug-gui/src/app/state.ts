import { EfficientState } from '@7b/ui';
import { EventToken } from '@7b/core';
import { Progress } from '@7b/io/rpc';
import { Excluded } from '@7b/reflection';

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
