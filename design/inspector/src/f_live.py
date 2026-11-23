from lib import *
from f_detail import header
from timeline import timeline
G = "gpt-5.3-codex-high"
FE148 = [
 dict(id="preflight", role="router", start=0, end=5, st="done", below="preflight · route → A · T1"),
 dict(id="route", role="router", start=5, end=8, st="done", below=""),
 dict(id="plan", role="planner", model=G, start=9, end=121, st="done", ctx=.34),
 dict(id="ac_tests", role="planner", model=G, start=300, end=371, st="done", ctx=.27, below="ac_tests · 1m 11s"),
 dict(id="implement", att=1, showatt=True, role="builder", model=G, start=374, end=None, st="running", ctx=.48),
]

def evlog(f, y, rows, title="Event log", sub=None, filters=True):
    t = TH
    T(f, 32, y, title, 16, t["text"], SANS, "Semi Bold")
    if sub: M(f, 32 + tw(title, 16, weight="Semi Bold") + 12, y + 3, sub, 12, t["muted"])
    y += 32
    if filters:
        x = 32
        label(f, x, y + 9, "Role"); x += 46
        for s, on in [("all", True), ("router", False), ("planner", False), ("builder", False), ("gates", False), ("verifiers", False), ("reviewer", False)]:
            x += chip(f, x, y, s, on, mono=True) + 6
        x += 18
        label(f, x, y + 9, "Step"); x += 46
        R(f, x, y, 170, 30, t["panel"], t["borderS"], 8); LT(f, x + 12, y, 30, "all steps", 13, t["text2"], MONO); M(f, x + 150, y + 7, "▾", 12, t["muted"]); x += 182
        label(f, x, y + 9, "Type"); x += 46
        R(f, x, y, 170, 30, t["panel"], t["borderS"], 8); LT(f, x + 12, y, 30, "all types", 13, t["text2"], MONO); M(f, x + 150, y + 7, "▾", 12, t["muted"]); x += 182
        R(f, W - 32 - 16 - tw("follow newest", 13) - 10, y + 7, 16, 16, t["accent"], None, 4); M(f, W - 32 - 16 - tw("follow newest", 13) - 10 + 3, y + 7, "✓", 12, t["accentInk"], "Bold")
        LT(f, W - 32 - tw("follow newest", 13), y, 30, "follow newest", 13, t["text2"])
        y += 44
    cols = [("#", 70, "right"), ("Time", 96, "left"), ("Step", 138, "left"), ("Role", 96, "left"), ("Type", 124, "left"), ("Status", 116, "left"),
            ("Tokens in / out", 150, "right"), ("Cost", 136, "right"), ("Detail", 450, "left")]
    out = []
    for r in rows:
        idn, tm, stp, role, typ, st, tok, cost, det = r[:9]
        hl = r[9] if len(r) > 9 else None
        out.append([dict(t=str(idn), mono=True, s=12, c=t["muted"]), dict(t=tm, mono=True, s=12, c=t["text2"]),
                    dict(t=stp, mono=True, s=12, wt="Medium"), dict(t=role, s=13, c=t["text2"]), dict(t=typ, mono=True, s=12, c=t["violetText"] if typ == "approval" else t["text2"]),
                    dict(badge=st) if st else dict(t="–", mono=True, c=t["muted"]), dict(t=tok, mono=True, s=12, c=t["text2"] if tok != "–" else t["muted"]),
                    dict(t=cost, mono=True, s=12, c=t["text"] if cost != "–" else t["muted"]), dict(t=det, s=13, c=hl or t["text2"])])
    return y + table(f, 32, y, cols, out, rh=38) - y + 0, y

