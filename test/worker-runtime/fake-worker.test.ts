import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createMacosProcessTable } from '../../src/ports/process-table.js';
import { createMacosSpawner } from '../../src/ports/spawner.js';
import type { RunningStep, StepRequest, StepResult } from '../../src/worker-runtime/types.js';
import { createFakeWorkerRuntime, loadScenario } from '../support/fake-worker.js';
import { createFakeDeps } from '../support/fake-deps.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';
import { descendantsOf, isAlive, runtimeSandbox, stepRequest, waitFor } from '../support/worker-runtime.js';

const SCENARIOS = join(import.meta.dirname, '..', 'fixtures', 'worker-scenarios');

const running: Array<() => Promise<void>> = [];

afterEach(async () => {
  // Safety net: no scenario child may outlive its test.
  for (const kill of running.splice(0)) {
    await kill().catch(() => undefined);
  }
  cleanupTempHomes();
});

/** A fake worker for one scenario file, started through the real macOS Spawner in a temp worktree. */
function setup(scenarioName: string) {
  const sandbox = runtimeSandbox();
  mkdirSync(sandbox.worktree, { recursive: true });
  const deps = createFakeDeps({ start: 1000 });
  const processTable = createMacosProcessTable();
  const spawner = createMacosSpawner({ processTable, deps });
  const runtime = createFakeWorkerRuntime({
    scenario: loadScenario(join(SCENARIOS, `${scenarioName}.json`)),
    spawner,
    processTable,
    deps,
  });
  const start = (overrides: Partial<StepRequest> = {}): RunningStep => {
    const step = runtime.start(stepRequest(sandbox.worktree, overrides));
    running.push(() => step.kill());
    return step;
  };
  return { sandbox, runtime, processTable, start, file: (name: string) => join(sandbox.worktree, name) };
}

type Setup = ReturnType<typeof setup>;

/** Waits until the child announced it is set up, and returns its pid. */
async function started(s: Setup): Promise<number> {
  await waitFor(() => existsSync(s.file('ready.txt')));
  const pid = s.processTable.list()[0]?.pid;
  expect(pid).toBeGreaterThan(0);
  return pid as number;
}

async function expectFailure(): Promise<void> {
  const s = setup('fail');

  const result = await s.start().result;

  expect(result.exitReason).toBe('exit_nonzero');
}

async function expectHang(): Promise<void> {
  const s = setup('hang');
  const step = s.start();
  const pid = await started(s);

  expect(isAlive(pid)).toBe(true);
  await step.kill();

  await waitFor(() => !isAlive(pid));
  expect((await step.result).exitReason).toBe('killed');
}

async function expectChildren(): Promise<void> {
  const s = setup('children');
  const step = s.start();
  const pid = await started(s);
  const grandchildren = await descendantsOf(pid);

  expect(grandchildren).toHaveLength(2);
  await step.kill();

  await waitFor(() => [pid, ...grandchildren].every((each) => !isAlive(each)));
}

async function expectIgnoresSigterm(): Promise<void> {
  const s = setup('ignore-sigterm');
  const step = s.start();
  const pid = await started(s);

  process.kill(pid, 'SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(isAlive(pid)).toBe(true);
  expect(s.processTable.list()[0]?.pid).toBe(pid);
  await step.kill();

  await waitFor(() => !isAlive(pid));
  expect((await step.result).exitReason).toBe('killed');
}

async function expectSessionId(): Promise<void> {
  const s = setup('session-id');

  const result = await s.start().result;

  expect(result.sessionId).toBe('session-example-1');
}

async function expectLatch(): Promise<void> {
  const s = setup('latch');
  const step = s.start();
  const pid = await started(s);

  expect(isAlive(pid)).toBe(true);
  writeFileSync(s.file('latch.txt'), 'go\n');

  const result: StepResult = await step.result;
  expect(result.exitReason).toBe('ok');
  expect(isAlive(pid)).toBe(false);
}

describe('a fake worker scenario file can script each listed behaviour', () => {
  test('a scenario applies real file edits in the worktree', async () => {
    const s = setup('edits');

    await s.start().result;

    expect(readFileSync(s.file('src/example.txt'), 'utf8')).toBe('edited by the fake worker\n');
    expect(readFileSync(s.file('docs/notes.md'), 'utf8')).toBe('# Notes\n');
  });

  test('a scenario returns final JSON, or malformed JSON N times', async () => {
    const final = setup('final-json');
    const finalResult = await final.start().result;
    expect(finalResult.exitReason).toBe('ok');
    expect(finalResult.parsed).toEqual({ summary: 'done' });
    expect(finalResult.parseError).toBeUndefined();
    expect(JSON.parse(finalResult.rawText)).toEqual({ summary: 'done' });

    const flaky = setup('malformed-twice');
    const attempts: StepResult[] = [];
    for (const attempt of [1, 2, 3]) {
      attempts.push(await flaky.start({ attempt }).result);
    }
    expect(attempts.map((attempt) => attempt.parsed)).toEqual([undefined, undefined, { summary: 'done' }]);
    expect(attempts.map((attempt) => attempt.parseError !== undefined)).toEqual([true, true, false]);
  });

  test('a scenario emits usage with the expected fields, and another omits them', async () => {
    const full = await setup('usage-full').start().result;
    const missing = await setup('usage-missing').start().result;

    expect(full.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(missing.usage).toBeUndefined();
  });

  test('a scenario can fail, hang, spawn children, ignore SIGTERM, return a session id, and block on a latch file', async () => {
    await expectFailure();
    await expectHang();
    await expectChildren();
    await expectIgnoresSigterm();
    await expectSessionId();
    await expectLatch();
  }, 20_000);

  test('a scenario edit path that is absolute or contains .. is rejected', () => {
    const dir = makeTempHome();
    const write = (name: string, path: string): string => {
      const file = join(dir, name);
      writeFileSync(file, JSON.stringify({ edits: [{ path, content: 'x' }] }));
      return file;
    };

    expect(() => loadScenario(write('absolute.json', '/tmp/escape.txt'))).toThrow(/inside the worktree/);
    expect(() => loadScenario(write('parent.json', '../escape.txt'))).toThrow(/inside the worktree/);
    expect(() => loadScenario(write('nested.json', 'src/../../escape.txt'))).toThrow(/inside the worktree/);
    expect(loadScenario(write('fine.json', 'src/ok.txt')).edits).toEqual([{ path: 'src/ok.txt', content: 'x' }]);
  });
});
