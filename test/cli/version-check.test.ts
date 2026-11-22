import { describe, expect, test } from 'vitest';

import { parseEnvelope, runCapture, useTempHome } from '../support/cli-harness.js';

useTempHome();

/** A command that is not exempt from the git check, so the check's effect is visible. */
const noop = {
  description: 'does nothing',
  run: () => ({ message: 'noop ran' }),
};

const run = (processVersion: string, runGitVersion: () => Promise<string>, argv = ['noop', '--json']) =>
  runCapture(argv, { commands: { noop }, processVersion, runGitVersion });

const git = (output: string) => async () => output;

describe('Node and git version check', () => {
  test('Node v22.12.0 is refused: exit 2, code node_too_old, message names 22.13 and the running version, next "install Node.js 22.13 or newer"', async () => {
    const result = await run('v22.12.0', git('git version 2.47.1'));

    const envelope = parseEnvelope(result);
    expect(result.exitCode).toBe(2);
    expect(envelope.errors?.[0]?.code).toBe('node_too_old');
    expect(envelope.errors?.[0]?.message).toContain('22.13');
    expect(envelope.errors?.[0]?.message).toContain('22.12.0');
    expect(envelope.errors?.[0]?.next).toContain('install Node.js 22.13 or newer');
  });

  test.each(['v22.13.0', 'v24.1.0'])('Node %s passes', async (version) => {
    const result = await run(version, git('git version 2.47.1'));

    expect(result.exitCode).toBe(0);
    expect(parseEnvelope(result).ok).toBe(true);
  });

  test('git 2.39.5 is refused with code git_too_old naming 2.40', async () => {
    const result = await run('v24.1.0', git('git version 2.39.5'));

    const envelope = parseEnvelope(result);
    expect(result.exitCode).toBe(2);
    expect(envelope.errors?.[0]?.code).toBe('git_too_old');
    expect(envelope.errors?.[0]?.message).toContain('2.40');
    expect(envelope.errors?.[0]?.message).toContain('2.39.5');
  });

  test.each(['git version 2.40.0', 'git version 2.47.1 (Apple Git-154)'])(
    'git output "%s" passes',
    async (output) => {
      const result = await run('v24.1.0', git(output));

      expect(result.exitCode).toBe(0);
    },
  );

  test('git missing (spawn error) is refused with code git_missing', async () => {
    const result = await run('v24.1.0', async () => {
      throw new Error('spawn git ENOENT');
    });

    const envelope = parseEnvelope(result);
    expect(result.exitCode).toBe(2);
    expect(envelope.errors?.[0]?.code).toBe('git_missing');
  });

  test('factory help and factory version skip the git check (they must answer at once)', async () => {
    let gitCalls = 0;
    const countingGit = async () => {
      gitCalls += 1;
      return 'git version 2.47.1';
    };

    const help = await run('v24.1.0', countingGit, ['help']);
    const version = await run('v24.1.0', countingGit, ['version']);

    expect(help.exitCode).toBe(0);
    expect(version.exitCode).toBe(0);
    expect(gitCalls).toBe(0);
  });

  test('help and version still work when git is missing', async () => {
    const missing = async () => {
      throw new Error('spawn git ENOENT');
    };

    const help = await run('v24.1.0', missing, ['help']);
    const version = await run('v24.1.0', missing, ['version']);

    expect(help.exitCode).toBe(0);
    expect(version.exitCode).toBe(0);
  });

  test('all other commands run the git check once', async () => {
    let gitCalls = 0;
    const countingGit = async () => {
      gitCalls += 1;
      return 'git version 2.47.1';
    };

    await run('v24.1.0', countingGit);

    expect(gitCalls).toBe(1);
  });

  test('the Node check also runs for help and version', async () => {
    const result = await run('v22.12.0', git('git version 2.47.1'), ['version', '--json']);

    expect(result.exitCode).toBe(2);
    expect(parseEnvelope(result).errors?.[0]?.code).toBe('node_too_old');
  });
});
