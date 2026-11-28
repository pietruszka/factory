---
name: factory-change
description: >-
  Change factory CLI commands, modules, ports, run-state, worker-runtime, or
  config. Use when adding or editing src/, wiring a command, introducing an
  outside system, or shaping errors and exit codes.
---

# factory-change

Procedures for changing product code. Facts live in `docs/reference/`; do not paste them here.

## Before coding

1. Read [AGENTS.md](../../../AGENTS.md) safety and invariants.
2. Confirm the ticket is in M1. Do not add `plan` / `run` / `approve` / etc. unless the ticket requires it.
3. Open the matching reference page under `docs/reference/` for the area you touch.

## Module placement

- Prefer an existing folder under `src/` (`cli`, `ports`, `platform`, `config`, `run-state`, `worker-runtime`, …).
- Do not invent a new top-level `src/` directory without a clear seam.
- Keep modules deep: small interface, behaviour behind it ([ports](../../../docs/reference/ports.md) are the outside-system seams).

## Outside systems and Deps

Steps: [Adding a port](../../../docs/reference/recipes.md#adding-a-port).

- New outside system → interface + recording fake in `src/ports/`, then adapters as needed.
- Take `Deps` as a parameter; never reach the real clock, timers, or randomness outside `src/platform/deps.ts`.
- Paths: build with `resolveFactoryPaths` from `src/platform/paths.ts`; no hard-coded home paths.

## CLI shape

Steps: [Adding a CLI command](../../../docs/reference/recipes.md#adding-a-cli-command).

- Register commands through the router; declare positionals/flags in schemas.
- Map failures to `EXIT_CODES` and the `--json` envelope (`exit_code`, `next_command`).
- Human text on stderr when `--json` is set; see [The factory command](../../../docs/reference/cli.md).

## After coding

- Run `npm run typecheck && npm run lint && npm test`.
- If behaviour or CLI surface changed, follow the `factory-docs` skill.
