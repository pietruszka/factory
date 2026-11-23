---
title: Run folder (FAC-16)
description: The per-run folder under the factory home - location, slug rules, layout, report.md outline, required artifacts per flow, redaction, permissions and errors.
---

# Run folder (FAC-16)

Each run gets one folder for its plan, evidence, saved prompts and report. The code is `src/run-folder/`. It is a library: there is no `factory` command for it yet. The run state machine (a later ticket) calls it.

## Location

`<factory home>/runs/<repo>/<ticket>/`, for example `runs/example-frontend/FE-123/`. The factory home is `~/.factory`, or `$FACTORY_HOME` when that is set; the code takes it from `resolveFactoryPaths` (see [Configuration](/reference/configuration)).

- The folder is never under the cache root and never inside a work-repo checkout. `createRunFolder` takes an optional `workRepoPath` and refuses when the run folder would be inside it.
- `repo`, `ticket` and a prompt `step` are slugs: non-empty, matching `^[A-Za-z0-9._-]+$`, and not `.` or `..`. A slash, `~`, a space or an absolute path is refused.
- `runFolderPath(env, repo, ticket)` is pure: it returns the path and creates nothing.

The worktree a run builds in is a separate folder under the cache root; see [Worktrees](/reference/worktrees).

The run state machine that decides when a run may end as `passed` is described in [Run state](/reference/run-state).

## Layout

`createRunFolder({ env, repo, ticket, workRepoPath? })` creates, and returns the path of:

```text
runs/<repo>/<ticket>/
  context/
  evidence/
    gates/
  prompts/
  verify/
```

The writers add these files:

| Function | Writes |
| --- | --- |
| `savePrompt({ env, repo, ticket, step, prompt, extraSecrets? })` | `prompts/<step>.md` |
| `writeEvidenceDiff({ env, repo, ticket, diff })` | `evidence/diff.patch` |
| `writeReport({ env, log, runId, worktreePath })` | `report.md` |

`ticket.json`, `plan.approved`, `decisions.md` and `review.md` are written by later tickets. The report only refers to them. `plan.md` is written by a later ticket too, but `factory resume` already adds a progress section to it (see below). The writers need the folder to exist; call `createRunFolder` first.

The run folder holds no checkout. No writer copies a worktree, a `.git` directory or a source tree. `createRunFolder` refuses a folder that already contains `.git`.

## report.md

`writeReport` reads the event log through a read-only handle and finds the run by `runId`. It never writes `runs.status`. It always writes the report, also when a required artifact is missing.

| Section | Fields |
| --- | --- |
| Heading | `Ticket`, `Repo`, `Run id` |
| `## Route` | `Flow`, `Tier` (from the run row) |
| `## Config` | `Config hash` as `sha256:<digest>`, from `runs.config_hash` |
| `## Models` | One `role: model` line per distinct pair in `steps` and `events`. A role from the config with no pair is listed as `unused`. |
| `## Cost and duration` | `Cost (reported)` and `Cost (estimated)` from `events.cost_usd` grouped by `usage_source`; `Cost (total)` when there is more than one group. When no cost was recorded the line is `Cost: missing`; the report never writes a zero total. `Duration` from `runs.started_at` to `runs.ended_at`, for example `12m 30s`. |
| `## Workspace` | `Worktree` (the path passed in), `Base commit` (from `runs.base_commit`) |
| `## Artifacts` | One line per required path, `present` or `missing`, then one line per optional path that exists |
| `## Next action` | Only when the run's current status is a cap or `cost_missing` stop that was recorded: what was spent or elapsed and what to do next. See [Caps and cost](/reference/caps). |

Later tickets add sections; they do not rename these fields.

The worktree path must be absolute and strictly inside the cache root, symlinks resolved. The cache root and the runs folder are siblings under the factory home (or the default cache folder and the default home), so a path under the cache root is never inside the run folder or a protected folder.

## Required artifacts

| Flow | Required |
| --- | --- |
| A, E, H | `plan.md`, `plan.approved`, `evidence/diff.patch`, `report.md` |
| F | `review.md`, `report.md` |

Optional, listed when present and never required in this ticket: `ticket.json`, `decisions.md`, the `context/`, `evidence/gates/` and `verify/` directories (even when empty), files under those folders and `prompts/`, and the other flow's files.

`canPassFromReport(runFolder)` takes only the run folder. It is true only when `report.md` records a flow with a required list, lists every required path of that flow as `present`, and each of those files still exists. A missing or unreadable report, an unknown flow, a stale `missing` line or a deleted file gives false. This module has no function that sets `runs.status` to `passed`; the state machine must refuse `passed` when `canPassFromReport` is false.

## Redaction

`savePrompt` redacts before it writes: first the exact values of environment variables whose names match KEY, TOKEN, SECRET, PASSWORD, PASS, AUTH or CREDENTIAL (and `extraSecrets`), then the token-pattern scan from `src/redaction/`. See [Event log](/reference/event-log#redaction) for the rules. The raw prompt is never written to disk.

`evidence/diff.patch` and `report.md` are written as given. They are not redacted.

## Plan progress

`writeProgress` (`src/run-folder/progress.ts`) writes a section to the end of `plan.md`, between the markers `<!-- factory:progress:begin -->` and `<!-- factory:progress:end -->`. It lists the current step, the done steps and the last result, and is rewritten each time [`factory resume`](/reference/resume) starts and a step finishes. The rest of the file is left as it was; a missing `plan.md` is created holding only the section.

The progress section is not part of what a person approves. `approvedContent(markdown)` is the file with that section removed, and `approvalHash(markdown)` is the sha256 (hex) of that text. Rewriting the progress never changes the hash; any other edit to `plan.md` does. `factory approve` is a later ticket and does not exist yet.

## Permissions

Directories are `0700` and files `0600`. Every writer sets `0600` after it writes, also on an existing file. `createRunFolder` on an existing run folder tightens everything in it that the current user owns, and the factory home, `runs/` and `runs/<repo>/` themselves. It does not walk any other folder and does not follow symlinks.

## Retention

[`factory clean`](/reference/clean) deletes `ticket.json`, everything under `prompts/` and everything under `evidence/` (including `diff.patch` and the gate logs) more than 30 days after `runs.ended_at`. `report.md`, `plan.md`, `plan.approved`, `decisions.md`, `review.md`, `context/`, `verify/` and the run folder itself are kept.

## Errors

Each is a `FactoryError` with `where` and `next`.

| Code | Exit | When |
| --- | --- | --- |
| `run_folder_invalid` | 2 | A `repo`, `ticket` or `step` that is not a slug; a run folder inside the work repo; a folder that already contains `.git`; a writer called before `createRunFolder`; a `worktreePath` that is relative or not strictly inside the cache root. |
| `run_not_found` | 2 | `writeReport` was given a `runId` that is not in the event log. |

## Not in this ticket

A factory command, the inspector, worktree creation (see [Worktrees](/reference/worktrees)), the run state machine and marking a run `passed`, writing `ticket.json`, the plan itself or `plan.approved`, and opening a draft PR.
