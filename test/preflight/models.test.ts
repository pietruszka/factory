import { describe, expect, test } from 'vitest';

import {
  checkModelsPreflight,
  parseAgentModelsOutput,
  type HomeModelsConfig,
  type ModelCatalogByCli,
} from '../../src/preflight/models.js';

function makeConfig(overrides: Partial<HomeModelsConfig> = {}): HomeModelsConfig {
  return {
    planner: {
      cli: 'cursor-agent',
      model: 'gpt-5.3-codex-high',
      family: 'gpt',
    },
    builder: {
      cli: 'cursor-agent',
      model: 'gpt-5.3-codex-high',
      family: 'gpt',
    },
    reviewer: {
      cli: 'cursor-agent',
      model: 'claude-opus-5-5-high',
      family: 'claude',
      temporary: true,
      note: 'TEMPORARY per D-37 until Copilot CLI follow-up passes.',
    },
    visionJudge: {
      cli: null,
      model: 'claude-opus-5-5-high',
      family: 'claude',
      note: 'Cursor agent has no headless image input yet.',
    },
    ...overrides,
  };
}

function makeCatalog(overrides: Partial<ModelCatalogByCli> = {}): ModelCatalogByCli {
  return {
    'cursor-agent': ['gpt-5.3-codex-high', 'claude-opus-5-5-high'],
    ...overrides,
  };
}

