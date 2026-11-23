"""Shared helpers for the Factory Inspector FigCraft mockups.
Tokens copied from /workspace/factory-design/assets/site.css (rgba -> 8-digit hex)."""
import json
from PIL import ImageFont
FP = '/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf'
WGT = {"Regular": 400, "Medium": 500, "Semi Bold": 600, "Bold": 700}
_fc = {}
MONO = "JetBrains Mono"; SANS = "Inter"

def tw(s, size, font=SANS, weight="Regular", ls=0):
    if font == MONO:
        return 0.6 * size * len(s) + ls * len(s)
    k = (size, weight)
    if k not in _fc:
        f = ImageFont.truetype(FP, max(1, round(size * 4)))
        f.set_variation_by_axes([min(32, max(14, size)), WGT[weight]]); _fc[k] = f
    return _fc[k].getlength(s) / 4 * 1.03 + ls * len(s)

def fit(s, size, width, font=SANS, weight="Regular"):
    if tw(s, size, font, weight) <= width: return s
    while s and tw(s + "…", size, font, weight) > width: s = s[:-1]
    return s.rstrip() + "…"

def a(hexrgb, alpha):
    return hexrgb + f"{round(alpha*255):02X}"

DARK = dict(name="dark",
    bg="#07080B", bg2="#0C0E13", panel=a("#FFFFFF", .035), panel2=a("#FFFFFF", .065),
    border=a("#FFFFFF", .10), borderS=a("#FFFFFF", .20),
    text="#EDEFF4", text2="#B7BDCB", muted="#8F97AA",
    accent="#3DF5FF", accentInk="#031417", accentText="#3DF5FF", accentSoft=a("#3DF5FF", .09), accentBorder=a("#3DF5FF", .34),
    violet="#8B5CFF", violetText="#B9A4FF", violetSoft=a("#8B5CFF", .15), violetBorder=a("#8B5CFF", .42),
    ok="#4ADE9A", okSoft=a("#4ADE9A", .11), warn="#F5C451", warnSoft=a("#F5C451", .11), err="#FF7A88", errSoft=a("#FF7A88", .11),
    codeBg="#090B10", codeText="#D7DBE6", synCmt="#7C8499", synStr="#9DF2C4", synKey="#B9A4FF", synAcc="#3DF5FF",
    grid=a("#FFFFFF", .04), glowA=a("#3DF5FF", .13), glowB=a("#8B5CFF", .16), topbar=a("#07080B", .78))
LIGHT = dict(name="light",
    bg="#F4F6FA", bg2="#EAEDF3", panel=a("#FFFFFF", .72), panel2="#FFFFFF",
    border=a("#0C101C", .13), borderS=a("#0C101C", .26),
    text="#0A0D14", text2="#2D3445", muted="#566074",
    accent="#0098A8", accentInk="#031417", accentText="#00606B", accentSoft=a("#0098A8", .09), accentBorder=a("#007886", .45),
    violet="#6B3DE0", violetText="#5A2FCB", violetSoft=a("#6B3DE0", .09), violetBorder=a("#6B3DE0", .40),
    ok="#0E7A46", okSoft=a("#0E7A46", .10), warn="#855500", warnSoft=a("#B07400", .12), err="#B01E35", errSoft=a("#B01E35", .09),
    codeBg="#EEF1F6", codeText="#1A2030", synCmt="#5F687C", synStr="#0B6B3E", synKey="#5A2FCB", synAcc="#00606B",
    grid=a("#0C101C", .055), glowA=a("#00BECD", .16), glowB=a("#6B3DE0", .13), topbar=a("#F4F6FA", .78))
TH = dict(DARK)
def use(theme): TH.clear(); TH.update(theme)
def mixa(c, pct):  # color-mix(in srgb, c pct%, transparent)
    return c[:7] + f"{round(pct/100*255):02X}"

steps = []
def add(cmd, params):
    steps.append({"command": cmd, "params": params}); return {"$step": len(steps) - 1}

def R(p, x, y, w, h, fill=None, stroke=None, r=0, name="rect", sw=1, dashes=None, fills=None, opacity=None, sides=None):
    props = {"cornerRadius": r}
    if fills is not None: props["fills"] = fills
    else: props["fill"] = fill or "none"
    if stroke:
        props.update(stroke=stroke, strokeWeight=sw, strokeAlign="inside")
        if dashes: props["dashes"] = dashes
        if sides: props["strokeSides"] = sides
    if opacity is not None: props["opacity"] = opacity
    q = {"type": "rectangle", "x": x, "y": y, "width": max(w, 0.5), "height": max(h, 0.5), "name": name, "props": props}
    if p is not None: q["parent"] = p
    return add("node.create", q)

