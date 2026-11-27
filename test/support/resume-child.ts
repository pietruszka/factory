// The child process of the crash test. It calls `resumeRun`, the library entry that `factory resume` uses,
// with a scripted fake worker, under the HOME and FACTORY_HOME the test gives it. It starts no model CLI.
// Started by test/resume/crash.test.ts through `node --import tsx`. Prints the outcome as one JSON line.
import { openEventLog, openEventLogReadOnly } from '../../src/event-log/open.js';
import { createPosixProcessTable } from '../../src/ports/process-table.js';
import { createPosixSpawner } from '../../src/ports/spawner.js';
import { resumeRun } from '../../src/resume/resume-run.js';
import { createFakeDeps } from './fake-deps.js';
import { createFakeWorkerRuntime, loadScenario } from './fake-worker.js';
import { RESUME_COST, RESUME_STAGES } from './resume-stages.js';

const { scenarioPath } = JSON.parse(process.argv[2] ?? '{}') as { scenarioPath: string };

// Fixed clock at the time the test run was created, but real sleeping, because a stop waits on `deps.sleep`.
const deps = {
  ...createFakeDeps({ start: Date.parse('2026-01-01T10:00:00.000Z') }),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};
const env = process.env;
const processTable = createPosixProcessTable();
const spawner = createPosixSpawner({ processTable, deps });
const log = openEventLog({ env, deps });
const reader = openEventLogReadOnly({ env });
const runtime = createFakeWorkerRuntime({ scenario: loadScenario(scenarioPath), spawner, processTable, deps, eventLog: log });

try {
  const outcome = await resumeRun({
    env,
    deps,
    log,
    reader,
    runtime,
    spawner,
    processTable,
    repo: 'example-frontend',
    ticket: 'FE-123',
    stages: RESUME_STAGES,
    cost: RESUME_COST,
  });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
} finally {
  log.close();
  reader.close();
}
