import { describe, expect, test } from 'vitest';

import { DEFAULT_MODELS, renderModelsSectionYaml } from '../../src/config/models.js';
import { FactoryError } from '../../src/platform/errors.js';
import { readModelsConfigFromYaml } from '../../src/preflight/models.js';

function refusal(fn: () => unknown): FactoryError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(FactoryError);
    return error as FactoryError;
  }
  throw new Error('expected the call to be refused, but it returned');
}

describe('readModelsConfigFromYaml', () => {
  test('round-trips models rendered by renderModelsSectionYaml', () => {
    const parsed = readModelsConfigFromYaml(renderModelsSectionYaml(DEFAULT_MODELS));
    expect(parsed).toEqual(DEFAULT_MODELS);
  });

  test('reads a models section next to a list and a multi-line string', () => {
    const contents = [
      'version: 1',
      'notes: |',
      '  first',
      '  second',
      'tags:',
      '  - a',
      renderModelsSectionYaml(DEFAULT_MODELS),
    ].join('\n');
    expect(readModelsConfigFromYaml(contents)).toEqual(DEFAULT_MODELS);
  });

  test('fails when models section is missing', () => {
    expect(() => readModelsConfigFromYaml('version: 1\n')).toThrow(/models/i);
  });

  test('rejects tab indentation with line number context', () => {
    const contents = [
      'models:',
      '\tplanner:',
      '\t\tcli: "cursor-agent"',
      '\t\tmodel: "gpt-5.3-codex-high"',
      '\t\tfamily: "gpt"',
    ].join('\n');
    expect(refusal(() => readModelsConfigFromYaml(contents)).where).toMatch(/:2$/);
  });

  test('rejects duplicate keys with line number context', () => {
    const contents = [
      'models:',
      '  planner:',
      '    cli: "cursor-agent"',
      '    model: "gpt-5.3-codex-high"',
      '    family: "gpt"',
      '  planner:',
      '    cli: "cursor-agent"',
      '    model: "gpt-5.3-codex-high"',
      '    family: "gpt"',
    ].join('\n');
    expect(refusal(() => readModelsConfigFromYaml(contents)).where).toMatch(/:6$/);
  });

  test('rejects reserved keys such as __proto__', () => {
    const contents = [
      'models:',
      '  planner:',
      '    cli: "cursor-agent"',
      '    model: "gpt-5.3-codex-high"',
      '    family: "gpt"',
      '  __proto__:',
      '    polluted: true',
    ].join('\n');
    const error = refusal(() => readModelsConfigFromYaml(contents));
    expect(error.where).toMatch(/:6$/);
    expect(error.message).toContain('__proto__');
  });

  test('rejects malformed quoted strings with line number context', () => {
    const contents = [
      'models:',
      '  planner:',
      '    cli: "cursor-agent"',
      '    model: "gpt-5.3-codex-high',
      '    family: "gpt"',
    ].join('\n');
    expect(refusal(() => readModelsConfigFromYaml(contents)).where).toMatch(/:4$/);
  });
});
