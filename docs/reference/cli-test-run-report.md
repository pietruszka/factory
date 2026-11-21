---
title: CLI test run report (FAC-8)
description: M0 report for Cursor agent and OpenCode covering CLI facts, contract suite, model ids, reconfirmed decisions and live spend.
---

# CLI test run report (FAC-8)

This page is the FAC-8 `[M0-7]` report for the first milestone (M0, the CLI test run).
It pulls together what FAC-3 to FAC-7 recorded for the two CLIs in scope:
Cursor agent (`agent`) and OpenCode (`opencode`).
Copilot CLI is not part of M0. Its items are listed at the end and handed to the Copilot CLI follow-up.

Status: **reviewed and merged; M0 is done.** Corrected after merge: OpenCode reaches Cursor's models through the `cursor-acp/` provider (see [OpenCode via `cursor-acp/`](#opencode-via-cursor-acp)).

## Summary

| | Cursor agent (`agent`) | OpenCode (`opencode`) |
| --- | --- | --- |
| Pinned version | `2026.11.19-f005e9d` | `1.19.5` |
| Structured output | `--output-format json`: one final result object (`stream-json` also exists) | `--format json`: newline-delimited events `step_start`, `text`, `step_finish` |
| Usage fields | `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` | `tokens.total`, `input`, `output`, `reasoning`, `cache.read`, `cache.write` |
| Cost field | none: cost is not reported by the CLI | `step_finish.part.cost` (real USD for `cursor-acp/` models, `0` for free models) |
| Usage timing (NFR-13) | end of call only (terminal result) | end of step only (`step_finish`) |
| Version flag (NFR-43) | `--version` | `--version` |
| Headless session resume | yes: `--resume <session_id>` keeps the same id | yes: `--session <sessionID>` keeps the same id |
| Read-only mode | yes: `--mode ask` or `--mode plan` | no flag; workaround in config (see below) |
| Telemetry (NFR-27) | **still open**, workaround recorded | opt-in only via `OTEL_EXPORTER_OTLP_ENDPOINT`; off when unset |
| Image input (D-6) | **still open**, workaround recorded | yes: `--file` with an image-capable model |
| "high fast" variants (NFR-45) | ids ending `-high-fast` in `agent models` | ids containing `-high-fast` in `opencode models` |
| Global skills | **still open**, workaround recorded | loaded from `~/.agents/skills/<name>/SKILL.md` (`opencode debug skill`) |
| Models | `agent models` (Cursor subscription) | free `opencode/*` models plus 174 Cursor models via the `cursor-acp/` provider |
| L2 contract suite | 19 of 19 passed | 19 of 19 passed, plus 2 `cursor-acp/` cases |
| Live spend | not reported by the CLI; a one-line probe on a nano model, far below $1 | $0.0049 reported by the CLI ($0 free-model runs plus one `cursor-acp/` probe) |

Full evidence for each fact (commands, docs and fixture fields) is on [CLI facts (FAC-4)](/reference/cli-facts).

## 1. CLI facts (M0-3, FAC-4)

### Cursor agent

- **Output:** `--output-format json` returns one JSON object with `type`, `subtype`, `is_error`, `result`, `session_id`, `request_id` and `usage`.
- **Usage:** `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`. No cost field. Usage arrives on the terminal result, not in partial output.
- **Version:** `agent --version` prints `2026.11.19-f005e9d`.
- **Resume:** `--resume [chatId]` and `--continue`; headless resume returns the same `session_id`.
- **Read-only:** `--mode ask` and `--mode plan`.
- **Fast variants:** model ids ending in `-high-fast`, for example `gpt-5.3-codex-high-fast`. Preflight rejects them.

### OpenCode

- **Output:** `--format json` prints `step_start`, `text` and `step_finish` events with `type`, `timestamp`, `sessionID` and `part`.
- **Usage and cost:** on `step_finish.part.tokens` and `step_finish.part.cost`, only at step end.
- **Version:** `opencode --version` prints `1.19.5`.
- **Resume:** `-c/--continue`, `-s/--session`, optional `--fork`; headless resume keeps the same `sessionID`.
- **Telemetry:** OTLP export only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- **Image input:** `--file` attachments, with an image-capable model.
- **FR-14 invocation:** `opencode run --command "<cmd>" "<args...>"`.
- **Global skills:** `opencode debug skill` lists skills from `~/.agents/skills/<name>/SKILL.md` (checked locally on 21 Nov 2026, no model call).

