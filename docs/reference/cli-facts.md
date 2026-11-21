---
title: CLI facts (FAC-4)
description: Evidence-backed CLI facts for Cursor agent and OpenCode.
---

# CLI facts (FAC-4)

This page captures FAC-4 `[M0-3]` facts for `agent` (Cursor) and `opencode` (OpenCode).
Each row has a value and evidence from either:

- exact commands run, or
- fixture fields under `test/fixtures/cli/<cli>/probe.json`.

If something could not be fully proven, it is marked **still open** with a workaround.

## Facts table

**OpenCode provider note (corrected after M0):** OpenCode on the owner's Mac loads the `cursor-acp` plugin, which exposes the Cursor subscription as the `cursor-acp/` provider (174 ids in `opencode models`). `cursor-acp/gpt-5.3-codex-high` is available; `claude-opus-5-5-high` is not (newest Opus there is 4.7). The free `opencode/*` models used in rows 1 to 4 are only part of what OpenCode can run.

| Item | Cursor agent (`agent`) | OpenCode (`opencode`) |
| --- | --- | --- |
| 1) Structured output shape (event types + fields) | `--output-format json` returns one JSON object with fields like `type`, `subtype`, `is_error`, `result`, `session_id`, `request_id`, and `usage`. `--output-format stream-json` supports streaming assistant events and a terminal result event. **Evidence:** `test/fixtures/cli/cursor-agent/probe.json` (`stdout`), `agent --help` (shows `json`/`stream-json` + `--stream-partial-output`), and `curl`-backed Cursor docs via Context7 (`output-format`). | `--format json` returns newline-delimited JSON events: `step_start`, `text`, `step_finish`. Shared top-level fields include `type`, `timestamp`, `sessionID`, `part`; `step_finish.part` carries terminal metadata. **Evidence:** `test/fixtures/cli/opencode/probe.json` (`stdout`) and `opencode run --help` (`--format ... raw JSON events`). |
| 2) Usage/cost fields and streaming timing (NFR-13) | Usage fields observed: `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`. Cost is not reported (`unknown` in fixture). Observed usage appears on terminal result output, i.e. end-of-call, not in partial deltas. **Evidence:** `test/fixtures/cli/cursor-agent/probe.json` (`usage`, `cost`), `test/fixtures/cli/summary.json` (`costByCli.cursor-agent`), live calls `agent -p --mode ask --trust --output-format json ...` and `agent ... --resume ...` (usage present, no cost). | Usage fields observed on `step_finish.part.tokens`: `total`, `input`, `output`, `reasoning`, `cache.read`, `cache.write`; cost on `step_finish.part.cost`. In observed outputs, tokens/cost appear at step end (not in `step_start` or `text`). **Evidence:** `test/fixtures/cli/opencode/probe.json` (`stdout` + `usage` + `cost`) and live calls `opencode run --format json ...` / `opencode run --format json --session ...` (cost/tokens only in `step_finish`). **Cursor models via `cursor-acp/`:** cost is a real USD number (`0.00490775` for one `PROBE_OK` on `cursor-acp/gpt-5.4-nano-none`); tool-call steps report zero tokens and only the final `step_finish` carries tokens. **Evidence:** `test/fixtures/cli/opencode/probe-cursor-acp.json`. |
| 3) Version flag and output (NFR-43) | `--version` flag exists and returns `2026.11.19-f005e9d`. **Evidence:** `agent --help` and `agent --version`. | `--version` flag exists and returns `1.19.5`. **Evidence:** `opencode --help` and `opencode --version`. |
| 4) Session resume support (flag + headless) | Resume flags exist: `--resume [chatId]`, `--continue`; command aliases include `agent resume` and `agent ls`. Headless resume works: same `session_id` is returned when running `-p --mode ask --trust --resume <session_id>`. **Evidence:** `agent --help`, `agent resume --help`, plus live calls in a temp dir outside git. | Resume flags exist: `-c/--continue`, `-s/--session`, optional `--fork`. Headless resume works: `opencode run --format json --session <sessionID> ...` keeps the same `sessionID`. **Evidence:** `opencode run --help` plus live calls in a temp dir outside git. |
| 5) Flags that disable write tools / read-only mode | Read-only modes exist by flag: `--mode ask` and `--mode plan` (both described as read-only/planning). **Evidence:** `agent --help`. | **Still open** for a single `run` flag equivalent to read-only: no explicit `--read-only`/`--no-write` flag in `opencode run --help`. **Workaround:** disable write-capable tools in config (`"tools": { "write": false, "bash": false }`) and/or apply permission policy (`OPENCODE_PERMISSION`). **Evidence:** `opencode run --help`, plus `curl -fsSL https://raw.githubusercontent.com/anomalyco/opencode/dev/services/site/src/docs/v1/content/config.mdx \| rg -n "tools|write|bash"` and `curl .../cli.mdx \| rg -n "OPENCODE_PERMISSION"`. |
| 6) Telemetry settings and opt-out (NFR-27) | **Still open**: no explicit telemetry on/off flag found in local `agent --help`, and no direct telemetry toggle surfaced in fetched Cursor CLI references. **Workaround:** keep to default config and gate outbound traffic externally (proxy/network policy) until a first-party telemetry toggle is documented. **Evidence:** `agent --help` plus Context7 query for Cursor CLI telemetry/config topics. | Telemetry export is opt-in via OTEL env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`, optional headers). If unset, no OTLP export target is configured. Can be turned off by leaving endpoint unset/removing it from env. **Evidence:** `curl -fsSL https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/cli/src/index.ts \| rg -n "OTEL_EXPORTER_OTLP_ENDPOINT|OTEL_EXPORTER_OTLP_HEADERS|Observability\\.layer"`. |
| 7) Image input support for a vision judge (D-6) | **Still open**: no explicit image/file-attach flag in `agent --help`. **Workaround:** place image inside workspace and request analysis in ask mode; treat as unverified until a documented image input path is confirmed. **Evidence:** `agent --help` (no attach/file/image option in top-level flags). | Supported with attachments when model supports image input. CLI accepts file attachments via `--file`; docs state image-capable model is required and provider limits still apply. **Evidence:** `opencode run --help` (`--file`) and `curl -fsSL https://raw.githubusercontent.com/anomalyco/opencode/dev/services/site/src/docs/content/attachments.mdx \| rg -n "image|model|attach"`. |
| 8) Recognising a "high fast" model variant in model list (NFR-45) | Recognise by model ID suffix `-high-fast` (e.g. `gpt-5.3-codex-high-fast`). **Evidence:** `agent models`. | Recognise by model IDs containing `-high-fast` where provider exposes it (e.g. `cursor-acp/gpt-5.3-codex-high-fast`). Also, `--variant high` exists for provider-specific reasoning variants. **Evidence:** `opencode models` and `opencode run --help` (`--variant`). |
| 9) OpenCode-only FR-14 invocation path (custom command/tool/MCP/skill) | N/A | For FR-14 harness-style invocation, `opencode run --command "<cmd>" "<args...>"` is directly supported. Alternative integration paths exist through `opencode mcp` and skill/plugin/config directories, but `--command` is the most direct test hook. **Evidence:** `opencode run --help` (`--command`) and `opencode --help` (`mcp`, `plugin`). |

