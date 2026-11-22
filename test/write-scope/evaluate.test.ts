import { describe, expect, test } from 'vitest';

import { evaluateChanges } from '../../src/write-scope/evaluate.js';
import type { ScopeChange } from '../../src/write-scope/snapshot.js';
import { scopeConfig } from '../support/write-scope.js';

const added = (...paths: string[]): ScopeChange[] => paths.map((path) => ({ path, kind: 'added' }));
const okOf = (role: string, config: ReturnType<typeof scopeConfig>, ...paths: string[]) =>
  evaluateChanges(role, config, added(...paths)).map((row) => row.ok);

describe('role write globs match whole paths', () => {
  test('a star stays inside one folder and a double star crosses folders', () => {
    const config = scopeConfig({ role_write_globs: { builder: ['src/*.ts', 'docs/**'] } });

    expect(okOf('builder', config, 'src/a.ts', 'src/deep/a.ts', 'docs/a.md', 'docs/deep/a.md', 'other.ts')).toEqual([
      true,
      false,
      true,
      true,
      false,
    ]);
  });

  test('a double star followed by a slash also matches no folder', () => {
    const config = scopeConfig({ protected_globs: ['**/package.json', 'src/**/gen.ts'] });

    expect(okOf('builder', config, 'package.json', 'apps/web/package.json', 'src/gen.ts', 'src/a/b/gen.ts', 'src/gen.tsx')).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  test('a protected glob wins over a role write glob', () => {
    const config = scopeConfig({ protected_globs: ['.github/**'], role_write_globs: { planner: ['.github/**', 'plan.md'] } });

    expect(okOf('planner', config, '.github/ci.yml', 'plan.md')).toEqual([false, true]);
  });
});

describe('role defaults and overrides', () => {
  test('an empty override keeps the default and a listed override replaces it as a whole', () => {
    const empty = scopeConfig({ role_write_globs: { planner: [] } });
    const replaced = scopeConfig({ role_write_globs: { planner: ['docs/**'] } });

    expect(okOf('planner', empty, 'plan.md', 'docs/a.md')).toEqual([true, false]);
    expect(okOf('planner', replaced, 'plan.md', 'docs/a.md')).toEqual([false, true]);
  });

  test('reviewer, visionJudge, verifier and an unknown role write nothing by default', () => {
    for (const role of ['reviewer', 'visionJudge', 'verifier', 'somebody-else']) {
      expect(okOf(role, scopeConfig(), 'plan.md', 'src/a.ts')).toEqual([false, false]);
    }
  });
});
