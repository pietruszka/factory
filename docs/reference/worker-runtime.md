---
title: Worker runtime (FAC-19)
description: The WorkerRuntime interface, how the Cursor agent and OpenCode adapters start their CLI through Spawner, the OpenCode no --auto rule, the scripted fake worker, the registry, process rows and what is deferred.
---

# Worker runtime (FAC-19)

A worker runtime runs one step of a run: it starts a model CLI in the run's worktree and returns a result. It is a library in `src/worker-runtime/`: there is no `factory` command for it. The step runner (a later ticket) drives it.

## Interface

```ts
interface WorkerRuntime {
  readonly id: RuntimeId; // 'cursor-agent' | 'opencode' | 'fake-worker' | `test-${string}`
  capabilities(): { resume: boolean; readOnly: boolean; structuredOutput: boolean };
  detectVersion(): Promise<string>;
  start(request: StepRequest): RunningStep;
}

interface RunningStep {
  events: AsyncIterable<StepEvent>; // { type: 'started', pid, command } then { type: 'output', text }
  result: Promise<StepResult>;
  kill(): Promise<void>; // Spawner.killTree: SIGKILL, children first
}
```

`run(runtime, request)` is `runtime.start(request).result`.

`StepRequest` has `runId`, `stepId`, `attempt`, `role`, `model`, `prompt`, `cwd`, `readOnly`, `timeoutMs`, `env`, and optional `resumeSessionId` and `outputSchema`. Allowed paths and budget are not adapter inputs.

`StepResult` is the runtime result:

| Field | Meaning |
| --- | --- |
| `exitReason` | `ok`, `timeout`, `exit_nonzero`, `malformed` or `killed` |
| `rawText` | The final text the CLI produced |
| `parsed`, `parseError` | Set by runtimes that parse JSON (the fake worker); the real adapters leave them to the core |
| `sessionId`, `usage` | Present when the CLI reported them |
| `durationMs` | `Deps.now()` at exit minus `Deps.now()` at start |
| `processes` | `{ pid, command }` of each child the step started |

This is not the L2 parser type in `src/adapters/step-result.ts`. `toRuntimeStepResult(parsed, { durationMs, processes })` maps the parser result into it: its `status` becomes `exitReason`, its `text` becomes `rawText`. The parsers `parseCursorAgentStepResult` and `parseOpenCodeStepResult` are unchanged.

## Adapters start the CLI through Spawner

`createCursorAgentRuntime` and `createOpenCodeRuntime` take `{ spawner, processTable, deps, eventLog? }`. They never call `spawn` or `exec`. Tests inject `createFakeSpawner`, so `npm test` never starts `agent`, `cursor-agent`, `opencode` or `copilot`.

| | Cursor agent | OpenCode |
| --- | --- | --- |
| Command | `agent -p --trust --output-format json [--mode ask] --model <model> [--resume <id>] <prompt>` | `opencode run --format json [--agent plan] --model <model> [--session <id>] <prompt>` |
| `readOnly` | `--mode ask` | `--agent plan` |

The bracketed parts appear only for a read-only role or a resume session id.

### cwd and PWD

`cwd` of the child and `env.PWD` are both `request.cwd`, the run's worktree under the cache worktrees root (see [Worktrees](/reference/worktrees)). The OpenCode `cursor-acp/` bridge resolves relative tool paths against `PWD`, so `cwd` alone is not enough. `request.env` is added to the parent's environment for the child. The macOS spawner forwards `SpawnRequest.env` and captures stdout and stderr (`SpawnedProcess.output`) so the parsers can run.

Adapters get the worktree path. They do not create worktrees or choose between `linked` and `standalone`. Which mode OpenCode needs is still open (D-39).

### OpenCode never gets --auto

OpenCode 2.x `--auto` auto-approves permissions. No OpenCode start passes it, for a write or a read-only role, with or without a resume session id. Tests check the program arguments.

### Timeout and kill

The step is killed with `Spawner.killTree` when `timeoutMs` passes (`exitReason: 'timeout'`) or when `kill()` is called (`'killed'`). `killTree` is always SIGKILL; a child that ignores SIGTERM is still killed.

## Process rows

`Spawner.spawn` records each child in the `ProcessTable` with its pid and command. When `eventLog` is given, the adapter also writes a `processes` row (`appendProcess` with `run_id` and `step` from the request) and ends it when the child exits (`endProcess`). Grandchildren do not get rows; `killTree` finds them with `ps`.

## Registry

Pipeline code looks a runtime up in a map it is given:

```ts
const registry = new Map<RuntimeId, WorkerRuntime>(
  [createCursorAgentRuntime(options), createOpenCodeRuntime(options)].map((runtime) => [runtime.id, runtime]),
);
getWorkerRuntime(registry, 'opencode');
```

An id that is not in the map throws `unknown_worker_runtime` (exit 2). A new adapter is added by putting it in the map; the lookup and `run` do not change. A test registers a third adapter (`test/support/test-adapter.ts`) that way.

## Fake worker

`createFakeWorkerRuntime({ scenario, spawner, processTable, deps })` in `test/support/fake-worker.ts` has id `fake-worker`. It is not in any production registry. `loadScenario(path)` reads a JSON file from `test/fixtures/worker-scenarios/`. Its child is a small Node script (`test/support/fake-worker-child.mjs`) started through the `Spawner`, never a model CLI.

| Field | Behaviour |
| --- | --- |
| `edits` | Writes the files under the worktree |
| `final`, `final.malformedTimes` | Returns the JSON as text; the first N starts return text that is not JSON (`exitReason: 'malformed'`, `parseError` set) |
| `usage` | Reports usage; leave it out to report none |
| `sessionId` | Returns a session id |
| `exitCode` | Exits with it; non-zero gives `exit_nonzero` |
| `hang` | Runs until killed |
| `children` | Starts N grandchildren in the same process group |
| `ignoreSigterm` | Ignores SIGTERM. A test sends SIGTERM, sees the process alive, then calls `kill()` |
| `latchFile` | Waits until that file exists, then finishes |
| `readyFile` | Created once the child is set up, so a test knows when to act |

Edit, latch and ready paths must be relative and must not contain `..`; `loadScenario` throws otherwise. Hang, children, SIGTERM and latch tests use real children under a temp home. The child stops itself after two minutes if a test run is aborted.

`FACTORY_WORKER=fake:<file>` is not built; tests inject the fake runtime.

## Deferred

Not in this ticket: the run state machine, checkpoints, caps and the one bounded JSON retry, and the `cost_missing` normaliser (FAC-20); `factory kill` and stale-pid status (FAC-23); the Copilot CLI adapter; `FACTORY_WORKER` and `FACTORY_LIVE` selection; moving preflight, probe and version-check onto `Spawner`; settling the OpenCode worktree mode with a live run.
