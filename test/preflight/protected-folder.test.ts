import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { DEFAULT_MODELS, type CompleteModelsSection } from '../../src/config/models.js';
import { preflight } from '../../src/preflight/preflight.js';
import { cleanupEventLogTest } from '../support/event-log.js';
import {
  agentAndSpend,
  catalogSpy,
  NOTHING_STARTED,
  preflightFixture,
  refusal,
  refusalOf,
} from '../support/preflight.js';

afterEach(cleanupEventLogTest);

/** Planner and builder run through OpenCode; every other role stays on the default CLI. */
const OPENCODE_MODELS: CompleteModelsSection = {
  ...DEFAULT_MODELS,
  planner: { cli: 'opencode', model: 'cursor-acp/gpt-5.3-codex-high', family: 'gpt' },
  builder: { cli: 'opencode', model: 'cursor-acp/gpt-5.3-codex-high', family: 'gpt' },
};
const OPENCODE_CATALOG = {
  opencode: ['cursor-acp/gpt-5.3-codex-high'],
  'cursor-agent': ['claude-opus-5-5-high'],
};

describe('OpenCode and a protected folder', () => {
  test('when a role is configured to use OpenCode and the worktree or sandbox path sits inside Documents, Desktop or Downloads under the test home, preflight refuses with protected_folder, starts no agent, and the next action points at the D-39 cache folder', async () => {
    const cases = [
      { folder: 'Documents', option: 'worktreePath' },
      { folder: 'Desktop', option: 'sandboxPath' },
      { folder: 'Downloads', option: 'worktreePath' },
    ] as const;

    for (const { folder, option } of cases) {
      const fx = preflightFixture({ models: OPENCODE_MODELS });
      const path = join(fx.sb.tmp, folder, 'factory', 'example-frontend', 'FE-123');

      const error = await refusalOf(
        preflight(fx.options({ [option]: path, loadCatalog: catalogSpy(OPENCODE_CATALOG).loadCatalog })),
      );

      expect(error, `${folder} ${option}`).toMatchObject(refusal('protected_folder'));
      expect(error.where, `${folder} ${option}`).toContain(folder);
      expect(error.next, `${folder} ${option}`).toContain(fx.cacheRoot);
      expect(agentAndSpend(fx), `${folder} ${option}`).toEqual(NOTHING_STARTED);
    }
  });

  test('when an OpenCode role is configured and the paths are outside the protected folders, preflight passes', async () => {
    const fx = preflightFixture({ models: OPENCODE_MODELS });

    const result = await preflight(
      fx.dryOptions({
        worktreePath: join(fx.cacheRoot, 'worktrees', 'example-frontend', 'FE-123'),
        sandboxPath: join(fx.cacheRoot, 'sandbox'),
        loadCatalog: catalogSpy(OPENCODE_CATALOG).loadCatalog,
      }),
    );

    expect(result).toMatchObject({ ok: true });
  });

  test('when no OpenCode role is configured, this preflight check does not refuse that path', async () => {
    const fx = preflightFixture();
    const path = join(fx.sb.tmp, 'Documents', 'factory', 'example-frontend', 'FE-123');

    const result = await preflight(fx.dryOptions({ worktreePath: path, sandboxPath: join(fx.sb.tmp, 'Desktop', 'sandbox') }));

    expect(result).toMatchObject({ ok: true });
  });
});
