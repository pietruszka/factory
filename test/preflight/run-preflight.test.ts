import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { DEFAULT_MODELS, renderModelsSectionYaml } from '../../src/config/models.js';
import { DEV_HOME_MARKER } from '../../src/dev/home.js';
import { runModelsPreflight, runPreflight } from '../../src/preflight/models.js';

describe('runModelsPreflight', () => {
  test('passes when all checks pass and accepts injected CLI model lists', () => {
    const result = runModelsPreflight(
      {
        planner: { cli: 'cursor-agent', model: 'gpt-5.3-codex-high', family: 'gpt' },
        builder: { cli: 'cursor-agent', model: 'gpt-5.3-codex-high', family: 'gpt' },
        reviewer: { cli: 'cursor-agent', model: 'claude-opus-5-5-high', family: 'claude' },
        visionJudge: {
          cli: null,
          model: 'claude-opus-5-5-high',
          family: 'claude',
          note: 'still open',
        },
      },
      async () => ({
        'cursor-agent': ['gpt-5.3-codex-high', 'claude-opus-5-5-high'],
      }),
    );

    return expect(result).resolves.toEqual({ ok: true, errors: [] });
  });

  test('fails when an injected CLI list does not accept a configured model id', () => {
    const result = runModelsPreflight(
      {
        planner: { cli: 'cursor-agent', model: 'gpt-5.3-codex-high', family: 'gpt' },
        builder: { cli: 'cursor-agent', model: 'gpt-5.3-codex-high', family: 'gpt' },
        reviewer: { cli: 'cursor-agent', model: 'claude-opus-5-5-high', family: 'claude' },
        visionJudge: {
          cli: null,
          model: 'claude-opus-5-5-high',
          family: 'claude',
          note: 'still open',
        },
      },
      async () => ({
        'cursor-agent': ['gpt-5.3-codex-high'],
      }),
    );

    return expect(result).resolves.toEqual({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({
          code: 'model_not_accepted_by_cli',
          role: 'reviewer',
        }),
      ]),
    });
  });
});

describe('runPreflight', () => {
  test('uses pipefail command and includes stderr when agent models command fails', async () => {
    const factoryHome = mkdtempSync(join(tmpdir(), 'factory-preflight-'));
    writeFileSync(join(factoryHome, 'config.yaml'), `${renderModelsSectionYaml(DEFAULT_MODELS)}\n`, 'utf8');
    writeFileSync(join(factoryHome, DEV_HOME_MARKER), 'test marker\n', 'utf8');

    const run = runPreflight({
      FACTORY_HOME: factoryHome,
      PATH: '/bin',
    });
    await expect(run).rejects.toThrow(/set -o pipefail; agent models \| cat/);
    await expect(run).rejects.toThrow(/not found|command not found/);
  });
});
