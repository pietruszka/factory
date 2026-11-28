# Reviewer context

Domain words are in [GLOSSARY.md](GLOSSARY.md). This file is what a reviewer checks. It is not the product-runtime instructions in [docs/flow.md](docs/flow.md).

## What this repo is

A TypeScript `factory` CLI. M1 is the foundation: `status`, `kill`, `resume`, `clean`, `dev-init`, `dev-approve`, plus platform and ports. [docs/flow.md](docs/flow.md) is the product requirements. It is not a map of the code.

## Invariants

- Throwaway factory home only. `FACTORY_HOME` must be a `.factory-dev-home`. Never the real `~/.factory`, its private sibling, or a real work repo. See [docs/agent-runbook.md](docs/agent-runbook.md).
- Outside systems, including a new process call, go through a port in [src/ports/](src/ports/). Tests use the recording fakes.
- Clock, timers, ids and randomness come from `Deps` in [src/platform/deps.ts](src/platform/deps.ts). Nothing else under `src/` calls `Date.now`, `new Date()`, timers, `Math.random` or `randomUUID`.
- A failure is a `FactoryError` from [src/platform/errors.ts](src/platform/errors.ts): `code`, `message`, `where`, `next`, `exitCode`. Exit 2 is refused. Exit 4 is internal. Breach is exit 3.
- `--json` prints one envelope with `exit_code` and `next_command`. See [docs/reference/cli.md](docs/reference/cli.md).

## What reviewers check

- Tests name behaviour. A test that measures source size, line count or file length does not count.
- The real-home ban holds. Tests and docs stay on a throwaway home and do not point the factory at a real one.
- A new process call or other outside system goes through a port, and time goes through `Deps`.
- A new failure uses the `FactoryError` contract: a stable `code`, where it happened, and a next action.
- A behaviour or CLI change updates the matching page under [docs/reference/](docs/reference/), and [docs/index.md](docs/index.md) and [docs/architecture.md](docs/architecture.md) stay honest about what is in the tree.
