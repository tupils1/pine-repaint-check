"use strict";
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
exports.collect = exports.RULES = exports.analyze = void 0;
var analyze_1 = require("./analyze");
Object.defineProperty(exports, "analyze", { enumerable: true, get: function () { return analyze_1.analyze; } });
var rules_1 = require("./rules");
Object.defineProperty(exports, "RULES", { enumerable: true, get: function () { return rules_1.RULES; } });
__exportStar(require("./format"), exports);
var files_1 = require("./files");
Object.defineProperty(exports, "collect", { enumerable: true, get: function () { return files_1.collect; } });
