import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';

import { cleanupRunStateTest, runStateFixture, type RunStateFixture } from '../support/run-state.js';
import { stoppedRun } from '../support/resume.js';
import { eventsOf } from '../support/worktree-fixture.js';
import { isAlive, waitFor } from '../support/worker-runtime.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CHILD = join(repoRoot, 'test', 'support', 'resume-child.ts');
const SCENARIOS = join(repoRoot, 'test', 'fixtures', 'worker-scenarios');

/** Children this test started and the latch files that release their fake workers, so nothing outlives the test. */
const started: ChildProcess[] = [];
const latches: string[] = [];

afterEach(async () => {
  for (const latch of latches.splice(0)) {
    // The fake worker polls for this file and then exits by itself.
    if (existsSync(dirname(latch))) writeFileSync(latch, 'release\n');
  }
  for (const child of started.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await cleanupRunStateTest();
});

interface FactoryChild {
  process: ChildProcess;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output: () => { stdout: string; stderr: string };
}

/** Starts the production resume entry (`resumeRun`) as a child process under the fixture's temp home. */
function startFactoryChild(state: RunStateFixture, scenario: string): FactoryChild {
  let stdout = '';
  let stderr = '';
  const child = spawn(process.execPath, ['--import', 'tsx', CHILD, JSON.stringify({ scenarioPath: join(SCENARIOS, `${scenario}.json`) })], {
    cwd: repoRoot,
    env: { PATH: process.env.PATH ?? '', HOME: state.fx.sb.tmp, FACTORY_HOME: state.fx.sb.home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push(child);
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
    child.on('exit', (code, signal) => done({ code, signal }));
  });
  return { process: child, exited, output: () => ({ stdout, stderr }) };
}

/** Waits for the fake worker's ready file. A child that exits first fails the wait with its own error output. */
async function waitUntilBlocked(child: FactoryChild, readyFile: string): Promise<void> {
  let early: string | undefined;
  void child.exited.then(({ code }) => {
    if (!existsSync(readyFile)) early = `the factory child exited with ${String(code)} before the worker was ready:\n${child.output().stderr}`;
  });
  await waitFor(() => {
    if (early !== undefined) throw new Error(early);
    return existsSync(readyFile);
  }, 30_000);
}

describe('a crashed factory child is resumed', () => {
  test('when the factory child is killed with kill -9 while the fake worker blocks on a latch, factory resume completes the run without redoing finished steps', async () => {
    const state = runStateFixture();
    // A crashed orchestrator leaves the run in its phase, with `prepare` finished.
    stoppedRun(state, { left: 'building', steps: [{ step: 'prepare', status: 'done' }] });
    const ready = join(state.worktree, 'ready.txt');
    latches.push(join(state.worktree, 'latch.txt'));

    const first = startFactoryChild(state, 'latch');
    await waitUntilBlocked(first, ready);
    const blocked = state.rows('SELECT pid, ended_at FROM processes WHERE run_id = ?', 'run-1');
    const workerPid = Number(blocked[0]?.pid);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.ended_at).toBeNull();
    // Only the factory child this test started is killed.
    first.process.kill('SIGKILL');
    expect(await first.exited).toMatchObject({ signal: 'SIGKILL' });
    // The crash left the worker alive and the run in its phase.
    expect(isAlive(workerPid)).toBe(true);
    expect(state.status()).toBe('building');

    const second = startFactoryChild(state, 'session-id');
    const result = await second.exited;

    expect(result.code, second.output().stderr).toBe(0);
    expect(JSON.parse(second.output().stdout.trim())).toMatchObject({
      status: 'passed',
      ran: ['implement', 'verify', 'review'],
      skipped: ['prepare'],
    });
    expect(state.status()).toBe('passed');
    // The blocked worker of the crashed attempt was stopped, and its process row ended.
    expect(isAlive(workerPid)).toBe(false);
    expect(state.rows('SELECT ended_at FROM processes WHERE pid = ?', workerPid)[0]?.ended_at).not.toBeNull();
    // `prepare` was not run again; `implement` got a second attempt.
    expect(state.rows("SELECT attempt, status FROM steps WHERE step = 'prepare'")).toEqual([{ attempt: 1, status: 'done' }]);
    expect(state.rows("SELECT attempt, status FROM steps WHERE step = 'implement' ORDER BY attempt").map((row) => row.attempt)).toEqual([1, 2]);
    // The same worktree was reused.
    expect(existsSync(state.worktree)).toBe(true);
    expect(eventsOf(state.fx.reader, 'run-1', 'worktree_created')).toHaveLength(1);
  }, 90_000);
});
