"use strict";
/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BSONType = exports.seekElementSize = exports.BaseParser = void 0;
// BSON (from @deepkit/bson)
__exportStar(require("./src/bson/model.js"), exports);
__exportStar(require("./src/bson/bson-parser.js"), exports);
var bson_parser_js_1 = require("./src/bson/bson-parser.js");
Object.defineProperty(exports, "BaseParser", { enumerable: true, get: function () { return bson_parser_js_1.BaseParser; } });
var continuation_js_1 = require("./src/bson/continuation.js");
Object.defineProperty(exports, "seekElementSize", { enumerable: true, get: function () { return continuation_js_1.seekElementSize; } });
var utils_js_1 = require("./src/bson/utils.js");
Object.defineProperty(exports, "BSONType", { enumerable: true, get: function () { return utils_js_1.BSONType; } });
__exportStar(require("./src/bson/bson-deserializer.js"), exports);
__exportStar(require("./src/bson/bson-serializer.js"), exports);
__exportStar(require("./src/bson/strings.js"), exports);
__exportStar(require("./src/bson/stream.js"), exports);
__exportStar(require("./src/bson/encoder.js"), exports);
