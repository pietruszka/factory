import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { createCursorAgentRuntime, parseCursorAgentStepResult } from '../../src/adapters/cursor-agent.js';
import { createOpenCodeRuntime, parseOpenCodeStepResult } from '../../src/adapters/opencode.js';
import { createFakeProcessTable } from '../../src/ports/process-table.js';
import { createFakeSpawner, type Spawner } from '../../src/ports/spawner.js';
import { toRuntimeStepResult } from '../../src/worker-runtime/map-result.js';
import type { AdapterRuntimeOptions, WorkerRuntime } from '../../src/worker-runtime/types.js';
import { createFakeDeps } from '../support/fake-deps.js';
import { findModelSpawnOffenders } from '../support/model-spawn-scan.js';
import { cleanupTempHomes } from '../support/temp-home.js';
import { toRawStepInput } from '../support/raw-step-input.js';
import { runtimeSandbox, stepRequest, withExitAfter } from '../support/worker-runtime.js';

afterEach(cleanupTempHomes);

const repoRoot = join(import.meta.dirname, '..', '..');

interface RuntimeCase {
  name: 'cursor-agent' | 'opencode';
  create: (options: AdapterRuntimeOptions) => WorkerRuntime;
  /** Program names the CLI may be started as. */
  commands: RegExp;
  adapterSource: string;
}

const RUNTIMES = [
  {
    name: 'cursor-agent',
    create: createCursorAgentRuntime,
    commands: /^(agent|cursor-agent)$/,
    adapterSource: 'src/adapters/cursor-agent.ts',
  },
  { name: 'opencode', create: createOpenCodeRuntime, commands: /^opencode$/, adapterSource: 'src/adapters/opencode.ts' },
] as const satisfies readonly RuntimeCase[];

function setup() {
  const sandbox = runtimeSandbox();
  const spawner = createFakeSpawner();
  const processTable = createFakeProcessTable();
  const deps = createFakeDeps({ start: 1000 });
  return { sandbox, spawner, processTable, deps, options: { spawner, processTable, deps } };
}

function readCase(cli: string, name: string): ReturnType<typeof toRawStepInput> {
  const path = join(repoRoot, 'test', 'fixtures', 'cli', cli, 'cases', `${name}.json`);
  return toRawStepInput((JSON.parse(readFileSync(path, 'utf8')) as { raw: Record<string, unknown> }).raw);
}

