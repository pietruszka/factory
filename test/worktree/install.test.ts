import { afterEach, describe, expect, test } from 'vitest';

import type { Deps } from '../../src/platform/deps.js';
import { createWorktree } from '../../src/worktree/create.js';
import { installWorktree, type CommandRunner } from '../../src/worktree/install.js';
import { cleanupEventLogTest } from '../support/event-log.js';
import { eventsOf, expectRejection, worktreeFixture, type WorktreeFixture } from '../support/worktree-fixture.js';

afterEach(cleanupEventLogTest);

interface FakeRunner {
  run: CommandRunner;
  calls: Array<{ command: string; cwd: string }>;
}

/** Records every call and moves the fake clock by `ms`, as a command that took that long would. */
function fakeRunner(deps: Deps & { advance(ms: number): void }, ms: number): FakeRunner {
  const calls: FakeRunner['calls'] = [];
  const run: CommandRunner = (command, options) => {
    calls.push({ command, cwd: options.cwd });
    deps.advance(ms);
    return Promise.resolve({ exitCode: 0 });
  };
  return { run, calls };
}

function install(fx: WorktreeFixture, path: string, run: CommandRunner): Promise<void> {
  return installWorktree({
    env: fx.sb.env,
    deps: fx.deps,
    log: fx.log,
    reader: fx.reader,
    runId: 'run-1',
    repoPath: fx.repo.path,
    path,
    run,
  });
}

describe('install in the worktree', () => {
  test('installWorktree runs the install command once with cwd at the worktree', async () => {
    const fx = worktreeFixture();
    const created = createWorktree(fx.options());
    const runner = fakeRunner(fx.deps, 0);

    await install(fx, created.path, runner.run);

    expect(runner.calls).toEqual([{ command: 'make install-deps', cwd: created.path }]);
  });

  test('a worktree_install event records started_at and ended_at from Deps, and the duration is not invented as zero when the command took time', async () => {
    const fx = worktreeFixture();
    const created = createWorktree(fx.options());
    const runner = fakeRunner(fx.deps, 2500);

    await install(fx, created.path, runner.run);

    const events = eventsOf(fx.reader, 'run-1', 'worktree_install');
    expect(events).toHaveLength(1);
    expect(events[0]?.started_at).toBe('2026-01-01T10:00:00.000Z');
    expect(events[0]?.ended_at).toBe('2026-01-01T10:00:02.500Z');
  });

  test('a second installWorktree on the same worktree is refused', async () => {
    const fx = worktreeFixture();
    const created = createWorktree(fx.options());
    const runner = fakeRunner(fx.deps, 0);
    await install(fx, created.path, runner.run);

    await expectRejection(install(fx, created.path, runner.run));

    expect(runner.calls).toHaveLength(1);
    expect(eventsOf(fx.reader, 'run-1', 'worktree_install')).toHaveLength(1);
  });

  test('a failed install is recorded as failed, refused as worktree_install_failed, and may be retried', async () => {
    const fx = worktreeFixture();
    const created = createWorktree(fx.options());
    const failing: CommandRunner = () => Promise.resolve({ exitCode: 1 });
    const working = fakeRunner(fx.deps, 0);

    await expectRejection(install(fx, created.path, failing), ['worktree_install_failed']);
    expect(eventsOf(fx.reader, 'run-1', 'worktree_install').map((event) => event.payload)).toEqual([
      { path: created.path, exit_code: 1 },
    ]);

    await install(fx, created.path, working.run);
    expect(working.calls).toHaveLength(1);
  });
});
