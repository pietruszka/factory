#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FactoryError } from '../platform/errors.js';
import { assertSupportedPlatform } from '../ports/platform.js';
import { EXIT_CODES } from './exit-codes.js';
import { printOutput, type CliIo } from './output.js';
import {
  defaultCommands,
  lookupCommand,
  parseCommandArgs,
  parseInvocation,
  renderHelp,
  wantsJson,
  type CommandTable,
} from './router.js';
import type { CliOutput } from './schemas.js';
import { checkEnvironment, runGitVersion } from './version-check.js';

export interface RunCliOptions extends CliIo {
  /** Arguments after the script name, for example `['version', '--json']`. */
  argv: string[];
  /** For example `v22.13.0`. */
  processVersion: string;
  /** Resolves with the output of `git --version`; rejects when git cannot be started. */
  runGitVersion: () => Promise<string>;
  /** The `package.json` version, printed by `factory version`. */
  packageVersion: string;
  /** Extra commands, merged over the built-in ones. Tests add commands here. */
  commands?: CommandTable;
  /** The operating system, for example `darwin`. Tests set it to check the refusal on other systems. */
  os?: NodeJS.Platform;
}

const failure = (command: string, error: unknown): CliOutput => {
  if (error instanceof FactoryError) {
    const { code, message, where, next, nextCommand, exitCode } = error;
    return {
      schema_version: 1,
      command,
      ok: false,
      exit_code: exitCode,
      message,
      errors: [{ code, message, where, next }],
      next_command: nextCommand ?? null,
    };
  }
  const message = `Internal error: ${error instanceof Error ? error.message : String(error)}`;
  return {
    schema_version: 1,
    command,
    ok: false,
    exit_code: EXIT_CODES.internal,
    message,
    errors: [{ code: 'internal_error', message }],
    next_command: null,
  };
};

/** Runs one CLI invocation and returns the process exit code. Never throws. */
export async function runCli(opts: RunCliOptions): Promise<number> {
  const json = wantsJson(opts.argv);
  const commands = { ...defaultCommands, ...opts.commands };
  let command = '';
  try {
    assertSupportedPlatform(opts.os ?? process.platform);
    const invocation = parseInvocation(opts.argv);
    command = invocation.command;
    const { rest } = invocation;
    const def = lookupCommand(commands, command);
    await checkEnvironment(opts, { checkGit: !def.skipGitCheck });
    const values = parseCommandArgs(def, command, rest);
    const result = await def.run({ values, packageVersion: opts.packageVersion, commands });
    return printOutput(
      {
        schema_version: 1,
        command,
        ok: true,
        exit_code: EXIT_CODES.ok,
        message: result.message,
        errors: [],
        next_command: null,
        data: result.data,
      },
      opts,
      json,
    );
  } catch (error) {
    const code = printOutput(failure(command, error), opts, json);
    // A missing command also shows the usage text, as a person would expect.
    if (error instanceof FactoryError && error.code === 'no_command') {
      opts.stderr(`\n${renderHelp(commands)}\n`);
    }
    return code;
  }
}

/** Finds the nearest `package.json` above this file, so source and built layouts both work. */
function readPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('package.json not found');
    dir = parent;
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

/** True when this file is the process entry point, also through the symlink `npm link` creates. */
const isEntryPoint = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
};

export interface RunMainOptions extends Omit<RunCliOptions, 'packageVersion'> {
  isEntryPoint: () => boolean;
  loadPackageVersion: () => string;
}

/**
 * Entry-point wrapper. Returns undefined when the module is only imported; otherwise the exit code.
 * Detecting the entry point and loading the version run inside the error handling, so a failure
 * there prints the internal-error contract (exit 4) instead of an uncaught stack trace.
 */
export async function runMain(opts: RunMainOptions): Promise<number | undefined> {
  try {
    if (!opts.isEntryPoint()) return undefined;
    return await runCli({ ...opts, packageVersion: opts.loadPackageVersion() });
  } catch (error) {
    return printOutput(failure('', error), opts, wantsJson(opts.argv));
  }
}

const exitCode = await runMain({
  argv: process.argv.slice(2),
  processVersion: process.version,
  runGitVersion,
  isEntryPoint,
  loadPackageVersion: readPackageVersion,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
if (exitCode !== undefined) process.exitCode = exitCode;