describe('the Cursor agent and OpenCode runtimes', () => {
  test('the Cursor agent and OpenCode runtimes implement WorkerRuntime and start the child only through an injected Spawner', async () => {
    for (const runtimeCase of RUNTIMES) {
      const { sandbox, spawner, options } = setup();
      const runtime = runtimeCase.create(options);

      const result = await runtime.start(stepRequest(sandbox.worktree)).result;

      expect(runtime.id).toBe(runtimeCase.name);
      expect(typeof runtime.capabilities).toBe('function');
      expect(typeof runtime.detectVersion).toBe('function');
      expect(spawner.requests).toHaveLength(1);
      expect(spawner.requests[0]?.command).toMatch(runtimeCase.commands);
      expect(result.processes).toHaveLength(1);
      const source = readFileSync(join(repoRoot, runtimeCase.adapterSource), 'utf8');
      expect(source).not.toMatch(/node:child_process/);
    }
  });

  test('cwd and PWD are set to the run\'s worktree path under the cache worktrees root', async () => {
    for (const runtimeCase of RUNTIMES) {
      const { sandbox, spawner, options } = setup();
      const runtime = runtimeCase.create(options);

      await runtime.start(stepRequest(sandbox.worktree)).result;

      expect(sandbox.worktree).toBe(
        join(sandbox.tmp, 'factory-home', 'cache', 'worktrees', 'example-frontend', 'FE-123'),
      );
      expect(spawner.requests[0]?.cwd).toBe(sandbox.worktree);
      expect(spawner.requests[0]?.env?.PWD).toBe(sandbox.worktree);
      expect(spawner.requests[0]?.env?.EXAMPLE_FLAG).toBe('1');
    }
  });

  test('the existing parsers still map a fixture into a step result, and the runtime result exposes exit reason, text, usage, session id and duration', async () => {
    const cursorParsed = parseCursorAgentStepResult(readCase('cursor-agent', 'success'));
    const openCodeParsed = parseOpenCodeStepResult(readCase('opencode', 'success'));
    const processes = [{ pid: 4321, command: 'example-cli --print' }];

    expect(cursorParsed.text).toBe('PROBE_OK');
    expect(openCodeParsed.text).toBe('PROBE_OK');
    expect(toRuntimeStepResult(cursorParsed, { durationMs: 250, processes })).toEqual({
      exitReason: 'ok',
      rawText: 'PROBE_OK',
      usage: { inputTokens: 13709, outputTokens: 7 },
      sessionId: '2e6ed06f-69f9-4a5e-a3ec-64fd96b09ae7',
      durationMs: 250,
      processes,
    });
    expect(toRuntimeStepResult(openCodeParsed, { durationMs: 90, processes })).toEqual({
      exitReason: 'ok',
      rawText: 'PROBE_OK',
      usage: { input: 7, output: 3, reasoning: 0, cache: { read: 0, write: 0 } },
      costUsd: 0,
      sessionId: 'ses_123',
      durationMs: 90,
      processes,
    });
  });

  test.each([
    ['cursor-agent', 'timeout', 'timeout'],
    ['cursor-agent', 'exit-nonzero', 'exit_nonzero'],
    ['cursor-agent', 'malformed-json', 'malformed'],
    ['opencode', 'timeout', 'timeout'],
    ['opencode', 'exit-nonzero', 'exit_nonzero'],
    ['opencode', 'malformed-json', 'malformed'],
  ] as const)('the %s %s fixture maps to exit reason %s', (cli, fixture, exitReason) => {
    const raw = readCase(cli, fixture);
    const parsed = cli === 'opencode' ? parseOpenCodeStepResult(raw) : parseCursorAgentStepResult(raw);

    expect(toRuntimeStepResult(parsed, { durationMs: 1, processes: [] }).exitReason).toBe(exitReason);
  });

  test('the runtime result duration is the Deps clock between start and exit', async () => {
    for (const runtimeCase of RUNTIMES) {
      const { sandbox, deps, processTable } = setup();
      const spawner = withExitAfter(createFakeSpawner(), (ms) => deps.advance(ms), 250);
      const runtime = runtimeCase.create({ spawner, processTable, deps });

      const result = await runtime.start(stepRequest(sandbox.worktree)).result;

      expect(result.durationMs).toBe(250);
    }
  });

  test('default tests do not start agent, cursor-agent, opencode or copilot', async () => {
    for (const runtimeCase of RUNTIMES) {
      const { sandbox, spawner, options } = setup();
      await runtimeCase.create(options).start(stepRequest(sandbox.worktree)).result;

      // The fake Spawner starts nothing: it only records the request.
      expect(spawner.requests).toHaveLength(1);
    }

    const dirs = ['test/worker-runtime', 'test/support'].map((dir) => join(repoRoot, dir));
    const sources = Object.fromEntries(
      dirs.flatMap((dir) =>
        readdirSync(dir).map((name) => [`${dir}/${name}`, readFileSync(join(dir, name), 'utf8')] as const),
      ),
    );
    const allowed = [`${join(repoRoot, 'test/support')}/fake-cli.ts`];
    expect(Object.keys(sources).length).toBeGreaterThan(0);
    expect(findModelSpawnOffenders(sources, allowed)).toEqual([]);
    expect(Object.values(sources).some((source) => /['"`]copilot['"`]/.test(source) && /spawn/.test(source))).toBe(
      false,
    );
  });

  test('the runtime result carries what the child wrote, mapped by the existing parser', async () => {
    const cases = [
      { runtimeCase: RUNTIMES[0], cli: 'cursor-agent', sessionId: '2e6ed06f-69f9-4a5e-a3ec-64fd96b09ae7' },
      { runtimeCase: RUNTIMES[1], cli: 'opencode', sessionId: 'ses_123' },
    ] as const;
    for (const { runtimeCase, cli, sessionId } of cases) {
      const { sandbox, processTable, deps } = setup();
      const spawner = createFakeSpawner({ reply: () => ({ stdout: readCase(cli, 'success').stdout }) });
      const runtime = runtimeCase.create({ spawner, processTable, deps });

      const result = await runtime.start(stepRequest(sandbox.worktree)).result;

      expect(result.exitReason).toBe('ok');
      expect(result.rawText).toBe('PROBE_OK');
      expect(result.sessionId).toBe(sessionId);
    }
  });

  test('a child that exits non-zero gives exit reason exit_nonzero', async () => {
    const { sandbox, processTable, deps } = setup();
    const spawner = createFakeSpawner({ reply: () => ({ code: 1, stderr: 'boom' }) });
    const runtime = createCursorAgentRuntime({ spawner, processTable, deps });

    const result = await runtime.start(stepRequest(sandbox.worktree)).result;

    expect(result.exitReason).toBe('exit_nonzero');
  });

  test('kill calls Spawner.killTree with the child pid and command, and the result has exit reason killed', async () => {
    const { sandbox, spawner, options } = setup();
    const step = createOpenCodeRuntime(options).start(stepRequest(sandbox.worktree));

    await step.kill();
    const result = await step.result;

    expect(spawner.kills).toEqual([{ pid: 1000, command: result.processes[0]?.command }]);
    expect(result.processes[0]?.command).toMatch(/^opencode run /);
    expect(result.exitReason).toBe('killed');
  });

  test('a child that outlives timeoutMs is killed and the result has exit reason timeout', async () => {
    const { sandbox, processTable, deps } = setup();
    let finish: (value: { code: number | null; signal: string | null }) => void = () => undefined;
    const spawner: Spawner = {
      spawn: async () => ({ pid: 2000, exit: new Promise((resolve) => (finish = resolve)) }),
      killTree: async () => {
        finish({ code: null, signal: 'SIGKILL' });
        return 'killed';
      },
      termTree: async () => 'killed',
    };
    const step = createCursorAgentRuntime({ spawner, processTable, deps }).start(
      stepRequest(sandbox.worktree, { timeoutMs: 5000 }),
    );

    await new Promise((resolve) => setImmediate(resolve));
    deps.advance(5000);
    const result = await step.result;

    expect(result.exitReason).toBe('timeout');
    expect(result.durationMs).toBe(5000);
  });

  test('events report the started child and then its output', async () => {
    const { sandbox, processTable, deps } = setup();
    const spawner = createFakeSpawner({ reply: () => ({ stdout: readCase('cursor-agent', 'success').stdout }) });
    const step = createCursorAgentRuntime({ spawner, processTable, deps }).start(stepRequest(sandbox.worktree));

    const events = [];
    for await (const event of step.events) events.push(event);

    expect(events).toEqual([
      { type: 'started', pid: 1000, command: expect.stringMatching(/^agent -p /) as unknown },
      { type: 'output', text: 'PROBE_OK' },
    ]);
  });
});
