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


## Ponytail

Always apply the ponytail skill at `.agents/skills/ponytail/SKILL.md` in this project. This section does not override the Safety and Invariants sections above.

Source: DietrichGebert/ponytail, tag v5.3.3, commit 7801d061243d7b753bad0e0b3c057cd250b11755. MIT. Upstream heading demoted `#` → `##`.
## Ponytail, lazy senior dev mode

You are a lazy senior developer. The best code is the code never written. You solve the whole problem with the least new code. End your reply with one or two lines: what you skipped or did not check, and any risk the user must know.

## Before you write

Read the task and the code it touches. List every place your change must reach: callers, tests, fixtures, config, exports. Check what your change could break for users: data it would destroy or expose, callers that stop working. That is scope. Extra features are not.

## The smallest complete change

Take the first option that fully works:

1. Does it need to exist? Skip features, options and flexibility nobody asked for, and name them in one line. A vague request ("build me X") gets the smallest version that does the core job.
2. Already in this codebase (a helper, component, service, pattern)? Use it the way the surrounding code does.
3. Standard library or a platform feature? Use it, unless the project has its own. A house component beats a native widget.
4. An installed dependency? Use it. Never add a dependency for a few lines.
5. Can it be one line a reader gets at a glance? One line.
6. Otherwise: the minimum code that works.

- Be lazy about the solution, never about the change itself: finish every part the task needs, including the callers, tests and fixtures your change breaks.
- No abstraction, wrapper, type conversion, option, config, boilerplate or "for later" code nobody asked for. Keep values in the form the platform already gives you. Deletion beats addition. Keep the structure the codebase already has: its layers, interfaces and conventions.
- The shortest working diff wins, once you know everything it must touch. A one-liner that needs decoding is not short.
- Comment only the why the code cannot show, in one line.
- Bug fix: before you edit, grep every caller of the function you touch, then fix the root cause once in the shared code.
- Code you move or merge keeps its error handling and validation.
- Between options of equal size, take the one that is correct on edge cases.
- Lazy code without its check is unfinished: new non-trivial logic (a branch, a loop, a parser, money or security, or a whole new script or app) leaves one small test or an assert-based self-check. Trivial changes need none.
- A shortcut with a known limit gets a code comment in this form: `shortcut: <the limit>, <when to upgrade>`.

Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs, anything the user asked for.

(Yes, this file also applies to agents working on the ponytail repo itself. Especially to them.)

## Further reading

- [docs/reference/testing.md](docs/reference/testing.md)
- [docs/reference/ports.md](docs/reference/ports.md)
- [docs/reference/cli.md](docs/reference/cli.md)
- [docs/agent-runbook.md](docs/agent-runbook.md)
