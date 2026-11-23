import { afterEach, describe, expect, test } from 'vitest';

import { DEFAULT_MODELS } from '../../src/config/models.js';
import { preflight } from '../../src/preflight/preflight.js';
import { cleanupEventLogTest } from '../support/event-log.js';
import {
  agentAndSpend,
  catalogSpy,
  DEFAULT_CATALOG,
  NOTHING_STARTED,
  preflightFixture,
  refusal,
  refusalOf,
} from '../support/preflight.js';

afterEach(cleanupEventLogTest);

describe('the model preflight inside the unified preflight', () => {
  test('a unified preflight call also runs the existing model preflight and fails with the existing model error when the reviewer is a high-fast variant or is from the builder\'s family', async () => {
    const highFast = preflightFixture({
      models: {
        ...DEFAULT_MODELS,
        reviewer: { cli: 'cursor-agent', model: 'claude-opus-5-5-high-fast', family: 'claude' },
      },
    });
    const sameFamily = preflightFixture({
      models: {
        ...DEFAULT_MODELS,
        reviewer: { cli: 'cursor-agent', model: 'gpt-5.3-codex-high', family: 'gpt' },
        visionJudge: { cli: null, model: 'gpt-5.3-codex-high', family: 'gpt' },
      },
    });

    const highFastError = await refusalOf(
      preflight(
        highFast.options({
          loadCatalog: catalogSpy({
            'cursor-agent': [...(DEFAULT_CATALOG['cursor-agent'] ?? []), 'claude-opus-5-5-high-fast'],
          }).loadCatalog,
        }),
      ),
    );
    const sameFamilyError = await refusalOf(preflight(sameFamily.options()));

    expect(highFastError).toMatchObject(refusal('high_fast_model'));
    expect(highFastError.message).toContain('-high-fast');
    expect(sameFamilyError).toMatchObject(refusal('same_family_conflict'));
    expect(sameFamilyError.message).toContain('reviewer');
    expect(agentAndSpend(highFast)).toEqual(NOTHING_STARTED);
    expect(agentAndSpend(sameFamily)).toEqual(NOTHING_STARTED);
  });

  test('a model failure is not labelled config_drift', async () => {
    const fx = preflightFixture({
      models: {
        ...DEFAULT_MODELS,
        reviewer: { cli: 'cursor-agent', model: 'claude-opus-5-5-high', family: 'claude' },
      },
    });

    const error = await refusalOf(preflight(fx.dryOptions({ loadCatalog: catalogSpy({ 'cursor-agent': [] }).loadCatalog })));

    expect(error).toMatchObject(refusal('model_not_accepted_by_cli'));
    expect(error.code).not.toBe('config_drift');
  });

  test('when models are valid, the injected catalog is used and no agent CLI is started', async () => {
    const fx = preflightFixture();
    const catalog = catalogSpy();

    const result = await preflight(fx.options({ loadCatalog: catalog.loadCatalog }));

    expect(result).toMatchObject({ ok: true });
    expect(catalog.calls).toEqual([['cursor-agent']]);
    expect(agentAndSpend(fx)).toEqual(NOTHING_STARTED);
  });
});
