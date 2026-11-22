---
title: Write scope (FAC-21)
description: Role write scopes enforced by a worktree snapshot diff - the snapshot, the ignore list, role defaults, the run-folder plan.md note, restore, breach, and what is deferred.
---

# Write scope (FAC-21)

A role may only change the worktree files it is allowed to. The factory checks this after every worker step by comparing two snapshots of the worktree. The code is `src/write-scope/`. It is a library: there is no new `factory` command. `runSteps` (see [Run state](/reference/run-state)) takes an optional `writeScope: { config, tempDir }` argument. Without it, steps run as before.

## Snapshot

`takeSnapshot({ env, cwd, snapshotIgnore, tempDir })` returns the id of a git tree of the worktree.

- It is built through a temporary index file (`GIT_INDEX_FILE`) in `tempDir`, with the existing `runGit` helper. The file is removed once the tree is written, so `tempDir` is empty again.
- It includes untracked files, and also files a `.gitignore` hides. Nothing is left out except what `snapshot_ignore` lists.
- HEAD and the worktree's real index are not changed. Git runs only in the worktree under the cache folder.

## Ignore list

Paths matching a glob in the merged config's `snapshot_ignore` (default `[]`) are not in the snapshot, so a change there never shows up in a diff. Put build output such as `node_modules/**` or `dist/**` there. Nothing is ignored unless it is listed.

## Diff

`diffSnapshots({ env, cwd, before, after })` compares two snapshot trees, not the worktree against HEAD. It returns `{ path, kind }` entries sorted by path, with `kind` `added`, `modified` or `deleted`. A delete, a file reverted to its earlier contents, and a content edit all appear.

## Role defaults

| Role | May change |
| --- | --- |
| `planner` | `plan.md` |
| `builder` | every worktree path, except `protected_globs` |
| `reviewer`, `visionJudge`, `verifier` | nothing |

- A role with no entry (an unknown name) writes nothing.
- `role_write_globs` in the config is an optional override. A missing or empty entry keeps the default; a listed entry replaces the default as a whole.
- `protected_globs` always win: a protected path is never allowed, whatever the role's globs say.
- `forbidden_globs` is not used here. `verifier` is a write-scope role, not a model slot, so it is not in `MODEL_ROLES`.

### Glob matching

A glob is matched against the whole worktree-relative path, with `/` separators. `*` matches inside one path segment, `?` is one character in a segment, and `**` crosses segments (`**/` also matches no segment). A glob ending in `/` means the whole folder. There are no `[...]` classes or `{a,b}` alternatives, and a glob without a `/` is not matched at any depth (`*.md` matches only top-level files). This is exact path matching, not the prefix overlap that `allowed_paths` uses for [worktrees](/reference/worktrees).

## The run-folder `plan.md`

The official `plan.md` lives in the [run folder](/reference/run-folder), outside the worktree. The snapshot never sees it, and the factory does not scan the run folder. The `planner` default `plan.md` covers a file of that name at the top of the worktree. A planner that changes any other worktree file is a breach.

## Check after a step

`runSteps` snapshots the worktree before each worker attempt and again after it returns, then:

1. Diffs the two trees and gives each changed path a check row: the item is the path, `ok` is whether the role may change it.
2. Restores every violated path from the pre-step snapshot: contents are put back, added files are removed, deleted files are written again. Allowed changes of the same step stay. HEAD and the real index do not change.
3. Appends one `write_scope` event with its check rows (gate `write_scope`). A clean step logs the event too, with all rows `ok` (or none), and restores nothing.

A step with a retry after malformed output is checked once per attempt. A step that is skipped because it is already checkpointed as done is not started, so it is not checked.

## Breach

When a path is out of scope, the step is recorded as `failed` with `exit_reason` `breach`, whatever the worker reported. The run moves to `breach` through `transition` and `runSteps` returns. `breach` is not resumable, and the process exit code for it is 3. A verifier step that changes nothing does not cause a breach.

## Tests

Every scenario uses the fake worker in a worktree created by the worktree helpers under the cache folder of a temp factory home. No real CLI is started.

## Deferred

CLI permission flags for write tools (a read-only mode for real reviewer and verifier adapters), the plan-conformance verifier and `forbidden_globs`, cap accounting, `factory kill`, `resume` and `status`, and the breach runbook scenario at the L3/L4 layers. The run folder is not snapshotted.
