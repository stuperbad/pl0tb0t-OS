#!/usr/bin/env python3
"""
prep_gcode.py -- SVG -> per-color G-code for the big Mach3 machine.

Standalone sibling to pl0tb0t-OS (github.com/stuperbad/pl0tb0t-OS). Reuses
that project's exact colour-enumeration and colour-split logic (ported
verbatim from pl0tb0t_OS.py's _parse_svg_layers / _split_svg_by_color), but
skips its tool-changer G-code entirely: this machine has no pen changer, so
each colour becomes its own separate .gcode file that you load and run one
at a time, swapping the pen by hand in between.

SAFETY: this machine has no encoder feedback to Mach3 and (per the last
session's audit) commanding a feed rate above the axis's configured max
velocity gets silently clamped -- that's the leading theory for the
skipping you saw on "CMYK flow from lines C.gcode" (F3000 mm/min = ~118
in/min, vs. a configured Vel0 of 66.67 in/min). Default --feed here is
conservative and well under that ceiling; raise it deliberately, not by
guessing.

Z heights (--z-safe / --z-lift / --z-draw) and --flip-y have NO default on
purpose. The two sample files found on this machine disagreed wildly on Z
convention, and a wrong Z-draw can drive the pen mount into the bed. Supply
real values (verified by hand-jogging Mach3, not guessed) before running
anything for real. --list-only works with none of this and is always safe.

Usage:
    # Safe, no physical params needed -- just see what's in the file:
    python prep_gcode.py --svg drawing.svg --list-only

    # Generate real gcode (Z values must be measured on the machine first):
    python prep_gcode.py --svg drawing.svg --outdir gcode_out \\
        --feed 20 --z-safe 0.5 --z-lift 0.1 --z-draw -0.02 --flip-y
"""
import argparse
import copy
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

DRAW_TAGS = {"path", "line", "polyline", "polygon", "circle", "ellipse"}
INK_NS = "http://www.inkscape.org/namespaces/inkscape"
_SKIP_COLORS = {"none", "inherit", "transparent", "white", "#ffffff", "#fff"}

_NS_MAP = [
    ("", "http://www.w3.org/2000/svg"),
    ("xlink", "http://www.w3.org/1999/xlink"),
    ("inkscape", "http://www.inkscape.org/namespaces/inkscape"),
    ("sodipodi", "http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd"),
    ("dc", "http://purl.org/dc/elements/1.1/"),
    ("cc", "http://creativecommons.org/ns#"),
    ("rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"),
]
for _prefix, _uri in _NS_MAP:
    ET.register_namespace(_prefix, _uri)


# ---------------------------------------------------------------------------
# Ported verbatim (logic-for-logic) from pl0tb0t_OS.py's
# _parse_svg_layers / _split_svg_by_color -- see that file for the original,
# Qt-bound versions this was lifted from.
# ---------------------------------------------------------------------------

def _style_color(style_str):
    m = re.search(r"stroke\s*:\s*([^;]+)", style_str or "")
    if m:
        val = m.group(1).strip()
        if val.lower() not in _SKIP_COLORS:
            return val
    return None


def _elem_color(el):
    c = _style_color(el.get("style", ""))
    if c:
        return c
    v = el.get("stroke", "")
    if v and v.lower() not in _SKIP_COLORS:
        return v
    return None


def _tag_of(el):
    return el.tag.split("}")[-1] if "}" in el.tag else el.tag


def parse_svg_layers(svg_path):
    """Return [{'label': ..., 'color': ...}, ...] in first-seen order."""
    layers = []
    tree = ET.parse(svg_path)
    root = tree.getroot()

    def layer_dominant_color(group):
        def _find(el, inh=""):
            c = _elem_color(el) or inh
            if _tag_of(el) in DRAW_TAGS:
                return c if c else None
            child_inh = _elem_color(el) or inh
            for child in el:
                result = _find(child, child_inh)
                if result:
                    return result
            return None
        return _find(group)

    ink_layers = [el for el in root.iter() if el.get(f"{{{INK_NS}}}groupmode") == "layer"]
    if ink_layers:
        for g in ink_layers:
            label = g.get(f"{{{INK_NS}}}label", "Unnamed Layer")
            layers.append({"label": label, "color": layer_dominant_color(g)})
    else:
        seen = []

        def _collect(el, inh=""):
            c = _elem_color(el) or inh
            if _tag_of(el) in DRAW_TAGS:
                if c and c not in seen and c.lower() not in _SKIP_COLORS:
                    seen.append(c)
                    layers.append({"label": c, "color": c})
            else:
                child_inh = _elem_color(el) or inh
                for child in el:
                    _collect(child, child_inh)
        for child in root:
            _collect(child)
    return layers


