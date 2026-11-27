import { describe, expect, test } from 'vitest';

import { EXIT_CODES } from '../../src/cli/exit-codes.js';
import { runMain } from '../../src/cli/main.js';
import { FactoryError } from '../../src/platform/errors.js';
import { parseEnvelope, runCapture, useTempHome } from '../support/cli-harness.js';

useTempHome();

describe('exit codes', () => {
  test('EXIT_CODES equals { ok: 0, needsAttention: 1, refused: 2, breach: 3, internal: 4 }', () => {
    expect(EXIT_CODES).toEqual({ ok: 0, needsAttention: 1, refused: 2, breach: 3, internal: 4 });
  });

  test('factory help exits 0 and lists the commands', async () => {
    const run = await runCapture(['help']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Usage:');
    expect(run.stdout).toContain('version');
    expect(run.stdout).toContain('help');
  });

  test('factory with no command prints help and exits 2', async () => {
    const run = await runCapture([]);

    expect(run.exitCode).toBe(2);
    expect(run.stdout + run.stderr).toContain('Usage:');
  });

  test('factory --json with no command uses command "" and exits 2', async () => {
    const run = await runCapture(['--json']);

    const envelope = parseEnvelope(run);
    expect(run.exitCode).toBe(2);
    expect(envelope).toMatchObject({ command: '', ok: false, exit_code: 2, next_command: 'factory help' });
    expect(envelope.errors[0]?.code).toBe('no_command');
  });

  test('an uncaught error thrown inside a command handler is caught at the top, prints an internal_error envelope in --json mode and exits 4', async () => {
    const commands = {
      boom: {
        description: 'always throws',
        skipGitCheck: true,
        run: () => {
          throw new Error('kaboom');
        },
      },
    };

    const run = await runCapture(['boom', '--json'], { commands });

    const envelope = parseEnvelope(run);
    expect(run.exitCode).toBe(4);
    expect(envelope).toMatchObject({ command: 'boom', ok: false, exit_code: 4 });
    expect(envelope.errors?.[0]?.code).toBe('internal_error');
  });

  test('a FactoryError with exitCode 2 maps to exit 2 and errors: [{ code, message }]', async () => {
    const commands = {
      refuse: {
        description: 'always refuses',
        skipGitCheck: true,
        run: () => {
          throw new FactoryError({
            code: 'protected_folder',
            message: 'Folder is protected.',
            where: 'FACTORY_HOME',
            next: 'Use a folder outside Documents.',
            exitCode: 2,
          });
        },
      },
    };

    const run = await runCapture(['refuse', '--json'], { commands });

    const envelope = parseEnvelope(run);
    expect(run.exitCode).toBe(2);
    expect(envelope).toMatchObject({ ok: false, exit_code: 2 });
    expect(envelope.errors?.[0]).toMatchObject({
      code: 'protected_folder',
      message: 'Folder is protected.',
    });
  });

  describe('entry point failures use the internal-error contract', () => {
    const entryOptions = (argv: string[], overrides: Partial<Parameters<typeof runMain>[0]> = {}) => {
      const out = { stdout: '', stderr: '' };
      const options = {
        argv,
        processVersion: 'v24.1.0',
        runGitVersion: async () => 'git version 2.47.1',
        isEntryPoint: () => true,
        loadPackageVersion: () => '1.2.3',
        stdout: (text: string) => void (out.stdout += text),
        stderr: (text: string) => void (out.stderr += text),
        ...overrides,
      };
      return { options, out };
    };

    test('a failure while loading the package version prints an internal_error envelope in --json mode and exits 4', async () => {
      const { options, out } = entryOptions(['version', '--json'], {
        loadPackageVersion: () => {
          throw new Error('package.json not found');
        },
      });

      const exitCode = await runMain(options);

      const envelope = JSON.parse(out.stdout) as { ok: boolean; exit_code: number; errors: Array<{ code: string }> };
      expect(exitCode).toBe(4);
      expect(envelope).toMatchObject({ ok: false, exit_code: 4 });
      expect(envelope.errors[0]?.code).toBe('internal_error');
    });

    test('a failure while detecting the entry point prints "Internal error" on stderr and exits 4', async () => {
      const { options, out } = entryOptions(['version'], {
        isEntryPoint: () => {
          throw new Error('realpath failed');
        },
      });

      const exitCode = await runMain(options);

      expect(exitCode).toBe(4);
      expect(out.stderr).toContain('Internal error: realpath failed');
    });

    test('when the module is only imported, runMain does nothing and prints nothing', async () => {
      const { options, out } = entryOptions(['version'], { isEntryPoint: () => false });

      const exitCode = await runMain(options);

      expect(exitCode).toBeUndefined();
      expect(out).toEqual({ stdout: '', stderr: '' });
    });

    test.each(['darwin', 'linux'] as const)(
      'on the happy path runMain runs the command with the loaded version on %s',
      async (os) => {
        const { options, out } = entryOptions(['version'], { os });

        const exitCode = await runMain(options);

        expect(exitCode).toBe(0);
        expect(out.stdout).toContain('factory 1.2.3');
      },
    );
  });
});
