import { describe, expect, test } from 'vitest';

import {
  CompleteModelsSectionSchema,
  ModelsSectionSchema,
  renderModelsSectionYaml,
} from '../../src/config/models.js';

describe('ModelsSectionSchema', () => {
  test('accepts partial models section and defaults to empty object', () => {
    expect(ModelsSectionSchema.parse(undefined)).toEqual({});
    expect(
      ModelsSectionSchema.parse({
        planner: {
          cli: 'cursor-agent',
          model: 'gpt-5.3-codex-high',
          family: 'gpt',
        },
      }),
    ).toEqual({
      planner: {
        cli: 'cursor-agent',
        model: 'gpt-5.3-codex-high',
        family: 'gpt',
      },
    });
  });

  test('complete schema still requires all roles', () => {
    expect(() =>
      CompleteModelsSectionSchema.parse({
        planner: {
          cli: 'cursor-agent',
          model: 'gpt-5.3-codex-high',
          family: 'gpt',
        },
      }),
    ).toThrow();
  });
});

describe('renderModelsSectionYaml', () => {
  test('quotes cli, model and family string values', () => {
    const yaml = renderModelsSectionYaml({
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
      },
      visionJudge: {
        cli: null,
        model: 'claude-opus-5-5-high',
        family: 'claude',
      },
    });

    expect(yaml).toContain('cli: "cursor-agent"');
    expect(yaml).toContain('model: "gpt-5.3-codex-high"');
    expect(yaml).toContain('family: "gpt"');
    expect(yaml).toContain('cli: null');
  });
});
