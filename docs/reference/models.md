---
title: Model IDs by role (FAC-6)
description: FAC-6 model selection by role, preflight gates, and price-table provenance.
---

# Model IDs by role (FAC-6)

This page captures FAC-6 `[M0-5]` for home-level `config.yaml` `models:` defaults and preflight rules.

## Decision table

| Role | CLI | Model ID | Family | Temporary | Note |
| --- | --- | --- | --- | --- | --- |
| planner | `cursor-agent` | `gpt-5.3-codex-high` | `gpt` | no | baseline |
| builder | `cursor-agent` | `gpt-5.3-codex-high` | `gpt` | no | baseline |
| reviewer | `cursor-agent` | `claude-opus-5-5-high` | `claude` | yes | TEMPORARY per D-37 until Copilot CLI follow-up passes |
| visionJudge | `null` | `claude-opus-5-5-high` | `claude` | no | still open: Cursor agent has no headless image input path yet; see [CLI facts (FAC-4)](/reference/cli-facts) |

## Preflight gates (NFR-45)

`npm run preflight` validates:

- required roles exist: `planner`, `builder`, `reviewer`, `visionJudge`
- no disallowed fast variants (`-high-fast` and any ID ending in `-fast`)
- planner and builder are same family
- reviewer and vision judge are same family
- reviewer/vision judge family differs from planner/builder family
- each configured CLI is in the usage-reporting allowlist (`cursor-agent`, `opencode`) based on [CLI facts (FAC-4)](/reference/cli-facts) row 2
- each non-null CLI model ID exists in that CLI's model list (`agent models` parsing `id - name`; `opencode models` parsing one `provider/model` id per line)
- provider prefixes such as `cursor-acp/` are stripped before the family and fast checks, so `cursor-acp/gpt-5.3-codex-high-fast` is rejected and `cursor-acp/claude-…` derives `claude`

When any check fails, preflight exits non-zero and prints each violation.

## OpenCode with Cursor models (`cursor-acp/`)

OpenCode reaches the Cursor subscription through the `cursor-acp/` provider. Availability checked with `opencode models` on 2026-11-21:

| Role model | Via Cursor agent | Via OpenCode (`cursor-acp/`) |
| --- | --- | --- |
| `gpt-5.3-codex-high` (planner, builder) | yes | yes: `cursor-acp/gpt-5.3-codex-high` |
| `claude-opus-5-5-high` (reviewer, vision judge) | yes | no: newest Opus via `cursor-acp/` is 4.7 |

The defaults above are unchanged. For `cursor-acp/` models OpenCode reports a real cost on `step_finish.part.cost`, so no price-table estimate is used for them (probe result on [CLI test run report](/reference/cli-test-run-report#opencode-via-cursor-acp)).

## Cost estimate sources

`src/cost/price-table.ts` stores token prices per 1M tokens and source metadata.

| Model ID | Input | Cache write | Cache read | Output | Source | Date | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `claude-opus-5-5-high` | 4 | 5 | 0.2 | 20 | [cursor.com/docs/models](https://cursor.com/docs/models) (`Claude Opus 5.5` row) | 2026-11-21 | known |
| `gpt-5.3-codex-high` | unknown | unknown | unknown | unknown | [cursor.com/docs/models](https://cursor.com/docs/models) (exact ID not listed) | 2026-11-21 | unknown |

If a model price is unknown, `estimateCost` returns `unknown` and adapters keep `cost: "cost_missing"`.  
If a model price is known and CLI usage tokens are present, adapters can fill cost with an estimate and mark `estimated: true`.
