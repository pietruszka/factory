---
name: factory-docs
description: >-
  Update factory VitePress docs when CLI surface, behaviour, or repo layout
  changes. Use when editing docs/, fixing stale current-state text, or keeping
  architecture in sync with src/.
---

# factory-docs

Keep the published site honest. Site `base` is `/factory/`.

## When to update

Any user-visible or CLI/behaviour change → update the matching page under `docs/reference/`. Overview pages must not claim a smaller surface than [The factory command](../../../docs/reference/cli.md).

## Rules

- Document what is in the tree. Do not document [End-to-end flow](../../../docs/flow.md) requirements as if they were implemented.
- Do not invent M1 commands that are not in the CLI reference / agent runbook.
- Prefer editing the canonical reference page over duplicating tables in guides.
- After adding agent instructions, point architecture / README at `AGENTS.md` and `.agents/skills/`.

## Usual touch points

| Change | Update |
| --- | --- |
| New or changed `factory` command | `docs/reference/cli.md` + command-specific page if any |
| Ports / fakes | `docs/reference/ports.md` |
| Test isolation / L3 | `docs/reference/testing.md` |
| Tree / contributor entry | `docs/architecture.md`, `docs/index.md` “Current state”, `README.md` |
| Sandbox agent loop | `docs/agent-runbook.md` |

## Check

- `npm run docs:build` when you change VitePress-facing pages.
- Open links relative to `/factory/` in local preview.