### OpenCode via `cursor-acp/`

The owner's OpenCode loads the `cursor-acp` plugin, which exposes the Cursor subscription as a provider. `opencode models` lists 174 `cursor-acp/` ids (checked 21 Nov 2026, no model call).

- **Builder and planner model: available.** `cursor-acp/gpt-5.3-codex-high` is listed, so OpenCode can plan or build on the same model as Cursor agent.
- **Reviewer model: not available.** There is no `cursor-acp/claude-opus-5-5-high`; the newest Opus through `cursor-acp/` is 4.7. The reviewer stays on Cursor agent (D-37).
- **Fast variants come through too** (for example `cursor-acp/gpt-5.3-codex-high-fast`). Preflight strips the provider prefix before the family and fast checks, so these are rejected.
- **Probe, 21 Nov 2026** (`opencode run --format json --model cursor-acp/gpt-5.4-nano-none "Reply with exactly: PROBE_OK"`, sandbox cwd, redacted fixture `test/fixtures/cli/opencode/probe-cursor-acp.json`):
  - succeeded, exit 0, final text `PROBE_OK`, about 33 s;
  - same NDJSON event types as free models, but **4 steps**: the bridge first emitted three `write` tool calls (`text` with tool-call JSON, then `tool_use`, then `step_finish` with reason `tool-calls` and zero tokens), then a final step with the answer;
  - tokens are reported only on the final `step_finish` (24,495 input, 7 output, no cache);
  - **cost is reported by the CLI** as a real number: `0.00490775` USD, so no price-table estimate is needed for `cursor-acp/` models;
  - `sessionID` is present on every event; resume was not re-tested on `cursor-acp/` (it uses the same `--session` flag as the free-model check).
- **Two adapter consequences**, both fixed in the follow-up PR: the result text is now the last step's text (not the tool-call JSON of earlier steps), and the probe sets `PWD` to the sandbox, because the bridge resolved the relative tool path against the inherited `PWD` and wrote a file into the directory the probe was started from (removed after the run).

### Still open, with workarounds

| Item | CLI | Status | Workaround |
| --- | --- | --- | --- |
| Telemetry opt-out (NFR-27) | Cursor agent | Still open: no telemetry flag in `agent --help` and none found in the CLI docs | Keep the default config and control outbound traffic outside the CLI (proxy or network policy) until a documented switch exists |
| Headless image input (D-6) | Cursor agent | Still open: no attach, file or image flag in `agent --help` | Vision judge CLI stays `null` in the model config (see [Model IDs by role](/reference/models)); OpenCode's `--file` is the known working path when an image-capable model is available |
| Read-only flag | OpenCode | No `--read-only` flag in `opencode run --help` | Disable write tools in config (`"tools": { "write": false, "bash": false }`) and/or set a permission policy with `OPENCODE_PERMISSION`; the pipeline's write-scope diff check still applies |
| Paid models | OpenCode | **Closed (corrected):** `opencode auth list` shows 0 provider credentials, but the `cursor-acp` plugin gives OpenCode the Cursor subscription models (`cursor-acp/…`, 174 ids). A live `cursor-acp/gpt-5.4-nano-none` probe succeeded and reported cost | Use `cursor-acp/` ids for paid roles; Opus 5.5 is not listed there, so the reviewer stays on Cursor agent |
| Tool side effects outside the sandbox | OpenCode via `cursor-acp/` | The bridge may call write tools even on a one-line prompt, resolving paths against `PWD` | Always set `PWD` to the sandbox cwd (done in the probe runner); the pipeline's write-scope diff check still applies |
| Global skill loading | Cursor agent | Not checked: `agent` has no command that lists loaded skills, and checking it needs a model call | The factory command is the entry point either way; confirm the Cursor path when the front-door skill is built (FR-28) |

## 2. L2 contract suite (M0-4, FAC-5)

Command: `npm test` (Vitest, no live CLI calls; a network guard blocks in-process sockets and fetch).

| Scope | Result |
| --- | --- |
| Whole repo | 12 test files, 121 tests, all passed at M0 sign-off (134 after the `cursor-acp/` follow-up) |
| Adapter contract suite (`test/contract/adapter-contract.test.ts`) | 38 shared tests, all passed: 19 for `cursor-agent`, 19 for `opencode`; plus 2 `cursor-acp/` cases added after M0 |

