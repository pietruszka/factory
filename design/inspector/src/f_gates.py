from lib import *
from f_detail import header

def mini_ui(f, x, y, w, h, variant):
    """the sample to-do app's empty state, drawn as a screenshot (light app UI)"""
    R(f, x, y, w, h, "#FFFFFF", None, 0, name=f"{variant} canvas")
    R(f, x, y, w, 24, "#F1F3F7", None, 0, name="app bar")
    R(f, x + 10, y + 9, 36, 6, "#1F2533", None, 2)
    for i, on in enumerate([False, True, False]):
        R(f, x + 12 + i * 40, y + 34, 34, 14, "#1F2533" if on else "#E6E9EF", None, 7)
    dy = 12 if variant != "mockup" else 0
    cx = x + w / 2
    if variant == "mockup":
        E(f, cx - 22, y + 70, 44, 44, "#E7EBF3", "#C9D1DE", 1, name="illustration")
        R(f, cx - 8, y + 86, 16, 12, "#C9D1DE", None, 2)
    R(f, cx - 60, y + 126 + dy, 120, 9, "#1F2533", None, 3, name="title")
    R(f, cx - 80, y + 142 + dy, 160, 6, "#9AA3B5", None, 3, name="subtitle")
    R(f, cx - 34, y + 158 + dy, 68, 14, "#FFFFFF", "#1F2533", 7, name="clear filter link")

