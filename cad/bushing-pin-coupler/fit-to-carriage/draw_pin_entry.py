"""Pin entering the funnel and the chamfered bushing: first touch (2.0 mm off), funnel bottom reached (offset <= bottom play),
the pin's bullet tip on the bushing lead-in chamfer, and seated.  Section across one pin."""
import os, numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import fit as F

R, TR, TL = F.PIN_D / 2, F.TIP_R, F.TIP_L
RM, RB, FD, RBORE, CH = F.FUN_R_MOUTH, F.FUN_R_BOT, F.FUN_DEPTH, F.BUSH_ID / 2, F.BUSH_CH
fig, axs = plt.subplots(1, 4, figsize=(22, 6.2), sharey=True)


def scene(ax, e, tip_y, title):
    for s in (-1, 1):
        ax.plot([s * 6, s * RM, s * RB], [0, 0, -FD], color="#555", lw=2)                       # printed funnel (45 deg)
        ax.plot([s * RB, s * (RBORE + CH)], [-FD, -FD], color="#b8741f", lw=3)                  # bushing end face (0.25 shelf, never reached)
        ax.plot([s * (RBORE + CH), s * RBORE], [-FD, -FD - CH], color="#b8741f", lw=3)          # bushing lead-in chamfer 0.4 x 45
        ax.plot([s * RBORE, s * RBORE], [-FD - CH, -FD - 5], color="#b8741f", lw=3)             # bore
    ax.fill_between([-6, -RM], [0, 0], [-3, -3], color="#ddd"); ax.fill_between([RM, 6], [0, 0], [-3, -3], color="#ddd")
    TF = R - TR
    px = [e - R, e - R, e - TF, e + TF, e + R, e + R]
    py = [tip_y + 7, tip_y + TL, tip_y, tip_y, tip_y + TL, tip_y + 7]
    ax.fill(px, py, color="#2b4c7e", alpha=0.85)
    ax.axvline(0, color="#aaa", lw=0.6, ls=":")
    ax.set_aspect("equal"); ax.set_xlim(-6, 6); ax.set_ylim(-7, 6); ax.set_title(title, fontsize=10); ax.grid(alpha=.25)


bottom_play = RB - R
scene(axs[0], 2.0, 0.5, "1. first touch: pin 2.0 mm off\npin edge %.2f of mouth radius %.2f" % (2.0 + R, RM))
scene(axs[1], bottom_play, -FD, "2. tip reaches the funnel bottom:\nfunnel left it %.2f off centre (tip flat radius %.2f)" % (bottom_play, R - TR))
scene(axs[2], 0.15, -FD - CH - 0.6, "3. bullet tip entering over the lead-in chamfer\n(centred to ~0.15)")
scene(axs[3], 0.0, -FD - 4.2, "4. seated in the bore")
axs[0].set_ylabel("mm  (ledge top = 0, pin enters going down)")
fig.tight_layout(); fig.savefig(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pin_entry.png"), dpi=62); print("ok")