Each CLI runs the same shared cases, including the real probe fixture, success, malformed JSON, missing cost (`cost_missing`), timeout, non-zero exit, empty output, session id present and absent, and the stale-fixture guard against the versions pinned in `test/fixtures/cli/pins.json`.
Derived fixtures: 7 per CLI under `test/fixtures/cli/<cli>/cases/`.

## 3. Model ids by role (M0-5, FAC-6)

Source: `src/config/models.ts` (`DEFAULT_MODELS`) and [Model IDs by role](/reference/models).

| Role | CLI | Model id | Family | Note |
| --- | --- | --- | --- | --- |
| planner | `cursor-agent` | `gpt-5.3-codex-high` | gpt | |
| builder | `cursor-agent` | `gpt-5.3-codex-high` | gpt | |
| reviewer | `cursor-agent` | `claude-opus-5-5-high` | claude | Temporary per D-37 until the Copilot CLI follow-up passes |
| visionJudge | `null` | `claude-opus-5-5-high` | claude | No CLI yet: Cursor agent has no headless image input |

`npm run preflight` checks that the roles exist, that no id is a fast variant, that the families are split correctly, and that every configured id is in that CLI's list (`agent models`, or `opencode models` for `cursor-acp/` ids). It passed against the real model list in FAC-6.

Prices: `claude-opus-5-5-high` has a price from [cursor.com/docs/models](https://cursor.com/docs/models). `gpt-5.3-codex-high` has no published price there, so planner and builder costs stay `cost_missing` until a price is found or those roles move to a priced model.

## 4. P-1, P-2 and P-8 (M0-6, FAC-7)

Recorded as D-38 in the Architecture and decisions log.

| Item | Outcome |
| --- | --- |
| P-1 schema library | Zod kept (`zod` in `package.json`); it already validates both CLIs' step results and the model config |
| P-2 SQLite driver | Node's built-in synchronous `node:sqlite` (`DatabaseSync`); `engines.node` raised to `>=22.13` so it needs no flag |
| P-8 install method | Package built from this repo and linked with `npm link` as the global `factory` command |

## 5. Live spend

Read from `test/fixtures/cli/cursor-agent/probe.json`, `test/fixtures/cli/opencode/probe.json` and `test/fixtures/cli/summary.json`.

| Run | CLI and model | Reported cost |
| --- | --- | --- |
| FAC-3 probe, 20 Nov 2026 (`Reply with exactly: PROBE_OK`) | Cursor agent, `gpt-5.4-nano-none` | Not reported by the CLI (`"cost": "unknown"`); 13,709 input and 7 output tokens |
| FAC-3 probe, 20 Nov 2026 | OpenCode, `opencode/beam-free` | `0` |
| FAC-4 fact checks (2 per CLI: one call and one resume, listed on [CLI facts](/reference/cli-facts)) | Same models as the probe | Cursor: not reported; OpenCode: `0` |
| FAC-6 preflight | `agent models` (lists models, no model call) | Nothing to spend |
| `cursor-acp/` probe, 21 Nov 2026 (`Reply with exactly: PROBE_OK`) | OpenCode, `cursor-acp/gpt-5.4-nano-none` | `0.00490775` (reported by the CLI); 24,495 input and 7 output tokens |

`summary.json`: `totalReportedCostUsd: 0`, with `cursor-agent` listed as unknown.

**Total live spend:** OpenCode $0.0049 (all from the `cursor-acp/` probe; free-model runs were $0). Cursor agent: not reported by the CLI; one-line prompts on a nano model, far below $1. Every run stayed at or below the $1 cap (D-30). No dollar figure is estimated for Cursor here, because the nano model has no price in the price table.

## 6. Handed to the Copilot CLI follow-up

Copilot CLI is not installed and was not tested in M0 (D-24). These items stay open and move to the Copilot CLI follow-up, which is a dependency of the M5 release gate (D-29), not of M0:

- structured output, usage fields and whether usage streams, version flag, session resume, write-tool flags, telemetry and fast-variant naming for Copilot CLI
- `--usage-output-file`, `totalNanoAiu` and the USD conversion
- how Copilot CLI loads a global skill
- image input for the vision judge on Copilot CLI
- the reviewer's final model id; until then the reviewer stays on Cursor agent (D-37)
