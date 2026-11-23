import { afterEach, describe, expect, test } from 'vitest';

import { preflight } from '../../src/preflight/preflight.js';
import { cleanupEventLogTest } from '../support/event-log.js';
import { agentAndSpend, NOTHING_STARTED, preflightFixture, probe, refusal, refusalOf } from '../support/preflight.js';

afterEach(cleanupEventLogTest);

describe('Node.js and git versions', () => {
  test('when Node.js is below 22.13, preflight fails with node_too_old, names 22.13 and the running version, and gives the next action to install Node.js 22.13 or newer', async () => {
    const fx = preflightFixture();

    const error = await refusalOf(preflight(fx.options({ probe: probe('v22.12.0') })));

    expect(error).toMatchObject(refusal('node_too_old'));
    expect(error.message).toContain('22.13');
    expect(error.message).toContain('22.12.0');
    expect(error.next).toContain('install Node.js 22.13 or newer');
    expect(agentAndSpend(fx)).toEqual(NOTHING_STARTED);
  });

  test('when git is missing or below 2.40, preflight fails with git_missing or git_too_old, names 2.40, and gives the next action', async () => {
    const cases = [
      {
        code: 'git_missing',
        runGitVersion: async (): Promise<string> => {
          throw new Error('spawn git ENOENT');
        },
      },
      { code: 'git_too_old', runGitVersion: async (): Promise<string> => 'git version 2.39.5' },
    ];

    for (const { code, runGitVersion } of cases) {
      const fx = preflightFixture();

      const error = await refusalOf(preflight(fx.options({ probe: probe('v24.1.0', runGitVersion) })));

      expect(error, code).toMatchObject(refusal(code));
      expect(error.message, code).toContain('2.40');
      expect(error.next, code).toContain('2.40');
      expect(agentAndSpend(fx), code).toEqual(NOTHING_STARTED);
    }
  });

  test.each(['v22.13.0', 'v24.1.0'])('Node %s passes the version check', async (version) => {
    const fx = preflightFixture();

    await expect(preflight(fx.dryOptions({ probe: probe(version) }))).resolves.toMatchObject({ ok: true });
  });

  test('git 2.40.0 passes the version check', async () => {
    const fx = preflightFixture();

    await expect(
      preflight(fx.dryOptions({ probe: probe('v24.1.0', async () => 'git version 2.40.0') })),
    ).resolves.toMatchObject({ ok: true });
  });
});