def split_svg_by_color(svg_path, target_color, out_path):
    """Write a copy of svg_path containing only elements whose resolved
    stroke matches target_color. Returns True if anything was written."""
    target = target_color.lower()
    tree = ET.parse(svg_path)
    root = tree.getroot()
    new_root = ET.Element(root.tag, root.attrib)
    found = False

    def filtered_copy(el, inherited=""):
        nonlocal found
        el_stroke = _elem_color(el) or inherited
        if _tag_of(el) in DRAW_TAGS:
            if el_stroke == target:
                found = True
                return copy.deepcopy(el)
            return None
        if _tag_of(el) == "g":
            child_inh = _elem_color(el) or inherited
            new_g = ET.Element(el.tag, el.attrib)
            for child in el:
                copied = filtered_copy(child, child_inh)
                if copied is not None:
                    new_g.append(copied)
            return new_g if len(new_g) else None
        return None

    for child in root:
        copied = filtered_copy(child)
        if copied is not None:
            new_root.append(copied)
    if not found:
        return False
    ET.ElementTree(new_root).write(out_path, encoding="unicode", xml_declaration=True)
    return True


def svg_page_size(svg_path):
    """Best-effort (width, height, unit-string) straight off the <svg> tag,
    for a sanity check against the machine's actual travel before running."""
    with open(svg_path, "r", encoding="utf-8", errors="ignore") as f:
        head = f.read(4000)
    w = re.search(r'\bwidth\s*=\s*"([\d.]+)([a-zA-Z%]*)"', head)
    h = re.search(r'\bheight\s*=\s*"([\d.]+)([a-zA-Z%]*)"', head)
    vb = re.search(r'\bviewBox\s*=\s*"([^"]+)"', head)
    return (
        (w.group(1), w.group(2)) if w else (None, None),
        (h.group(1), h.group(2)) if h else (None, None),
        vb.group(1) if vb else None,
    )


# ---------------------------------------------------------------------------
# Mach3-appropriate vpype gwrite profile.
#
# Deliberately does NOT reuse pl0tb0t-OS's own [gwrite.pl0tb0t_layer] profile
# unit/values (unit="mm", speed tuned for the small GRBL plotter) -- this
# machine's axis config is in inches (<Units>0</Units> in the Mach3 profile)
# and has no pen-changer Z offsets. No $H, no M-codes, no G53 tool-change
# moves -- just G20 G90, safe-Z travel, and a plain draw feed clamped well
# under this axis's configured Vel0 (66.67 in/min; see README.md for how
# that number was derived).
# ---------------------------------------------------------------------------

def write_vpype_profile(cfg_path, z_safe, z_lift, z_draw, feed, flip_y, units):
    content = (
        f'[gwrite.mach3_layer]\n'
        f'unit = "{units}"\n'
        f'vertical_flip = {"true" if flip_y else "false"}\n'
        f'segment_first = "G0 Z{z_lift:.4f}\\nG0 X{{x:.4f}} Y{{y:.4f}}\\nG1 Z{z_draw:.4f} F{feed}\\n"\n'
        f'segment = "G1 X{{x:.4f}} Y{{y:.4f}} F{feed}\\n"\n'
    )
    with open(cfg_path, "w") as f:
        f.write(content)


