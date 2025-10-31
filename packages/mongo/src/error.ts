import { DatabaseError, DatabaseSession, UniqueConstraintFailure } from '@7b/db';

/**
 * Converts a specific database error to a more specific error, if possible.
 */
export function handleSpecificError(session: DatabaseSession, error: DatabaseError): Error {
    let cause: any = error;
    while (cause) {
        if (cause instanceof Error) {
            if (cause.message.includes('duplicate key error')
            ) {
                return new UniqueConstraintFailure(`${cause.message}`, { cause: error });
            }
            cause = cause.cause;
        }
    }

    return error;
}
