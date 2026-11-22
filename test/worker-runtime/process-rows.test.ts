import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createCursorAgentRuntime } from '../../src/adapters/cursor-agent.js';
import { createOpenCodeRuntime } from '../../src/adapters/opencode.js';
import { openEventLog } from '../../src/event-log/open.js';
import { createFakeProcessTable } from '../../src/ports/process-table.js';
import type { AdapterRuntimeOptions, WorkerRuntime } from '../../src/worker-runtime/types.js';
import { createFakeDeps } from '../support/fake-deps.js';
import { createFakeWorkerRuntime, loadScenario } from '../support/fake-worker.js';
import { cleanupEventLogTest, eventLogSandbox, openRaw, runInput, track } from '../support/event-log.js';
import { createRecordingSpawner, stepRequest } from '../support/worker-runtime.js';

afterEach(cleanupEventLogTest);

const SCENARIOS = join(import.meta.dirname, '..', 'fixtures', 'worker-scenarios');

const CASES: Array<[string, (options: AdapterRuntimeOptions) => WorkerRuntime, RegExp]> = [
  ['the Cursor agent runtime', createCursorAgentRuntime, /^(agent|cursor-agent) /],
  ['the OpenCode runtime', createOpenCodeRuntime, /^opencode /],
];

describe.each(CASES)('every spawned process is recorded with pid and command: %s', (_name, create, commandPattern) => {
  const setup = () => {
    const sandbox = eventLogSandbox();
    const deps = createFakeDeps({ start: 1_700_000_000_000 });
    const processTable = createFakeProcessTable();
    const spawner = createRecordingSpawner(processTable, deps);
    const log = track(openEventLog({ env: sandbox.env, deps }));
    log.insertRun(runInput({ run_id: 'run-1' }));
    return { sandbox, deps, processTable, spawner, log };
  };

  test('after a start, ProcessTable has a row with that pid and command', async () => {
    const { sandbox, deps, processTable, spawner } = setup();
    const runtime = create({ spawner, processTable, deps });

    const result = await runtime.start(stepRequest(sandbox.tmp)).result;

    expect(result.processes).toHaveLength(1);
    expect(result.processes[0]?.pid).toBe(1000);
    expect(result.processes[0]?.command).toMatch(commandPattern);
    expect(processTable.list()).toEqual([
      { pid: 1000, command: result.processes[0]?.command, startedAt: 1_700_000_000_000 },
    ]);
  });

  test('when an event log and run id are provided, a processes row is appended with the same pid and command', async () => {
    const { sandbox, deps, processTable, spawner, log } = setup();
    const runtime = create({ spawner, processTable, deps, eventLog: log });

    const result = await runtime.start(stepRequest(sandbox.tmp, { runId: 'run-1', stepId: 'implement' })).result;

    const rows = openRaw(sandbox.dbPath, { readOnly: true })
      .prepare('SELECT run_id, step, pid, command FROM processes')
      .all();
    expect(rows).toEqual([
      { run_id: 'run-1', step: 'implement', pid: 1000, command: processTable.list()[0]?.command },
    ]);
    expect(rows[0]?.command).toBe(result.processes[0]?.command);
    expect(String(rows[0]?.command)).toMatch(commandPattern);
  });
});

describe('every spawned process is recorded with pid and command: the fake worker runtime', () => {
  test('when an event log and run id are provided, a processes row is appended with the same pid and command', async () => {
    const sandbox = eventLogSandbox();
    const deps = createFakeDeps({ start: 1_700_000_000_000 });
    const processTable = createFakeProcessTable();
    const spawner = createRecordingSpawner(processTable, deps);
    const log = track(openEventLog({ env: sandbox.env, deps }));
    log.insertRun(runInput({ run_id: 'run-1' }));
    const runtime = createFakeWorkerRuntime({
      scenario: loadScenario(join(SCENARIOS, 'session-id.json')),
      spawner,
      processTable,
      deps,
      eventLog: log,
    });

    const result = await runtime.start(stepRequest(sandbox.tmp, { runId: 'run-1', stepId: 'implement' })).result;

    const rows = openRaw(sandbox.dbPath, { readOnly: true })
      .prepare('SELECT run_id, step, pid, command FROM processes')
      .all();
    expect(processTable.list()).toHaveLength(1);
    expect(rows).toEqual([
      { run_id: 'run-1', step: 'implement', pid: 1000, command: processTable.list()[0]?.command },
    ]);
    expect(rows[0]?.command).toBe(result.processes[0]?.command);
  });
});