def gates(ox, oy, theme, name):
    use(theme); t = TH
    H = 1400
    f = frame(ox, oy, W, H, name)
    background(f, W, H)
    topbar(f, "127.0.0.1:4317/#/FE-147/verify/3", "Runs")
    header(f, "FE-147", "Gates and verifiers",
           [("neutral", "flow A"), ("accent", "T1"), ("status", "needs_human")],
           [("attempt", "3 of 3", None), ("verify-fail loops", "2 / 2", t["warn"]), ("evidence", "runs/example-frontend/FE-147/", None)], "",
           crumbs_=["Runs", "FE-147", "verify #3"])
    y = 196
    x = 32
    for s, on in [("attempt 1 · 2 failed", False), ("attempt 2 · 2 failed", False), ("attempt 3 · 2 failed", True)]:
        x += chip(f, x, y, s, on, mono=True, kind="err") + 8
    M(f, x + 8, y + 8, "11 checks · 9 pass · 2 fail · from check_rows of the gate events", 12, t["muted"])
    y = 244
    y += callout(f, 32, y, W - 64, "Stopped", "needs_human: mockup-vs-UI still failed after 2 fix loops, so no draft PR was opened. The e2e gate exited 0 but ran 0 tests, which counts as a failure.", "err") + 28
    # code gates
    T(f, 32, y, "Code gates", 16, t["text"], SANS, "Semi Bold"); M(f, 32 + 102, y + 3, "judged by exit code and item count · .factory/config.yaml gates", 12, t["muted"])
    y += 32
    cols = [("Gate", 150, "left"), ("Command", 400, "left"), ("Exit", 80, "right"), ("Items", 130, "right"), ("Duration", 110, "right"), ("Evidence", 336, "left"), ("Result", 170, "left")]
    def row(g, cmd, ex, items, dur, ev, res, st):
        bad = st != "pass"
        return [dict(t=g, mono=True, wt="Medium"), dict(t="$ " + cmd, mono=True, s=12.5, c=t["codeText"]), dict(t=ex, mono=True, s=12.5),
                dict(t=items, mono=True, s=12.5, c=t["err"] if bad else t["text2"], wt="Medium" if bad else "Regular"), dict(t=dur, mono=True, s=12.5, c=t["text2"]),
                dict(t=ev, mono=True, s=12, c=t["accentText"]), dict(badge=res, st="failed" if bad else "passed")]
    rows = [row("lint", "npm run lint", "0", "41 files", "2.1s", "evidence/gates/lint.log", "pass", "pass"),
            row("typecheck", "npm run typecheck", "0", "63 files", "6.4s", "evidence/gates/typecheck.log", "pass", "pass"),
            row("test", "npm test -- --run", "0", "38 tests", "11.8s", "evidence/gates/test.log", "pass", "pass"),
            row("build", "npm run build", "0", "1 bundle", "12.0s", "evidence/gates/build.log", "pass", "pass"),
            row("e2e", "npx playwright test --grep @FE-147", "0", "0 tests", "3.2s", "evidence/gates/e2e.log", "checked nothing", "zero")]
    R(f, 32, y + 36 + 4 * 42, W - 64, 42, a(t["err"][:7], .10), None, [0, 0, 11, 11], name="zero-items row highlight")
    R(f, 32, y + 36 + 4 * 42, 3, 42, t["err"], None, [0, 0, 0, 11], name="zero-items bar")
    y += table(f, 32, y, cols, rows, rh=42) + 28
    # verifiers + AC map
    T(f, 32, y, "Verifiers", 16, t["text"], SANS, "Semi Bold")
    LW = 664; RX = 32 + LW + 24; RW = W - 64 - LW - 24
    T(f, RX, y, "AC-to-test map", 16, t["text"], SANS, "Semi Bold"); M(f, RX + 142, y + 3, "plan.md · frozen before the build", 12, t["muted"])
    y += 32
    cols = [("Verifier", 172, "left"), ("What it looked at", 296, "left"), ("Items", 76, "right"), ("Result", 120, "left")]
    def vrow(v, what, items, st, res=None):
        bad = st == "failed"
        return [dict(t=v, mono=True, wt="Medium", s=12.5), dict(t=what, s=13, c=t["text2"]),
                dict(t=items, mono=True, s=12.5, c=t["err"] if bad else t["text2"]), dict(badge=res or ("fail" if bad else ("skipped" if st == "skipped" else "pass")), st=st)]
    rows = [vrow("plan conformance", "4 changed files, all in allowed paths", "4", "passed"),
            vrow("write scope", "0 protected paths touched", "1,284", "passed"),
            vrow("frozen AC tests", "hidden tests run outside the worktree", "3", "passed"),
            vrow("non-empty", "e2e looked at 0 items", "0", "failed"),
            vrow("verdict consistency", "no review yet, verifiers failed", "–", "skipped"),
            vrow("mockup-vs-UI", "2 regions differ at 1280×800", "2", "failed")]
    h1 = table(f, 32, y, cols, rows, rh=42)
    cols = [("AC", 70, "left"), ("Criterion", 240, "left"), ("Test or check", 280, "left"), ("Result", 98, "left")]
    rows = [[dict(t="AC-1", mono=True, wt="Medium"), dict(t="Message when a filter is empty", s=13, c=t["text2"]), dict(t="tests/frozen/empty-state.test.tsx", mono=True, s=12, c=t["accentText"]), dict(badge="pass", st="passed")],
            [dict(t="AC-2", mono=True, wt="Medium"), dict(t="'Clear filter' returns to All", s=13, c=t["text2"]), dict(t="…/empty-state.test.tsx › clear", mono=True, s=12, c=t["accentText"]), dict(badge="pass", st="passed")],
            [dict(t="AC-3", mono=True, wt="Medium"), dict(t="Matches the approved mockup", s=13, c=t["text2"]), dict(t="mockup-vs-UI · verify/", mono=True, s=12, c=t["accentText"]), dict(badge="fail", st="failed")],
            [dict(t="", mono=True), dict(t="3 ACs · 3 mapped · 0 unmapped", s=12.5, c=t["muted"]), dict(t=""), dict(t="")]]
    table(f, RX, y, cols, rows, rh=42)
    y += h1 + 28
    # mockup panel
    ph = 372
    panel(f, 32, y, W - 64, ph, 16, name="mockup-vs-UI")
    T(f, 52, y + 20, "mockup-vs-UI", 16, t["text"], MONO, "Bold")
    sbadge(f, 52 + tw("mockup-vs-UI", 16, MONO) + 12, y + 18, "failed", text="2 regions differ")
    M(f, 52, y + 48, "vision judge claude-opus-5-5-high · Playwright screenshot at the mockup's viewport 1280×800 · approved mockup linked from plan.md", 12, t["muted"])
    iw, ih = 300, 188
    ix = 52; iy = y + 84
    caps = [("Mockup", "verify/mockup.png", "mockup"), ("Screenshot", "verify/screenshot.png", "shot"), ("Diff overlay", "verify/diff.png", "diff")]
    for i, (c, p, v) in enumerate(caps):
        xx = ix + i * (iw + 16)
        R(f, xx - 1, iy - 1, iw + 2, ih + 2, t["codeBg"], t["borderS"], 10, name=f"{c} frame")
        g = add("node.create", {"type": "frame", "parent": f, "name": f"{c} image", "x": xx, "y": iy, "width": iw, "height": ih, "props": {"fill": "#FFFFFF", "clip": True, "cornerRadius": 9}})
        if v == "diff":
            mini_ui(g, 0, 0, iw, ih, "shot")
            R(g, 0, 0, iw, ih, a("#FFFFFF", .62), None, 0, name="fade")
            for (rx, ry, rw, rh, lab) in [(80, 132, 140, 50, "R1"), (118, 64, 64, 56, "R2")]:
                R(g, rx, ry, rw, rh, a("#8B5CFF", .22), "#8B5CFF", 4, name=f"region {lab}", sw=1.5)
                R(g, rx, ry - 16, 24, 14, "#8B5CFF", None, 3); LT(g, rx, ry - 16, 14, lab, 10, "#FFFFFF", MONO, "Bold", w=24, align="center")
        else:
            mini_ui(g, 0, 0, iw, ih, v)
        label(f, xx, iy + ih + 12, c)
        M(f, xx + iw - tw(p, 11, MONO), iy + ih + 12, p, 11, t["accentText"])
    # regions list
    rx = ix + 3 * (iw + 16) + 8; rw = W - 32 - 20 - rx
    label(f, rx, iy, "Differing regions")
    ry = iy + 26
    for lab, box, txt in [("R1", "x 512 y 560 · 480×200", "Empty-state title and text sit 12 px lower than the mockup."),
                          ("R2", "x 592 y 300 · 256×224", "Illustration missing: the image request returned 404 in the worktree.")]:
        R(f, rx, ry, rw, 92, t["violetSoft"], t["violetBorder"], 10)
        R(f, rx + 12, ry + 12, 26, 18, t["violet"], None, 4); LT(f, rx + 12, ry + 12, 18, lab, 11, "#FFFFFF", MONO, "Bold", w=26, align="center")
        M(f, rx + 48, ry + 14, box, 11.5, t["violetText"])
        for j, ln in enumerate(wrapt(txt, 13.5, rw - 24)):
            LT(f, rx + 12, ry + 38 + j * 20, 20, ln, 13.5, t["text2"])
        ry += 104
    M(f, rx, ry + 2, "attempt 1: 3 regions · 2: 2 · 3: 2", 12, t["muted"])
    return f
