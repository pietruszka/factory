---
title: Preflight (FAC-26)
description: The unified preflight library - Node and git versions, config drift, the model policy and the OpenCode protected-folder check, what each failure moves the run to, and the preflight event.
---

# Preflight (FAC-26)

`preflight` in `src/preflight/preflight.ts` is a library that must pass before any agent call. There is no `factory preflight` command yet, and `factory run` does not call it yet. `npm run preflight` is unchanged: it stays the model-only check (see [Model IDs by role](/reference/models#preflight-gates-nfr-45)).

It starts no agent CLI, runs no `install` or gate command, makes no network call and spends nothing. Everything it reads is local: the config files, `package.json`, lockfiles and the version probe. The model catalog and the Node and git probe are injected. That is how it stays well inside the 5 s of NFR-44, by construction rather than by a timing test.

## Checks

The checks run in this order, and the first failure is thrown as a `FactoryError` (exit 2).

| Check | What it does | Failure codes |
| --- | --- | --- |
| `toolchain` | Calls `checkEnvironment` with the injected probe: Node 22.13 or newer, git 2.40 or newer. | `node_too_old`, `git_missing`, `git_too_old` |
| `config` | `loadConfig` for the repo (see [Factory config](/reference/factory-config)). | The existing load codes, for example `repo_config_missing` and `config_invalid`. They are not renamed. |
| `config_drift` | The loaded config must still match the repo. | `config_drift` |
| `models` | `runModelsPreflight` with the injected catalog. | The existing model codes, for example `high_fast_model` and `model_not_accepted_by_cli`. Never `config_drift`. |
| `protected_folder` | Only when a role in `models` uses `opencode`: the worktree path and the sandbox root must be outside `<HOME>/Documents`, `<HOME>/Desktop` and `<HOME>/Downloads`. | `protected_folder` |

The result is `{ ok: true, checks }`, where `checks` names the checks that ran and passed. `protected_folder` is left out when no role uses OpenCode.

## Config drift

The error code is `config_drift`. Its message names the config key (`package_manager`, `install`, `gates.lint`, ...) and its next action says what to change. The repo config file is the `where`.

- **`package_manager`** must have its lockfile at the repo root: `npm` with `package-lock.json`, `pnpm` with `pnpm-lock.yaml`, `yarn` with `yarn.lock`. A missing lockfile, or only another manager's lockfile, is drift.
- **`install`** and every gate that is set (`gates.lint`, `gates.typecheck`, `gates.test`, and `gates.build` and `gates.e2e` only when set) are checked from `gates_cwd`, one `&&`, `||` or `;` part at a time:
  - `<manager> run <script>`, and for pnpm and yarn the shorthand `<manager> <script>`, need `<script>` in the `scripts` of the `package.json` in `gates_cwd`. `npm test` needs a `test` script.
  - A package-manager builtin such as `ci` or `install` is accepted, but only with the configured `package_manager`. Another manager's command is drift.
  - `npx` is accepted when `package_manager` is `npm`.
  - A command that starts with a relative path (`./scripts/lint.sh`) needs that file in the repo.
  - Anything else, for example `node` or `tsc`, is not checked. No binary is looked up on the machine `PATH`, and no package is resolved over the network.

Commands are never executed.

## OpenCode and protected folders

When a role uses OpenCode, the `worktreePath` and `sandboxPath` options (the sandbox defaults to the computed sandbox root) are checked with `assertNotProtectedFolder`, symlinks and case included. A path inside a protected folder is refused as `protected_folder`, and the next action points at the factory cache folder: `<FACTORY_HOME>/cache` when `FACTORY_HOME` is set, otherwise the default cache folder. This is the D-39 behaviour. Which worktree mode OpenCode needs is still open and is not settled here. The always-on guards in `resolveFactoryPaths` and worktree create are unchanged and apply with or without OpenCode.

## The preflight event

Pass `run: { context, runId }` for a run in `preflight` (see [Run state](/reference/run-state)). The result is then appended to the [event log](/reference/event-log) as an event of type `preflight`:

- `status` is `ok` or `failed`. The `payload` holds `ok`, `checks` (the checks that passed before the result) and, on failure, `failed` with the error `code` and `where`.
- `cost_usd` and all token columns are empty: preflight spends nothing, so there is no zero to record.
- A pass leaves the stored status as `preflight`. `factory run` will move it on later.
- A `config_drift` failure moves the run to `config_drift` with `transition`. The run is resumable once the config is fixed.
- A toolchain, model or `protected_folder` failure moves the run to `refused`, which frees the one-active-run slot.
- A config load failure (`repo_config_missing` and the like) records the event and leaves the status alone.
- The status only changes when the run is still in `preflight`.

Without `run`, the checks run and nothing is written.

## Not in this ticket

A `factory preflight` command, calling it from `factory run`, base branch and Jira project checks, CLI version and rate-table age checks, a live OpenCode linked-worktree probe, and any run of `install` or the gates.
