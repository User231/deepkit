import { test } from 'node:test';
import * as ts from 'typescript';
import { TransformationContext } from 'typescript';

import { expect } from '@deepkit/run/expect';

import { ReflectionTransformer } from '../../src/compiler.js';

function build(currentDir = process.cwd(), useConfig = 'tsconfig.json'): { [path: string]: string } {
    process.env.DEBUG = 'deepkit';
    const configFile = ts.findConfigFile(currentDir, ts.sys.fileExists, useConfig);
    if (!configFile) throw Error('tsconfig.json not found');
    const { config } = ts.readConfigFile(configFile, ts.sys.readFile);

    const { options, fileNames, errors } = ts.parseJsonConfigFileContent(config, ts.sys, currentDir);
    options.configFilePath = configFile;

    const program = ts.createProgram({ options, rootNames: fileNames, configFileParsingDiagnostics: errors });

    const result: { [path: string]: string } = {};
    program.emit(
        undefined,
        (fileName, data) => {
            //add basename to currentDir from fileName to result
            result[fileName.slice(currentDir.length + 1).replace(/\.js$/, '')] = data;
        },
        undefined,
        undefined,
        {
            before: [(context: TransformationContext) => new ReflectionTransformer(context)],
        },
    );

    return result;
}

/**
 * Whether `className` carries reflection metadata, INDEPENDENT of emit shape.
 *
 * The transformer attaches `__type` as a static member, and how TypeScript emits
 * that depends on `target`:
 *
 *   target < ES2022   →  `WithTypes.__type = [...]`        (assignment after the class)
 *   target >= ES2022  →  `class WithTypes { static __type = [...] }`  (native static field)
 *
 * These tests are about WHICH FILES get reflection (the `reflection` option's
 * resolution across nested tsconfigs), not about codegen. Asserting the first
 * shape as a raw string silently failed the moment the fixture's target rose —
 * which is exactly what happened when the workspace unified on ES2022, and it
 * looked like "reflection is broken" when reflection was perfectly fine.
 *
 * Each fixture file declares exactly one class, so matching the class name and a
 * static `__type` anywhere in the file is unambiguous.
 */
function hasReflection(code: string, className: string): boolean {
    if (code.includes(`${className}.__type`)) return true;
    return code.includes(`class ${className}`) && code.includes('static __type');
}

test('suite1 base default', async () => {
    const files = build(__dirname + '/suite1');
    expect(hasReflection(files['file1'], 'WithTypes')).toBe(true);
    expect(hasReflection(files['backend/file3'], 'WithTypesBackend')).toBe(true);
    //frontend contains types because frontend/tsconfig.json is not picked.
    expect(hasReflection(files['frontend/file2'], 'WithoutTypesFrontend')).toBe(true);
});

test('suite1 base no-types', async () => {
    const files = build(__dirname + '/suite1', 'tsconfig.no-types.json');
    expect(hasReflection(files['file1'], 'WithTypes')).toBe(true);
    expect(hasReflection(files['backend/file3'], 'WithTypesBackend')).toBe(false);
    //frontend contains types because frontend/tsconfig.json is not picked.
    expect(hasReflection(files['frontend/file2'], 'WithoutTypesFrontend')).toBe(false);
});

test('suite1 frontend', async () => {
    const files = build(__dirname + '/suite1/frontend');
    expect(hasReflection(files.file2, 'WithoutTypesFrontend')).toBe(false);
});

test('suite1 backend', async () => {
    const files = build(__dirname + '/suite1/backend');
    expect(hasReflection(files.file3, 'WithTypesBackend')).toBe(true);
});
