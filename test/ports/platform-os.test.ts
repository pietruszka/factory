import { describe, expect, test } from 'vitest';

import { assertSupportedPlatform } from '../../src/ports/platform.js';
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
  test.each(['linux', 'win32'] as const)(
    'refuses %s as unsupported_os, exit code 2, and names macOS in next',
    (os) => {
      const error = thrown(() => assertSupportedPlatform(os));

      expect(error).toBeInstanceOf(FactoryError);
      expect(error).toMatchObject({ code: 'unsupported_os', exitCode: 2 });
      expect((error as FactoryError).next).toContain('macOS');
      expect((error as FactoryError).message).toContain(os);
    },
  );

  test('accepts darwin', () => {
    expect(() => assertSupportedPlatform('darwin')).not.toThrow();
  });
});

describe('runCli on another operating system', () => {
  useTempHome();

  test('on a non-darwin platform refuses with unsupported_os and does not run the command', async () => {
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
    expect(run.exitCode).toBe(2);
    expect(envelope.errors?.[0]?.code).toBe('unsupported_os');
    expect(envelope.errors?.[0]?.next).toContain('macOS');
    expect(ran).toBe(false);
  });
});
