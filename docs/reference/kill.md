---
title: factory kill
description: What factory kill does - the polite stop, the escalation, recycled pids, the kept worktree, and what resume means for a killed run.
---

# factory kill

`factory kill <ticket>` stops the run of a ticket in the current checkout. The code is `killRun` in `src/kill/kill-run.ts` and the command in `src/cli/kill.ts`. The command is a thin wrapper: it finds the run and calls `killRun`. See [The factory command](/reference/cli#factory-kill-ticket) for the arguments, output and error codes.

## What `killRun` does

1. Reads the run's `processes` rows that have no `ended_at`.
2. Calls `Spawner.termTree(pid, command)` on each. This sends `SIGTERM`, children first, and only when [`ProcessTable.stillMatches`](/reference/ports) says the pid still runs the recorded command.
3. Waits up to the grace for those trees to exit. The grace is 10 seconds by default (the FR-31 estimate, not a minimum). It looks again every 50 ms with `Deps.sleep`, so a tree that is already gone ends the wait at once and is not killed again.
4. Calls `Spawner.killTree(pid, command)` (`SIGKILL`) on every tree that still runs after the grace.
5. Moves the run to `killed` with `transition`, appends a `killed` event whose payload lists each pid with the `termTree` and `killTree` results, and sets `ended_at` on the process rows.

`killRun` takes an optional `graceMs`, so tests use a short wait on a fake clock instead of 10 seconds. It never calls `process.kill`; the spawner does.

## Recycled pids

When the recorded pid now runs another command, `termTree` and `killTree` return `pid_reused` and send no signal. The run still moves to `killed` and its process rows are ended.

## The worktree is kept

Nothing removes the worktree. After a kill, `runs.status` is `killed`, the worktree folder still exists, and `transition` accepts the move from `killed` back to the phase the run left (see [Run state](/reference/run-state)). [`factory resume`](/reference/resume) uses this: it stops any process rows that are still open (the same `termTree` then `killTree` walk, without forcing `killed`), then moves the run back to that phase.

## Second kill

`killRun` on a run that is already `killed` signals only what is still alive. With no live matching process it changes nothing and writes no second `killed` event, so `factory kill FE-123` can be repeated safely.

## Not covered

A run that is stopped for another reason (for example `needs_human`) or final is refused with `illegal_transition` before anything is signalled. Stale runs are still only marked `interrupted` by `markStaleRuns`, without signals. A step that times out is still stopped by its own timeout, not through `factory kill`.
