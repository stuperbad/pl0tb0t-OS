"""Why the flat of the pin can never land on the flat of the bushing: worst-case sideways error through the funnel (section across one pin)."""
import os, numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import fit as F

R, C, RM, RB, FD = F.PIN_D / 2, F.TIP_CH, F.FUN_R_MOUTH, F.FUN_R_BOT, F.FUN_DEPTH
RBORE = F.BUSH_ID / 2
fig, axs = plt.subplots(1, 3, figsize=(18, 6.5), sharey=True)

def part(ax, e, tip_y, title):
    # ledge surface at y=0 (up), funnel going down: cone from RM at y=0 to RB at y=-FD, then bushing bore RBORE below, bushing OD 2.5
    for sgn in (-1, 1):
        ax.plot([sgn * 6, sgn * RM, sgn * RB, sgn * RBORE if False else sgn * RB], [0, 0, -FD, -FD], color="#555", lw=2)
        ax.plot([sgn * RB, sgn * RBORE], [-FD, -FD], color="#b8741f", lw=3)          # bushing end face (annulus RBORE..2.5 exposed under the funnel bottom)
        ax.plot([sgn * RBORE, sgn * RBORE], [-FD, -FD - 5], color="#b8741f", lw=3)
    ax.fill_between([-6, -RM], [-0.0, -0.0], [-3, -3], color="#ddd"); ax.fill_between([RM, 6], [0, 0], [-3, -3], color="#ddd")
    # pin: centre x=e, tip at tip_y, chamfer C x 45 deg, going up
    x = e
    ax.fill([x - R, x - R, x - R + C, x + R - C, x + R, x + R], [tip_y + 6, tip_y + C, tip_y, tip_y, tip_y + C, tip_y + 6], color="#2b4c7e", alpha=0.85)
    ax.axvline(0, color="#aaa", lw=0.6, ls=":")
    ax.set_aspect("equal"); ax.set_xlim(-6, 6); ax.set_ylim(-7, 6); ax.set_title(title, fontsize=10); ax.grid(alpha=.25)

part(axs[0], 2.0, 0.6, "first touch: 2.0 mm off, tip just inside the funnel mouth\n(pin edge at %.2f of the %.2f mouth radius)" % (2.0 + R, RM))
part(axs[1], 0.0 + (RB - R) , -FD + 0.0, "arrives at the bushing end face: the funnel has centred it to <= %.2f mm\ntip flat radius %.2f + offset %.2f = %.2f < bore radius %.2f" % (RB - R, R - C, RB - R, R - C + RB - R, RBORE))
part(axs[2], 0.0, -FD - 4.0, "seated: pin inside the bushing bore")
axs[0].set_ylabel("mm  (ledge top = 0, pin enters going down)")
fig.tight_layout(); fig.savefig(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pin_entry.png"), dpi=70); print("ok")