def live(ox, oy, theme, name):
    use(theme); t = TH
    H = 1440
    f = frame(ox, oy, W, H, name)
    background(f, W, H)
    topbar(f, "127.0.0.1:4317/#/FE-148", "Runs")
    header(f, "FE-148", "Show a due-date chip on each todo row",
           [("neutral", "flow A"), ("accent", "T1"), ("status", "building")],
           [("repo", "example-frontend", None), ("run", "run-01JDXF2M8Q", None), ("base", "b71d0e9", None)], "")
    # live indicator (right of title)
    lw = 330; lx = W - 32 - lw
    R(f, lx, 108, lw, 34, t["accentSoft"], t["accentBorder"], 17, name="live pill")
    d = E(f, lx + 14, 122, 7, 7, t["accent"]); glow(d, mixa(t["accent"], 90), 10)
    LT(f, lx + 30, 108, 34, "live · polling 1 s · last event 2 s ago", 12.5, t["accentText"], MONO, "Medium")
    tabs(f, 196, [("Timeline", None), ("Steps", 5), ("Gates & verifiers", 0), ("Event log", 41), ("Files", 3)], "Timeline")
    # caps + process
    y = 258
    sw = 260
    def capcard(x, lab, val, cap, frac, sub):
        panel(f, x, y, sw, 112, 14, name=f"cap {lab}")
        label(f, x + 16, y + 14, lab)
        M(f, x + 16, y + 34, val, 22, t["text"], "Medium"); M(f, x + 16 + tw(val, 22, MONO) + 8, y + 42, cap, 12, t["muted"])
        if frac is not None: R(f, x + 16, y + 74, sw - 32, 5, t["panel2"], None, 2.5); R(f, x + 16, y + 74, (sw - 32) * (frac or 0), 5, t["warn"] if (frac or 0) > .8 else t["accent"], None, 2.5)
        M(f, x + 16, y + 88, sub, 11.5, t["muted"])
    capcard(32, "Cost vs cap", "$1.42", "of $5.00", 1.42 / 5, "est. so far · 28% · caps.A.usd")
    capcard(32 + sw + 12, "Wall clock vs cap", "9m 12s", "of 30m", 552 / 1800, "31% · caps.A.minutes")
    capcard(32 + 2 * (sw + 12), "Tokens so far", "412k", "in · 38k out", None, "cache read 1.02M")
    px = 32 + 3 * (sw + 12); pw = W - 32 - px
    panel(f, px, y, pw, 112, 14, name="process", strong=True)
    label(f, px + 16, y + 14, "Worker process")
    sbadge(f, px + pw - 16 - 98, y + 10, "running")
    for i, (k, v) in enumerate([("pid", "51877"), ("started", "17:08:28"), ("step", "implement #1")]):
        M(f, px + 16 + i * 150, y + 38, k, 11.5, t["muted"]); M(f, px + 16 + i * 150, y + 54, v, 13.5, t["text"], "Medium")
    R(f, px + 16, y + 80, pw - 32, 22, t["codeBg"], t["border"], 6)
    LT(f, px + 26, y + 80, 22, fit("$ cursor-agent -p --output-format stream-json --model gpt-5.3-codex-high --cwd ~/.factory/worktrees/…", 11, pw - 52, MONO), 11, t["codeText"], MONO)
    y += 112 + 20
    h, X = timeline(f, 32, y, W - 64, FE148, 720, [(121, 300)], now=552, sub="0 → 12m · axis grows while the run is live")
    # remaining area hint
    y += h + 28
    rows = [
     (5512, "17:11:24", "implement #1", "builder", "output", "running", "–", "–", "edited src/components/TodoRow.tsx (+22 −3)", t["text"]),
     (5511, "17:11:09", "implement #1", "builder", "output", "running", "–", "–", "ran npm test -- TodoRow · exit 1 · 1 failing"),
     (5508, "17:10:02", "implement #1", "builder", "output", "running", "–", "–", "read src/features/todos/types.ts"),
     (5503, "17:08:28", "implement #1", "builder", "started", "running", "–", "–", "process pid 51877 · cli_session_id e41b…09"),
     (5502, "17:08:25", "ac_tests", "planner", "usage", "done", "92.4k / 6.1k", "$0.21 est.", "2 frozen tests written to tests/frozen/"),
     (5498, "17:07:14", "–", "–", "run_status", None, "–", "–", "awaiting_approval → building"),
     (5497, "17:07:14", "–", "–", "approval", None, "–", "–", "plan sha256:51ab…d3 · approver piotr · client cli", t["violetText"]),
     (5490, "17:04:15", "plan", "planner", "usage", "done", "168.9k / 11.7k", "$0.38 reported", "plan.md written · 3 ACs · 4 allowed paths"),
     (5489, "17:04:15", "–", "–", "run_status", None, "–", "–", "planning → awaiting_approval"),
     (5480, "17:02:22", "route", "router", "route", "done", "–", "–", "A · T1 · rule: label story, 3 testable ACs"),
     (5478, "17:02:19", "preflight", "router", "preflight", "done", "–", "–", "6 checks ok · config sha256:7be0…c41d"),
    ]
    evlog(f, y, rows, sub="41 events · newest first · new rows slide in at the top")
    return f
