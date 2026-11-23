---
title: factory status
description: What factory status lists - active and recent runs, the text and JSON formats, stale rows that are display-only, the default of 10 recent runs, and the empty list when there is no event log.
---

# factory status

`factory status [ticket] [--json]` lists the active and the recent runs in the [event log](/reference/event-log). It only reads. The library is `listRuns` in `src/status/list-runs.ts` and the command is a thin wrapper in `src/cli/status.ts`. See [The factory command](/reference/cli#factory-status-ticket) for the arguments and error codes.

## Read-only

- The event log is opened with the read-only open (`openEventLogReadOnly`). It creates no file, loosens no mode and does not migrate.
- `status` never calls `markStaleRuns`, `transition`, `killRun` or `resumeRun`, and sends no signal to any pid.
- It skips the git check, runs no preflight, starts no worker CLI and makes no network call, so it answers at once. It needs no checkout and no repo config.

## Which runs

- **Active runs come first.** A run is active when its stored status is a phase: `preflight`, `routing`, `planning`, `awaiting_approval`, `building`, `gating`, `verifying`, `reviewing` or `opening_pr`. Every active run is listed, however many there are.
- **Recent runs follow.** Every other run (`passed` and all stop statuses, `interrupted` and `killed` included) counts as recent. The newest last event comes first, and the default is **10**. There is no flag to change it yet.
- With a ticket, only the runs of that ticket are listed, in every repo, in the same order. The 10 recent runs are counted among those runs.

## Text format

One header line, then one line per run, in the order above. The columns are:

| Column | Meaning |
| --- | --- |
| `TICKET` | The ticket key, for example `FE-123`. |
| `REPO` | The repo name. |
| `FLOW` | The flow the run was routed to. |
| `STATUS` | The stored status. A stale run adds ` (stale)`. |
| `STEP` | The current step, or `-` when the run has no steps yet. |
| `COST` | Dollars (at least two decimals) and `reported` or `estimated`, or `-` when no event has a cost. |
| `LAST EVENT` | Time since the latest event of the run, in the largest whole unit: `45s`, `5m`, `2h`, `1d`, then ` ago`. |

```text
TICKET  REPO              FLOW  STATUS    STEP       COST             LAST EVENT
FE-123  example-frontend  B     building  implement  -                5m ago
FE-101  example-frontend  A     passed    prepare    $0.75 reported   2h ago
FE-102  example-frontend  C     budget    implement  $1.50 estimated  1d ago
```

When there is nothing to list, the text is `No runs recorded.` (or `No runs of FE-123 recorded.`) and the exit code is 0.

### Current step

The current step follows the latest attempt of each step, as `isStepDone` does ([Run state](/reference/run-state)): it is the first step whose latest attempt is not `done`, in the order the steps were first recorded. When every step's latest attempt is `done`, it is the last of them. A run with no `steps` rows has none. An older `done` attempt never hides a newer attempt of the same step that is still open or failed. Step ids are whatever the `steps` table holds.

### Cost

The cost is the sum of `events.cost_usd` of the run. It is `estimated` when any event that contributes to it is not `reported`, and `reported` when every one is, a genuine `$0.00` included. A run with no `cost_usd` on any event shows `-`, and `cost_usd` and `cost_source` are left out of its JSON row: the figure is never a silent zero.

## JSON

With `--json`, the [envelope](/reference/cli#json) carries `data`:

```json
{
  "schema_version": 1,
  "rows": [
    {
      "run_id": "run-123",
      "ticket": "FE-123",
      "repo": "example-frontend",
      "flow": "B",
      "status": "building",
      "current_step": "implement",
      "last_event_at": "2026-03-01T11:55:00.000Z",
      "elapsed_ms": 300000,
      "stale": false
    },
    {
      "run_id": "run-101",
      "ticket": "FE-101",
      "repo": "example-frontend",
      "flow": "A",
      "status": "passed",
      "current_step": "prepare",
      "cost_usd": 0.75,
      "cost_source": "reported",
      "last_event_at": "2026-03-01T10:00:00.000Z",
      "elapsed_ms": 7200000,
      "stale": false
    }
  ]
}
```

`data` parses against `StatusDocumentSchema` (`src/status/list-runs.ts`). Its rows are the same rows, in the same order, as the text.

| Field | Type | Meaning |
| --- | --- | --- |
| `schema_version` | `1` | The version of this document. |
| `rows[].run_id`, `ticket`, `repo`, `flow` | string | Identity of the run. |
| `rows[].status` | string | The stored status. |
| `rows[].current_step` | string or null | See above. |
| `rows[].cost_usd` | number | Present only when an event has a cost. |
| `rows[].cost_source` | `reported` or `estimated` | Present with `cost_usd`. |
| `rows[].last_event_at` | ISO text | `started_at` of the latest event of the run (the run's own `started_at` when it has no event). |
| `rows[].elapsed_ms` | number | `Deps.now()` minus `last_event_at`, in milliseconds. |
| `rows[].stale` | boolean | See below. |

## Stale rows are display-only

A run whose stored status is a phase is marked stale (`"stale": true`, and ` (stale)` after the status in text) when it has no live process: every process row without an `ended_at` is gone or now runs another command (`ProcessTable.stillMatches` is false for it), or the run has no such row at all. A phase run with at least one still-matching process is not stale. A finished run is never stale.

Marking is **display only**. `status` does not write `interrupted`, does not end process rows and does not touch the run folder: the stored status stays the phase it was in. `markStaleRuns` is the code that moves such a run to `interrupted`; `status` does not call it.

A run that is only just starting (for example in `preflight` before it records a process) has no process row yet and shows as stale for that moment.

## Disk use

`status` also measures disk use and shows it below the table: bytes for the worktrees, the runs and the db, and a total. A ticket filter does not change it. Measuring reads file sizes and writes nothing. In `--json`, `data.disk` carries `worktrees`, `runs`, `db` and `total`, plus a `warning` when the total is above 10 GiB; the warning does not change the exit code. See [factory clean](/reference/clean#disk-use).

## No event log

When `factory.db` does not exist, `status` prints an empty list and exits 0 (`{ "schema_version": 1, "rows": [] }` with `--json`, with no `disk`). It creates no home, no database and no run folder. A file with an older or newer schema is refused with `db_schema_older` or `db_schema_newer` (exit 4) and is not changed.

## Not covered

Step detail and live process views are for the inspector. `status` has no limit flag and no way to list more than the 10 most recent finished runs.
