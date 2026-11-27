import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

import { FactoryError } from '../platform/errors.js';
import { runCommand, type RunCommand } from './run-command.js';

export type { RunCommand } from './run-command.js';

export interface Platform {
  readonly os: NodeJS.Platform;
  readonly clipboard: {
    read(): Promise<string>;
    write(text: string): Promise<void>;
  };
  readonly keychain: {
    /** The stored value, or undefined when the item does not exist. */
    get(item: string): Promise<string | undefined>;
  };
}

export interface FakePlatform extends Platform {
  readonly keychainReads: readonly string[];
  readonly clipboardWrites: readonly string[];
}

/** An in-memory Platform. It never reaches the real keychain or clipboard. */
export function createFakePlatform(
  options: { os?: NodeJS.Platform; keychain?: Record<string, string>; clipboard?: string } = {},
): FakePlatform {
  const keychainReads: string[] = [];
  const clipboardWrites: string[] = [];
  let clipboard = options.clipboard ?? '';
  return {
    os: options.os ?? 'darwin',
    keychainReads,
    clipboardWrites,
    keychain: {
      get: async (item) => {
        keychainReads.push(item);
        return options.keychain?.[item];
      },
    },
    clipboard: {
      read: async () => clipboard,
      write: async (text) => {
        clipboardWrites.push(text);
        clipboard = text;
      },
    },
  };
}

const clipboardFailed = (tool: string, next: string): FactoryError =>
  new FactoryError({
    code: 'clipboard_failed',
    message: `${tool} failed.`,
    where: tool,
    next,
    exitCode: 2,
  });

/** True when `name` is an executable file somewhere on `pathEnv`. */
function findOnPath(name: string, pathEnv: string | undefined): string | undefined {
  for (const dir of (pathEnv ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not present or not executable.
    }
  }
  return undefined;
}

/** macOS Platform: `security` for the keychain, `pbcopy` and `pbpaste` for the clipboard. */
export function createMacosPlatform(options: { run?: RunCommand } = {}): Platform {
  const run = options.run ?? runCommand;
  return {
    os: 'darwin',
    keychain: {
      get: async (item) => {
        const { stdout, exitCode } = await run('security', ['find-generic-password', '-w', '-s', item]);
        return exitCode === 0 ? stdout.replace(/\r?\n$/, '') : undefined;
      },
    },
    clipboard: {
      read: async () => {
        const { stdout, exitCode } = await run('pbpaste', []);
        if (exitCode !== 0) throw clipboardFailed('pbpaste', 'check that the macOS clipboard tools are available');
        return stdout;
      },
      write: async (text) => {
        const { exitCode } = await run('pbcopy', [], text);
        if (exitCode !== 0) throw clipboardFailed('pbcopy', 'check that the macOS clipboard tools are available');
      },
    },
  };
}

/**
 * Linux Platform: keychain refs are refused (`env:` instead). Clipboard uses `wl-copy`/`wl-paste`
 * or `xclip` when one is on PATH; otherwise write warns and returns.
 */
export function createLinuxPlatform(
  options: {
    run?: RunCommand;
    pathEnv?: string;
    warn?: (message: string) => void;
  } = {},
): Platform {
  const run = options.run ?? runCommand;
  const pathEnv = options.pathEnv ?? process.env.PATH;
  const warn = options.warn ?? ((message) => process.stderr.write(`${message}\n`));

  const clipboardWrite = (): { command: string; args: string[] } | undefined => {
    if (findOnPath('wl-copy', pathEnv)) return { command: 'wl-copy', args: [] };
    if (findOnPath('xclip', pathEnv)) return { command: 'xclip', args: ['-selection', 'clipboard'] };
    return undefined;
  };

  const clipboardRead = (): { command: string; args: string[] } | undefined => {
    if (findOnPath('wl-paste', pathEnv)) return { command: 'wl-paste', args: [] };
    if (findOnPath('xclip', pathEnv)) return { command: 'xclip', args: ['-selection', 'clipboard', '-o'] };
    return undefined;
  };

  return {
    os: 'linux',
    keychain: {
      get: async (item) => {
        throw new FactoryError({
          code: 'secret_missing',
          message: `The keychain item "${item}" cannot be read on Linux.`,
          where: `keychain item ${item}`,
          next: `use an env: secret ref instead of keychain: ${item}`,
          exitCode: 2,
        });
      },
    },
    clipboard: {
      read: async () => {
        const tool = clipboardRead();
        if (!tool) {
          throw clipboardFailed('clipboard', 'install wl-clipboard or xclip, or skip the clipboard step');
        }
        const { stdout, exitCode } = await run(tool.command, tool.args);
        if (exitCode !== 0) throw clipboardFailed(tool.command, 'check that wl-clipboard or xclip is available');
        return stdout;
      },
      write: async (text) => {
        const tool = clipboardWrite();
        if (!tool) {
          warn('No clipboard tool on PATH (wl-copy or xclip); skipping clipboard copy.');
          return;
        }
        const { exitCode } = await run(tool.command, tool.args, text);
        if (exitCode !== 0) throw clipboardFailed(tool.command, 'check that wl-clipboard or xclip is available');
      },
    },
  };
}

/** Platform for the current OS: macOS keychain and clipboard, or the Linux backends. */
export function createPlatform(
  os: NodeJS.Platform,
  options: { run?: RunCommand; pathEnv?: string; warn?: (message: string) => void } = {},
): Platform {
  if (os === 'darwin') return createMacosPlatform(options);
  if (os === 'linux') return createLinuxPlatform(options);
  throw new FactoryError({
    code: 'unsupported_os',
    message: `Factory runs on macOS (darwin) and Linux; this is ${os}.`,
    where: 'platform',
    next: 'run Factory on macOS (darwin) or Linux',
    exitCode: 2,
  });
}

/** Refuses anything other than macOS or Linux as `unsupported_os` (exit 2). */
export function assertSupportedPlatform(os: NodeJS.Platform): void {
  if (os === 'darwin' || os === 'linux') return;
  throw new FactoryError({
    code: 'unsupported_os',
    message: `Factory runs on macOS (darwin) and Linux; this is ${os}.`,
    where: 'platform',
    next: 'run Factory on macOS (darwin) or Linux',
    exitCode: 2,
  });
}
