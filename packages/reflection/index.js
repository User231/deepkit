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
exports.metaAnnotation = void 0;
// Type system (from @deepkit/type)
__exportStar(require("./src/type/core.js"), exports);
__exportStar(require("./src/type/changes.js"), exports);
__exportStar(require("./src/type/decorator.js"), exports);
__exportStar(require("./src/type/decorator-builder.js"), exports);
__exportStar(require("./src/type/reference.js"), exports);
__exportStar(require("./src/type/serializer.js"), exports);
__exportStar(require("./src/type/serializer-facade.js"), exports);
__exportStar(require("./src/type/typeguard.js"), exports);
__exportStar(require("./src/type/types.js"), exports);
__exportStar(require("./src/type/utils.js"), exports);
__exportStar(require("./src/type/validator.js"), exports);
__exportStar(require("./src/type/validators.js"), exports);
__exportStar(require("./src/type/snapshot.js"), exports);
__exportStar(require("./src/type/change-detector.js"), exports);
__exportStar(require("./src/type/path.js"), exports);
__exportStar(require("./src/type/type-serialization.js"), exports);
__exportStar(require("./src/type/registry.js"), exports);
__exportStar(require("./src/type/default.js"), exports);
__exportStar(require("./src/type/mixin.js"), exports);
__exportStar(require("./src/type/reflection/type.js"), exports);
var type_js_1 = require("./src/type/reflection/type.js");
Object.defineProperty(exports, "metaAnnotation", { enumerable: true, get: function () { return type_js_1.typeAnnotation; } });
__exportStar(require("./src/type/reflection/processor.js"), exports);
__exportStar(require("./src/type/reflection/extends.js"), exports);
__exportStar(require("./src/type/reflection/reflection.js"), exports);
// Type spec (from @deepkit/type-spec)
__exportStar(require("./src/spec/index.js"), exports);
// Type compiler (from @deepkit/type-compiler)
__exportStar(require("./src/compiler/index.js"), exports);
