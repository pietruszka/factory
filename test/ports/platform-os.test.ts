import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  assertSupportedPlatform,
  createLinuxPlatform,
  createPlatform,
} from '../../src/ports/platform.js';
import { FactoryError } from '../../src/platform/errors.js';
import { parseEnvelope, runCapture, useTempHome } from '../support/cli-harness.js';

const thrown = (fn: () => void): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('assertSupportedPlatform', () => {
  test.each(['darwin', 'linux'] as const)('accepts %s', (os) => {
    expect(() => assertSupportedPlatform(os)).not.toThrow();
  });

  test('refuses win32 as unsupported_os, exit code 2, and names darwin and linux', () => {
    const error = thrown(() => assertSupportedPlatform('win32'));

    expect(error).toBeInstanceOf(FactoryError);
    expect(error).toMatchObject({ code: 'unsupported_os', exitCode: 2 });
    expect((error as FactoryError).next).toMatch(/darwin/i);
    expect((error as FactoryError).next).toMatch(/[Ll]inux/);
    expect((error as FactoryError).message).toContain('win32');
  });
});

describe('runCli on another operating system', () => {
  useTempHome();

  test('on linux runs the command', async () => {
    let ran = false;
    const noop = {
      description: 'records that it ran',
      skipGitCheck: true,
      run: () => {
        ran = true;
        return { message: 'noop ran' };
      },
    };

    const run = await runCapture(['noop', '--json'], { commands: { noop }, os: 'linux' });

    const envelope = parseEnvelope(run);
    expect(run.exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(ran).toBe(true);
  });

  test('on win32 refuses with unsupported_os and does not run the command', async () => {
    let ran = false;
    const noop = {
      description: 'records that it ran',
      skipGitCheck: true,
      run: () => {
        ran = true;
        return { message: 'noop ran' };
      },
    };

    const run = await runCapture(['noop', '--json'], { commands: { noop }, os: 'win32' });

    const envelope = parseEnvelope(run);
    expect(run.exitCode).toBe(2);
    expect(envelope.errors?.[0]?.code).toBe('unsupported_os');
    expect(envelope.errors?.[0]?.next).toMatch(/darwin/i);
    expect(envelope.errors?.[0]?.next).toMatch(/[Ll]inux/);
    expect(ran).toBe(false);
  });
});

describe('createPlatform', () => {
  test('darwin returns the macOS backend', () => {
    expect(createPlatform('darwin').os).toBe('darwin');
  });

  test('linux returns the Linux backend', () => {
    expect(createPlatform('linux').os).toBe('linux');
  });
});

describe('the Linux Platform', () => {
  test('keychain.get refuses with secret_missing and says to use env:', async () => {
    const platform = createLinuxPlatform({ pathEnv: '' });

    await expect(platform.keychain.get('example-item')).rejects.toMatchObject({
      code: 'secret_missing',
      exitCode: 2,
      where: 'keychain item example-item',
      next: expect.stringMatching(/env:/),
    });
    await expect(platform.keychain.get('example-item')).rejects.toMatchObject({
      next: expect.not.stringMatching(/store the secret in the keychain/),
    });
  });

  test('clipboard write uses wl-copy when it is on PATH', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'factory-wl-'));
    const seen: Array<{ command: string; args: readonly string[]; input: string | undefined }> = [];
    writeFileSync(join(bin, 'wl-copy'), '#!/bin/sh\ncat > /dev/null\n', { mode: 0o755 });
    chmodSync(join(bin, 'wl-copy'), 0o755);

    const platform = createLinuxPlatform({
      pathEnv: bin,
      run: async (command, args, input) => {
        seen.push({ command, args, input });
        return { stdout: '', exitCode: 0 };
      },
    });

    await platform.clipboard.write('hello');

    expect(seen).toEqual([{ command: 'wl-copy', args: [], input: 'hello' }]);
  });

  test('clipboard write uses xclip when wl-copy is absent', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'factory-xclip-'));
    const seen: Array<{ command: string; args: readonly string[]; input: string | undefined }> = [];
    writeFileSync(join(bin, 'xclip'), '#!/bin/sh\ncat > /dev/null\n', { mode: 0o755 });
    chmodSync(join(bin, 'xclip'), 0o755);

    const platform = createLinuxPlatform({
      pathEnv: bin,
      run: async (command, args, input) => {
        seen.push({ command, args, input });
        return { stdout: '', exitCode: 0 };
      },
    });

    await platform.clipboard.write('hello');

    expect(seen).toEqual([
      { command: 'xclip', args: ['-selection', 'clipboard'], input: 'hello' },
    ]);
  });

  test('clipboard write warns and returns when no tool is on PATH', async () => {
    const warnings: string[] = [];
    const seen: string[] = [];
    const platform = createLinuxPlatform({
      pathEnv: mkdtempSync(join(tmpdir(), 'factory-empty-')),
      warn: (message) => warnings.push(message),
      run: async (command) => {
        seen.push(command);
        return { stdout: '', exitCode: 0 };
      },
    });

    await expect(platform.clipboard.write('hello')).resolves.toBeUndefined();
    expect(seen).toEqual([]);
    expect(warnings[0]).toMatch(/wl-copy|xclip/i);
  });
});
