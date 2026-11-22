---
title: Worktrees (FAC-17)
description: The per-run worktree in the cache folder - location, linked and standalone modes, what stays untouched in the work repo, the two-run limit, install, events and errors.
---

# Worktrees (FAC-17)

Each run builds in its own checkout of the work repo, made from a pinned commit. The code is `src/worktree/`. It is a library: there is no `factory` command for it yet. The run state machine (a later ticket) calls it.

| Function | What it does |
| --- | --- |
| `worktreePath(env, repo, ticket)` | Pure: returns the worktree path. Creates nothing. |
| `assertCanStart({ reader, runId?, allowedPaths? })` | Refuses a third active run and overlapping allowed paths. Reads the event log only. |
| `createWorktree({ env, deps, log, reader, runId, repo, ticket, repoPath, baseCommit, allowedPaths?, mode?, path? })` | Creates the worktree and appends `worktree_created`. |
| `installWorktree({ env, deps, log, reader, runId, repoPath, path, run })` | Runs the repo's `install` command once in the worktree. `run` is an injected command runner. |
| `removeWorktree({ env, deps, log, runId, repoPath, path })` | Deletes the worktree and appends `worktree_removed`. |

## Location

`<worktrees root>/<repo>/<ticket>/`, for example `worktrees/example-frontend/FE-123/` under the cache folder. The root comes from `resolveFactoryPaths` (see [Configuration](/reference/configuration)): `~/.cache/factory/worktrees` by default, or `$FACTORY_HOME/cache/worktrees` when `FACTORY_HOME` is set.

- `repo` and `ticket` are slugs, the same rule as the [run folder](/reference/run-folder): `^[A-Za-z0-9._-]+$`, not `.` or `..`. A slash or `..` is refused as `worktree_invalid`.
- A path at or inside `<HOME>/Documents`, `<HOME>/Desktop` or `<HOME>/Downloads` is refused as `protected_folder`. This covers the computed path and a `path` the caller passes.
- `createWorktree` checks, in this order: slugs, protected folder, `.git` in `repoPath`, the base commit, that the destination does not exist, then the concurrency rules and the config. An existing destination is never overwritten.
- On any failure after the destination is touched, it is deleted again.

## Modes

| Mode | Command | Result |
| --- | --- | --- |
| `linked` (default) | `git worktree add --detach <path> <baseCommit>` | A git worktree with a detached HEAD at the pinned commit. |
| `standalone` | `git clone --no-checkout <repoPath> <path>`, then `git checkout --detach <baseCommit>` | A local clone with no link back except `remote.origin.url`. |

The mode is the `mode` argument when given, else the optional config key `worktree.mode` (`linked` or `standalone`, global file or per repo, see [Factory config](/reference/factory-config)), else `linked`. Which mode OpenCode needs is the open D-39 question. This ticket does not settle it, and no default was chosen from a live run.

## The work repo stays untouched (NFR-1, NFR-2)

After `createWorktree` and again after `removeWorktree`, the work-repo checkout has the same working tree, index and branches. Both modes use a detached HEAD, so no `factory/<ticket>` branch is created in the work repo. A later ticket creates the publishable branch. While a linked worktree exists, git keeps its bookkeeping under the work repo's `.git/worktrees/`; `removeWorktree` uses `git worktree remove`, so that is gone afterwards. The factory writes no file into the work repo.

`removeWorktree` refuses a path that is not an existing worktree, a folder that is not a clone of `repoPath`, and `repoPath` itself.

## Concurrency (ADR-007)

An active run is a row in `runs` whose status is not `passed`, `refused` or `breach`. The run passed as `runId` is not counted.

- A third active run is refused as `worktree_busy`. There is no queue.
- A second active run is allowed only when its `allowed_paths` globs cannot overlap those of the first. Overlap is refused as `worktree_overlap`.
- The `allowed_paths` of an active run come from its latest `worktree_created` event. A missing or empty list means every path, so it overlaps everything.
- The overlap rule is conservative. Only the literal prefix of a glob counts: the whole path segments before the first segment with `*`, `?`, `[` or `{`. Two globs overlap unless those prefixes differ at some segment. `src/a/**` and `src/b/**` are disjoint, and so are `src/a/**` and `src/ab/**`. `src/**` and `src/a/**` overlap, and so do `src/a*/x` and `src/a/**`. A glob that starts with a wildcard (`**/*.ts`, `*.md`) overlaps everything.
- The `runs_one_active` index (one active run per repo and ticket) is unchanged.

## Install (NFR-46)

`installWorktree` runs the merged config's `install` string with cwd at the worktree root. It is separate from `createWorktree` so a run can create the worktree at start and install after the plan is approved.

- The command goes through `run`, a `(command, { cwd }) => Promise<{ exitCode }>` the caller supplies. The module has no default runner and never runs `npm ci` itself.
- A `worktree_install` event records `started_at` and `ended_at` from `Deps`, so the time can count toward the run's wall-clock cap later. Its `status` is `ok` or `failed`, and its payload is `{ path, exit_code }`. A runner that throws is recorded as `failed` too.
- A second install on the same worktree for the same run is refused once one has succeeded. A failed install may be retried.

## Events and report

| Event | Payload |
| --- | --- |
| `worktree_created` | `path`, `base_commit` (the full id), `mode`, `allowed_paths` (`[]` when none were given) |
| `worktree_install` | `path`, `exit_code`; `status` `ok` or `failed`; `started_at` and `ended_at` |
| `worktree_removed` | `path`, `mode` |

The payloads go through the event log's redaction. The worktree path and base commit appear in `report.md` by passing the path to `writeReport` (see [Run folder](/reference/run-folder)); there is no second report format.

## Errors

Each is a `FactoryError` with `where` and `next`, exit code 2.

| Code | When |
| --- | --- |
| `worktree_invalid` | A `repo` or `ticket` that is not a slug; a relative `path`; a repo without `.git`; a base commit that does not exist; a destination that already exists; `removeWorktree` or `installWorktree` on a path that is not an existing worktree. |
| `protected_folder` | A worktree path inside `<HOME>/Documents`, `<HOME>/Desktop` or `<HOME>/Downloads`. |
| `worktree_create_failed` | git failed to create the worktree or clone. The destination is deleted. |
| `worktree_remove_failed` | git failed to remove the worktree, or the folder is not a clone of `repoPath`. |
| `worktree_busy` | Two other runs are already active. |
| `worktree_overlap` | The allowed paths may overlap an active run's. |
| `worktree_already_installed` | The install already succeeded in this worktree for this run. |
| `worktree_install_failed` | The install command exited with a non-zero code. |

## Tests

They use real git on disposable repos under a temp home, and a fake command runner. They never touch the real factory home, cache folder or a real work-repo checkout.

## Not in this ticket

A factory command, the run state machine and marking a run `passed`, snapshot and write-scope diff, retention of old worktrees, preflight (the git version floor), `WorkerRuntime`, cap enforcement, stale-pid marking, a live OpenCode run, creating `factory/<ticket>` in the work repo.
