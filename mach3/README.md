# mach3/ — big-machine gcode prep

Standalone sibling to the main pl0tb0t-OS Make-tab pipeline, for the big
Mach3-controlled machine (NUC at 192.168.0.104, hostname `pl0tb0tNuc`).
No pen changer on that machine, so this skips tool-change gcode entirely:
`prep_gcode.py` takes a multi-color SVG and emits one plain gcode file per
color, run one at a time with a manual pen swap in between.

## Why this isn't just pl0tb0t_OS.py pointed at a different profile

The color-enumeration and color-split logic (`parse_svg_layers` /
`split_svg_by_color` in `prep_gcode.py`) is ported line-for-logic from
`_parse_svg_layers` / `_split_svg_by_color` in `pl0tb0t_OS.py` — same
approach, same edge cases handled (Inkscape layer groups, inherited stroke
via `<g>`, `id="signature"` relabeling). But the rest of the pipeline is
different enough not to share:

- No tool-changer gcode (`_tool_pickup_gcode`/`_tool_drop_gcode`) — this
  machine has one manual pen mount, not the small plotter's holder array.
- Different vpype gwrite profile: G20 (inches, matching this machine's
  actual axis config) instead of the small plotter's `unit = "mm"` profile,
  and feed rates sized for this machine's servo tuning, not the small
  plotter's steppers.
- No daemon/serial streaming — this just writes `.gcode` files; you load
  them into Mach3 by hand.

## 2026-08 machine audit — why the earlier drift/skipping happened

Read-only audit of the Mach3 profile (`pl0tb0t XL.xml`), PlugIns folder, and
Windows event log, done before writing this tool:

- **Homing is real and deliberate** — `RefSpeed0`-`RefSpeed5` and a slaved
  gantry-squaring setup (`SlaveHome=1`, `Slave0=3`, `Slave2=3`) confirm
  proper 3-limit-switch homing, contradicting an earlier hasty read of the
  profile that (wrongly) concluded homing wasn't configured at all.
- **No encoder feedback into Mach3** — all `Encoder0..7` A/B pins are
  unassigned. The servo *drives* almost certainly close their own position
  loop on their own motor encoders (normal, and why results have been
  mostly good), but Mach3/the DigitalDream USB motion card have zero way to
  detect a following-error/stall/USB-hiccup if one happens — nothing
  catches it, and the next "zero" just starts from a false reference.
- **The likely actual trigger, found in real gcode**: `CMYK flow from lines
  C.gcode` (in `Downloads/`, a file the user confirms was actually run and
  produced skipping) commands `F3000` in `G21` (mm) — roughly 118 in/min if
  this profile's `<Units>0</Units>` (Mach3's standard "0 = inches" convention)
  is correctly read — against this profile's configured `Vel0 = 66.67` in/min
  max axis velocity. Mach3 silently clamps feed to the configured max rather
  than erroring, so every one of that file's ~6,776 short draw segments would
  have been commanded at ~77% over the axis ceiling, with zero speed
  headroom, on a job made of many short accelerate/decelerate segments — a
  demanding workload for an untuned servo's following-error tolerance. This
  finding stands on the CMYK file plus this machine's own profile alone.
- Also found, lower priority: `Mach3.exe` has hard-crashed 5 times since
  July 2025 (`ntdll.dll` access violation, most recent the morning before
  this audit) — infrequent, but a real stability issue worth its own look
  eventually. Backlash compensation is present in the profile but disabled
  and unconfigured (`BacklashOn=0`, all `backlash_pos*=0`) — not a
  centimeters-scale cause, but worth measuring and enabling once the bigger
  issue is settled.
- One open item never resolved: the exact "pull-off distance" setting after
  a switch is hit (the behavior where homing seats the machine on the
  switch and stays there rather than backing off) wasn't found in the
  profile XML under the tag names searched, and there's no custom Ref/Home
  macro in `Macros\Pl0tb0t XL\`. Likely a native Mach3 General
  Config/Homing field — worth pinning down directly in the Mach3 UI rather
  than guessing from the XML.

## prep_gcode.py

```
# Safe — no physical params needed, just reports what's in the file:
python prep_gcode.py --svg drawing.svg --list-only

# Real output — Z values must be MEASURED on the machine, not guessed:
python prep_gcode.py --svg drawing.svg --outdir gcode_out \
    --feed 20 --z-safe 3.3465 --z-lift 0.1575 --z-draw 0.0 --flip-y
```

Z-safe/Z-lift/Z-draw and `--flip-y` have no default on purpose — see the
warning in the script's own docstring. Current working values for this
machine (confirmed by the user, 2026-08): lift 4mm (0.1575in), safe travel
~85mm (3.3465in), draw at exactly 0 (zeroed with pen touching paper),
flip-Y on (SVG is Y-down, this machine's zero is bottom-left).

Feed default is 20 in/min — deliberately conservative relative to the
configured 66.67 in/min axis ceiling. Raise it deliberately after a
successful run, not by guessing.
