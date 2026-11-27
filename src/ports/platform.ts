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
      get: (item) => {
        keychainReads.push(item);
        return Promise.resolve(options.keychain?.[item]);
      },
    },
    clipboard: {
      read: () => Promise.resolve(clipboard),
      write: (text) => {
        clipboardWrites.push(text);
        clipboard = text;
        return Promise.resolve();
      },
    },
  };
}

const clipboardFailed = (tool: string): FactoryError =>
  new FactoryError({
    code: 'clipboard_failed',
    message: `${tool} failed.`,
    where: tool,
    next: 'check that the macOS clipboard tools are available',
    exitCode: 2,
  });

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
        if (exitCode !== 0) throw clipboardFailed('pbpaste');
        return stdout;
      },
      write: async (text) => {
        const { exitCode } = await run('pbcopy', [], text);
        if (exitCode !== 0) throw clipboardFailed('pbcopy');
      },
    },
  };
}

/** Refuses anything other than macOS as `unsupported_os` (exit 2). */
export function assertSupportedPlatform(os: NodeJS.Platform): void {
  if (os === 'darwin') return;
  throw new FactoryError({
    code: 'unsupported_os',
    message: `Factory runs on macOS only; this is ${os}.`,
    where: 'platform',
    next: 'run Factory on macOS',
    exitCode: 2,
  });
}
