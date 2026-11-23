from lib import *
from timeline import timeline, fmt_d, LANES
G = "gpt-5.3-codex-high"; C = "claude-opus-5-5-high"
FE145 = [
 dict(id="preflight", role="router", start=0, end=6, st="done", below="preflight 6s · route 3s → A · T1", purpose="Node, git, config hash, models", cost=None),
 dict(id="route", role="router", start=6, end=9, st="done", below="", purpose="label story + 2 testable ACs → A, T1", cost=None),
 dict(id="plan", role="planner", model=G, start=10, end=140, st="done", ctx=.38, cost=.42, src="rep", tin="168.2k", tout="12.4k", purpose="Write plan.md from the context pack"),
 dict(id="ac_tests", role="planner", model=G, start=392, end=470, st="done", ctx=.29, cost=.28, src="est", tin="92.0k", tout="7.9k", purpose="Frozen AC tests before the build", below="ac_tests · 1m 18s"),
 dict(id="implement", att=1, showatt=True, role="builder", model=G, start=475, end=760, st="done", ctx=.54, cost=.96, src="rep", tin="301.4k", tout="22.1k", purpose="Implement the plan in the worktree"),
 dict(id="gates", att=1, showatt=True, role="gates", start=762, end=815, st="failed", below="✗ gates #1 · typecheck exit 2", purpose="lint, typecheck, test, build", cost=None),
 dict(id="implement", att=2, role="builder", model=G, start=818, end=940, st="done", ctx=.61, cost=.47, src="est", tin="158.2k", tout="9.8k", purpose="Fix loop 1: TS2322 in useFilterParam", below="implement #2 · 2m 02s"),
 dict(id="gates", att=2, role="gates", start=942, end=1000, st="done", below="gates #2 · 4/4 green", purpose="lint, typecheck, test, build", cost=None),
 dict(id="verify", role="verifiers", start=1002, end=1040, st="done", below="verify · 5 pass · 1 skipped", purpose="5 pass · mockup check skipped", cost=None),
 dict(id="review", role="reviewer", model=C, start=1042, end=1100, st="done", ctx=.47, cost=.73, src="rep", tin="125.6k", tout="8.8k", purpose="Diff vs plan and ACs: approve", below="review · claude-opus-5-5-high · 58s · approve"),
]
WAIT145 = [(140, 392)]

def header(f, key, title, badges, meta, url, crumbs_=None, y=76):
    t = TH
    crumbs(f, y, crumbs_ or ["Runs", key])
    M(f, 32, y + 30, key, 28, t["text"], "Bold")
    T(f, 32 + tw(key, 28, MONO) + 16, y + 33, title, 24, t["text"], SANS, "Semi Bold", ls=-0.4)
    bx = 32; by = y + 78
    for b in badges:
        if b[0] == "status": bx += sbadge(f, bx, by, b[1], text=b[2] if len(b) > 2 else None) + 8
        else: bx += badge(f, bx, by, b[1], b[0]) + 8
    mx = bx + 8
    for k, v, c in meta:
        M(f, mx, by + 4, k, 12, t["muted"]); mx += tw(k, 12, MONO) + 6
        M(f, mx, by + 4, v, 12, c or t["text2"], "Medium"); mx += tw(v, 12, MONO) + 18

