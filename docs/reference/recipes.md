---
title: Recipes (FAC-57)
description: How to add a factory CLI command, and how to add a port with its recording fake.
---

# Recipes (FAC-57)

The steps. Facts stay on [The factory command](/reference/cli) and [Ports](/reference/ports).

## Adding a CLI command

Do this only when the ticket asks for a command. Do not add `plan`, `run`, `approve`, `revise`, `outcome`, `inspect`, `review`, `baseline` or `compare` unless it does.

1. Add a `CommandDef`: `description`, flags in `options`, required names in `positionals`, optional names in `optionalPositionals`, and `run`. Copy the shape of `createStatusCommand` in `src/cli/status.ts`. Return `{ message, data?, nextCommand? }`.
2. Register it on `defaultCommands` in `src/cli/router.ts`. Set `skipGitCheck` only when the command must answer without a checkout.
3. Refuse with `refused` or `internal` from `src/platform/errors.ts`, or a `FactoryError` whose `exitCode` is one of `EXIT_CODES` in `src/cli/exit-codes.ts` (0 ok, 1 needs attention, 2 refused, 3 breach, 4 internal). The `code` stays stable. `next` says what to do. Set `nextCommand` when the next step is itself a command.
4. Do not build a second JSON document. `src/cli/schemas.ts` is the `--json` envelope (`exit_code`, `next_command`). `printOutput` in `src/cli/output.ts` sends the human text to stderr when `--json` is set.
5. Add a behaviour test that runs the command through the router. Do not assert on source size. Use a throwaway factory home.
6. Add a row on [The factory command](/reference/cli). Add a page and a sidebar entry when the command needs more than a row. Keep [Architecture](/architecture) and the home page honest about what is shipped.

On a throwaway branch, a command added this way should leave the existing router and exit-code tests passing. That check is manual.

## Adding a port

A port is how the core reaches an outside system. A new process call is a port.

1. Add the interface and a `createRecording*` function in `src/ports/`. Follow `createRecordingCodeHost` in `src/ports/code-host.ts`: every call is appended to `calls`, and a write throws `write_not_allowed` (exit 2) until the test calls `allow`.
2. A real refusal is a `FactoryError`. Tests inject the process runner. The recording fake starts nothing, and it does not call `gh`, `acli`, `agent`, `cursor-agent` or `opencode`.
3. Pass `Deps` in when the port needs a clock or an id. Do not read the clock yourself.
4. Add a row on [Ports](/reference/ports): the interface, the fake, and the real implementation, or "not yet".
