from lib import *
def sheet(ox, oy, theme, name):
    use(theme); t = TH
    H = 840
    f = frame(ox, oy, W, H, name)
    background(f, W, H)
    M(f, 32, 40, "APPROVED 2026-11-23 · INSPECTOR TOKENS", 12, t["accentText"], "Medium", ls=1.44)
    T(f, 32, 62, "Inspector status and lane tokens", 30, t["text"], SANS, "Semi Bold", ls=-0.6)
    T(f, 32, 106, "Every runs.status value from src/event-log/schema.ts mapped onto the existing badge tones. Breach is the only solid badge.", 16, t["text2"])
    groups = [("Phases (live)", ["preflight", "routing", "planning", "building", "gating", "verifying", "reviewing", "opening_pr"]),
              ("Human gate", ["awaiting_approval"]), ("Done", ["passed"]),
              ("Needs you", ["needs_human"]), ("Safety", ["breach"]),
              ("Caps and limits", ["budget", "timeout", "cost_missing", "cannot_reproduce", "config_drift"]),
              ("Neutral stops", ["refused", "killed", "interrupted"]),
              ("Step status", ["pending", "running", "done", "failed"])]
    y = 156
    for i, (g, sts) in enumerate(groups):
        x = 32; yy = y + i * 44
        label(f, x, yy + 6, g)
        bx = x + 170
        for s in sts:
            bx += sbadge(f, bx, yy, s) + 8
    y = 534
    label(f, 32, y, "Timeline bars")
    bx = 32
    for lab, fill, stroke, d in [("agent step", t["accentSoft"], t["accentBorder"], None), ("code step", t["panel2"], t["borderS"], None),
                                  ("failed", t["errSoft"], mixa(t["err"], 60), None), ("human wait", t["violetSoft"], t["violetBorder"], [4, 3]),
                                  ("open / no ended_at", t["panel2"], t["borderS"], [3, 3]), ("ghost · no events", "none", t["warn"], [3, 3])]:
        R(f, bx, y + 26, 150, 24, fill, stroke, 6, dashes=d)
        M(f, bx, y + 58, lab, 12, t["text2"])
        bx += 176
    n = R(f, bx, y + 26, 150, 24, t["accentSoft"], t["accent"], 6); glow(n, mixa(t["accent"], 45), 14)
    M(f, bx, y + 58, "running (glow)", 12, t["text2"])
    y = 640
    label(f, 32, y, "Flow tiles and tiers")
    from lib import flow_tile
    for i, fl in enumerate(["A", "E", "F", "H", None]):
        flow_tile(f, 32 + i * 52, y + 24, fl)
    bx = 32 + 5 * 52 + 20
    for s, k in [("T0", "neutral"), ("T1", "accent"), ("T2", "warn")]:
        bx += badge(f, bx, y + 32, s, k) + 8
    y = 730
    label(f, 32, y, "Cost labels and links")
    bx = 32
    for v, l in [("$2.86", "reported"), ("$0.47", "est."), ("$2.86", "reported + est."), ("≥ $3.12", "partial: an event has no cost_usd"), ("–", "no cost recorded, never $0.00")]:
        M(f, bx, y + 26, v, 15, t["text"], "Medium"); M(f, bx, y + 48, l, 11, t["muted"])
        bx += max(tw(l, 11, MONO), tw(v, 15, MONO)) + 40
    M(f, bx + 20, y + 26, "127.0.0.1:4317/#/FE-123/<step>/<attempt>", 13, t["accentText"])
    M(f, bx + 20, y + 48, "fixed default port · bookmarkable hash", 11, t["muted"])
    return f