describe('checkModelsPreflight', () => {
  test('passes for approved FAC-6 defaults', () => {
    const result = checkModelsPreflight(makeConfig(), makeCatalog());
    expect(result).toEqual([]);
  });

  test('reports missing role entries', () => {
    const partial = makeConfig();
    delete partial.visionJudge;
    const result = checkModelsPreflight(partial, makeCatalog());
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_role',
          role: 'visionJudge',
        }),
      ]),
    );
  });

  test('rejects a model containing -high-fast', () => {
    const result = checkModelsPreflight(
      makeConfig({
        planner: {
          cli: 'cursor-agent',
          model: 'gpt-5.3-codex-high-fast',
          family: 'gpt',
        },
      }),
      makeCatalog({
        'cursor-agent': ['gpt-5.3-codex-high-fast', 'gpt-5.3-codex-high', 'claude-opus-5-5-high'],
      }),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'high_fast_model',
          role: 'planner',
        }),
      ]),
    );
  });

  test('rejects a model id ending in -fast', () => {
    const result = checkModelsPreflight(
      makeConfig({
        builder: {
          cli: 'cursor-agent',
          model: 'gpt-5.3-codex-fast',
          family: 'gpt',
        },
      }),
      makeCatalog({
        'cursor-agent': ['gpt-5.3-codex-high', 'gpt-5.3-codex-fast', 'claude-opus-5-5-high'],
      }),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'fast_model',
          role: 'builder',
        }),
      ]),
    );
  });

  test('rejects reviewer family equal to planner/builder family', () => {
    const result = checkModelsPreflight(
      makeConfig({
        reviewer: {
          cli: 'cursor-agent',
          model: 'gpt-5.3-codex-high',
          family: 'gpt',
        },
      }),
      makeCatalog(),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'same_family_conflict',
          role: 'reviewer',
        }),
      ]),
    );
  });

  test('rejects vision judge family equal to planner/builder family', () => {
    const result = checkModelsPreflight(
      makeConfig({
        visionJudge: {
          cli: null,
          model: 'gpt-5.3-codex-high',
          family: 'gpt',
          note: 'still open',
        },
      }),
      makeCatalog(),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'same_family_conflict',
          role: 'visionJudge',
        }),
      ]),
    );
  });

  test('rejects a model id not accepted by its CLI', () => {
    const result = checkModelsPreflight(
      makeConfig({
        reviewer: {
          cli: 'cursor-agent',
          model: 'claude-sonnet-5-5-high',
          family: 'claude',
        },
      }),
      makeCatalog(),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'model_not_accepted_by_cli',
          role: 'reviewer',
          cli: 'cursor-agent',
        }),
      ]),
    );
  });

  test('rejects mismatched family labels even when same-family conflict would not trigger', () => {
    const result = checkModelsPreflight(
      makeConfig({
        reviewer: {
          cli: 'cursor-agent',
          model: 'gpt-5.3-codex-high',
          family: 'claude',
        },
      }),
      makeCatalog(),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'family_label_mismatch',
          role: 'reviewer',
          model: 'gpt-5.3-codex-high',
        }),
        expect.objectContaining({
          code: 'same_family_conflict',
          role: 'reviewer',
        }),
      ]),
    );
  });

  test('reports unknown family for reviewer when family cannot be derived from model id', () => {
    const result = checkModelsPreflight(
      makeConfig({
        reviewer: {
          cli: 'cursor-agent',
          model: 'composer-sonnet-4',
          family: 'claude',
        },
      }),
      makeCatalog({
        'cursor-agent': ['gpt-5.3-codex-high', 'claude-opus-5-5-high', 'composer-sonnet-4'],
      }),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unknown_family',
          role: 'reviewer',
          model: 'composer-sonnet-4',
        }),
      ]),
    );
  });

  test('reports unknown family for vision judge when family cannot be derived from model id', () => {
    const result = checkModelsPreflight(
      makeConfig({
        visionJudge: {
          cli: null,
          model: 'muse-creative-1',
          family: 'claude',
          note: 'still open',
        },
      }),
      makeCatalog(),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unknown_family',
          role: 'visionJudge',
          model: 'muse-creative-1',
        }),
      ]),
    );
  });

  test.each(['planner', 'builder', 'reviewer', 'visionJudge'] as const)(
    'rejects auto model selection for %s',
    (role) => {
      const config =
        role === 'planner'
          ? makeConfig({
              planner: {
                cli: 'cursor-agent',
                model: 'auto',
                family: 'gpt',
              },
            })
          : role === 'builder'
            ? makeConfig({
                builder: {
                  cli: 'cursor-agent',
                  model: 'auto',
                  family: 'gpt',
                },
              })
            : role === 'reviewer'
              ? makeConfig({
                  reviewer: {
                    cli: 'cursor-agent',
                    model: 'auto',
                    family: 'claude',
                  },
                })
              : makeConfig({
                  visionJudge: {
                    cli: null,
                    model: 'auto',
                    family: 'claude',
                    note: 'still open',
                  },
                });
      const result = checkModelsPreflight(
        config,
        makeCatalog({
          'cursor-agent': ['gpt-5.3-codex-high', 'claude-opus-5-5-high', 'auto'],
        }),
      );

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'unknown_family',
            role,
            model: 'auto',
          }),
        ]),
      );
    },
  );

  test('rejects non-usage-reporting CLIs for model roles', () => {
    const result = checkModelsPreflight(
      makeConfig({
        reviewer: {
          cli: 'some-cli',
          model: 'claude-opus-5-5-high',
          family: 'claude',
        },
      }),
      makeCatalog({
        'some-cli': ['claude-opus-5-5-high'],
      }),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'cli_without_usage',
          role: 'reviewer',
          cli: 'some-cli',
        }),
      ]),
    );
  });

  test('rejects fast=true overrides and case variants', () => {
    const result = checkModelsPreflight(
      makeConfig({
        builder: {
          cli: 'cursor-agent',
          model: 'gpt-5.3-codex-high[reasoning=high,FAST=true]',
          family: 'gpt',
        },
      }),
      makeCatalog({
        'cursor-agent': [
          'gpt-5.3-codex-high',
          'gpt-5.3-codex-high[reasoning=high,FAST=true]',
          'claude-opus-5-5-high',
        ],
      }),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'fast_model',
          role: 'builder',
        }),
      ]),
    );
  });
});

describe('parseAgentModelsOutput', () => {
  test('extracts model IDs from real output format with header and tip footer', () => {
    const parsed = parseAgentModelsOutput(
      [
        'Available models:',
        'gpt-5.3-codex-high - GPT 5.3 Codex High',
        'claude-opus-5-5-high - Claude Opus 5.5',
        'Tip: Use `--model <id>` to select a model',
        '',
      ].join('\n'),
    );

    expect(parsed).toEqual(['gpt-5.3-codex-high', 'claude-opus-5-5-high']);
  });

  test('throws when output is truncated and lacks the tip footer', () => {
    expect(() =>
      parseAgentModelsOutput(
        ['Available models:', 'gpt-5.3-codex-high - GPT 5.3 Codex High', 'claude-opus-5-5-high - Claude Opus 5.5']
          .join('\n'),
      ),
    ).toThrow(/truncated/i);
  });

  test('does not parse warning lines as model IDs', () => {
    const parsed = parseAgentModelsOutput(
      [
        'Available models:',
        'gpt-5.3-codex-high - GPT 5.3 Codex High',
        'Warning: token refresh - retrying',
        'Tip: Use `--model <id>` to select a model',
      ].join('\n'),
    );

    expect(parsed).toEqual(['gpt-5.3-codex-high']);
  });
});
