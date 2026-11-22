import { parseArgs, type ParseArgsConfig } from 'node:util';

import { FactoryError } from '../platform/errors.js';
import { EXIT_CODES } from './exit-codes.js';

type ParsedValues = ReturnType<typeof parseArgs>['values'];

/** What a command handler returns on success; the router builds the envelope around it. */
export interface CommandResult {
  message: string;
  data?: unknown;
}

export interface CommandContext {
  /** Parsed values of the command's own flags. */
  values: ParsedValues;
  packageVersion: string;
  /** Every command the CLI knows, for `help`. */
  commands: CommandTable;
}

export interface CommandDef {
  description: string;
  /** Flags accepted besides the global `--json`, in `node:util` parseArgs form. */
  options?: ParseArgsConfig['options'];
  /** Commands that must answer at once skip the git check (NFR-20). */
  skipGitCheck?: boolean;
  run: (ctx: CommandContext) => CommandResult | Promise<CommandResult>;
}

export type CommandTable = Record<string, CommandDef>;

export interface ParsedInvocation {
  /** Empty string when no command was given. */
  command: string;
  rest: string[];
}

const HELP_COMMAND = 'factory help';

/** Renders the help text listing every command in the table. */
export function renderHelp(commands: CommandTable): string {
  const names = Object.keys(commands);
  const width = Math.max(...names.map((name) => name.length));
  const rows = names.map((name) => `  ${name.padEnd(width)}  ${commands[name]?.description ?? ''}`);
  return [
    'Usage: factory <command> [--json]',
    '',
    'Commands:',
    ...rows,
    '',
    'Flags:',
    '  --json  print one JSON document on stdout instead of text',
  ].join('\n');
}

export const defaultCommands: CommandTable = {
  version: {
    description: 'Print the factory version (also --version).',
    skipGitCheck: true,
    run: ({ packageVersion }) => ({
      message: `factory ${packageVersion}`,
      data: { version: packageVersion },
    }),
  },
  help: {
    description: 'Show this help.',
    skipGitCheck: true,
    run: ({ commands }) => ({
      message: renderHelp(commands),
      data: {
        commands: Object.entries(commands).map(([name, def]) => ({ name, description: def.description })),
      },
    }),
  },
};

const usageError = (code: string, message: string, where: string): FactoryError =>
  new FactoryError({
    code,
    message,
    where,
    next: 'run `factory help`',
    nextCommand: HELP_COMMAND,
    exitCode: EXIT_CODES.refused,
  });

/** True when the global `--json` flag is present anywhere in argv. */
export const wantsJson = (argv: string[]): boolean => argv.includes('--json');

/**
 * Splits argv into the command name and the rest. The global flags are `--json` and `--version`;
 * any other flag before the command is refused as unknown_flag.
 */
export function parseInvocation(argv: string[]): ParsedInvocation {
  const args = argv.filter((arg) => arg !== '--json');
  const [first = '', ...rest] = args;
  if (first === '--version') return { command: 'version', rest };
  if (first.startsWith('-')) {
    throw usageError('unknown_flag', `Unknown flag ${first.split('=')[0]}.`, 'factory');
  }
  return { command: first, rest };
}

/** Finds the command; refuses an empty or unknown name. */
export function lookupCommand(commands: CommandTable, name: string): CommandDef {
  if (name === '') {
    throw usageError('no_command', 'No command given.', 'factory');
  }
  const def = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (!def) {
    throw usageError('unknown_command', `Unknown command: ${name}.`, name);
  }
  return def;
}

/** Parses the command's own flags in strict mode; refuses unknown flags and stray arguments. */
export function parseCommandArgs(
  def: CommandDef,
  command: string,
  rest: string[],
): ParsedValues {
  try {
    return parseArgs({ args: rest, options: def.options ?? {}, strict: true, allowPositionals: false })
      .values;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const flag = /Unknown option '([^']+)'/.exec(text)?.[1];
    if (flag) {
      throw usageError('unknown_flag', `Unknown flag ${flag} for command ${command}.`, command);
    }
    // Other parse problems (a stray argument, a missing flag value) keep Node's own wording.
    throw usageError('invalid_usage', text.split('. ')[0] ?? text, command);
  }
}
