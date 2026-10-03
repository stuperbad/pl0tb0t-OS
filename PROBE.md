# Pen probe + live pen offsets

Branch `probe-station`. Adds a fixed 3-axis touch probe (PGFUN-style CNC
touch probe, NC, mounted stylus-up in the front-left of the utility lane) and
a way to apply each pen's offset **while streaming** instead of baking it into
the G-code.

## What changed

| File | Change |
|---|---|
| `pl0tb0t_probe.py` (new) | Probe routine, offset rewriting, directive format. No Qt/serial — testable offline. |
| `pl0tb0t_daemon.py` | Understands `@PL0T` directives mid-stream, runs the probe, adds the offset to X/Y/Z of every non-G53 absolute line. New `probe` command. Reports GRBL `Pn:` pins. |
| `pl0tb0t_OS.py` | *Pen Probe* panel (Machine tab, middle column). "Live pen offsets" mode for G-code generation. Runner passes directives + probe settings through. v0.5.228. |
| `tests/` | `test_probe.py` (fake GRBL + stylus geometry), `test_daemon_live.py` (real daemon over a pty). |

## Three modes

1. **Classic** (default, *Live pen offsets* off) — nothing changes; output is
   byte-identical to before.
2. **Live, predicted** (*Live pen offsets* on, probe off) — G-code is generated
   neutral with a `;@PL0T {"op":"pen",...,"pred":[dx,dy,dz]}` line after each
   pickup and `;@PL0T {"op":"clear"}` before each drop. The daemon applies
   `pred` — the exact numbers that used to be baked in. **Usable today**: turn it
   on, plot something you've plotted before, it should come out identical.
   Those files then keep working if you change pen types later.
3. **Live, probed** (*Probe every pen at pickup* on + a reference set) — after
   each pickup the daemon measures the pen and applies
   `measured − reference (+ per-type Z trim)` instead.

Old G-code with no `;@PL0T` lines always streams exactly as it did.
Offsets are applied by rewriting lines in the daemon — nothing is written to
GRBL's G54/G92/TLO, so an aborted plot can't leave a stale offset behind.

## Bring-up when the probe arrives

1. **Wire it.** Verified on the X-Controller with a CNCTOPBAOS V6, which is an
   NPN normally-**open** sensor: yellow → PROBE, black → the GND beside it, red →
   the **M7 (mist)** terminal, which reads a steady 5 V while M7 is on (5 V is also
   the safe level for this probe). Never put red on a limit or PROBE terminal.
   The probe therefore only has power while M7 is on: the daemon sends `M7` before
   each measurement and `M9` after (`probe_power_on` / `probe_power_off` /
   `probe_power_settle`; set them to `""` if the probe is powered another way).
   In our setup an unpowered probe reads TRIGGERED, which is expected, not a fault.
2. Leave `$6=0` (the default). An NPN-NO sensor pulls the line to ground when
   triggered, which is what GRBL's normal setting expects; `$6=1` is only for a
   normally-closed probe. Verified: open at rest, TRIGGERED when pressed.
3. *Pen Probe* panel should say **Probe input: open**; push the stylus and it
   should say **TRIGGERED**. If it's backwards, `$6` is wrong. If it shows
   TRIGGERED with the stylus untouched and won't clear, check the wiring —
   GRBL refuses to probe from a triggered state (ALARM 4), which is the
   fail-safe you want.
4. Bench test with nothing moving near it: `G91 G38.3 Z-5 F50` with the
   carriage well above the stylus, push the stylus by hand mid-move → it should
   stop and print `[PRB:...:1]`. Send `G90` afterwards.
5. Set **Travel Z** to a machine Z where the *longest* pen clears the stylus.
6. Load the **zero pen** (the one Work Zero / Contact Z were set with), jog its
   tip to within ~1 mm over the stylus, **Teach XY here**.
7. Raise it a few mm, **Set reference**. It plunges (fast then slow), touches
   ±X and ±Y just below the crown, re-touches Z centred. The result line shows
   contact widths — expect about ball Ø + tip Ø (≈2–3 mm with the 2 mm ball).
8. **Probe loaded pen** a few times with the same pen: corrections should
   repeat within a few hundredths. Then with other pens.
9. Tick *Live pen offsets* and *Probe every pen at pickup*, regenerate, plot.
10. Tune each pen type's **Z trim** after a test plot (soft tips squash a little
    under the probe's ~2.7 N).

## Probe sequence (per pen, ~20–40 s)

wait for motion to finish → G53 up to Travel Z → along the lane in X → over
the stylus in Y → rough Z touch at the predicted height (walks a small grid if
it misses the 2 mm crown) → hop over, drop *XY depth* below the crown, touch
from −X and +X, then −Y and +Y (midpoints = centre) → final Z touch centred →
back to where the stream left the carriage → carry on streaming with the new
offset. Fast touch at *Fast feed*, then *Samples* slow touches that must agree
within *Tolerance*. G38.3 is used so a miss is a clean error, not an alarm.

If a probe fails mid-plot the default is to **stop** (the error names the
pen and why). *Warn, use predicted offsets* keeps going instead.

## Known limits / to do

- Resume-from-line re-probes the pen for the layer it resumes into (on purpose).
- The G-code viewer's "Send selected / next line" debug tools don't apply live
  offsets.
- The stock 2 mm ball stylus is a small Z target; a flat-top stylus would make
  the rough Z touch more forgiving (the miss-grid covers ±1.6 mm meanwhile).
- The bracket (front-left, bolts to the front 20 mm extrusion, stylus top near
  paper height) isn't designed yet — wait for the probe's real dimensions.
