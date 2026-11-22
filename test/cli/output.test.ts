import { describe, expect, test } from 'vitest';

import { CliOutputSchema } from '../../src/cli/schemas.js';
import { parseEnvelope, runCapture, useTempHome } from '../support/cli-harness.js';

useTempHome();

describe('--json envelope', () => {
  test('factory version --json prints exactly one JSON document that parses with CliOutputSchema: schema_version 1, command "version", ok true, exit_code 0, message', async () => {
    const run = await runCapture(['version', '--json']);

    const parsed = CliOutputSchema.parse(JSON.parse(run.stdout));
    expect(run.exitCode).toBe(0);
    expect(parsed).toMatchObject({
      schema_version: 1,
      command: 'version',
      ok: true,
      exit_code: 0,
    });
    expect(parsed.message).toContain('1.2.3');
    // One document: a single line ending in a newline.
    expect(run.stdout.trimEnd().split('\n')).toHaveLength(1);
    expect(run.stdout.endsWith('\n')).toBe(true);
  });

  test('stdout holds only the JSON document; human text goes to stderr in --json mode', async () => {
    const run = await runCapture(['version', '--json']);

    expect(() => JSON.parse(run.stdout)).not.toThrow();
    expect(run.stderr).toContain('1.2.3');
  });

  test('without --json the message goes to stdout and stderr stays empty', async () => {
    const run = await runCapture(['version']);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('1.2.3');
    expect(run.stderr).toBe('');
  });

  test('an envelope that fails its own schema is not printed; the process prints an internal_error envelope and exits 4', async () => {
    const commands = {
      broken: {
        description: 'returns a message that is not a string',
        skipGitCheck: true,
        run: () => ({ message: 42 as unknown as string }),
      },
    };

    const run = await runCapture(['broken', '--json'], { commands });

    const envelope = parseEnvelope(run);
    expect(run.exitCode).toBe(4);
    expect(CliOutputSchema.safeParse(envelope).success).toBe(true);
    expect(envelope).toMatchObject({ ok: false, exit_code: 4 });
    expect(envelope.errors?.[0]?.code).toBe('internal_error');
    expect(run.stdout).not.toContain('42');
  });
});
