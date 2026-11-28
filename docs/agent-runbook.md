---
title: Agent runbook
description: Allowed M1 surfaces, the failure-detection loop and the stop limits for an agent debugging the factory in the sandbox only.
---

# Agent runbook

This page is for a coding agent that debugs the factory against the sandbox only. It lists the surfaces that ship in M1, how to detect a failure, and the stop limits. It is not a way to approve a real plan. `factory approve` is not in M1.

## Boundaries

Use a throwaway factory home. `factory dev-init <path>` writes the marker file `.factory-dev-home` and a starter `config.yaml` in that home. Set `FACTORY_HOME` to the throwaway factory home before any other factory command. A home without that marker is refused.

Work in the sandbox only. The unpacked sample repo is `todo-app`, under the cache sandbox folder of that home. `factory dev-approve` records an approval only for a fake-worker run of that sandbox repo.

Never use the real factory home. Never use the private sibling. Never call live `gh`. Never call `acli`. Never write a ticket or a pull request on a live host. Never point a run at a real work repo.

## Allowed surfaces

These commands ship in M1. Type them as written. A ticket key in examples is `FE-123`.

```sh
factory status
factory status FE-123 --json
factory kill FE-123
factory resume FE-123
factory clean
factory dev-init /tmp/example-factory-home
factory dev-init --sample todo-v0
factory dev-approve FE-123
factory version
factory help
```

`factory dev-init --sample` unpacks the sample and writes nothing outside the throwaway factory home. It does not install the sample. `factory dev-approve` then records the content hash of the current run `plan.md`, with approver `agent-debug` and client `dev-harness`. A later change to `plan.md` voids that hash. This is a dev harness command. It is not `factory approve`.

### Machine output

Pass `--json` when you need one document on stdout. The human text goes to stderr. The document includes `exit_code` and `next_command`.

| `exit_code` | Meaning |
| --- | --- |
| exit code 0 | Done |
| exit code 1 | Stopped and needs attention |
| exit code 2 | Refused, or the command was used wrongly |
| exit code 3 | A safety limit was breached |
| exit code 4 | Internal error |

`next_command` is a string such as `factory resume FE-123`, or null when there is no next step. On success, `factory kill` sets `next_command` to `factory resume FE-123`.

### Read-only database queries

`factory.db` in the throwaway factory home is the event log. Query it read-only. Read `runs`, `steps` and `events`. Do not insert, update or delete rows yourself. `factory status` is the read-only command for the same facts.

### Run-folder files

The run folder for a ticket holds:

- `report.md`, including the next action
- `plan.md` and `plan.approved`
- `evidence/` (diff, gate logs and other large artifacts)

`ticket.json` and `prompts/` are also run-folder files. Retention deletes those, plus `evidence/`, only after the run has ended and aged out. `report.md`, `plan.md` and `plan.approved` stay.

### Dev harness

Drive pipeline steps with the fake worker. Do not start a live model CLI. Tests that move time use the injectable clock (`Deps`), not a real wait. The stop limits below are enforced by that test harness. There is no user-facing supervisor command.

## Failure detection

Detect a failure before you run another command:

1. Run `factory status --json`. Read the stored status, whether a run in a phase is stale, and `exit_code`.
2. Read the failed step's exit reason in the event log, and the next action in `report.md`. `next_command` names the following command when the CLI set one.
3. Treat `breach`, `budget`, `timeout`, `cost_missing`, `killed` and a non-zero `exit_code` as a stop. A missing cost is `cost_missing`; it is never a cost of zero.
4. Continue only with the next action that the report or `next_command` names, and only inside the stop limits. Three identical failures mean you stop, you do not invent another command.

`factory status` does not change the run. `factory kill` stops a run and keeps its worktree. `factory resume` continues a stopped run from its checkpoint in that worktree.

## Stop limits

The test harness ends an agent session when any of these holds. The clock is the injectable clock, so a session does not wait out the minutes for real.

- Three identical failure signatures (the same status, exit reason and step) end the session, and the harness writes a report.
- At most 20 factory commands per scenario. The next one is refused.
- At most one resume per cause.
- At most one retry of a command that failed with `cli_error`.
- Stop a command with `factory kill` after 10 minutes under the fake worker.
- Stop the whole session after 60 minutes.

A dollar cap on a run is a different limit. Hitting it stops that run as `budget`. It does not reset these session limits.

## Not in M1

These commands are not in M1. They are designed for a later milestone. Do not run them and do not treat a missing command as a factory bug:

- `factory plan` is not in M1
- `factory run` is not in M1
- `factory approve` is not in M1
- `factory revise` is not in M1
- `factory outcome` is not in M1
- `factory inspect` is not in M1
- `factory review` is not in M1
- `factory baseline` is not in M1
- `factory compare` is not in M1

M1 proves the loop with the throwaway factory home, `factory dev-init --sample`, the fake worker, `factory dev-approve` and `factory status`. It does not start Flow A.
