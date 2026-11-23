import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { DEFAULT_MODELS } from '../../src/config/models.js';
import { preflight } from '../../src/preflight/preflight.js';
import { cleanupEventLogTest } from '../support/event-log.js';
import {
  agentAndSpend,
  catalogSpy,
  NOTHING_STARTED,
  preflightFixture,
  probe,
  refusal,
  refusalOf,
} from '../support/preflight.js';

afterEach(cleanupEventLogTest);

describe('the preflight result as an event', () => {
  test('given a run in preflight, a passing preflight appends a preflight event with no cost, leaves the stored status as preflight, and does not start an agent', async () => {
    const fx = preflightFixture();

    const result = await preflight(fx.options());

    const events = fx.events('preflight');
    expect(result).toMatchObject({ ok: true });
    expect(events).toHaveLength(1);
    expect(events[0]?.cost_usd).toBeNull();
    expect(events[0]?.payload_json).not.toBeNull();
    expect(fx.status()).toBe('preflight');
    expect(agentAndSpend(fx)).toEqual(NOTHING_STARTED);
  });

  test('a config_drift failure moves the run to config_drift and still records the preflight event, with no agent and no spend', async () => {
    const fx = preflightFixture({ install: 'npm run setup' });

    const error = await refusalOf(preflight(fx.options()));

    const events = fx.events('preflight');
    expect(error).toMatchObject(refusal('config_drift'));
    expect(fx.status()).toBe('config_drift');
    expect(events).toHaveLength(1);
    expect(events[0]?.cost_usd).toBeNull();
    expect(agentAndSpend(fx)).toEqual(NOTHING_STARTED);
  });

  test('a node, git, model or protected_folder failure moves the run to refused and still records the preflight event', async () => {
    const opencodeModels = {
      ...DEFAULT_MODELS,
      builder: { cli: 'opencode', model: 'cursor-acp/gpt-5.3-codex-high', family: 'gpt' },
      planner: { cli: 'opencode', model: 'cursor-acp/gpt-5.3-codex-high', family: 'gpt' },
    };
    const cases = [
      { code: 'node_too_old', fixture: () => preflightFixture(), override: { probe: probe('v22.12.0') } },
      {
        code: 'git_too_old',
        fixture: () => preflightFixture(),
        override: { probe: probe('v24.1.0', async () => 'git version 2.39.5') },
      },
      {
        code: 'model_not_accepted_by_cli',
        fixture: () => preflightFixture(),
        override: { loadCatalog: catalogSpy({ 'cursor-agent': [] }).loadCatalog },
      },
      {
        code: 'protected_folder',
        fixture: () => preflightFixture({ models: opencodeModels }),
        override: {
          loadCatalog: catalogSpy({
            opencode: ['cursor-acp/gpt-5.3-codex-high'],
            'cursor-agent': ['claude-opus-5-5-high'],
          }).loadCatalog,
        },
      },
    ];

    for (const { code, fixture, override } of cases) {
      const fx = fixture();
      const options = fx.options({
        ...override,
        ...(code === 'protected_folder' ? { worktreePath: join(fx.sb.tmp, 'Downloads', 'example-frontend') } : {}),
      });

      const error = await refusalOf(preflight(options));

      expect(error, code).toMatchObject(refusal(code));
      expect(fx.status(), code).toBe('refused');
      expect(fx.events('preflight'), code).toHaveLength(1);
      expect(agentAndSpend(fx), code).toEqual(NOTHING_STARTED);
    }
  });

  test('without a run, a passing preflight writes no event and leaves the stored status alone', async () => {
    const fx = preflightFixture();

    const result = await preflight(fx.dryOptions());

    expect(result).toMatchObject({ ok: true });
    expect(fx.events('preflight')).toHaveLength(0);
    expect(fx.status()).toBe('preflight');
  });
});
