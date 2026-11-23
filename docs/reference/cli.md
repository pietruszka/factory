---
title: The factory command
description: Commands, the --json envelope, exit codes and error codes of the factory CLI.
---

# The factory command

`factory` is the command line entry point. After `npm run build`, `npm link` (run once, by hand) puts it on your `PATH`. Without linking, run `node dist/src/cli/main.js`.

```sh
factory <command> [arguments] [--json]
```

## Commands

| Command | What it does | Checks git |
| --- | --- | --- |
| `version` | Prints `factory <version>` from `package.json`. `factory --version` is the same command. | no |
| `clean` | Deletes worktrees 7 days after a merge or an abandon, and `ticket.json`, prompts and evidence 30 days after a run ended; prints disk use per area. See [factory clean](/reference/clean). | no |
| `kill <ticket>` | Stops the run of a ticket in the current checkout and keeps its worktree. See [factory kill](/reference/kill). | yes |
| `resume <ticket>` | Continues a stopped run of a ticket from its checkpoint, in its existing worktree. Takes `--from <step>` and `--cap +$N`. See [factory resume](/reference/resume). | yes |
| `status [ticket]` | Lists the active and the 10 most recent runs, or only the runs of one ticket, without writing anything. See [factory status](/reference/status). | no |
| `dev-init --sample <tag>` | Dev only. Unpacks the checked-in to-do sample repo (a zip) under the throwaway factory home's cache folder, checks out the tag and writes a path-matched repo config. Installs nothing. See [Sandbox and dev-init](/reference/sandbox). | no |
| `help` | Lists the commands. | no |

`help`, `version`, `status`, `clean` and `dev-init` answer at once: they skip the git check. Every other command checks git once before it runs. All commands check Node first.

`factory` with no command prints the usage text and exits 2.

A command accepts only its own flags, its declared positional arguments and the global `--json`. An unknown flag or a stray argument is refused with exit 2.

### Positional arguments

A command declares its positionals by name, for example `kill` declares `ticket`. The router requires exactly one value per name. A missing value or an extra one is refused as `invalid_usage` (exit 2) with a message that names the argument, for example `factory kill needs a ticket.` A command that declares no positionals accepts none. A command can also declare optional positionals, for example `status` declares `[ticket]`: zero or one value is accepted, and a further one is refused as `invalid_usage`. `help` shows them in square brackets.

Commands run from the folder given to `runCli` as `cwd`, which defaults to the process folder. Tests pass a temp folder instead of changing directory.

### `factory kill <ticket>`

```sh
cd path/to/example-frontend
factory kill FE-123
```

`kill` finds the repo from the current folder: the git top folder of `cwd`, the repo config that matches it, and the config file name without `.yaml` (for example `repos/example-frontend.yaml` gives `example-frontend`). It then takes the one run of that repo and ticket that is not `passed`, `refused` or `breach`. A run that is already `killed` counts.