def T(p, x, y, s, size=14, color=None, font=SANS, weight="Regular", lh=None, w=None, align="left", ls=None, name=None):
    props = {"fontFamily": font, "fontStyle": weight, "fontSize": size, "fill": color or TH["text"]}
    if lh is not None: props["lineHeight"] = lh
    if ls is not None: props["letterSpacing"] = ls
    q = {"type": "text", "x": x, "y": y, "text": s, "name": name or s[:40]}
    if w is not None: q["width"] = w; props["textAlign"] = align; props["textAutoResize"] = "height"
    q["props"] = props
    if p is not None: q["parent"] = p
    return add("node.create", q)

def M(p, x, y, s, size=12, color=None, weight="Regular", **k):
    return T(p, x, y, s, size, color or TH["muted"], MONO, weight, **k)

def LT(p, x, y, h, s, size=14, color=None, font=SANS, weight="Regular", **k):
    """single line vertically centred in a box of height h"""
    return T(p, x, y, s, size, color, font, weight, lh=h, **k)

def E(p, x, y, w, h, fill="none", stroke=None, sw=1, name="dot"):
    props = {"fill": fill}
    if stroke: props.update(stroke=stroke, strokeWeight=sw, strokeAlign="inside")
    return add("node.create", {"type": "ellipse", "parent": p, "x": x, "y": y, "width": w, "height": h, "name": name, "props": props})

def V(p, x, y, w, h, path, stroke, sw=1.6, fill="none", name="icon"):
    return add("node.create", {"type": "vector", "parent": p, "x": x, "y": y, "width": w, "height": h, "name": name,
        "props": {"path": path, "fill": fill, "stroke": stroke, "strokeWeight": sw, "strokeJoin": "round", "strokeCap": "round"}})

def glow(node, color, radius=8):
    add("effect.add", {"ids": [node], "type": "dropShadow", "effect": {"type": "dropShadow", "color": color, "radius": radius, "offset": [0, 0], "spread": 0}})

def shadow(node):
    if TH["name"] == "dark":
        add("effect.add", {"ids": [node], "type": "dropShadow", "effect": {"type": "dropShadow", "color": "#000000B0", "radius": 70, "offset": [0, 24], "spread": -28}})
    else:
        add("effect.add", {"ids": [node], "type": "dropShadow", "effect": {"type": "dropShadow", "color": "#141E3C40", "radius": 50, "offset": [0, 22], "spread": -26}})

def frame(x, y, w, h, name):
    return add("node.create", {"type": "frame", "name": name, "x": x, "y": y, "width": w, "height": h, "props": {"fill": TH["bg"], "clip": True}})

def panel(p, x, y, w, h, r=16, name="panel", strong=False, fill=None, hl=True):
    n = R(p, x, y, w, h, fill or TH["panel"], TH["borderS"] if strong else TH["border"], r, name=name)
    if hl and TH["name"] == "dark":  # .card::before top highlight
        R(p, x + 1, y + 1, w - 2, min(h * 0.4, 120), r=max(r - 1, 0), name="highlight",
          fills=[{"type": "linearGradient", "stops": [a("#FFFFFF", .035), a("#FFFFFF", 0)], "from": [0, 0], "to": [0, 1]}])
    return n

def label(p, x, y, s, color=None, size=11):  # .card .label / table th
    return M(p, x, y, s.upper(), size, color or TH["muted"], "Medium", ls=0.08 * size)

# ---------------------------------------------------------------- badges
STATUS = {}
def status_style(st):
    t = TH
    phases = ["preflight", "routing", "planning", "building", "gating", "verifying", "reviewing", "opening_pr"]
    if st == "passed": return ("ok", False)
    if st in phases: return ("accent", True)
    if st == "awaiting_approval": return ("violet", False)
    if st in ("needs_human",): return ("err", False)
    if st == "breach": return ("errSolid", False)
    if st in ("budget", "timeout", "cost_missing", "cannot_reproduce", "config_drift"): return ("warn", False)
    if st in ("refused", "killed", "interrupted", "skipped", "pending"): return ("neutral", False)
    if st in ("done", "ok", "pass"): return ("ok", False)
    if st in ("failed", "fail"): return ("err", False)
    if st == "running": return ("accent", True)
    return ("neutral", False)

