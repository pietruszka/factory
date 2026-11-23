from lib import *
LANES = ["router", "planner", "builder", "gates", "verifiers", "reviewer"]
AGENT = {"planner", "builder", "reviewer"}

def fmt_d(s):
    s = int(round(s))
    if s < 60: return f"{s}s"
    return f"{s//60}m {s%60:02d}s"

def make_map(x0, w, total, waits, wait_px=96):
    active = total - sum(b - a_ for a_, b in waits)
    scale = (w - wait_px * len(waits)) / active
    def X(tt):
        px = x0; prev = 0
        for a_, b in waits:
            if tt <= a_: return px + (tt - prev) * scale
            px += (a_ - prev) * scale
            if tt <= b: return px + (tt - a_) / (b - a_) * wait_px
            px += wait_px; prev = b
        return px + (tt - prev) * scale
    return X, scale

def timeline(f, x, y, w, steps, total, waits=(), now=None, lane_h=56, title="Timeline", sub=None, legend=True, missing=()):
    t = TH
    lanes_h = lane_h * len(LANES)
    h = 64 + 30 + lanes_h + 20
    panel(f, x, y, w, h, 16, name="timeline panel")
    T(f, x + 20, y + 18, title, 16, t["text"], SANS, "Semi Bold")
    if sub: M(f, x + 20 + tw(title, 16, weight="Semi Bold") + 12, y + 21, sub, 12, t["muted"])
    if legend:
        lx = x + w - 20
        items = [("agent step", "agent"), ("code step", "code"), ("failed", "fail"), ("human wait", "wait"), ("context used", "ctx")]
        widths = [tw(s, 12, MONO) + 28 for s, _ in items]
        lx -= sum(widths)
        for (s, k), ww in zip(items, widths):
            if k == "agent": R(f, lx, y + 22, 16, 10, t["accentSoft"], t["accentBorder"], 3)
            elif k == "code": R(f, lx, y + 22, 16, 10, t["panel2"], t["borderS"], 3)
            elif k == "fail": R(f, lx, y + 22, 16, 10, t["errSoft"], mixa(t["err"], 60), 3)
            elif k == "wait": R(f, lx, y + 22, 16, 10, t["violetSoft"], t["violetBorder"], 3, dashes=[3, 2])
            else: R(f, lx, y + 25, 16, 3, t["accent"], None, 1.5)
            M(f, lx + 22, y + 19, s, 12, t["muted"])
            lx += ww
    lx0 = x + 20; tx0 = x + 150; tw_ = w - 150 - 24
    X, scale = make_map(tx0, tw_, total, list(waits))
    ty = y + 64
    # axis ticks
    tick = 240 if total > 1800 else (120 if total > 600 else 60)
    tt = 0
    while tt <= total + 1:
        inwait = any(a_ < tt < b for a_, b in waits)
        if not inwait:
            xx = X(tt)
            R(f, xx, ty + 24, 1, lanes_h + 4, t["border"] if tt else t["borderS"], name="tick")
            M(f, xx - 12 if tt else xx, ty + 2, f"{tt//60}m", 11, t["muted"])
        tt += tick
    R(f, tx0 + tw_, ty + 24, 1, lanes_h + 4, t["border"], name="end tick")
    ly = ty + 28
    for i, ln in enumerate(LANES):
        if i: R(f, lx0, ly + i * lane_h, w - 40, 1, t["border"], name="lane rule")
        M(f, lx0, ly + i * lane_h + 12, ln, 12.5, t["text2"], "Medium")
        kind = "agent" if ln in AGENT else "code"
        M(f, lx0, ly + i * lane_h + 30, kind, 10.5, t["muted"])
    for a_, b in waits:
        wx = X(a_); ww = X(b) - wx
        R(f, wx + 2, ly + 4, ww - 4, lanes_h - 8, t["violetSoft"], t["violetBorder"], 8, dashes=[4, 3], name="awaiting approval band")
        T(f, wx + 10, ly + lane_h * 2 + 10, "awaiting", 11, t["violetText"], MONO, "Medium")
        T(f, wx + 10, ly + lane_h * 2 + 26, "approval", 11, t["violetText"], MONO, "Medium")
        T(f, wx + 10, ly + lane_h * 2 + 44, fmt_d(b - a_), 11, t["violetText"], MONO)
        M(f, wx + 10, ly + lane_h * 4 + 10, "≈ axis", 10, t["violetText"])
        M(f, wx + 10, ly + lane_h * 4 + 24, "compressed", 10, t["violetText"])
    for s in steps:
        li = LANES.index(s["role"])
        bx = X(s["start"]); end = s["end"] if s.get("end") is not None else (s.get("end_draw") or now or total)
        bw = max(X(end) - bx, 5)
        by = ly + li * lane_h + 8; bh = 24
        st = s["st"]
        agent = s["role"] in AGENT
        if st == "failed":
            fill, stroke = t["errSoft"], mixa(t["err"], 60)
        elif agent:
            fill, stroke = t["accentSoft"], t["accentBorder"]
        else:
            fill, stroke = t["panel2"], t["borderS"]
        dashes = [3, 3] if s.get("end") is None and st != "running" else None
        n = R(f, bx, by, bw, bh, fill, stroke if st != "running" else t["accent"], 6, name=f"step {s['id']}#{s.get('att',1)}", dashes=dashes)
        if st == "running": glow(n, mixa(t["accent"], 45), 14)
        if s.get("ctx") is not None:
            cw = (bw - 8) * s["ctx"]
            R(f, bx + 4, by + bh - 5, bw - 8, 2, t["border"], None, 1, name="ctx track")
            R(f, bx + 4, by + bh - 5, cw, 2, t["warn"] if s["ctx"] > .8 else t["accent"], None, 1, name=f"ctx {int(s['ctx']*100)}%")
        att = f" #{s['att']}" if s.get("att", 1) > 1 or s.get("showatt") else ""
        mark = "✗ " if st == "failed" else ""
        full = f"{mark}{s['id']}{att} · {s['model']} · {fmt_d(end - s['start'])}" if s.get("model") else f"{mark}{s['id']}{att} · {fmt_d(end - s['start'])}"
        short = f"{mark}{s['id']}{att} · {fmt_d(end - s['start'])}" if s.get("end") is not None else f"{mark}{s['id']}{att} · ? (no ended_at)"
        if s.get("end") is None and st != "running" and s.get("below"):
            full = short = s["below"]
        col = t["err"] if st == "failed" else (t["accentText"] if agent or st == "running" else t["text"])
        if tw(full, 11.5, MONO) + 16 <= bw:
            LT(f, bx + 8, by, bh - 2, full, 11.5, col, MONO, "Medium")
        elif tw(short, 11.5, MONO) + 16 <= bw:
            LT(f, bx + 8, by, bh - 2, short, 11.5, col, MONO, "Medium")
        else:
            lab = s.get("below", short)
            lx_ = bx
            if bx + tw(lab, 10.5, MONO) > tx0 + tw_: lx_ = bx + bw - tw(lab, 10.5, MONO)
            if lab: M(f, lx_, by + bh + 3, lab, 10.5, col if st == "failed" else t["text2"])
        for mx in s.get("marks", []):
            pass
    if now is not None:
        nx = X(now)
        R(f, nx, ty + 20, 1.5, lanes_h + 12, t["accent"], name="now line")
        R(f, nx - 22, ty, 44, 18, t["accent"], None, 9, name="now pill")
        LT(f, nx - 22, ty, 18, "now", 11, t["accentInk"], MONO, "Bold", w=44, align="center")
    return h, X
