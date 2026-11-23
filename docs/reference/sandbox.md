---
title: Sandbox and factory dev-init (FAC-28)
description: The generator for the to-do sample app (a local git repo with tags todo-v0, todo-v1 and todo-v2 under the cache sandbox folder) and factory dev-init --sample, which writes a path-matched repo config into a throwaway factory home.
---

# Sandbox and factory dev-init (FAC-28)

The dev harness needs a small app to run the factory against. The factory repo holds only the **generator**. The app is written at run time, never checked in, and never pushed.

- Generator: `generateTodoSandbox({ env })` in `src/sandbox/todo-sandbox.ts`. The file contents are in `src/sandbox/todo-app-files.ts`.
- Command: `factory dev-init --sample <tag>` in `src/cli/dev-init.ts`. It skips the git check.

## Where the sample lives

At `<sandboxRoot>/todo-app`, from `resolveFactoryPaths` ([Configuration](/reference/configuration)):

| `FACTORY_HOME` | Path |
| --- | --- |
| unset | `~/.cache/factory/sandbox/todo-app` |
| set to `<fh>` | `<fh>/cache/sandbox/todo-app` |

Baseline reports stay where they were: `<home>/sandbox/baseline-reports`. The generator does not move that folder into the cache root and writes no report.

## The repo

A local git repo on branch `main` with no remote. It has three annotated tags, each on its own commit, in this order:

| Tag | Content |
| --- | --- |
| `todo-v0` | A small working to-do list. `package.json` has `lint`, `typecheck` and `test` scripts, and all three pass. No dependencies, so `npm install` fetches nothing. |
| `todo-v1` | `todo-v0` plus a documented bug: `completeItem` also completes the items added before it. `test/known-bug.test.js` describes the right behaviour and fails. The README names the bug. |
| `todo-v2` | `todo-v1` plus a documented UI difference: a new heading and a different done mark. The README names it. The known bug stays. |

Every commit and tag has the author and committer `Factory Sandbox <factory-sandbox@example.invalid>` and a fixed date (equal for author and committer). The repo holds no real name, email, home path or token.

### Two runs are identical

The same files, tags, commit ids and tag ids come out every time. When `todo-app` already exists, the generator deletes it and builds it again, so a checked-out tag, stray files or a changed file never survive a run. After a run, `main` is checked out at `todo-v2`.

### Refusals

All are `FactoryError` with exit 2.

| Code | When |
| --- | --- |
| `protected_folder` | The resolved home, cache, sandbox or `todo-app` path is at or inside `~/Documents`, `~/Desktop` or `~/Downloads`, symlinks followed. Nothing is written there. |
| `sandbox_symlink` | The cache folder, the sandbox folder or `todo-app` is a symbolic link. The link and its target are left alone. |

## `factory dev-init --sample <tag>`

```sh
npm run dev:init -- /tmp/example-factory-home
FACTORY_HOME=/tmp/example-factory-home factory dev-init --sample todo-v0
```

`npm run dev:init -- <path>` is unchanged: it creates a throwaway home with the dev-home marker and a starter `config.yaml`, and nothing else. `dev-init --sample` then:

1. Refuses unless `FACTORY_HOME` is set to an existing home that has the dev-home marker.
2. Runs the generator and checks out the tag (detached HEAD).
3. Writes `<home>/repos/todo-app.yaml` with `match.path` set to the absolute sample path (no `match.origin`), `base_branch: main`, `package_manager: npm`, `install: npm install`, and `gates.lint`, `gates.typecheck` and `gates.test` as npm scripts. The file is rewritten on every run.

`loadConfig({ env, repoPath: <sample path> })` then matches that file by path ([Factory config](/reference/factory-config)).

The command starts no agent. It does not call preflight, `markStaleRuns`, `killRun`, `resumeRun` or `factory clean`, and it writes nothing under `sandbox/baseline-reports`.

| Code | When |
| --- | --- |
| `sample_required` | No `--sample`. |
| `sample_unknown` | The name is not `todo-v0`, `todo-v1` or `todo-v2`. The `next` text lists them. Nothing is written. |
| `dev_home_required` | `FACTORY_HOME` is unset. Nothing is written under the default home or cache. |
| `dev_home_invalid` | The home does not exist, has no dev-home marker, or is the default or a private folder. |
| `protected_folder`, `sandbox_symlink` | As above. |

`--json` prints the envelope with `data.sample`, `data.sandbox_path` and `data.repo_config`.