def tone(kind):
    t = TH
    return {
        "ok": (t["ok"], t["okSoft"], mixa(t["ok"], 40)),
        "warn": (t["warn"], t["warnSoft"], mixa(t["warn"], 40)),
        "err": (t["err"], t["errSoft"], mixa(t["err"], 40)),
        "errSolid": ("#1A0508" if t["name"] == "dark" else "#FFFFFF", t["err"], t["err"]),
        "accent": (t["accentText"], t["accentSoft"], t["accentBorder"]),
        "violet": (t["violetText"], t["violetSoft"], t["violetBorder"]),
        "neutral": (t["text2"], t["panel"], t["borderS"]),
    }[kind]

def badge(p, x, y, s, kind="neutral", dot=False, live=False, h=24, size=12, mono=True):
    fg, bg, bd = tone(kind)
    font = MONO if mono else SANS
    w = tw(s, size, font, "Medium") + 20 + (12 if dot else 0)
    R(p, x, y, w, h, bg, bd, h / 2, name=f"badge {s}")
    tx = x + 10
    if dot:
        d = E(p, x + 10, y + (h - 6) / 2, 6, 6, fg, name="dot")
        if live: glow(d, mixa(fg, 90), 8)
        tx += 12
    LT(p, tx, y, h, s, size, fg, font, "Medium")
    return w

def sbadge(p, x, y, st, h=24, size=12, text=None):
    kind, live = status_style(st)
    return badge(p, x, y, text or st, kind, dot=True, live=live, h=h, size=size)

def flow_tile(p, x, y, flow, s=40):
    if flow is None:
        R(p, x, y, s, s, TH["panel"], TH["border"], 10, name="flow tile", dashes=[3, 3])
        LT(p, x, y, s, "–", 16, TH["muted"], MONO, "Medium", w=s, align="center"); return
    R(p, x, y, s, s, TH["panel2"], TH["borderS"], 10, name=f"flow {flow}")
    LT(p, x, y, s, flow, 18, TH["text"], MONO, "Bold", w=s, align="center")

# ---------------------------------------------------------------- chrome
W = 1440
def background(f, w, h):
    t = TH
    # glows (.hero::before)
    R(f, -120, -260, 900, 640, fills=[{"type": "radialGradient", "stops": [t["glowA"], a(t["glowA"][:7], 0)]}], name="glow-a")
    R(f, 760, -240, 900, 620, fills=[{"type": "radialGradient", "stops": [t["glowB"], a(t["glowB"][:7], 0)]}], name="glow-b")
    gh = 760
    for gx in range(0, w + 1, 56):
        R(f, gx, 0, 1, gh, t["grid"], name="grid v")
    for gy in range(0, gh + 1, 56):
        R(f, 0, gy, w, 1, t["grid"], name="grid h")
    R(f, 0, 260, w, gh - 258, fills=[{"type": "linearGradient", "stops": [a(t["bg"], 0), t["bg"]], "from": [0, 0], "to": [0, 1]}], name="grid fade")

