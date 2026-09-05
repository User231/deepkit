import { base64ToUint8Array } from '@deepkit/core';
import { ReceiveType, SerializationOptions, cast, resolveReceiveType } from '@deepkit/type';

import { RpcError } from '../model.js';
import { BodyDecoder, RpcMessage, RpcMessageRouteType, rpcDecodeError } from '../protocol.js';

export interface RpcHttpRequest {
    headers: { [name: string]: undefined | string | string[] };
    method?: string;
    url?: string;
    body?: Uint8Array;
}

export interface RpcHttpResponse {
    setHeader(name: string, value: number | string): this;

    writeHead(statusCode: number): this;

    end(data?: Uint8Array | string): void;
}

export class HttpRpcMessage extends RpcMessage {
    /**
     * @param castOptions how `parseBody`/`decodeBody` cast the JSON: a JSON BODY carries exact
     *   types (a string is a string, a number a number — the typed client serialized it through
     *   the same parameter types), so the bridge casts it with `loosely: false`; `?arg=` query
     *   strings are text and keep the loose (coercing) default.
     */
    constructor(
        public id: number,
        public composite: boolean,
        public type: number,
        public routeType: RpcMessageRouteType,
        public headers: RpcHttpRequest['headers'],
        public json?: any,
        public castOptions: SerializationOptions = {},
    ) {
        super(id, composite, type, routeType);
    }

    getJson(): any {
        return this.json;
    }

    getSource(): Uint8Array {
        return base64ToUint8Array(String(this.headers['X-Source']));
    }

    getDestination(): Uint8Array {
        return base64ToUint8Array(String(this.headers['X-Destination']));
    }

    getError(): Error {
        const json = this.getJson();
        if (!json) throw new RpcError('No body found');
        return rpcDecodeError(json);
    }

    isError(): boolean {
        return super.isError();
    }

    parseGenericBody(): object {
        return this.getJson();
    }

    parseBody<T>(type?: ReceiveType<T>): T {
        const json = this.getJson();
        if (!json) {
            throw new RpcError('No body found');
        }
        return cast(json, this.castOptions, undefined, undefined, resolveReceiveType(type));
    }

    decodeBody<T>(decoder: BodyDecoder<T>): T {
        const json = this.getJson();
        if (!json) {
            throw new RpcError('No body found');
        }
        return cast(json, this.castOptions, undefined, undefined, decoder.type);
    }

    getBodies(): RpcMessage[] {
        const json = this.getJson();
        if (!Array.isArray(json)) throw new RpcError('Expected array of RpcMessage items');

        const result: RpcMessage[] = [];
        for (const item of json) {
            result.push(
                new HttpRpcMessage(
                    this.id,
                    false,
                    item.type,
                    this.routeType,
                    this.headers,
                    item.body,
                    this.castOptions,
                ),
            );
        }

        return result;
    }
}

// export function createHttpRpcMessage(type:
//
// }