It stops the recorded process trees (children first, a polite stop before SIGKILL), moves the run to `killed`, writes a `killed` event and keeps the worktree. On success `next_command` is `factory resume FE-123` and the text names the ticket, that the worktree was kept, and the run folder path. Details: [factory kill](/reference/kill); to continue the run, see [`factory resume`](#factory-resume-ticket).

A second `factory kill FE-123` on a run that is already `killed`, with no live matching process, exits 0, signals nothing and keeps the worktree.

### `factory resume <ticket>`

```sh
cd path/to/example-frontend
factory resume FE-123
factory resume FE-123 --from verify
factory resume FE-123 --cap "+$2"
```

`resume` finds the repo from the current folder the same way `kill` does, then takes the one run of that repo and ticket that is not `passed`, `refused` or `breach`. It continues that run in its existing worktree: steps with a done checkpoint are not started again, and an unfinished step gets a new attempt. A run that was `killed` or stopped for another reason goes back to the phase it left, never to a later one.

| Flag | Meaning |
| --- | --- |
| `--from <step>` | Run that step and every later step again; earlier done checkpoints are kept. Takes a step id, a phase name, or the short names `plan`, `build`, `gate`, `verify` and `review`. A step in a phase the run already left is refused. |
| `--cap +$N` | Add N dollars (`+$2`, `+$0.50`) to the run's dollar cap. Quote it, because `$` is special in a shell. Nothing raises the cap automatically. It adds dollars only: it does not extend the wall-clock cap. |

On success `next_command` is `factory resume FE-123` unless the run is now `passed`. Details, the order of work and the limits: [factory resume](/reference/resume).

### `factory status [ticket]`

```sh
factory status
factory status FE-123
factory status --json
```

`status` lists runs from the event log. It does not need a checkout or a repo config, and it does not check git. With no ticket it lists every active run and the 10 most recent finished runs, in every repo. With a ticket it lists only that ticket's runs, in every repo. Active runs (stored status is a phase) come first; recent runs follow, newest last event first. Each row shows ticket, repo, flow, stored status, current step, cost marked `reported` or `estimated`, and time since the last event. A run in a phase whose process is gone is marked `stale`; this is only shown, and nothing is written (the status is not changed to `interrupted`). With `--json`, `data` is `{ "schema_version": 1, "rows": [...], "disk": {...} }`; `disk` has the bytes of the worktrees, runs and db areas and their total, plus a `warning` above 10 GiB.

When `factory.db` is missing, it prints an empty list, leaves `disk` out and exits 0 without creating anything. A ticket that is not a slug is refused as `ticket_invalid` (exit 2). Details, the text format and the JSON fields: [factory status](/reference/status).

### `factory clean`

```sh
factory clean
factory clean --json
```

`clean` applies the retention policy to every run in the event log: it removes a worktree more than 7 days after the pull request merged or the run was abandoned, and deletes `ticket.json`, `prompts/` and `evidence/` of a run that ended more than 30 days ago. It keeps `report.md`, `plan.md` and every event row. It prints what it removed and the disk use per area, with a soft warning above 10 GiB (exit 0). It does not need a checkout and does not check git. When `factory.db` is missing it exits 0 and creates nothing. Details: [factory clean](/reference/clean).

## `--json`

With `--json`, stdout holds exactly one JSON document followed by a newline. The human message goes to stderr. Without `--json`, the message goes to stdout on success and to stderr on failure.

```json
{
  "schema_version": 1,
  "command": "version",
  "ok": true,
  "exit_code": 0,
  "message": "factory 0.1.0",
  "errors": [],
  "next_command": null,
  "data": { "version": "0.1.0" }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `schema_version` | `1` | Changes only when a field is removed or changes meaning |
| `command` | string | The command name; `""` when none was given |
| `ok` | boolean | `true` exactly when `exit_code` is 0 |
| `exit_code` | 0 to 4 | Same as the process exit code |
| `message` | string | The human text |
| `errors` | array | `{ code, message, where?, next? }` entries; empty on success |
| `next_command` | string or null | A next step, for example `factory help`. A command sets it on success too (`kill` and an unfinished `resume` set `factory resume FE-123`); the text output prints it as a `Next:` line |
| `data` | any, optional | Command-specific payload |

The output is checked against its schema (`CliOutputSchema` in `src/cli/schemas.ts`) before it is printed. If it does not match, nothing of it is printed; instead the process prints an `internal_error` envelope and exits 4.

## Exit codes

| Code | Name | Meaning |
| --- | --- | --- |
| 0 | `ok` | Done |
| 1 | `needsAttention` | Stopped and needs attention (not used yet) |
| 2 | `refused` | Refused, or the command was used wrongly |
| 3 | `breach` | A safety limit was breached (not used yet) |
| 4 | `internal` | Internal error: a bug in the factory |

An uncaught error in a command is caught at the top and reported as `internal_error` with exit 4.

## Error codes

| Code | Exit | When | Next action |
| --- | --- | --- | --- |
| `no_command` | 2 | No command given | run `factory help` |
| `unknown_command` | 2 | The command is not in the table | run `factory help` |
| `unknown_flag` | 2 | A flag the command does not accept | run `factory help` |
| `invalid_usage` | 2 | Another argument problem, for example a stray argument or a second ticket for `status` | run `factory help` |
| `ticket_invalid` | 2 | `kill`, `resume` or `status` got a ticket that is not a slug | pass a ticket key such as `FE-123` |
| `checkout_invalid` | 2 | `kill` or `resume` ran in a folder that is not inside a git checkout | run it from inside the work-repo checkout |
| `repo_config_missing` | 2 | No repo config matches the checkout (see [Factory config](/reference/factory-config)) | create the repo config file |
| `run_not_found` | 2 | No running or stopped run for that repo and ticket; nothing was signalled | check the ticket and the checkout |
| `run_not_resumable` | 2 | `resume` on a run that is `passed`, `refused` or `breach`; nothing was started | start a new run for the ticket |
| `step_unknown` | 2 | `resume --from` names a step the pipeline does not have | pass one of the listed steps |
| `from_behind` | 2 | `resume --from` names a step in a phase the run already left | pass a step of the current or a later phase |
| `cap_invalid` | 2 | `resume --cap` is not a plus sign and a dollar amount above zero | pass `--cap "+$2"` |
| `cap_reached` | 2 | `resume` on a run whose spend already reaches its dollar cap; the message names the amount spent | pass `--cap "+$N"` |
| `worktree_missing` | 2 | `resume` found no worktree for the run; none is created | restore the worktree or start a new run |
| `approval_missing` | 2 | `resume` of a run that has not reached building and has no recorded approval | record an approval first |
| `illegal_transition` | 2 | `kill` on a run that is stopped for another reason, or final; nothing was signalled | see [Run state](/reference/run-state) |
| `node_too_old` | 2 | Node.js older than 22.13 | install Node.js 22.13 or newer |
| `git_missing` | 2 | `git --version` could not be run | install git 2.40 or newer |
| `git_too_old` | 2 | git older than 2.40, or its version could not be read | update git to 2.40 or newer |
| `db_schema_older` / `db_schema_newer` | 4 | `status` found an event log with another schema version; nothing was written | see [Event log](/reference/event-log) |
| `internal_error` | 4 | An uncaught error, or output that failed its schema | none; report it as a bug |

The path codes `factory_home_relative` and `protected_folder` (see [VitePress config](/reference/configuration#factory-paths)) use the same envelope when a command reports them.

## Git check

The default check runs `git --version` once: fixed arguments, no shell, a 5 second timeout. Tests inject a fake instead, so they never start git.