LOGO = "M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"
LOGO2 = "M8 12h3l1.5-3 1.5 6 1.5-3H17"
def topbar(f, url, nav="Runs", live=False):
    t = TH
    R(f, 0, 0, W, 56, t["topbar"], name="topbar")
    R(f, 0, 55, W, 1, t["border"], name="topbar border")
    V(f, 32 + 3.8, 16 + 2.5, 16.4, 19, "M8.2 0L16.4 4.75V14.25L8.2 19L0 14.25V4.75Z", t["accent"], 1.6, name="logo hex")
    V(f, 32 + 8, 16 + 9, 9, 6, "M0 3H3L4.5 0L6 6L7.5 3H9", t["accent"], 1.6, name="logo pulse")
    LT(f, 64, 0, 56, "factory", 15, t["text"], MONO, "Bold")
    bx = 64 + tw("factory", 15, MONO) + 10
    R(f, bx, 18, tw("inspect", 11, MONO) + 18, 20, "none", t["border"], 10, name="ver")
    LT(f, bx + 9, 18, 20, "inspect", 11, t["muted"], MONO, "Medium")
    nx = bx + tw("inspect", 11, MONO) + 40
    for n in ["Runs", "Event log", "Baselines"]:
        ww = tw(n, 14) + 24
        if n == nav:
            R(f, nx, 12, ww, 32, t["panel2"], None, 8, name="nav active")
        LT(f, nx + 12, 12, 32, n, 14, t["text"] if n == nav else t["text2"])
        if n == "Baselines":
            R(f, nx + ww + 2, 19, 34, 18, t["panel"], t["borderS"], 9); LT(f, nx + ww + 2, 19, 18, "dev", 10, t["text2"], MONO, "Medium", w=34, align="center")
        nx += ww + 4
    # url pill (bookmarkable hash)
    uw = 440
    ux = W - 32 - 38 - 12 - 226 - 12 - uw
    R(f, ux, 12, uw, 32, t["codeBg"], t["border"], 8, name="url")
    V(f, ux + 12, 21, 10, 13, "M1 6V4a4 4 0 0 1 8 0v2M0.5 6h9v7h-9z", t["muted"], 1.3, name="lock")
    LT(f, ux + 30, 12, 32, fit(url, 12.5, uw - 40, MONO), 12.5, t["text2"], MONO)
    # read-only pill
    rx = W - 32 - 38 - 12 - 226
    R(f, rx, 12, 226, 32, t["panel"], t["border"], 16, name="read-only")
    E(f, rx + 12, 25, 6, 6, t["ok"])
    LT(f, rx + 26, 12, 32, "read-only · 127.0.0.1:4317", 12, t["text2"], MONO)
    # theme toggle
    R(f, W - 32 - 38, 9, 38, 38, t["panel"], t["border"], 10, name="theme toggle")
    if t["name"] == "dark":
        V(f, W - 32 - 38 + 12, 21, 14, 14, "M13 8.5A6 6 0 1 1 5.5 1a5 5 0 0 0 7.5 7.5z", t["text2"], 1.5, name="moon")
    else:
        E(f, W - 32 - 38 + 15, 24, 8, 8, "none", t["text2"], 1.5, name="sun")

def crumbs(f, y, parts):
    x = 32
    for i, s in enumerate(parts):
        last = i == len(parts) - 1
        M(f, x, y, s, 13, TH["text"] if last else TH["accentText"], "Medium" if last else "Regular")
        x += tw(s, 13, MONO)
        if not last:
            M(f, x + 8, y, "/", 13, TH["muted"]); x += 24

def tabs(f, y, items, active):
    x = 32
    R(f, 32, y + 39, W - 64, 1, TH["border"], name="tabs rule")
    for s, cnt in items:
        on = s == active
        LT(f, x, y, 40, s, 14, TH["text"] if on else TH["text2"], weight="Medium" if on else "Regular")
        ww = tw(s, 14, weight="Medium")
        if cnt is not None:
            cw = tw(str(cnt), 11, MONO) + 12
            R(f, x + ww + 8, y + 11, cw, 18, TH["panel2"], TH["border"], 9)
            LT(f, x + ww + 8, y + 11, 18, str(cnt), 11, TH["muted"], MONO, w=cw, align="center")
            ww += cw + 8
        if on:
            R(f, x, y + 38, ww, 2, TH["accent"], name="tab underline")
        x += ww + 28

def stat(p, x, y, w, h, lab, val, sub=None, valcolor=None, subcolor=None):
    panel(p, x, y, w, h, 14, name=f"stat {lab}")
    label(p, x + 16, y + 14, lab)
    M(p, x + 16, y + 34, val, 22, valcolor or TH["text"], "Medium")
    if sub: T(p, x + 16, y + h - 26, fit(sub, 11.5, w - 28, MONO), 11.5, subcolor or TH["muted"], MONO)

def code_block(p, x, y, w, lines, head=None, headR=None, size=12.5, lh=20, name="code"):
    t = TH
    hh = 38 if head else 0
    h = hh + 14 * 2 + lh * len(lines)
    R(p, x, y, w, h, t["codeBg"], t["border"], 12, name=name)
    if head:
        R(p, x, y + hh - 1, w, 1, t["border"])
        LT(p, x + 14, y, hh, head, 12, t["muted"], MONO, "Medium")
        if headR: LT(p, x + w - 14 - tw(headR, 12, MONO), y, hh, headR, 12, t["muted"], MONO)
    cy = y + hh + 14
    for ln in lines:
        if isinstance(ln, str): ln = [(ln, "code")]
        cx = x + 18
        for seg, role in ln:
            col = {"code": t["codeText"], "c": t["synCmt"], "s": t["synStr"], "k": t["synKey"], "a": t["synAcc"], "m": t["muted"],
                   "ok": t["ok"], "err": t["err"], "warn": t["warn"]}[role]
            if seg:
                LT(p, cx, cy, lh, seg, size, col, MONO)
            cx += tw(seg, size, MONO)
        cy += lh
    return h

