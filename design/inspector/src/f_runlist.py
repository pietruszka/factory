from lib import *

# lane statuses: router, planner, builder, gates, verifiers, reviewer
# d=done f=failed r=running p=pending s=skipped w=awaiting human
RUNS = [
 dict(key="FE-148", flow="A", tier="T1", st="building", title="Show a due-date chip on each todo row", started="17:02", ago="9m",
      lanes="ddrppp", loops=0, cost="$1.42", src="est. · so far", dur="9m 12s", tin="412k", tout="38k", note="implement #1 · live", pr=None),
 dict(key="FE-147", flow="A", tier="T1", st="needs_human", title="Empty state when a filter has no todos", started="15:31", ago="1h",
      lanes="dddddf", loops=2, cost="$4.62", src="reported", dur="27m 05s", tin="1.31M", tout="96k", note="mockup-vs-UI · loops 2/2", pr=None, lanes_fail=4),
 dict(key="FE-146", flow="E", tier="T1", st="passed", title="Completed todos reappear after the back button", started="14:02", ago="3h",
      lanes="dddddd", loops=0, cost="$2.18", src="reported", dur="14m 51s", tin="702k", tout="48k", note="draft PR #214", pr="#214"),
 dict(key="PR #213", flow="F", tier="T1", st="passed", title="Review: bulk delete for selected todos", ticket="FE-140", started="12:40", ago="4h",
      lanes="dsssd d", loops=0, cost="$0.92", src="reported", dur="6m 30s", tin="288k", tout="21k", note="review.md drafted", pr=None),
 dict(key="FE-145", flow="A", tier="T1", st="passed", title="Filter tabs keep URL state on reload", started="11:05", ago="6h",
      lanes="dddddd", loops=1, cost="$2.86", src="reported + est.", dur="18m 40s", tin="845k", tout="61k", note="PR #212 · 1 fix loop", pr="#212"),
 dict(key="FE-144", flow="H", tier="T0", st="passed", title="Bump vitest 3.2.1 → 3.2.4 (dev dependency)", started="10:20", ago="7h",
      lanes="dddddd", loops=0, cost="$0.41", src="reported", dur="4m 02s", tin="96k", tout="7k", note="draft PR #211", pr="#211"),
 dict(key="FE-143", flow="A", tier="T1", st="awaiting_approval", title="Undo toast after deleting a todo", started="09:48", ago="7h",
      lanes="dwpppp", loops=0, cost="$0.38", src="reported", dur="3m 10s", tin="171k", tout="12k", note="waiting for plan approval", pr=None),
 dict(key="FE-142", flow=None, tier="T2", st="refused", title="Upgrade react 19 → 20", started="Fri 16:12", ago="3d",
      lanes="fsssss", loops=0, cost="–", src="no agent call", dur="2s", tin="–", tout="–", note="major version bump is T2", pr=None),
 dict(key="FE-139", flow="E", tier="T1", st="budget", title="Optimistic toggle rollback flickers on API error", started="Fri 11:30", ago="3d",
      lanes="ddfppp", loops=1, cost="$6.00", src="reported", dur="38m 14s", tin="2.02M", tout="141k", note="cap $6.00 reached", pr=None),
 dict(key="FE-137", flow="A", tier="T1", st="breach", title="Rename todo `done` field to `completed`", started="Thu 15:02", ago="4d",
      lanes="ddfsss", loops=0, cost="$1.07", src="reported", dur="8m 41s", tin="330k", tout="27k", note="edited tests/frozen/**", pr=None),
]
LANES = ["router", "planner", "builder", "gates", "verify", "review"]

def lane_strip(f, x, y, lanes, fail_idx=None):
    t = TH
    lanes = lanes.replace(" ", "")
    for i, c in enumerate(lanes[:6]):
        sx = x + i * 52
        col = {"d": t["ok"], "f": t["err"], "r": t["accent"], "p": t["borderS"], "s": t["border"], "w": t["violet"]}[c]
        if c == "s":
            R(f, sx, y, 48, 6, "none", t["borderS"], 3, dashes=[2, 2], name="lane skipped")
        elif c == "p":
            R(f, sx, y, 48, 6, t["panel2"], t["borderS"] if t["name"] == "light" else t["border"], 3, name="lane pending")
        else:
            n = R(f, sx, y, 48, 6, col if c != "d" else mixa(t["ok"], 70), None, 3, name=f"lane {LANES[i]} {c}")
            if c == "r": glow(n, mixa(t["accent"], 80), 8)
        M(f, sx, y + 11, LANES[i], 10, t["muted"] if c in "ps" else t["text2"])

