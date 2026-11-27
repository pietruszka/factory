import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { killRun } from '../../src/kill/kill-run.js';
import { createFakeProcessTable, createPosixProcessTable } from '../../src/ports/process-table.js';
import { createPosixSpawner, type Spawner } from '../../src/ports/spawner.js';
import { transition } from '../../src/run-state/transition.js';
import { createWorktree } from '../../src/worktree/create.js';
import { eventsOf } from '../support/worktree-fixture.js';
import { allGone, recordingSpawner, startWorkerInRun, withClock } from '../support/kill.js';
import { cleanupRunStateTest, runStateFixture } from '../support/run-state.js';
import { isAlive } from '../support/worker-runtime.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupRunStateTest();
});

const GRACE_MS = 300;

/** A Spawner that starts nothing and reports every tree as already gone. */
const goneSpawner: Spawner = {
  spawn: async () => {
    throw new Error('this test starts no children');
  },
  termTree: async () => 'gone',
  killTree: async () => 'gone',
};

const killedEvents = (state: ReturnType<typeof runStateFixture>) => eventsOf(state.fx.reader, 'run-1', 'killed');

const endedAt = (state: ReturnType<typeof runStateFixture>) =>
  state.rows('SELECT ended_at FROM processes').map((row) => row.ended_at);

describe('killRun on a run whose process row is a recycled pid', () => {
  test('killRun on a run whose process row is a recycled pid still moves the run to killed, writes the event, and does not signal that pid', async () => {
    const state = runStateFixture();
    createWorktree(state.fx.options());
    state.arrange('building');
    const processTable = createFakeProcessTable();
    const spawner = createPosixSpawner({ processTable, deps: state.fx.deps });
    // A real child that this test starts under the temp home; the fake table then claims its pid was recycled.
    const child = await spawner.spawn({ command: '/bin/sleep', args: ['30'], cwd: state.worktree });
    state.fx.log.appendProcess({ run_id: 'run-1', step: 'implement', pid: child.pid, command: '/bin/sleep 30' });
    processTable.plantRecycledPid(child.pid, 'some-other-program');

    try {
      await withClock(killRun({ ...state.context, runId: 'run-1', spawner, processTable, graceMs: GRACE_MS }), state.fx.deps);

      expect(isAlive(child.pid)).toBe(true);
      expect(state.status()).toBe('killed');
      expect(killedEvents(state)).toHaveLength(1);
      expect(existsSync(state.worktree)).toBe(true);
      expect(endedAt(state)).toEqual([expect.any(String)]);
    } finally {
      process.kill(child.pid, 'SIGKILL'); // the pid is the one this test started
      await child.exit;
    }
  });
});

describe('killRun on a worker that ignores SIGTERM', () => {
  test('a fake worker that spawns children and ignores SIGTERM is sent a polite stop, then escalated with SIGKILL, and the tree is gone within the injectable grace', async () => {
    const state = runStateFixture();
    const worker = await startWorkerInRun(state, 'ignore-sigterm-children', 2);
    const processTable = createPosixProcessTable();
    const { spawner, calls } = recordingSpawner(createPosixSpawner({ processTable, deps: state.fx.deps }));
    const before = state.fx.deps.now();

    await withClock(killRun({ ...state.context, runId: 'run-1', spawner, processTable, graceMs: GRACE_MS }), state.fx.deps);

    expect(calls).toEqual([
      { op: 'term', pid: worker.pid, command: worker.command, result: 'killed' },
      { op: 'kill', pid: worker.pid, command: worker.command, result: 'killed' },
    ]);
    expect(state.fx.deps.now() - before).toBeLessThanOrEqual(GRACE_MS + 100);
    await allGone([worker.pid, ...worker.descendants]);
    expect(existsSync(state.worktree)).toBe(true);
    expect(state.status()).toBe('killed');
    await worker.step.result;
  }, 20_000);
});

describe('a killed run is left resumable', () => {
  test('after killRun the run status is killed, the worktree directory still exists, and a library transition from killed onto a later phase is accepted', async () => {
    const state = runStateFixture();
    createWorktree(state.fx.options());
    state.arrange('building');
    state.fx.log.appendProcess({ run_id: 'run-1', step: 'implement', pid: 4242, command: 'example-worker --print' });

    await withClock(
      killRun({
        ...state.context,
        runId: 'run-1',
        spawner: goneSpawner,
        processTable: createFakeProcessTable(),
        graceMs: GRACE_MS,
      }),
      state.fx.deps,
    );

    expect(state.status()).toBe('killed');
    expect(existsSync(state.worktree)).toBe(true);
    expect(endedAt(state)).toEqual([expect.any(String)]);
    // FAC-20: a stopped run goes back to the phase it left, here building.
    transition(state.context, 'run-1', 'building');
    expect(state.status()).toBe('building');
    expect(existsSync(state.worktree)).toBe(true);
  });
});

describe('killRun goes through ProcessTable and Spawner', () => {
  test('killRun looks up process rows and calls termTree and killTree with the recorded pid and command; it does not call process.kill', async () => {
    const state = runStateFixture();
    state.arrange('building');
    const command = 'example-worker --print';
    state.fx.log.appendProcess({ run_id: 'run-1', step: 'implement', pid: 4242, command });
    const processTable = createFakeProcessTable();
    processTable.record({ pid: 4242, command, startedAt: 0 }); // still matches, so the polite stop did not end it
    const { spawner, calls } = recordingSpawner({
      spawn: goneSpawner.spawn,
      termTree: async () => 'killed',
      killTree: async () => 'killed',
    });
    const signal = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await withClock(killRun({ ...state.context, runId: 'run-1', spawner, processTable, graceMs: GRACE_MS }), state.fx.deps);

    expect(calls).toEqual([
      { op: 'term', pid: 4242, command, result: 'killed' },
      { op: 'kill', pid: 4242, command, result: 'killed' },
    ]);
    expect(signal).not.toHaveBeenCalled();

    // Static check: neither the kill library nor the command module names process.kill.
    const root = join(import.meta.dirname, '..', '..', 'src');
    const files = [
      ...readdirSync(join(root, 'kill')).map((name) => join(root, 'kill', name)),
      join(root, 'cli', 'kill.ts'),
    ];
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/process\.kill\s*\(/);
    }
  });
});
