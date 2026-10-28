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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const fs = __importStar(require("fs"));
const analyze_1 = require("./analyze");
const files_1 = require("./files");
const format_1 = require("./format");
const rules_1 = require("./rules");
function run(o, write) {
    const files = (0, files_1.collect)(o.paths.length ? o.paths : ['.']);
    let findings = [];
    for (const f of files)
        findings.push(...(0, analyze_1.analyze)(fs.readFileSync(f, 'utf8'), f));
    findings = findings.filter((f) => rules_1.SEVERITY_RANK[f.severity] >= rules_1.SEVERITY_RANK[o.minSeverity] && !o.disable.includes(f.ruleId));
    if (o.sarifOutput)
        fs.writeFileSync(o.sarifOutput, (0, format_1.toSARIF)(findings));
    const body = o.format === 'json' ? (0, format_1.toJSON)(findings, files.length) : o.format === 'sarif' ? (0, format_1.toSARIF)(findings) : o.format === 'github' ? (0, format_1.toGitHub)(findings) + '\n' + (0, format_1.toText)(findings, files.length) : (0, format_1.toText)(findings, files.length);
    write(body + '\n');
    return (0, format_1.exitCode)(findings, o.failOn);
}
