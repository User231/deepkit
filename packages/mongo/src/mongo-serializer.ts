/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
import { BSONValue } from '@deepkit/bson';
import {
    JsonBuildContext,
    ReflectionKind,
    Serializer,
    Type,
    TypeHandler,
    isBinaryBigIntType,
    isMongoIdType,
    isUUIDType,
    registerDefaultHandlers,
    registerTypeGuards,
    registerUnionHandler,
} from '@deepkit/type';

/**
 * A {@link TypeHandler} bound to {@link JsonBuildContext} (the object build context the
 * mongo serializer reuses).
 */
type MongoTypeHandler<T extends Type = Type> = TypeHandler<T, JsonBuildContext>;

/**
 * Wrap a value together with its reflected type in a {@link BSONValue}. The downstream
 * BSON serializer sees filter / update documents as `any`, so without the embedded type
 * it could not tell a `MongoId`/`UUID`/`BinaryBigInt` apart from a plain string/bigint.
 * The wrapper carries that type through the `any` path so the value is encoded as a BSON
 * ObjectId / binary rather than a string/long.
 *
 * The closure captures the reflected `type` and runs at serialize time via `b.call`.
 */
const wrapWithType: MongoTypeHandler = (type, input, b) => b.call((value: any) => new BSONValue(value, type), input);

/**
 * Identity handler — keep the value as its native JS type. The BSON `any` serializer
 * encodes Date / binary / bigint natively, so we must NOT apply the JSON transforms the
 * default handlers do (Date → ISO string, bigint → string, binary → base64).
 */
const identity: MongoTypeHandler = (type, input) => input;

/**
 * Serializer that converts entity values into a form the BSON layer can encode inside the
 * `any`-typed filter / update documents MongoDB commands use. It builds on the default JSON
 * handlers (for object/array recursion and `& Reference` → foreign-key) but:
 *
 *  - wraps `UUID` / `MongoId` / `BinaryBigInt` values in {@link BSONValue} so they keep their
 *    BSON identity through the `any` path, and
 *  - keeps `Date`, binary and (non-binary) `bigint` as native JS instead of JSON-encoding them.
 *
 * `any` is used for filter & patch documents since the full type would be too complex to
 * express otherwise.
 */
class MongoSerializer extends Serializer {
    constructor() {
        super('mongo');
    }

    protected override registerSerializers() {
        // Annotation handlers are first-match-wins, so register the special types BEFORE the
        // defaults to shadow the default UUID / MongoId / BinaryBigInt handling.
        this.serializeRegistry.addDecorator(isMongoIdType, wrapWithType);
        this.serializeRegistry.addDecorator(isUUIDType, wrapWithType);
        this.serializeRegistry.addDecorator(isBinaryBigIntType, wrapWithType);

        // Default JSON handlers: primitive identity, object/array recursion, reference → FK,
        // and `undefined` → null (which matches the previous mongo behavior).
        registerDefaultHandlers(this);
        registerUnionHandler(this);
        registerTypeGuards(this);

        // Keep BSON-native representations rather than the JSON transforms the defaults apply.
        this.serializeRegistry.replaceClass(Date, identity); // BSON has a native Date type
        this.serializeRegistry.replaceBinary(identity); // BSON has a native binary type
        this.serializeRegistry.replaceKind(ReflectionKind.bigint, identity); // BSON encodes bigint as Long
    }
}

export const mongoSerializer = new MongoSerializer();
