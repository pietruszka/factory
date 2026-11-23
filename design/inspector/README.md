# Factory Inspector mockups (FAC-32)

First mockups of the read-only inspector that `factory inspect` serves on `127.0.0.1` (PRD FR-13, MVP inspector; see `docs/flow.md` › Run folders and inspect). They were drawn in FigCraft, use the Factory design-system tokens from the landing and docs prototype, and use field names from this repo's event log, run state and run folder docs.

These are design files, not code. They live outside `docs/` on purpose: `docs/` is the VitePress site and these should not be published with it.

## Files

| File | What it shows |
| --- | --- |
| `inspector.figcraft` | FigCraft source, 8 frames on one page. Open it in FigCraft. |
| `inspector.fig` | The same file exported as `.fig` (FigCraft's `.fig` export is experimental). |
| `00-overview.png` | All 8 frames on one sheet. |
| `01-run-list-dark.png` | Run list: one card per run (flow, ticket or PR key, summary, six-lane role strip, status, cost, duration, tokens). Newest first, filters by flow and status. |
| `02-run-detail-timeline.png` | Run detail (FE-145): header totals equal the sum of steps, timeline with one lane per role, steps table with a Σ row. |
| `03-step-detail.png` | Step detail (FE-145 implement #2): request and exact prompt, outputs (diff summary, files), plan slice, time, cost, token split, context window, worker process, identifiers. |
| `04-gate-evidence-mockup-check.png` | Gate evidence (FE-147 verify #3): code gates with command, exit code, item count and evidence path; a gate that checked nothing fails; verifiers; AC-to-test map; mockup-vs-UI with mockup, screenshot, diff overlay and regions. |
| `05-live-run.png` | Live run (FE-148): 1 s polling, a "now" line, cost and wall clock against the caps, worker process (pid, command, start), event log filtered by role, step and type. |
| `06-broken-events-gaps.png` | A run with gaps (FE-131): missing `ended_at`, invalid `payload_json`, DB-vs-files mismatches, an expired prompt. The page stays up and names every gap. |
| `07-run-list-light.png` | The run list in the light theme. |
| `08-status-tokens.png` | The approved status, lane, tier, cost-label and link tokens. |

All PNGs are 1440 px wide at 1x.

## Approved design decisions (Piotr, 2026-11-23)

1. **Status colours** (frame 08):
   - Phases (`preflight` … `opening_pr`): cyan with a live dot.
   - `awaiting_approval`: violet.
   - `passed`: green.
   - `needs_human`: red.
   - `breach`: solid red. It is the only solid badge.
   - `budget`, `timeout`, `cost_missing`, `cannot_reproduce`, `config_drift`: amber.
   - `refused`, `killed`, `interrupted`: neutral.
   - Step statuses: `pending` neutral, `running` cyan, `done` green, `failed` red.
2. **Timeline bars:** agent steps (planner, builder, reviewer) are cyan-tinted. Code steps (router, gates, verifiers) are neutral. Failures are red. Bars are not coloured per role.
3. **Approval wait:** shown as a fixed-width violet band (96 px) with a compressed time axis, so a long human wait does not dwarf the work.
4. **Violet** means human or compare only: the approval wait, approval events, and mockup diff regions. T2 tiers use amber.
5. **Dense tables:** 38–42 px rows, 12–12.5 px JetBrains Mono for values, numbers right-aligned.
6. **Themes:** dark is the default and light sits behind the toggle. In light, pending lanes use `border-strong`.
7. **Background:** the grid and glow sit only in the top 760 px. The noise texture from the site is not rendered in FigCraft.
8. **Links:** the inspector has a fixed default port (shown as `127.0.0.1:4317`). Routes use the hash format `#/FE-123/<step>/<attempt>`, for example `#/FE-145/implement/2` and `#/FE-147/verify/3`.
9. **Lanes:** six lanes (router, planner, builder, gates, verifiers, reviewer). The mockup check and its vision-judge model sit under verifiers.
10. **Cost labels:** cost is always labelled `reported` or `est.` (or `reported + est.`). A partial total gets `≥`. No recorded cost is shown as `–`, never `$0.00`.
11. **Flow F:** the run key is the PR (`PR #213`), and the linked ticket goes in the subtitle.

## Tokens

These are copied from the design prototype's `assets/site.css`. rgba values are written as 8-digit hex (`#RRGGBBAA`).

| Token | Dark | Light |
| --- | --- | --- |
| bg | `#07080B` | `#F4F6FA` |
| bg-2 | `#0C0E13` | `#EAEDF3` |
| panel | `rgba(255,255,255,.035)` = `#FFFFFF09` | `rgba(255,255,255,.72)` = `#FFFFFFB8` |
| panel-2 | `rgba(255,255,255,.065)` = `#FFFFFF11` | `#FFFFFF` |
| border | `rgba(255,255,255,.10)` = `#FFFFFF1A` | `rgba(12,16,28,.13)` = `#0C101C21` |
| border-strong | `rgba(255,255,255,.20)` = `#FFFFFF33` | `rgba(12,16,28,.26)` = `#0C101C42` |
| text | `#EDEFF4` | `#0A0D14` |
| text-2 | `#B7BDCB` | `#2D3445` |
| muted | `#8F97AA` | `#566074` |
| accent | `#3DF5FF` | `#0098A8` |
| accent-ink | `#031417` | `#031417` |
| accent-text | `#3DF5FF` | `#00606B` |
| accent-soft | `rgba(61,245,255,.09)` = `#3DF5FF17` | `rgba(0,152,168,.09)` = `#0098A817` |
| accent-border | `rgba(61,245,255,.34)` = `#3DF5FF57` | `rgba(0,120,134,.45)` = `#00788673` |
| violet | `#8B5CFF` | `#6B3DE0` |
| violet-text | `#B9A4FF` | `#5A2FCB` |
| violet-soft | `rgba(139,92,255,.15)` = `#8B5CFF26` | `rgba(107,61,224,.09)` = `#6B3DE017` |
| violet-border | `rgba(139,92,255,.42)` = `#8B5CFF6B` | `rgba(107,61,224,.40)` = `#6B3DE066` |
| ok / ok-soft | `#4ADE9A` / `#4ADE9A1C` | `#0E7A46` / `#0E7A461A` |
| warn / warn-soft | `#F5C451` / `#F5C4511C` | `#855500` / `#B074001F` |
| err / err-soft | `#FF7A88` / `#FF7A881C` | `#B01E35` / `#B01E3517` |
| badge border (ok, warn, err) | the state colour at 40% (`…66`) | the state colour at 40% (`…66`) |
| code-bg | `#090B10` | `#EEF1F6` |
| code-text | `#D7DBE6` | `#1A2030` |
| syn comment / string / key / accent | `#7C8499` / `#9DF2C4` / `#B9A4FF` / `#3DF5FF` | `#5F687C` / `#0B6B3E` / `#5A2FCB` / `#00606B` |
| grid | `rgba(255,255,255,.04)` = `#FFFFFF0A`, 56 px | `rgba(12,16,28,.055)` = `#0C101C0E`, 56 px |
| glow-a / glow-b | `#3DF5FF21` / `#8B5CFF29` | `#00BECD29` / `#6B3DE021` |
| shadow | `0 24px 70px -28px rgba(0,0,0,.85)` | `0 22px 50px -26px rgba(20,30,60,.35)` |
| primary button | bg `#3DF5FF`, text `#031417` | the same |

Type, sizes and radii:
- **Fonts:** JetBrains Mono for keys, labels, numbers, code and badges. Inter for text.
- **Labels:** 11 px Medium uppercase, letter-spacing 0.08em, muted. Kicker: 12 px, 0.12em, accent-text.
- **Sizes:** page title 34 px Semi Bold; key title 28 px mono Bold; section 16 px Semi Bold; body 14–16 px; code 12.5 px with 20–21 px line height.
- **Radii:** panels 16, cards and stat tiles 14, tables, code and callouts 12, chips and inputs 8, badges full pill (24 px high, 22 px in tables).
- **Top bar:** 56 px, bg at 78%, 1 px bottom border.
- **Callouts:** 3 px left bar in the tone colour on its soft fill.

## Real data vs sample data

**Real**, from this repo at FAC-28 (`3c3e0b8`):
- **Run statuses:** the 20 `runs.status` values and the legal phase order.
- **Tables:**
  - `steps` columns: step, attempt, role, model, purpose, status, exit_reason, input_hash, cli_session_id, started_at, ended_at.
  - `events` token and cost columns: input, output, cache read, cache write, reasoning, `cost_usd`, `usage_source` reported or estimated, `context_used`, `context_window`, `payload_json`.
  - `check_rows`, `processes` (pid, command, started_at) and `approvals` (plan_hash, approver, client).
- **Event types:** `run_status`, `loop`, `usage`, `preflight`, `started`, `output`, `retention_cleaned`, `draft_pr`.
- **Run folder:** `prompts/<step>.md`, `evidence/diff.patch`, `evidence/gates/`, `verify/`, `report.md`.
- **Retention:** `factory clean` removes prompts, `ticket.json` and evidence 30 days after `ended_at`.
- **Gates:** the config keys `gates.lint`, `typecheck`, `test`, `build`, `e2e`.
- **Caps:** A $5/30 min, E $6/45 min, F and H $2/15 min.
- **Models:** `gpt-5.3-codex-high` (planner, builder) and `claude-opus-5-5-high` (reviewer, visionJudge).
- **Inspector config:** `inspector.host 127.0.0.1`, and `openEventLogReadOnly` for the inspector.
- **Other:** `factory status` cost rules (sum of `cost_usd`, `-` when nothing is recorded), and the repo name `example-frontend`.

**Sample**, made up for the mockups:
- Ticket keys and titles, PR numbers, every cost, token count, time and pid.
- The step names `ac_tests`, `repro_test` and `verify`, and the event types `route` and `approval`.
- Port `4317`. Config `inspector.port` still defaults to `0`, a random port.
- The "Need you" tiles, the dev "Baselines" nav item, and the mockup images.

**Not in the repo yet:**
- The inspector itself.
- `factory run`, `plan` and `approve`.
- The router, real gates and verifiers, the reviewer and mockup-vs-UI.
- Router, gates and verifiers as roles. `MODEL_ROLES` is only planner, builder, reviewer and visionJudge.

There is also a cost gap. `gpt-5.3-codex-high` has no price in `src/cost/price-table.ts`, so real Cursor runs need a `rate_table` entry, or they end as `cost_missing`.

## Editing

The mockups are edited directly in `inspector.figcraft` with FigCraft (the app or its MCP server). PNGs are exported from that file.

`.figcraft` and `.fig` files are zip archives. To keep git from diffing them as text, add these lines to `.gitattributes`:

```text
design/inspector/*.figcraft binary
design/inspector/*.fig binary
```
