# AGENTS.md

Instructions for coding agents working **on this repository**. This is not the product-runtime `AGENTS.md` described in [docs/flow.md](docs/flow.md).

## What this repo is

- A TypeScript `factory` CLI. M1 foundation is in progress: status, kill, resume, clean, `dev-init`, `dev-approve`, plus platform/ports underneath.
- Product requirements: [docs/flow.md](docs/flow.md). Do not treat that page as a map of implemented code.
- Do not invent or implement non-M1 commands (`plan`, `run`, `approve`, `revise`, `outcome`, `inspect`, `review`, `baseline`, `compare`) unless the ticket says so.

## Map

| Area | Path |
| --- | --- |
| CLI entry and commands | `src/cli/` |
| Outside-system ports + recording fakes | `src/ports/` |
| Clock / ids (`Deps`), paths, errors | `src/platform/` |
| Config, event log, run folder, run state | `src/config/`, `src/event-log/`, `src/run-folder/`, `src/run-state/` |
| Worker runtime, adapters, worktree, write-scope, cost | matching folders under `src/` |
| Tests | `test/` (L3 under `test/l3/`) |
| Docs (VitePress, base `/factory/`) | `docs/` |
| Project agent skills | `.agents/skills/` |

## Safety (non-negotiable)

- Use a throwaway factory home only (`FACTORY_HOME` with `.factory-dev-home`). Never the real `~/.factory`, private sibling, or a real work repo.
- Never call live `gh` or `acli`. Never open tickets or PRs on a live host from factory code or tests.
- Never start live model CLIs (`agent`, `cursor-agent`, `opencode`) from tests; use `test/support/fake-cli.ts` and the scripted fake worker.
- Sandbox debugging surfaces and stop limits: [docs/agent-runbook.md](docs/agent-runbook.md).

## Invariants

- Inject `Deps` from `src/platform/deps.ts`. Do not call `Date.now`, `new Date()`, timers, or `Math.random` / `randomUUID` outside `src/platform/deps.ts` (ESLint enforces this).
- Reach outside systems only through `src/ports/`. Tests use recording fakes; see [docs/reference/ports.md](docs/reference/ports.md).
- Exit codes: `0` ok, `1` needs attention, `2` refused / bad usage, `3` breach, `4` internal (`src/cli/exit-codes.ts`).
- Machine output: `--json` envelope with `exit_code` and `next_command` ([docs/reference/cli.md](docs/reference/cli.md)).

## Definition of done

1. `npm run typecheck && npm run lint && npm test`
2. If CLI surface or behaviour changed, update the matching page under `docs/reference/` and keep overview “current state” honest ([docs/index.md](docs/index.md), [docs/architecture.md](docs/architecture.md)).

## Skills

Use the project skills under `.agents/skills/` when they match the task:

- `factory-change` — modules, ports, CLI shape
- `factory-test` — isolation, fakes, L3
- `factory-docs` — VitePress sync

## Further reading

- [docs/reference/testing.md](docs/reference/testing.md)
- [docs/reference/ports.md](docs/reference/ports.md)
- [docs/reference/cli.md](docs/reference/cli.md)
- [docs/agent-runbook.md](docs/agent-runbook.md)
