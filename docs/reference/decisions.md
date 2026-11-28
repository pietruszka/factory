---
title: Decision index (FAC-57)
description: One line for each D-, P-, NFR- and ADR- number cited in docs, src and AGENTS.md. The numbers are never changed.
---

# Decision index (FAC-57)

Every `D-`, `P-`, `NFR-` and `ADR-` number cited under `docs/`, `src/` or `AGENTS.md` is listed once. A number is never changed, reused or reassigned. The line is what this repo says when it cites that number. The decision text itself is on [Architecture](/architecture) and the PRD, [End-to-end flow](/flow).

| Number | Cited as | Pages |
| --- | --- | --- |
| ADR-007 | At most two runs may be active at once. A second is allowed only when its paths cannot overlap the first. There is no queue. | [Architecture](/architecture), [End-to-end flow](/flow) |
| ADR-014 | A worktree goes 7 days after the merge or the abandon. Large artifacts go 30 days after the run ended. | [Architecture](/architecture), [End-to-end flow](/flow) |
| D-6 | Headless image input on Cursor agent is still open. | [Architecture](/architecture), [End-to-end flow](/flow) |
| D-15 | The private sibling of a factory home is `<home>-private`, next to the home. | [Architecture](/architecture), [End-to-end flow](/flow) |
| D-17 | The checkout may hold the sample fixture zip and its pack inputs, not an unpacked sample tree. Cited together with D-19. | [Architecture](/architecture), [End-to-end flow](/flow) |
| D-18 | `dev-approve` writes only in a throwaway factory home. | [Architecture](/architecture), [End-to-end flow](/flow) |
| D-19 | The same narrowing as D-17. The repo cites them as one rule and adds no separate number. | [Architecture](/architecture), [End-to-end flow](/flow) |
| D-24 | Copilot CLI was not installed and was not tested in M0. | [Architecture](/architecture), [End-to-end flow](/flow) |
| D-29 | The Copilot CLI follow-up is a dependency of the M5 release gate, not of M0. | [Architecture](/architecture), [End-to-end flow](/flow) |
| D-30 | The M0 probe stayed at or below the $1 cap. | [Architecture](/architecture), [End-to-end flow](/flow) |
| D-37 | The reviewer stays on Cursor agent until the Copilot CLI follow-up passes. | [Architecture](/architecture), [End-to-end flow](/flow) |
| D-38 | The oldest supported Node is 22.13. This number also records the P-1, P-2 and P-8 choices. | [Architecture](/architecture), [End-to-end flow](/flow) |
| D-39 | Worktrees and the sandbox live under the cache root. Documents, Desktop and Downloads are refused. Which worktree mode OpenCode needs is still open. | [Architecture](/architecture), [End-to-end flow](/flow) |
| NFR-1 | Creating or removing a worktree leaves the work repo's working tree, index and branches unchanged. | [Architecture](/architecture), [End-to-end flow](/flow) |
| NFR-2 | The work repo gets no factory branch and no leftover worktree metadata. | [Architecture](/architecture), [End-to-end flow](/flow) |
| NFR-13 | Usage and cost are reported at the end of the call or the step, not in partial output. | [Architecture](/architecture), [End-to-end flow](/flow) |
| NFR-17 | Disk use of the factory home warns above 10 GiB and never refuses on that warning. | [Architecture](/architecture), [End-to-end flow](/flow) |
| NFR-20 | A command that must answer at once skips the git check. | [Architecture](/architecture), [End-to-end flow](/flow) |
| NFR-21 | A run that would overlap another is refused. There is no queue. | [Architecture](/architecture), [End-to-end flow](/flow) |
| NFR-23 | A run can pass only when that flow's required report paths are on disk. | [Architecture](/architecture), [End-to-end flow](/flow) |
| NFR-27 | Cursor telemetry opt-out is still open. OpenCode exports only when the OTEL endpoint is set. | [Architecture](/architecture), [End-to-end flow](/flow) |
| NFR-33 | Code under `src/` must not hard-code a user-home path. | [Architecture](/architecture), [End-to-end flow](/flow) |
| NFR-39 | `--json` prints one document, the CLI envelope. | [Architecture](/architecture), [End-to-end flow](/flow) |
| NFR-43 | `--version` prints the tool version. | [Architecture](/architecture), [End-to-end flow](/flow) |
| NFR-44 | Preflight stays inside 5 seconds by doing no network and no install, not by a timing test. | [Architecture](/architecture), [End-to-end flow](/flow) |
| NFR-45 | A model id that contains `-high-fast` is refused, and preflight checks the role model gates. | [Architecture](/architecture), [End-to-end flow](/flow) |
| NFR-46 | A worktree install records `started_at` and `ended_at` from `Deps`. | [Architecture](/architecture), [End-to-end flow](/flow) |
| P-1 | The schema library is Zod. | [Architecture](/architecture), [End-to-end flow](/flow) |
| P-2 | The SQLite driver is Node's built-in `node:sqlite`. | [Architecture](/architecture), [End-to-end flow](/flow) |
| P-4 | Event-log tables are append-only. A raw update or delete is refused. | [Architecture](/architecture), [End-to-end flow](/flow) |
| P-5 | There is no queue when a run cannot start. | [Architecture](/architecture), [End-to-end flow](/flow) |
| P-8 | The install method is `npm link` of the package built from this repo. | [Architecture](/architecture), [End-to-end flow](/flow) |
| P-9 | `--json` is one envelope, with `exit_code` and `next_command`. | [Architecture](/architecture), [End-to-end flow](/flow) |
| P-14 | Clock, timers, ids and randomness go through `Deps`. | [Architecture](/architecture), [End-to-end flow](/flow) |
| P-22 | Resuming a live Cursor, OpenCode or Copilot session is not in this tree. | [Architecture](/architecture), [End-to-end flow](/flow) |
| P-23 | Exit codes are 0 ok, 1 needs attention, 2 refused, 3 breach, 4 internal. | [Architecture](/architecture), [End-to-end flow](/flow) |
