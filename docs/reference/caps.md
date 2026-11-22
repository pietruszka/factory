---
title: Caps and cost (FAC-22)
description: Per-run dollar and wall-clock caps, cap_usd_effective, summing across attempts, reported and estimated cost, cost_missing, budget and timeout stops, the next action, and what is deferred.
---

# Caps and cost (FAC-22)

A run has a dollar cap and a wall-clock cap. The factory sums what a run has spent across all attempts and stops the run when a cap is reached. The code is `src/cost/`, with a hook in `src/run-state/`. It is a library: there is no new `factory` command. `runSteps` (see [Run state](/reference/run-state)) takes an optional `cost` argument; without it, steps run as before.

## Defaults and override

The caps come from `config.caps[flow]` (see [Factory config](/reference/factory-config)). This ticket uses them; it does not change them.

| Flow | Dollars | Minutes |
| --- | --- | --- |
| `A` | 5 | 30 |
| `E` | 6 | 45 |
| `F`, `H` | 2 | 15 |

A per-repo file replaces a flow's values for that repo only; other repos keep the defaults. `flowCaps(config.caps, flow)` returns `{ usd, minutes }`. An unknown flow is `unknown_flow`.

## cap_usd_effective

`startRun(context, input, { caps })` stores `runs.cap_usd_effective` from the flow's `usd`. When the input already sets `cap_usd_effective`, that value is kept; this is how a later resume can use a raised cap. Without `caps`, nothing is stored and the run has no dollar cap. The wall-clock cap is not stored: the caller passes the flow's `minutes` in `cost.minutes`.

## Summing

`checkCaps({ ...context, runId, minutes })` compares the run with its caps and returns `within`, `budget` or `timeout`.

- **Cost** is the sum of `events.cost_usd` for the run, over every attempt. An event with no `cost_usd` adds nothing; an absent field is never counted as zero.
- **Wall-clock** is the injected clock (`Deps.now()`) minus `runs.started_at`. It includes a recorded `worktree_install` interval. Install time counts toward the time cap, not toward model cost.
- A cap counts as reached when the value is equal to it.

## Reported and estimated cost

After each step, `normaliseUsage` produces the dollar figure and flags it. `runSteps` writes it as an `events` row of type `usage` with `cost_usd` and `usage_source`.

| `usage_source` | When |
| --- | --- |
| `reported` | The CLI reported a numeric cost. A reported `0` (for example a free model) is a reported zero. |
| `estimated` | No reported cost, but reported tokens that the config `rate_table` can price. |

Estimates use the merged config `rate_table`, not the built-in table used by the adapter tests. The factory does not invent a price: a model with no entry, or a null rate for a token kind that was used, cannot be priced. The caps enforce on whichever figure was produced. The run report (see [Run folder](/reference/run-folder)) keeps splitting the two totals.

## cost_missing

`cost.expectedUsage` lists the fields the runtime must report: `tokens` (any token count) and `cost` (a numeric dollar figure). Cursor and the default estimate path expect `tokens`; OpenCode, when declared, expects `cost`. Copilot CLI is not covered.

A successful step ends as `cost_missing` when:

- an expected field is absent, or
- tokens were reported but cannot be priced.

The step is checkpointed `failed` with `exit_reason` `cost_missing`, the run moves to `cost_missing` through `transition`, and no `cost_usd` is written for the absence. Tokens that were reported and can be priced are an estimate, not `cost_missing`.

## Budget and timeout

Caps are checked before and after each step, so the last step is checked too.

- Summed cost at or over `cap_usd_effective` stops the run as `budget`.
- Elapsed wall-clock at or over the flow's minutes stops the run as `timeout`.

The worktree is never removed. A step's `timeoutMs` is tightened to the wall-clock left in the run, so a hang cannot run past the cap by more than the step timeout. A step stopped for time is killed with `Spawner.killTree`, which sends SIGKILL.

## Next action

Each cap or `cost_missing` stop writes an `events` row of type `run_stop` whose payload has a `next` text. While the run's status is still that stop, `writeReport` prints it under `## Next action`.

- **Budget:** the amount spent and the cap, and that resuming needs an explicit cap, for example `factory resume FE-123 --cap +$2`.
- **Timeout:** the elapsed minutes, for example `30 min`, and `factory resume FE-123`.
- **cost_missing:** the step and the fields that were missing.

The `factory resume` command and its `--cap` flag are not built yet (see below); the text names the command the later ticket adds.

## Deferred

- **Turn caps.** No Page gives a default turn count, so no turn cap is enforced and there is no `caps.<flow>.turns` key.
- **Live usage streaming.** Caps are enforced at step end. The CLIs report usage only at step end, so nothing is checked mid-step; the wall-clock check still catches a hang.
- The `factory resume` command and `--cap` (FAC-24), the rate-table age warning (FAC-26), Copilot CLI and the Admin API.
