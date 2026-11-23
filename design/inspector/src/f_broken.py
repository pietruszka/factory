from lib import *
from f_detail import header
from timeline import timeline
G = "gpt-5.3-codex-high"
FE131 = [
 dict(id="preflight", role="router", start=0, end=5, st="done", below="preflight · route → E · T1"),
 dict(id="route", role="router", start=5, end=8, st="done", below=""),
 dict(id="plan", role="planner", model=G, start=9, end=160, st="done", ctx=.41),
 dict(id="repro_test", role="planner", model=G, start=520, end=760, st="done", ctx=.36),
 dict(id="implement", att=1, showatt=True, role="builder", model=G, start=762, end=None, end_draw=1880, st="done", below="implement #1 · gpt-5.3-codex-high · ? no ended_at (event #4127)"),
 dict(id="gates", att=1, showatt=True, role="gates", start=1890, end=1950, st="ghost", below="gates #1 · steps row only, no events"),
 dict(id="implement", att=2, role="builder", model=G, start=1955, end=2700, st="failed", ctx=.83),
]

def broken(ox, oy, theme, name):
    use(theme); t = TH
    H = 1450
    f = frame(ox, oy, W, H, name)
    background(f, W, H)
    topbar(f, "127.0.0.1:4317/#/FE-131", "Runs")
    header(f, "FE-131", "Toggle all skips the last todo",
           [("neutral", "flow E"), ("accent", "T1"), ("status", "timeout")],
           [("repo", "example-frontend", None), ("run", "run-01JB8RK2TN", None), ("ended", "2026-10-19 16:44", None), ("age", "35 days", None)], "")
    y = 196
    y += callout(f, 32, y, W - 64, "Read with gaps", "This run has 5 problems in its events and files. The page shows everything it could read, names each gap and never guesses a value.", "verify") + 20
    # totals with unknowns
    n = 5; gap = 12; sw = (W - 64 - gap * (n - 1)) / n
    tiles = [("Cost", "≥ $3.12", "reported · 1 event has no cost_usd", t["warn"]), ("Duration", "45m 00s", "run ended timeout · caps.E.minutes", None),
             ("Tokens in / out", "≥ 1.12M / 74k", "implement #1 usage missing", t["warn"]), ("Fix loops", "1 / 2", "gates #1 has no evidence", t["warn"]),
             ("Steps", "7 rows", "Σ known steps ≠ header · 1 open", t["warn"])]
    for i, (l, v, s, c) in enumerate(tiles):
        stat(f, 32 + i * (sw + gap), y, sw, 96, l, v, s, subcolor=c)
    y += 96 + 28
    T(f, 32, y, "Problems", 16, t["text"], SANS, "Semi Bold"); M(f, 32 + 86, y + 3, "schema check of factory.db rows against runs/example-frontend/FE-131/", 12, t["muted"])
    y += 32
    cols = [("Kind", 150, "left"), ("Where", 330, "left"), ("What is wrong", 600, "left"), ("Shown as", 296, "left")]
    def k(s, kind): return dict(fn=lambda x, yy, w, h, s=s, kind=kind: badge(f, x, yy + (h - 22) / 2, s, kind, h=22, size=11.5))
    rows = [[k("missing field", "err"), dict(t="events #4127 · usage · implement #1", mono=True, s=12), dict(t="ended_at missing, so the step has no duration and no end", c=t["text2"], s=13), dict(t="open dashed bar · ?", mono=True, s=12, c=t["muted"])],
            [k("malformed", "err"), dict(t="events #4131 · payload_json", mono=True, s=12), dict(t="not valid JSON (unexpected end at char 212)", c=t["text2"], s=13), dict(t="raw text below", mono=True, s=12, c=t["muted"])],
            [k("DB ≠ files", "warn"), dict(t="steps gates #1 ↔ events, check_rows", mono=True, s=12), dict(t="steps row says done, but no gate event or check rows exist", c=t["text2"], s=13), dict(t="ghost bar · no evidence", mono=True, s=12, c=t["muted"])],
            [k("DB ≠ files", "warn"), dict(t="report.md ↔ plan.approved", mono=True, s=12), dict(t="report lists plan.approved as present; the file is not on disk", c=t["text2"], s=13), dict(t="missing file chip", mono=True, s=12, c=t["muted"])],
            [k("expired", "neutral"), dict(t="prompts/ · ticket.json · evidence/", mono=True, s=12), dict(t="deleted by factory clean on 2026-11-18, 30 days after ended_at", c=t["text2"], s=13), dict(t="expired card · events kept", mono=True, s=12, c=t["muted"])]]
    y += table(f, 32, y, cols, rows, rh=42) + 28
    # timeline (ghost style handled: draw manually over)
    h, X = timeline(f, 32, y, W - 64, [s if s["st"] != "ghost" else dict(s, st="done") for s in FE131], 2700, [(160, 520)], sub="0 → 45m · open and ghost bars are data gaps")
    # restyle ghost bar: overlay dashed outline
    gx = X(1890); gw = X(1950) - gx
    ly = y + 64 + 28 + 3 * 56 + 8
    R(f, gx - 1, ly - 1, gw + 2, 26, t["bg"], None, 6, name="ghost mask")
    R(f, gx, ly, gw, 24, "none", t["warn"], 6, dashes=[3, 3], name="ghost gates #1")
    y += h + 28
    # expired prompt + raw payload
    LW = 664; RX = 32 + LW + 24; RW = W - 64 - LW - 24
    T(f, 32, y, "Prompt · implement #2", 16, t["text"], SANS, "Semi Bold")
    T(f, RX, y, "events #4131 · payload_json (raw)", 16, t["text"], SANS, "Semi Bold")
    y += 32
    R(f, 32, y, LW, 196, t["panel"], t["borderS"], 14, dashes=[5, 4], name="expired prompt")
    badge(f, 52, y + 20, "expired", "neutral")
    T(f, 52, y + 58, "prompts/implement.md was deleted by factory clean on 2026-11-18, 30 days after this run ended.", 15, t["text"], w=LW - 40)
    T(f, 52, y + 104, "Kept: the event rows (model, timing, tokens, cost), plan.md, report.md, decisions.md and verify/.", 14, t["text2"], w=LW - 40)
    M(f, 52, y + 156, "retention_cleaned · event #4502 · 9 paths removed", 12, t["muted"])
    lines = [[("{", "code")], [('  "summary"', "k"), (": ", "code"), ('"toggleAll now walks the list in rev', "s")],
             [("  ⏎ cut off: the writer stopped here", "warn")], "", [("— shown as text, not parsed. Other events", "c")], [("  of this step still render normally.", "c")]]
    code_block(f, RX, y, RW, lines, head="payload_json · 212 bytes", headR="invalid JSON", size=12.5, lh=21)
    return f
