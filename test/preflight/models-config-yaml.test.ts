import { describe, expect, test } from 'vitest';

import { DEFAULT_MODELS, renderModelsSectionYaml } from '../../src/config/models.js';
import { readModelsConfigFromYaml } from '../../src/preflight/models.js';

describe('readModelsConfigFromYaml', () => {
  test('round-trips models rendered by renderModelsSectionYaml', () => {
    const parsed = readModelsConfigFromYaml(renderModelsSectionYaml(DEFAULT_MODELS));
    expect(parsed).toEqual(DEFAULT_MODELS);
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
    expect(() => readModelsConfigFromYaml(contents)).toThrow(/line 2:/i);
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
    expect(() => readModelsConfigFromYaml(contents)).toThrow(/line 6:/i);
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
    expect(() => readModelsConfigFromYaml(contents)).toThrow(/line 6:.*__proto__/i);
  });

  test('rejects malformed quoted strings with line number context', () => {
    const contents = [
      'models:',
      '  planner:',
      '    cli: "cursor-agent"',
      '    model: "gpt-5.3-codex-high',
      '    family: "gpt"',
    ].join('\n');
    expect(() => readModelsConfigFromYaml(contents)).toThrow(/line 4:/i);
  });
});