def runlist(ox, oy, theme, name):
    use(theme)
    t = TH
    H = 1500
    f = frame(ox, oy, W, H, name)
    background(f, W, H)
    topbar(f, "127.0.0.1:4317/#/runs?flow=all&status=all", "Runs")
    # header
    M(f, 32, 92, "INSPECTOR · READ-ONLY", 12, t["accentText"], "Medium", ls=1.44)
    T(f, 32, 114, "Runs", 34, t["text"], SANS, "Semi Bold", ls=-0.8)
    T(f, 32, 162, "Every run in ~/.factory/factory.db and runs/, newest first. Nothing here changes a run, a file, a PR or Jira.", 16, t["text2"])
    # summary tiles
    sx = W - 32 - 3 * 178 - 2 * 12
    stat(f, sx, 92, 178, 92, "Active", "1", "building · FE-148", t["accentText"])
    stat(f, sx + 190, 92, 178, 92, "Need you", "3", "stopped 2 · plan 1", t["err"] if t["name"] == "dark" else t["err"])
    stat(f, sx + 380, 92, 178, 92, "10 runs · 7 days", "$19.86", "reported + est.")
    # filters
    fy = 216
    label(f, 32, fy + 9, "Flow")
    x = 80
    for s, on, cnt in [("All", True, 10), ("A", False, 5), ("E", False, 2), ("F", False, 1), ("H", False, 1)]:
        x += chip(f, x, fy, s, on, count=cnt, mono=s != "All") + 6
    x += 22
    label(f, x, fy + 9, "Status"); x += 64
    for s, kind, on, cnt in [("All", None, True, None), ("active", "accent", False, 1), ("approval", "violet", False, 1),
                             ("passed", "ok", False, 4), ("needs_human", "err", False, 1), ("stopped", "warn", False, 2), ("refused", "neutral", False, 1)]:
        x += chip(f, x, fy, s, on, count=cnt, mono=s != "All", kind=kind) + 6
    # search
    R(f, W - 32 - 220, fy, 220, 30, t["panel"], t["borderS"], 8, name="search")
    V(f, W - 32 - 220 + 12, fy + 9, 12, 12, "M5 0a5 5 0 1 1 0 10a5 5 0 1 1 0-10zM8.6 8.6L12 12", t["muted"], 1.4, name="search icon")
    LT(f, W - 32 - 220 + 32, fy, 30, "Ticket or PR…", 13, t["muted"])
    R(f, W - 32 - 26, fy + 6, 18, 18, t["panel"], t["borderS"], 5); LT(f, W - 32 - 26, fy + 6, 18, "/", 11, t["text2"], MONO, w=18, align="center")
    # column header
    hy = 272
    cols = [(32 + 20, "Run"), (32 + 560, "Role lanes"), (32 + 892, "Status")]
    for cx, s in cols:
        label(f, cx, hy, s)
    for xr, s in [(32 + 1180, "Cost"), (32 + 1268, "Duration"), (32 + 1352, "Tokens")]:
        label(f, xr - tw(s.upper(), 11, MONO) - 0.88 * len(s), hy, s)
    # cards
    y = 296
    for i, r in enumerate(RUNS):
        h = 100
        sel = r["key"] == "FE-145"
        n = panel(f, 32, y, W - 64, h, 14, name=f"run card {r['key']}", strong=False)
        if r["st"] in ("building",):
            R(f, 32, y, W - 64, h, "none", t["accentBorder"], 14, name="live border")
        cx = 32 + 20
        flow_tile(f, cx, y + 20, r["flow"])
        M(f, cx + 6, y + 66, r["tier"], 11, t["warn"] if r["tier"] == "T2" else t["muted"], "Medium")
        tx = cx + 56
        M(f, tx, y + 18, r["key"], 15, t["text"], "Bold")
        M(f, tx + tw(r["key"], 15, MONO) + 10, y + 21, "example-frontend", 12, t["muted"])
        T(f, tx, y + 42, fit(r["title"], 15, 440), 15, t["text2"], SANS, "Medium")
        meta = f"started {r['started']} · {r['ago']} ago" + (f" · PR {r['pr']}" if r["pr"] else "")
        M(f, tx, y + 68, meta, 12, t["muted"])
        if r.get("ticket"):
            M(f, tx + tw(meta, 12, MONO), y + 68, " · ticket ", 12, t["muted"]); M(f, tx + tw(meta + " · ticket ", 12, MONO), y + 68, r["ticket"], 12, t["accentText"], "Medium")
        lane_strip(f, 32 + 560, y + 38, r["lanes"])
        if r["loops"]:
            M(f, 32 + 560, y + 16, f"fix loops {r['loops']}/2", 11, t["warn"] if r["loops"] == 2 else t["text2"], "Medium")
        sbadge(f, 32 + 892, y + 22, r["st"])
        T(f, 32 + 892, y + 56, fit(r["note"], 12, 180, MONO), 12, t["err"] if r["st"] in ("needs_human", "breach") else t["muted"], MONO)
        def rm(xr, yy, s, size, col, wt="Regular"): M(f, xr - tw(s, size, MONO), yy, s, size, col, wt)
        rm(32 + 1180, y + 22, r["cost"], 15, t["text"], "Medium")
        rm(32 + 1180, y + 46, r["src"], 11, t["muted"])
        rm(32 + 1268, y + 22, r["dur"], 15, t["text"], "Medium")
        rm(32 + 1352, y + 22, r["tin"], 15, t["text"], "Medium")
        rm(32 + 1352, y + 46, "out " + r["tout"], 11, t["muted"])
        y += h + 10
    # footer
    R(f, 0, H - 56, W, 1, t["border"])
    M(f, 32, H - 38, "Showing 10 of 10 runs · factory 0.3.0 · factory.db schema v1 · 127.0.0.1:4317 (default port) · polling every 1 s", 12, t["muted"])
    M(f, W - 32 - tw("No buttons here change runs, files, PRs or Jira.", 12, MONO), H - 38, "No buttons here change runs, files, PRs or Jira.", 12, t["muted"])
    return f