def detail(ox, oy, theme, name):
    use(theme); t = TH
    H = 1430
    f = frame(ox, oy, W, H, name)
    background(f, W, H)
    topbar(f, "127.0.0.1:4317/#/FE-145", "Runs")
    header(f, "FE-145", "Filter tabs keep URL state on reload",
           [("neutral", "flow A"), ("accent", "T1"), ("status", "passed")],
           [("repo", "example-frontend", None), ("run", "run-01JDQ7H3ZK", None), ("base", "4e1c9a2", None),
            ("config", "sha256:7be0…c41d", None), ("PR", "#212 draft ↗", t["accentText"])], "")
    tabs(f, 196, [("Timeline", None), ("Steps", 10), ("Gates & verifiers", 11), ("Event log", 64), ("Files", 7)], "Timeline")
    # totals
    y = 258; n = 6; gap = 12; sw = (W - 64 - gap * (n - 1)) / n
    tiles = [("Cost", "$2.86", "$2.11 reported + $0.75 est"), ("Duration", "18m 40s", "incl. 4m 12s approval wait"),
             ("Tokens in", "845.2k", "cache read 2.14M"), ("Tokens out", "61.0k", "reasoning 18.3k"),
             ("Fix loops", "1 / 2", "gates: typecheck"), ("Steps", "10", "Σ steps = header totals ✓")]
    for i, (l, v, s) in enumerate(tiles):
        stat(f, 32 + i * (sw + gap), y, sw, 96, l, v, s, subcolor=t["ok"] if s.endswith("✓") else None)
    # timeline
    y = 374
    h, X = timeline(f, 32, y, W - 64, FE145, 1120, WAIT145, sub="1 lane per role · 0 → 18m 40s")
    # PR marker
    px = X(1120) - 1
    R(f, px - 6, y + 64 + 28 + 8, 6, 24, t["okSoft"], mixa(t["ok"], 60), 3, name="open_pr")
    T(f, px - 132, y + 64 + 28 + 13, "open_pr → PR #212", 11, t["ok"], MONO, "Medium", w=120, align="right")
    # steps table
    y = y + h + 24
    T(f, 32, y, "Steps", 16, t["text"], SANS, "Semi Bold")
    M(f, 32 + 58, y + 3, "attempts in order · sums match the header", 12, t["muted"])
    y += 32
    cols = [("Step", 150, "left"), ("Role", 96, "left"), ("Model", 176, "left"), ("Start", 100, "right"), ("Duration", 98, "right"),
            ("Cost", 144, "right"), ("In / out", 140, "right"), ("Context", 96, "right"), ("Status", 116, "left"), ("Purpose", 260, "left")]
    rows = []
    for s in FE145:
        att = f" #{s.get('att',1)}" if s.get("showatt") or s.get("att", 1) > 1 else ""
        cost = f"${s['cost']:.2f}" + (" est." if s.get("src") == "est" else " reported") if s.get("cost") is not None else "–"
        rows.append([dict(t=s["id"] + att, mono=True, wt="Medium"), dict(t=s["role"], c=t["text2"]),
                     dict(t=s.get("model", "code"), mono=True, s=12, c=t["text2"] if s.get("model") else t["muted"]),
                     dict(t=f"+{fmt_d(s['start'])}" if s['start'] else "0s", mono=True, s=12, c=t["muted"]),
                     dict(t=fmt_d(s["end"] - s["start"]), mono=True, s=12.5),
                     dict(t=cost, mono=True, s=12.5, c=t["text"] if s.get("cost") else t["muted"]),
                     dict(t=f"{s['tin']} / {s['tout']}" if s.get("tin") else "–", mono=True, s=12, c=t["text2"] if s.get("tin") else t["muted"]),
                     dict(t=f"{int(s['ctx']*100)}%" if s.get("ctx") else "–", mono=True, s=12, c=t["text2"] if s.get("ctx") else t["muted"]),
                     dict(badge=s["st"]), dict(t=s["purpose"], s=13, c=t["text2"])])
    rows.append([dict(t="Σ 10 steps", mono=True, wt="Bold"), dict(t=""), dict(t="2 models · 1 human gate", s=12, c=t["muted"]), dict(t=""),
                 dict(t="18m 40s", mono=True, wt="Bold", s=12.5), dict(t="$2.86 rep.+est.", mono=True, wt="Bold", s=12.5),
                 dict(t="845.2k / 61.0k", mono=True, wt="Bold", s=12), dict(t=""), dict(t=""), dict(t="approval 4m 12s · piotr via cli", s=13, c=t["violetText"])])
    table(f, 32, y, cols, rows, rh=40)
    return f
