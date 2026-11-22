---
title: The factory command
description: Commands, the --json envelope, exit codes and error codes of the factory CLI.
---

# The factory command

`factory` is the command line entry point. After `npm run build`, `npm link` (run once, by hand) puts it on your `PATH`. Without linking, run `node dist/src/cli/main.js`.

```sh
factory <command> [--json]
```

## Commands

| Command | What it does | Checks git |
| --- | --- | --- |
| `version` | Prints `factory <version>` from `package.json`. `factory --version` is the same command. | no |
| `help` | Lists the commands. | no |

`help` and `version` answer at once: they skip the git check. Every other command checks git once before it runs. All commands check Node first.

`factory` with no command prints the usage text and exits 2.

A command accepts only its own flags and the global `--json`. An unknown flag or a stray argument is refused with exit 2.

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
| `next_command` | string or null | A runnable next step, for example `factory help` |
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
| `invalid_usage` | 2 | Another argument problem, for example a stray argument | run `factory help` |
| `node_too_old` | 2 | Node.js older than 22.13 | install Node.js 22.13 or newer |
| `git_missing` | 2 | `git --version` could not be run | install git 2.40 or newer |
| `git_too_old` | 2 | git older than 2.40, or its version could not be read | update git to 2.40 or newer |
| `internal_error` | 4 | An uncaught error, or output that failed its schema | none; report it as a bug |

The path codes `factory_home_relative` and `protected_folder` (see [VitePress config](/reference/configuration#factory-paths)) use the same envelope when a command reports them.

## Git check

The default check runs `git --version` once: fixed arguments, no shell, a 5 second timeout. Tests inject a fake instead, so they never start git.
