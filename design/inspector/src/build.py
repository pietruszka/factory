from lib import *
import f_runlist, f_detail, f_step, f_gates, f_live, f_broken, f_tokens
f_runlist.runlist(0, 0, DARK, "01 Run list · dark")
f_detail.detail(1640, 0, DARK, "02 Run detail · timeline")
f_step.step(3280, 0, DARK, "03 Step detail")
f_gates.gates(4920, 0, DARK, "04 Gate evidence · mockup check")
f_live.live(0, 1800, DARK, "05 Live run")
f_broken.broken(1640, 1800, DARK, "06 Broken events · gaps")
f_runlist.runlist(3280, 1800, LIGHT, "07 Run list · light")
f_tokens.sheet(4920, 1800, DARK, "08 Status tokens")
import os
save(os.path.join(os.path.dirname(os.path.abspath(__file__)), "inspector.script.json"))