def table(p, x, y, cols, rows, rh=40, hh=36, name="table", zebra=False, fs=13):
    """cols: [(title, width, align)]; rows: list of list of cell specs: str or dict(t, c, mono, w, badge, kind)"""
    t = TH
    w = sum(c[1] for c in cols)
    h = hh + rh * len(rows)
    R(p, x, y, w, h, t["panel"], t["border"], 12, name=name)
    R(p, x + 1, y + 1, w - 2, hh - 1, t["panel"], None, [11, 11, 0, 0], name="th bg")
    R(p, x, y + hh - 1, w, 1, t["border"])
    cx = x
    for title, cw, al in cols:
        LT(p, cx + 14, y, hh, title.upper(), 11, t["muted"], MONO, "Medium", ls=0.88, w=cw - 28, align=al)
        cx += cw
    ry = y + hh
    for i, row in enumerate(rows):
        if i: R(p, x, ry, w, 1, t["border"])
        cx = x
        for (title, cw, al), cell in zip(cols, row):
            if cell is None: cx += cw; continue
            if isinstance(cell, str): cell = dict(t=cell)
            if "fn" in cell:
                cell["fn"](cx + 14, ry, cw - 28, rh)
            elif "badge" in cell:
                bx = cx + 14
                if al == "right": bx = cx + cw - 14 - (tw(cell["badge"], 12, MONO, "Medium") + 32)
                sbadge(p, bx, ry + (rh - 22) / 2, cell.get("st", cell["badge"]), h=22, size=11.5, text=cell["badge"])
            else:
                mono = cell.get("mono", False); size = cell.get("s", 12.5 if mono else fs)
                font = MONO if mono else SANS
                s = fit(cell["t"], size, cw - 28, font, cell.get("wt", "Regular"))
                LT(p, cx + 14, ry, rh, s, size, cell.get("c", t["text"]), font, cell.get("wt", "Regular"), w=cw - 28, align=al)
            cx += cw
        ry += rh
    return h

def callout(p, x, y, w, tag, body, kind="note", h=None):
    t = TH
    col = {"note": (t["accent"], t["accentSoft"], t["accentText"]), "proposed": (t["violet"], t["violetSoft"], t["violetText"]),
           "verify": (t["warn"], t["warnSoft"], t["warn"]), "err": (t["err"], t["errSoft"], t["err"]),
           "ok": (t["ok"], t["okSoft"], t["ok"])}[kind]
    tagw = tw(tag.upper(), 11, MONO) + 1.0 * len(tag)
    bw = w - 32 - tagw - 12
    lines = wrapt(body, 14.5, bw)
    hh = h or (14 * 2 + 22 * len(lines))
    R(p, x, y, w, hh, col[1], t["borderS"], 12, name=f"callout {tag}")
    R(p, x, y, 3, hh, col[0], None, [12, 0, 0, 12], name="callout bar")
    M(p, x + 16, y + 16, tag.upper(), 11, col[2], "Bold", ls=0.88)
    for i, ln in enumerate(lines):
        LT(p, x + 16 + tagw + 12, y + 14 + 22 * i, 22, ln, 14.5, t["text2"])
    return hh

def wrapt(s, size, width, font=SANS, weight="Regular"):
    out, cur = [], ""
    for wd in s.split():
        tt = (cur + " " + wd).strip()
        if tw(tt, size, font, weight) <= width or not cur: cur = tt
        else: out.append(cur); cur = wd
    out.append(cur); return out

def chip(p, x, y, s, on=False, h=30, count=None, mono=False, kind=None):
    t = TH
    font = MONO if mono else SANS
    w = tw(s, 13, font, "Medium") + 24 + (tw(str(count), 11, MONO) + 8 if count is not None else 0) + (12 if kind else 0)
    if on:
        R(p, x, y, w, h, t["accentSoft"], t["accentBorder"], 8, name=f"chip {s} on")
    else:
        R(p, x, y, w, h, t["panel"], t["border"], 8, name=f"chip {s}")
    tx = x + 12
    if kind:
        fg = tone(kind)[0]; E(p, x + 12, y + h / 2 - 3, 6, 6, fg if kind != "errSolid" else TH["err"]); tx += 12
    LT(p, tx, y, h, s, 13, t["accentText"] if on else t["text2"], font, "Medium")
    if count is not None:
        LT(p, tx + tw(s, 13, font, "Medium") + 8, y, h, str(count), 11, t["muted"], MONO)
    return w

def save(path):
    json.dump(steps, open(path, "w"), ensure_ascii=False)
    print(len(steps), "steps ->", path)
