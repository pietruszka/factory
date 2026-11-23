---
title: factory clean and retention (FAC-27)
description: What factory clean removes and keeps - worktrees 7 days after a merge or an abandon, ticket.json, prompts and evidence 30 days after a run ended - where the ages come from, and the disk use per area with its 10 GiB soft warning.
---

# factory clean and retention (FAC-27)

`factory clean [--json]` applies the retention policy to every run in the [event log](/reference/event-log) and prints what it removed and the disk use per area. The policy is a library (`applyRetention` in `src/retention/clean.ts`); the command is a thin wrapper in `src/cli/clean.ts`. There is no background scheduler: the 7-day and 30-day limits apply when `factory clean` runs.

`clean` skips the git check and needs no checkout. It starts no worker CLI, calls no preflight, `markStaleRuns`, `killRun` or `resumeRun`, and deletes no event row.

## What goes, and when

| What | When | How |
| --- | --- | --- |
| The run's worktree under the cache folder ([Worktrees](/reference/worktrees)) | More than 7 days after the pull request merged, or after the run's latest outcome was recorded as `abandoned` | `removeWorktree`, which also records `worktree_removed` |
| `ticket.json`, everything under `prompts/`, everything under `evidence/` (`diff.patch` and the gate logs included) | More than 30 days after `runs.ended_at` | Files are deleted, and one `retention_cleaned` event lists the paths |

Both limits are strict: exactly 7 or exactly 30 days is not yet old enough.

### What stays

`report.md`, `plan.md`, `plan.approved`, `decisions.md`, `review.md`, `context/`, `verify/`, the run folder itself, `factory.db` and every event row. The work-repo checkout is never changed, apart from the git worktree metadata that `removeWorktree` clears.

## Where the ages come from

Only `Deps.now()` against timestamps in the event log or from the code host. A file's modification time is never read, so copying or touching a file cannot make a run look older or younger.

- **Worktree, merge:** the pull request number is `payload.number` of the run's latest `draft_pr` event. `clean` asks `CodeHost.fetchPullRequest(repo, number)` for `mergedAt`. A missing number, a failed fetch, or a `mergedAt` that is absent or null leaves the worktree. A failed fetch is listed as skipped, with a next action.
- **Worktree, abandon:** `recorded_at` of the run's latest row in `outcomes`, and only when that latest outcome is `abandoned`. A later `accepted` or `rejected` cancels it. Other stop statuses (`killed`, `budget`, `timeout`, `refused`, `config_drift`) are not an abandon.
- **Artifacts:** `runs.ended_at`. A run with no `ended_at` keeps all its artifacts.

A run with none of these is never cleaned. A run that is merged and has no `draft_pr` event is in that case, because the pull request number is not stored anywhere else.

No code host adapter ships yet, so by default every pull request read fails and only abandoned runs lose their worktree. Tests inject a scripted `CodeHost`.

## Limits and care

- Every run is walked, each against its own `ended_at`, latest outcome and latest `draft_pr`. An older run of a ticket that is past its limit is cleaned even when a newer run of that ticket exists. Runs of one ticket can share a worktree path and a run folder; what one run already removed is gone for the next, which then finds nothing to do.
- A linked worktree is removed only through `git worktree remove` in the work-repo checkout it came from, found from the worktree's own `.git` file. When that checkout is missing, the worktree is skipped with a next action. It is never deleted by hand.
- A standalone clone is removed through the standalone path of `removeWorktree`, which checks that it is a clone of the work repo.
- Worktrees outside the cache worktrees folder are skipped. A symlink inside `prompts/` or `evidence/` is removed as a link, and what it points at stays.
- A second `clean` that finds nothing to do removes nothing and adds no event.

## Output

Text: the removed worktrees, the skipped ones with the reason and a `Next:` line, the artifact files deleted per run, then the disk line. `Nothing to clean.` comes first when nothing was removed.

With `--json`, the [envelope](/reference/cli#json) carries `data`:

```json
{
  "schema_version": 1,
  "worktrees_removed": [{ "run_id": "run-123", "path": "/tmp/factory/cache/worktrees/example-frontend/FE-123" }],
  "worktrees_skipped": [],
  "artifacts_deleted": [{ "run_id": "run-101", "paths": ["evidence/diff.patch", "prompts/plan.md", "ticket.json"] }],
  "disk": { "worktrees": 4096, "runs": 2048, "db": 53248, "total": 59392 }
}
```

When `factory.db` does not exist, the result is empty, the exit code is 0, and nothing is created.

## Disk use

`factory clean` and [`factory status`](/reference/status) report bytes for three areas: `worktrees` (the cache `worktrees/` folder), `runs` (the runs folder) and `db` (`factory.db` with its `-wal` and `-shm` files). `total` is the whole factory home plus the cache folder when it lies outside the home, so it also counts the config, repos and sandbox. Sizes are the sum of file sizes. A symlink counts as the link and is never followed out of the roots. `clean` measures after it has removed things.

When the total is above 10 GiB (`10 * 1024^3` bytes), the text adds a `Warning:` line and `disk.warning` is set. It is only a warning: the exit code stays 0 and nothing is refused. `status` only measures; it deletes nothing.

## Not covered

A scheduler (launchd or cron), `factory outcome`, opening draft pull requests and a live `gh` adapter, deleting event rows, `report.md`, `plan.md`, `verify/` or `context/`, and any age taken from file times.
