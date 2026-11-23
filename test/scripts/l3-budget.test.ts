import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { L3_BUDGET_SECONDS } from '../../scripts/run-layer.js';
import { REPO_ROOT } from '../support/todo-sandbox.js';

const scripts = (JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;

// Held checks: these describe what is already true and must stay true.
describe('the default gates stay small and offline', () => {
  test('L3 finishes within 120 seconds', () => {
    expect(L3_BUDGET_SECONDS).toBe(120);
    expect(scripts['test:l3']).toContain('run-layer');
  });

  test('npm test and test:l3 pass with the network blocked except localhost: neither runs a trace or the sample gates', () => {
    for (const name of ['test', 'test:l3']) {
      expect(scripts[name], name).toBeDefined();
      expect(scripts[name], name).not.toMatch(/trace|sample-gates|npm ci/);
    }
    expect(scripts.trace).toBeUndefined();
  });
});
