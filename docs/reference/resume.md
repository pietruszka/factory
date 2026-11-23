---
title: factory resume
description: What factory resume does - the checkpoint rules, --from, --cap, the stored CLI session, the new base commit, crash recovery, the plan progress section, and the timeout gap.
---

# factory resume

`factory resume <ticket>` continues a stopped run of a ticket in its existing worktree. The code is `resumeRun` in `src/resume/resume-run.ts` and the command in `src/cli/resume.ts`. The command is a thin wrapper: it finds the repo and the run and calls `resumeRun`. See [The factory command](/reference/cli#factory-resume-ticket) for the arguments, output and error codes.

```sh
cd path/to/example-frontend
factory resume FE-123
factory resume FE-123 --from verify
factory resume FE-123 --cap "+$2"
```

## Which run

The repo comes from the current folder, the same way as [`factory kill`](/reference/kill). The run is the one run of that repo and ticket that is not `passed`, `refused` or `breach`. That includes `killed`, `interrupted`, `budget`, `timeout`, `needs_human`, `cost_missing`, and a run still left in a phase after a crash. A `passed`, `refused` or `breach` run is refused as `run_not_resumable` (exit 2). No run at all is `run_not_found`.

## What it does

All checks come first. Nothing is stopped, written or started when one of them refuses.

1. **Leftover processes.** Process rows of the run that are still open get `Spawner.termTree`, then `Spawner.killTree` for any tree that still runs after the grace (the same walk as `factory kill`, which keeps the pid check). Their rows are ended. This is how a crashed orchestrator's worker is stopped; you do not need to run `factory kill` first. `killTree` stays SIGKILL, and resume code never calls `process.kill`.
2. **Back to the phase the run left.** A stopped run goes back, through `transition`, to the phase it left, never to a later one. A run that was left in a phase stays in it. A later phase is entered only by finishing the steps before it.
3. **New base.** `runs.base_commit` is set to the current `HEAD` of the existing worktree (the D-39 path under the cache root). Commits you made in the worktree become the new base, and the next step starts with that commit as `HEAD`. No second worktree is created, and a missing worktree is refused as `worktree_missing`. The worktree is never removed.
4. **Steps.** A step whose latest attempt is `done` is not started again. Any other step gets a new attempt. Cost of the new attempts is summed with the earlier ones when the caps are checked.
5. **Finish.** After the last step the run walks through the remaining phases. The stub pipeline then writes its evidence and report and the run becomes `passed`, or `needs_human` when required artifacts are missing. A step that does not finish stops the run again, with the same stop status as in [Run state](/reference/run-state).

A `resumed` event is appended with the status the run had, the step given to `--from`, the new base commit, the cap and the processes that were stopped.

Until `factory run` exists, the pipeline `resume` continues is the stub pipeline: one build step. The library takes any list of phases and steps.

## `--from <step>`

`--from` runs the named step and every later step again, in the same worktree. Earlier `done` checkpoints are kept. Each repeated step is a new attempt, so the old attempt stays in the `steps` table. The value is a step id, a phase name (every step of that phase and later ones), or a short name: `plan`, `build`, `gate`, `verify` or `review`. Until `factory run` exists the command's pipeline is the stub: the `implement` step in `building`, then `gating`, `verifying`, `reviewing` and `opening_pr`, which are only entered because they have no work yet. So `--from verify` is accepted on the real command, and restarts from the `verifying` phase. An unknown value is refused as `step_unknown` and names the valid steps and phases.

A run only goes forward: `--from` for a step in a phase the run already left is refused as `from_behind`. No backward move was added to `transition`, so to repeat an earlier phase, start from a run that stopped in or before it.

## `--cap +$N`

`--cap` is a plus sign and a dollar amount above zero, for example `+$2` or `+$0.50`. Quote it, because `$` is special in a shell. Any other form (`2`, `$2`, `-$2`, `+$x`) is refused as `cap_invalid`.

The amount is added to `runs.cap_usd_effective`, or becomes the cap when the run had none. Nothing raises the cap on its own. When the summed cost is already at or over the cap and `--cap` is missing (or too small), resume refuses as `cap_reached`, names the amount spent, and does not change the cap. See [Caps and cost](/reference/caps).

### The timeout gap

`--cap` adds dollars only. The wall-clock cap is still measured from the original `runs.started_at` against the flow's minutes, and neither a minutes flag nor a reset of `started_at` exists. A `timeout` run can be resumed, but while the elapsed time is still over the cap it stops as `timeout` again before the first step finishes. The next action text of a timeout stop names `--cap +$2`, which does not help in that case. Closing this gap needs a decision on a wall-clock extension (see the Pages for FR-26).

## CLI session reuse

When an earlier attempt of a step stored a `cli_session_id`, the new attempt starts with `resumeSessionId` set to the latest stored id of that step. When the step has none of its own, it falls back to the latest `cli_session_id` stored for the same role. It is passed if the runtime reports `resume` in its capabilities. The Cursor and OpenCode adapters turn that into their resume flag. Nothing checks whether the CLI still has that session: that is a live check and is not part of this ticket.

## Crash recovery

After the factory process is killed with `kill -9` while a worker runs, the run is still in its phase, the worker may still be alive, and its process row is still open. `markStaleRuns` only marks such a run `interrupted` and signals nothing, so `factory resume` does the cleanup itself (step 1), then redoes at most the step that was in progress; finished steps are not repeated. The crash test starts `resumeRun` as a child process under a temp home with a fake worker blocked on a latch, kills that child only, and resumes.

One known hole stays: `termTree` sends SIGTERM to the parent first, and a parent that exits on it can make children that ignore SIGTERM look `gone`. Resume uses the same walk, so such children can survive. It is not fixed here.

## Plan progress

Resume writes a progress section into the run folder's `plan.md` (current step, done steps, last result). It is outside the approval hash. See [Run folder](/reference/run-folder#plan-progress).

## Errors

| Code | Exit | When |
| --- | --- | --- |
| `ticket_invalid` | 2 | The ticket is not a slug |
| `checkout_invalid` | 2 | The folder is not inside a git checkout |
| `repo_config_missing` | 2 | No repo config matches the checkout |
| `run_not_found` | 2 | No running or stopped run for that repo and ticket |
| `run_not_resumable` | 2 | The run is `passed`, `refused` or `breach` |
| `step_unknown` | 2 | `--from` names an unknown step |
| `from_behind` | 2 | `--from` names a step in a phase the run already left |
| `cap_invalid` | 2 | `--cap` is not a plus sign and a dollar amount |
| `cap_reached` | 2 | The spend already reaches the dollar cap |
| `worktree_missing` | 2 | The run's worktree is gone |
| `approval_missing` | 2 | The run has not reached building and has no approval |

## Not covered

`factory run`, `plan`, `approve`, `status` and `outcome`; the inspector; resuming a live Cursor, OpenCode or Copilot session (P-22); a wall-clock extension; the SIGTERM hole above; stopping stale runs inside `markStaleRuns`.
