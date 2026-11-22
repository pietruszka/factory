import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { transition } from '../../src/run-state/transition.js';
import { cleanupRunStateTest, PHASE_ORDER } from '../support/run-state.js';
import { errorFields, thrownBy } from '../support/event-log.js';
import { git } from '../support/work-repo.js';
import { scopeConfig, writeScopeFixture, type WriteScopeFixture } from '../support/write-scope.js';

afterEach(cleanupRunStateTest);

const STEP_ROWS = 'SELECT step, status, exit_reason FROM steps ORDER BY attempt';
const APP_TS = 'export const app = 1;\n';
const README = 'example\n';

/** What git reports as changed in the worktree, untracked files included. Empty means the worktree is clean. */
const dirtyPaths = (scope: WriteScopeFixture): string =>
  git(scope.worktree, 'status', '--porcelain', '--untracked-files=all');

describe('a role that writes outside its scope fails as a breach', () => {
  test('a planner that edits a worktree code file fails as a breach, a write_scope event is logged, and the file is restored', async () => {
    const scope = writeScopeFixture();

    const outcome = await scope.runScoped('scope-code-edit', 'planner');

    expect(outcome.status).toBe('breach');
    expect(scope.state.rows(STEP_ROWS)).toEqual([{ step: 'step', status: 'failed', exit_reason: 'breach' }]);
    expect(scope.writeScopeEvents()).toEqual([{ rows: [{ item: 'src/app.ts', ok: false }] }]);
    expect(readFileSync(join(scope.worktree, 'src/app.ts'), 'utf8')).toBe(APP_TS);
    expect(dirtyPaths(scope)).toBe('');
    expect(git(scope.worktree, 'rev-parse', 'HEAD')).toBe(scope.baseCommit);
  });

  test('a planner that writes plan.md in the worktree is not a breach', async () => {
    const scope = writeScopeFixture();

    const outcome = await scope.runScoped('scope-plan-md', 'planner');

    expect(outcome.status).toBe('building');
    expect(scope.writeScopeEvents()).toEqual([{ rows: [{ item: 'plan.md', ok: true }] }]);
    expect(existsSync(join(scope.worktree, 'plan.md'))).toBe(true);
  });

  test('a reviewer that edits any worktree file fails as a breach, a write_scope event is logged, and the file is restored', async () => {
    const scope = writeScopeFixture();

    const outcome = await scope.runScoped('scope-doc-edit', 'reviewer');

    expect(outcome.status).toBe('breach');
    expect(scope.state.rows(STEP_ROWS)).toEqual([{ step: 'step', status: 'failed', exit_reason: 'breach' }]);
    expect(scope.writeScopeEvents()).toEqual([{ rows: [{ item: 'README.md', ok: false }] }]);
    expect(readFileSync(join(scope.worktree, 'README.md'), 'utf8')).toBe(README);
    expect(dirtyPaths(scope)).toBe('');
  });

  test('a builder that touches a protected glob fails as a breach, a write_scope event is logged, and the file is restored', async () => {
    const scope = writeScopeFixture();
    const config = scopeConfig({ protected_globs: ['.github/**', 'README.md'] });

    const outcome = await scope.runScoped('scope-builder', 'builder', config);

    expect(outcome.status).toBe('breach');
    expect(scope.state.rows(STEP_ROWS)).toEqual([{ step: 'step', status: 'failed', exit_reason: 'breach' }]);
    expect(scope.writeScopeEvents()).toEqual([
      {
        rows: [
          { item: '.github/workflows/ci.yml', ok: false },
          { item: 'README.md', ok: false },
          { item: 'src/feature.ts', ok: true },
        ],
      },
    ]);
    // The edited protected file has its contents back and the added protected file is gone.
    expect(readFileSync(join(scope.worktree, 'README.md'), 'utf8')).toBe(README);
    expect(existsSync(join(scope.worktree, '.github/workflows/ci.yml'))).toBe(false);
    // The allowed change of the same step is left alone.
    expect(readFileSync(join(scope.worktree, 'src/feature.ts'), 'utf8')).toBe('export const feature = 1;\n');
    expect(dirtyPaths(scope)).toBe('?? src/feature.ts');
  });

  test('the run status is breach and is not left in a phase', async () => {
    const scope = writeScopeFixture();

    const outcome = await scope.runScoped('scope-code-edit', 'planner');

    expect(outcome.status).toBe('breach');
    expect(scope.state.status()).toBe('breach');
    expect(PHASE_ORDER as readonly string[]).not.toContain(scope.state.status());
    expect(scope.state.rows("SELECT ended_at FROM runs WHERE run_id = 'run-1'")[0]?.ended_at).not.toBeNull();
    // A breach is final: the run cannot be moved back into a phase.
    const refused = errorFields(thrownBy(() => transition(scope.state.context, 'run-1', 'building')));
    expect(refused).toMatchObject({ isFactoryError: true, code: 'illegal_transition', exitCode: 2 });
    expect(refused.where).toMatch(/\S/);
    expect(refused.next).toMatch(/\S/);
  });
});

describe('after a verifier step the worktree diff is empty', () => {
  test('a verifier step that changes nothing has an empty worktree diff and does not move the run to breach', async () => {
    const scope = writeScopeFixture();

    const outcome = await scope.runScoped('final-json', 'verifier');

    expect(outcome.status).toBe('building');
    expect(scope.state.status()).toBe('building');
    expect(scope.state.rows(STEP_ROWS)).toEqual([{ step: 'step', status: 'done', exit_reason: 'ok' }]);
    expect(scope.writeScopeEvents()).toEqual([{ rows: [] }]);
    expect(dirtyPaths(scope)).toBe('');
  });

  test('a verifier step that edits a file fails as a breach, a write_scope event is logged, and the file is restored', async () => {
    const scope = writeScopeFixture();

    const outcome = await scope.runScoped('scope-code-edit', 'verifier');

    expect(outcome.status).toBe('breach');
    expect(scope.state.rows(STEP_ROWS)).toEqual([{ step: 'step', status: 'failed', exit_reason: 'breach' }]);
    expect(scope.writeScopeEvents()).toEqual([{ rows: [{ item: 'src/app.ts', ok: false }] }]);
    expect(readFileSync(join(scope.worktree, 'src/app.ts'), 'utf8')).toBe(APP_TS);
    expect(dirtyPaths(scope)).toBe('');
  });
});