## Contract tests

FAC-5 adds shared contract tests for adapter parsing with no live CLI calls:

- suite: `test/contract/adapter-contract.test.ts`
- shared assertions: `test/contract/adapter-contract.ts`
- pinned CLI versions: `test/fixtures/cli/pins.json`
- derived per-case fixtures: `test/fixtures/cli/<cli>/cases/*.json` (each file declares `derivedFrom`)
- probe fixtures now store `cliVersion` and `cliVersionSource`
- stale-fixture guard: any fixture version older than the pin fails with `stale fixture`
- test network guard blocks in-process sockets/fetch only; child-process network access is out of scope here

## Live calls used (4/4, plus one `cursor-acp/` probe)

All live calls were run in a `mktemp` directory under `/tmp` (outside any git repo), with prompt `Reply with exactly: OK`.

1. `agent -p --mode ask --trust --output-format json --model gpt-5.4-nano-none "Reply with exactly: OK"`  
   Reported cost: `unknown`; usage present.
2. `agent -p --mode ask --trust --resume <session_id> --output-format json --model gpt-5.4-nano-none "Reply with exactly: OK"`  
   Reported cost: `unknown`; usage present.
3. `opencode run --format json --model opencode/beam-free "Reply with exactly: OK"`  
   Reported cost: `0`.
4. `opencode run --format json --session <sessionID> --model opencode/beam-free "Reply with exactly: OK"`  
   Reported cost: `0`.
5. `cursor-acp/` probe, 21 Nov 2026, in the probe sandbox: `opencode run --format json --model cursor-acp/gpt-5.4-nano-none "Reply with exactly: PROBE_OK"`  
   Succeeded; reported cost: `0.00490775`; 4 steps (3 bridge tool calls, then the answer). Fixture: `test/fixtures/cli/opencode/probe-cursor-acp.json`.
