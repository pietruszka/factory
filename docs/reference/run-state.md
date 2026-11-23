---
title: Run state (FAC-20)
description: The run state machine and step runner - statuses, legal transitions, passed and canPassFromReport, checkpoints, retry and loop limits, stale runs, one active run, and what is deferred.
---

# Run state (FAC-20)

A run is always in exactly one status. This page covers the code that moves it between statuses and runs worker steps with checkpoints. The code is `src/run-state/`. It is a library: there is no `factory run` command yet. [`factory status`](/reference/status) only reads runs and shows a run whose process is gone as stale without changing its status. [`factory kill`](/reference/kill) moves a run to `killed` through `transition`, and [`factory resume`](/reference/resume) continues a stopped run from its checkpoints.

`transition` is the only production writer of `runs.status`. It calls the storage helper `updateRunStatus` from the [event log](/reference/event-log) after it has checked that the move is legal. The storage helper itself still accepts any known status; tests may use it to arrange a state, production code must not.

## Statuses

- **Phases**, in happy-path order: `preflight`, `routing`, `planning`, `awaiting_approval`, `building`, `gating`, `verifying`, `reviewing`, `opening_pr`.
- **Done**: `passed`.
- **Stop statuses**: `refused`, `config_drift`, `needs_human`, `cannot_reproduce`, `budget`, `timeout`, `cost_missing`, `breach`, `killed`, `interrupted`.

A run ends when it is `passed` or in a stop status. It is never left in a phase when a driver returns.

## Legal transitions

`transition(context, runId, to)`:

| From | To |
| --- | --- |
| A phase | The next phase in the order above, or any stop status. |
| `opening_pr` | `passed`, but only when `canPassFromReport` is true (below). |
| A stop status other than `refused` and `breach` | The phase the run left (library continue). |
| `passed`, `refused`, `breach` | Nothing. These are not resumable. |

- Moving to the status the run already has is a no-op: no write and no history entry.
- An illegal move is a `FactoryError` with code `illegal_transition`, exit 2, and a next action that lists the legal targets. The stored status is unchanged.
- Each real move writes one `events` row of type `run_status` with the old and new status. Continue reads the phase that was left from the latest such row. When the status was set without `transition`, the phase is unknown and any phase is accepted.
- `ended_at` is set when the run moves to `passed` or to a stop status.

### `passed` and the report

`passed` is allowed only from `opening_pr`, and only when `canPassFromReport(runFolder)` is true: the `report.md` in the run folder names a flow with a defined required list, lists every required artifact as present, and each of them is still a file on disk (see [Run folder](/reference/run-folder)). Otherwise `transition` throws `passed_refused` (exit 2, with a next action) and the status stays `opening_pr`.

## Steps and checkpoints

`runSteps({ ...context, runtime, runId, phase, cwd, steps })` moves the run into `phase`, then starts each step through `WorkerRuntime.start`.

- Before a step starts, a `steps` row is written as `running` with its `input_hash` (SHA-256 of role, model, prompt, read-only flag and output schema).
- When it finishes, the same row is written with `done` or `failed`, its `exit_reason`, its `cli_session_id` when the worker reported one, and `ended_at`. This happens before the next step starts. No column was added.
- A step that already has a `done` row is skipped on a later call (continue), so the worker is not started again and no second `processes` row is added for it. The skip does not compare input hashes. A step that did not finish gets a new attempt number.
- The result is `{ status, ran, skipped }`.

A step that does not finish moves the run to a stop status: `exitReason` `timeout` gives `timeout`, `budget` gives `budget`, `killed` gives `killed`, anything else gives `needs_human`. A worker that never succeeds is therefore started once, not in a loop. A worker that hangs is stopped by the step's `timeoutMs` (default 60 seconds, from `Deps` timers), and the run becomes `timeout`.

`runSteps` also takes an optional `writeScope` argument. With it, each attempt is snapshotted before and checked after the worker, and a step that writes outside its role's scope ends as `breach`; see [Write scope](/reference/write-scope).

## Retry and loop limits

- **Malformed structured output.** The step is retried exactly once, in the same call, with the parse error added to the prompt and `resumeSessionId` set when the first attempt reported a session. A retry that returns valid output finishes the step and the run stays in its phase. A second malformed result ends the step as `failed` with `exit_reason` `schema_invalid` and the run as `needs_human`.
- **Fix, verify-fail and revision loops.** `enterLoop(context, runId, kind)` allows two loops per kind and records each as an `events` row of type `loop`. The third call returns `{ allowed: false, count: 3 }` and moves the run to `needs_human`.

With the optional `cost` argument, `runSteps` also records usage, enforces the dollar and wall-clock caps and ends a step as `cost_missing` when usage is missing. See [Caps and cost](/reference/caps).

## Stale runs

`markStaleRuns({ ...context, processTable })` looks at the `processes` rows that have no `ended_at`, for runs in a phase. A row is dead when `ProcessTable.stillMatches(pid, command)` is false: the pid is gone, or it now runs another command. Dead rows are ended. A run with no live row left is moved to `interrupted` (resumable, worktree kept). No pid is signalled. A run with a live row is left as it is, and a run that is already `interrupted` is not touched again. The function returns the ids it moved.

## One active run

`startRun(context, runInput)` inserts the run in `preflight` through the `runs_one_active` index. While another run of the same repo and ticket is not `passed`, `refused` or `breach`, the insert is refused as `run_already_active` (exit 2); its next action names `factory status` and `factory resume <ticket>`. No second run row is written.

## Continue and resume

`runSteps` skips a step whose latest attempt is `done`; a step whose latest attempt is not done gets a new attempt. `rerun` lists step ids that are started again even though they are done, and `StepSpec.resumeSessionId` passes the CLI session an earlier attempt stored to the first new attempt of a step. `phaseToResume` returns the phase a stopped run left. [`factory resume`](/reference/resume) uses all three.

## Stub pipeline

`runStubPlan` and `runStubBuild` in `src/run-state/stub-pipeline.ts` exist for tests. They drive one run with a fake worker: `preflight` to `routing` to `planning` with a stub plan step, then `awaiting_approval`. After an approval was recorded by the test (`runStubBuild` refuses with `approval_missing` without one), one stub build step runs, the later phases are entered without work, a stub diff and the report are written, and the run becomes `passed` when `canPassFromReport` allows it, or `needs_human` when it does not. A build step that fails or times out ends the run in the matching stop status.

## Deferred

- The `factory` commands `run`, `plan`, `approve` and `outcome` (`kill` is in [factory kill](/reference/kill), `resume` in [factory resume](/reference/resume), `status` in [factory status](/reference/status)); intake, routing, real gates, verifiers, reviewer and opening a draft pull request.
- `factory status` (FAC-25).
