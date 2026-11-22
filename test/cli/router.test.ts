import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { parseEnvelope, runCapture, useTempHome } from '../support/cli-harness.js';

useTempHome();

describe('router: unknown command or flag', () => {
  test('factory frobnicate exits 2; the message names the command, says it is unknown and gives next "run `factory help`"', async () => {
    const run = await runCapture(['frobnicate']);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('frobnicate');
    expect(run.stderr.toLowerCase()).toContain('unknown');
    expect(run.stderr).toContain('run `factory help`');
  });

  test('factory version --frob exits 2 and names the flag', async () => {
    const run = await runCapture(['version', '--frob']);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('--frob');
    expect(run.stderr.toLowerCase()).toContain('unknown');
    expect(run.stderr).toContain('run `factory help`');
  });

  test('--json variant of an unknown command has errors[0].code unknown_command and next_command "factory help"', async () => {
    const run = await runCapture(['frobnicate', '--json']);

    const envelope = parseEnvelope(run);
    expect(run.exitCode).toBe(2);
    expect(envelope).toMatchObject({ command: 'frobnicate', ok: false, exit_code: 2 });
    expect(envelope.errors?.[0]?.code).toBe('unknown_command');
    expect(envelope.next_command).toBe('factory help');
  });

  test('--json variant of an unknown flag has errors[0].code unknown_flag and next_command "factory help"', async () => {
    const run = await runCapture(['version', '--frob', '--json']);

    const envelope = parseEnvelope(run);
    expect(run.exitCode).toBe(2);
    expect(envelope.errors?.[0]?.code).toBe('unknown_flag');
    expect(envelope.errors?.[0]?.message).toContain('--frob');
    expect(envelope.next_command).toBe('factory help');
  });

  test('factory --frob (unknown flag before any command) exits 2 and names the flag', async () => {
    const run = await runCapture(['--frob']);

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('--frob');
    expect(run.stderr.toLowerCase()).toContain('unknown');
    expect(run.stderr).toContain('run `factory help`');
  });

  test.each([[['--frob', '--json']], [['--json', '--frob']]])(
    'factory %j has errors[0].code unknown_flag and next_command "factory help"',
    async (argv) => {
      const run = await runCapture(argv);

      const envelope = parseEnvelope(run);
      expect(run.exitCode).toBe(2);
      expect(envelope).toMatchObject({ ok: false, exit_code: 2 });
      expect(envelope.errors?.[0]?.code).toBe('unknown_flag');
      expect(envelope.errors?.[0]?.message).toContain('--frob');
      expect(envelope.next_command).toBe('factory help');
    },
  );

  test('a short unknown flag before any command (factory -x) is also unknown_flag', async () => {
    const envelope = parseEnvelope(await runCapture(['-x', '--json']));

    expect(envelope.errors?.[0]?.code).toBe('unknown_flag');
  });

  test('factory with only --json still reports no_command', async () => {
    const run = await runCapture(['--json']);

    expect(run.exitCode).toBe(2);
    expect(parseEnvelope(run).errors?.[0]?.code).toBe('no_command');
  });

  test('the router is built on node:util parseArgs in strict mode (no new dependency)', () => {
    const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
    const source = readFileSync(resolve(root, 'src/cli/router.ts'), 'utf8');
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };

    expect(source).toMatch(/parseArgs/);
    expect(source).toMatch(/from 'node:util'/);
    expect(source).toMatch(/strict:\s*true/);
    expect(Object.keys(pkg.dependencies)).toEqual(['zod']);
  });
});