def run_vpype(svg_path, cfg_path, out_path):
    # -c <file> is a GLOBAL vpype flag (which config file to load) and must
    # come before the pipeline steps; gwrite's own -p then selects the
    # profile NAME from within that file (the [gwrite.mach3_layer] section
    # header below), not a path. Matches how pl0tb0t_OS.py's
    # _run_vpype_cmd invokes it.
    cmd = ["vpype", "-c", cfg_path, "read", svg_path, "gwrite", "-p", "mach3_layer", out_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode == 0, result.stdout, result.stderr


def safe_filename(color):
    return re.sub(r"[^A-Za-z0-9]+", "", color)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--svg", required=True, help="Source SVG (already sized to real-world units)")
    ap.add_argument("--outdir", default="gcode_out", help="Where per-colour .gcode files go")
    ap.add_argument("--list-only", action="store_true", help="Just report colours/page size, write nothing")
    ap.add_argument("--feed", type=float, default=20.0, help="Draw feed, units/min (default 20, conservative vs. this axis's Vel0=66.67 in/min)")
    ap.add_argument("--units", choices=["in", "mm"], default="in", help="vpype coordinate unit (default in -- matches this machine's axis config)")
    ap.add_argument("--z-safe", type=float, default=None, help="REQUIRED for real output: Z height for rapid travel between colours")
    ap.add_argument("--z-lift", type=float, default=None, help="REQUIRED for real output: Z height for pen-up travel within a colour")
    ap.add_argument("--z-draw", type=float, default=None, help="REQUIRED for real output: Z height for pen-down drawing")
    ap.add_argument("--flip-y", action="store_true", help="Flip Y (typical for SVG->machine; verify against a real move before trusting)")
    args = ap.parse_args()

    if not os.path.exists(args.svg):
        print(f"ERROR: not found: {args.svg}", file=sys.stderr)
        sys.exit(1)

    (ww, wu), (hh, hu), vb = svg_page_size(args.svg)
    print(f"Page size (from <svg> tag): width={ww}{wu or ''}  height={hh}{hu or ''}  viewBox={vb}")
    print("  -> sanity-check this against the machine's actual travel before running anything.\n")

    print("Parsing layers/colours ...")
    layers = parse_svg_layers(args.svg)
    seen = []
    for l in layers:
        c = (l.get("color") or "").lower()
        if c and c not in seen:
            seen.append(c)
    print(f"Found {len(seen)} distinct colour(s): {seen}\n")

    if args.list_only:
        print("(--list-only: nothing written)")
        return

    missing = [n for n, v in [("--z-safe", args.z_safe), ("--z-lift", args.z_lift), ("--z-draw", args.z_draw)] if v is None]
    if missing:
        print("Refusing to generate real G-code: missing " + ", ".join(missing) + ".", file=sys.stderr)
        print("These have no default on purpose -- measure them on the actual machine first.", file=sys.stderr)
        sys.exit(2)

    os.makedirs(args.outdir, exist_ok=True)
    tmp_dir = os.path.join(args.outdir, "_tmp")
    os.makedirs(tmp_dir, exist_ok=True)

    for i, color in enumerate(seen):
        print(f"[{i+1}/{len(seen)}] {color} ...")
        split_path = os.path.join(tmp_dir, f"split_{safe_filename(color)}.svg")
        if not split_svg_by_color(args.svg, color, split_path):
            print(f"  no drawable paths for {color}, skipping")
            continue

        cfg_path = os.path.join(tmp_dir, "mach3_profile.toml")
        write_vpype_profile(cfg_path, args.z_safe, args.z_lift, args.z_draw, args.feed, args.flip_y, args.units)

        base = os.path.splitext(os.path.basename(args.svg))[0]
        out_path = os.path.join(args.outdir, f"{base}__{safe_filename(color)}.gcode")
        preamble_path = out_path + ".tmp"

        ok, out, err = run_vpype(split_path, cfg_path, preamble_path)
        if not ok:
            print(f"  vpype FAILED: {err.strip()}", file=sys.stderr)
            continue

        units_cmd = "G20" if args.units == "in" else "G21"
        with open(preamble_path, "r", encoding="utf-8", errors="ignore") as f:
            body = f.read()
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(f"; pl0tb0t-mach3 prep_gcode.py -- colour {color}\n")
            f.write(f"{units_cmd} G90\n")
            f.write(f"G0 Z{args.z_safe:.4f}\n")
            f.write(body)
            f.write(f"\nG0 Z{args.z_safe:.4f}\nM2\n")
        os.remove(preamble_path)
        print(f"  -> {out_path}")

    print("\nDone. Load ONE file at a time in Mach3, swap the pen between colours.")
    print("Before running for real: air-cut (Z well above paper) the first colour and watch it.")


if __name__ == "__main__":
    main()
