import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { writeReport } from '../../src/run-folder/report.js';
import { createWorktree } from '../../src/worktree/create.js';
import { removeWorktree } from '../../src/worktree/remove.js';
import { cleanupEventLogTest } from '../support/event-log.js';
import { eventsOf, worktreeFixture } from '../support/worktree-fixture.js';

afterEach(cleanupEventLogTest);

describe('worktree events and report', () => {
  test('createWorktree appends a worktree_created event with the path, base commit and mode', () => {
    const fx = worktreeFixture();

    createWorktree(fx.options({ mode: 'linked', allowedPaths: ['src/**'] }));

    const events = eventsOf(fx.reader, 'run-1', 'worktree_created');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      path: join(fx.sb.home, 'cache', 'worktrees', 'example-frontend', 'FE-123'),
      base_commit: fx.repo.baseCommit,
      mode: 'linked',
      allowed_paths: ['src/**'],
    });
  });

  test('writeReport after createWorktree includes the worktree path and the base commit', () => {
    const fx = worktreeFixture();
    mkdirSync(join(fx.sb.home, 'runs', 'example-frontend', 'FE-123'), { recursive: true });

    const created = createWorktree(fx.options());
    const reportPath = writeReport({ env: fx.sb.env, log: fx.reader, runId: 'run-1', worktreePath: created.path });

    const text = readFileSync(reportPath, 'utf8');
    expect(text).toContain(`- **Worktree:** ${join(fx.sb.home, 'cache', 'worktrees', 'example-frontend', 'FE-123')}`);
    expect(text).toContain(`- **Base commit:** ${fx.repo.baseCommit}`);
  });

  test('removeWorktree appends a worktree_removed event', () => {
    const fx = worktreeFixture();
    const created = createWorktree(fx.options());

    removeWorktree({ env: fx.sb.env, deps: fx.deps, log: fx.log, runId: 'run-1', repoPath: fx.repo.path, path: created.path });

    const removed = eventsOf(fx.reader, 'run-1', 'worktree_removed');
    expect(removed).toHaveLength(1);
    const createdEvent = eventsOf(fx.reader, 'run-1', 'worktree_created')[0];
    expect(createdEvent).toBeDefined();
    expect(removed[0]?.id).toBeGreaterThan(createdEvent?.id ?? Number.MAX_SAFE_INTEGER);
  });
});
