from lib import *
from f_detail import header

def kv(f, x, y, w, k, v, vc=None, mono=True, size=13):
    t = TH
    M(f, x, y, k, 12, t["muted"])
    if mono: M(f, x + w - tw(v, size, MONO), y - 1, v, size, vc or t["text"], "Medium")
    else: T(f, x + w - tw(v, size), y - 1, v, size, vc or t["text"])

def section(f, x, y, title, right=None, w=None):
    t = TH
    T(f, x, y, title, 16, t["text"], SANS, "Semi Bold")
    if right: M(f, x + w - tw(right, 12, MONO), y + 3, right, 12, t["muted"])

def step(ox, oy, theme, name):
    use(theme); t = TH
    H = 1330
    f = frame(ox, oy, W, H, name)
    background(f, W, H)
    topbar(f, "127.0.0.1:4317/#/FE-145/implement/2", "Runs")
    header(f, "FE-145", "implement · attempt 2",
           [("accent", "builder"), ("status", "done"), ("warn", "fix loop 1 / 2")],
           [("model", "gpt-5.3-codex-high", None), ("exit_reason", "ok", None), ("phase", "building", None)], "",
           crumbs_=["Runs", "FE-145", "implement #2"])
    # attempt switch
    y = 196
    x = 32
    x += chip(f, x, y, "attempt 1 · done · then gates failed", False, mono=True) + 8
    x += chip(f, x, y, "attempt 2 · done", True, mono=True) + 8
    M(f, x + 8, y + 8, "← → between attempts of this step", 12, t["muted"])
    LX, LW = 32, 840; RX, RW = 32 + 840 + 24, W - 64 - 840 - 24
    # ---- left
    y = 246
    h = callout(f, LX, y, LW, "Why it ran", "Fix loop 1 of 2. gates #1 failed on typecheck (exit 2). The builder got the failure verbatim and the same allowed paths.", "verify")
    y += h + 24
    section(f, LX, y, "Request and prompt", "prompts/implement.md · 2.4 KB · expires 30 days after ended_at", LW)
    y += 34
    lines = [
     [("# role: builder · step: implement · attempt 2 (fix loop 1 of 2)", "c")],
     [("ticket", "k"), (": FE-145 · Filter tabs keep URL state on reload", "code")],
     [("plan", "k"), (": runs/example-frontend/FE-145/plan.md ", "code"), ("sha256:9c41…e2a0 (approved)", "c")],
     [("allowed_paths", "k"), (": ", "code"), ("src/features/filters/**", "s"), (", ", "code"), ("src/routes/todos.tsx", "s")],
     [("deny", "k"), (": ", "code"), ("tests/frozen/**", "s"), (", ", "code"), (".env*", "s"), (", ", "code"), ("package-lock.json", "s")],
     "",
     [("The typecheck gate failed. Fix it without editing frozen tests.", "code")],
     [("--- evidence/gates/typecheck.log (verbatim) ---", "c")],
     [("src/features/filters/useFilterParam.ts:18:5", "a"), (" - error TS2322:", "err")],
     [("  Type 'string | null' is not assignable to type 'Filter'.", "code")],
     [("--- end ---", "c")],
     "",
     [("Return JSON matching ", "code"), ("step-result.schema.json", "s"), (": status, summary, files.", "code")],
     "", "",
    ]
    h = code_block(f, LX, y, LW, lines, head="prompt · 13 of 64 lines", headR="[REDACTED] secrets: 0", size=12.5, lh=21)
    R(f, LX + 1, y + h - 36, LW - 2, 35, t["panel"], None, [0, 0, 11, 11], name="show all")
    LT(f, LX, y + h - 36, 35, "Show all 64 lines ↓", 12.5, t["accentText"], MONO, "Medium", w=LW, align="center")
    y += h + 28
    section(f, LX, y, "Outputs", "step-result.json · evidence/diff.patch", LW)
    y += 34
    ph = 268
    panel(f, LX, y, LW, ph, 14, name="outputs")
    M(f, LX + 18, y + 18, "+18", 22, t["ok"], "Medium"); M(f, LX + 70, y + 18, "−6", 22, t["err"], "Medium")
    T(f, LX + 112, y + 22, "2 files changed in this attempt · run total +156 −41 in 5 files", 14, t["text2"])
    fy = y + 62
    for path, ad, de in [("src/features/filters/useFilterParam.ts", 14, 5), ("src/routes/todos.tsx", 4, 1)]:
        R(f, LX + 18, fy, LW - 36, 36, t["codeBg"], t["border"], 8)
        M(f, LX + 32, fy + 10, path, 12.5, t["text"])
        M(f, LX + LW - 200, fy + 10, f"+{ad}", 12.5, t["ok"], "Medium"); M(f, LX + LW - 160, fy + 10, f"−{de}", 12.5, t["err"], "Medium")
        for k in range(10):
            col = t["ok"] if k < round(10 * ad / (ad + de)) else t["err"]
            R(f, LX + LW - 120 + k * 8, fy + 13, 6, 10, mixa(col, 80), None, 2)
        fy += 44
    label(f, LX + 18, fy + 10, "Summary")
    T(f, LX + 18, fy + 30, "Narrowed the URL param to Filter with a type guard and fall back to 'all' when it is missing or unknown.", 14, t["text2"], w=LW - 36)
    label(f, LX + 18, fy + 66, "Review findings")
    M(f, LX + 18 + 140, fy + 66, "none for a builder step · see review", 12, t["muted"])
    y += ph + 28
    section(f, LX, y, "Plan slice", "plan.md · AC-to-check map", LW)
    y += 34
    cols = [("AC", 80, "left"), ("Criterion", 380, "left"), ("Check", 380, "left")]
    rows = [[dict(t="AC-1", mono=True, wt="Medium"), dict(t="Selected filter survives a page reload", c=t["text2"]), dict(t="tests/frozen/filters-url.test.tsx", mono=True, s=12, c=t["text2"])],
            [dict(t="AC-2", mono=True, wt="Medium"), dict(t="Back button restores the previous filter", c=t["text2"]), dict(t="tests/frozen/filters-history.test.tsx", mono=True, s=12, c=t["text2"])]]
    table(f, LX, y, cols, rows, rh=40)
    # ---- right
    y = 246
    def card(y, title, h):
        panel(f, RX, y, RW, h, 14, name=title)
        label(f, RX + 18, y + 16, title)
        return y + 44
    cy = card(y, "Time", 150)
    for k, v in [("started", "11:18:43"), ("ended", "11:20:45"), ("duration", "2m 02s"), ("offset in run", "+13m 38s")]:
        kv(f, RX + 18, cy, RW - 36, k, v); cy += 24
    y += 150 + 14
    cy = card(y, "Cost", 132)
    M(f, RX + 18, cy, "$0.47", 26, t["text"], "Medium")
    badge(f, RX + 18 + tw("$0.47", 26, MONO) + 12, cy + 6, "estimated", "warn", h=22, size=11.5)
    M(f, RX + 18, cy + 42, "rate_table · gpt-5.3-codex-high · repo config", 12, t["muted"])
    M(f, RX + 18, cy + 60, "run so far $2.13 rep.+est. of $5.00 cap", 12, t["muted"])
    R(f, RX + RW - 18 - 110, cy + 64, 110, 4, t["panel2"], None, 2); R(f, RX + RW - 18 - 110, cy + 64, 110 * 2.13 / 5, 4, t["accent"], None, 2)
    y += 132 + 14
    cy = card(y, "Tokens", 236)
    parts = [("input", 158204, t["accent"]), ("output", 9812, t["text"]), ("cache read", 412330, mixa(t["accent"], 35)),
             ("cache write", 18040, t["muted"]), ("reasoning", 4210, t["text2"])]
    tot = sum(p[1] for p in parts)
    bx = RX + 18; bw = RW - 36
    for nm, v, c in parts:
        ww = max(bw * v / tot, 3)
        R(f, bx, cy, ww - 1.5, 10, c, None, 2, name=f"tok {nm}")
        bx += ww
    cy += 24
    for nm, v, c in parts:
        R(f, RX + 18, cy + 4, 8, 8, c, None, 2)
        M(f, RX + 34, cy, nm, 12.5, t["text2"])
        vs = f"{v:,}"
        M(f, RX + RW - 18 - tw(vs, 12.5, MONO), cy, vs, 12.5, t["text"], "Medium")
        cy += 24
    M(f, RX + 18, cy + 4, "usage_source reported · reasoning counted in output", 11.5, t["muted"])
    y += 236 + 14
    cy = card(y, "Context window", 104)
    M(f, RX + 18, cy, "61%", 22, t["text"], "Medium"); M(f, RX + 80, cy + 6, "166k of 272k tokens", 12.5, t["muted"])
    R(f, RX + 18, cy + 36, RW - 36, 6, t["panel2"], None, 3); R(f, RX + 18, cy + 36, (RW - 36) * .61, 6, t["accent"], None, 3)
    R(f, RX + 18 + (RW - 36) * .8, cy + 32, 1, 14, t["warn"]); M(f, RX + 18 + (RW - 36) * .8 + 4, cy + 30, "80%", 10, t["warn"])
    y += 104 + 14
    cy = card(y, "Process", 200)
    for k, v in [("pid", "48113"), ("exit code", "0"), ("started", "11:18:43"), ("ended", "11:20:45")]:
        kv(f, RX + 18, cy, RW - 36, k, v); cy += 24
    R(f, RX + 18, cy + 4, RW - 36, 52, t["codeBg"], t["border"], 8)
    M(f, RX + 30, cy + 12, "cursor-agent -p --output-format stream-json", 11.5, t["codeText"])
    M(f, RX + 30, cy + 30, "  --model gpt-5.3-codex-high --resume c8f1…", 11.5, t["codeText"])
    y += 200 + 14
    cy = card(y, "Identifiers", 104)
    for k, v in [("cli_session_id", "c8f1e0b2-…-4d7a"), ("input_hash", "sha256:3a9f…71c0")]:
        kv(f, RX + 18, cy, RW - 36, k, v, t["text2"], size=12.5); cy += 24
    return f
