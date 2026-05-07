#!/usr/bin/env python3
"""
Pl0tb0t OS: menu-driven controller for GRBL plotters + art workflows.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Tuple, Iterable

try:
    import serial
    from serial.tools import list_ports
except Exception:  # pragma: no cover - only hit when pyserial missing
    serial = None
    list_ports = None

import stream

CONFIG_PATH = "pl0tb0t_os_config.json"
TOOLS_PATH = "pl0tb0t_tools.json"


@dataclass
class Tool:
    name: str
    color: str
    x: float
    y: float
    z: float
    safe_z: float


@dataclass
class OSConfig:
    port: Optional[str] = None
    baud: int = 115200
    tools_path: str = TOOLS_PATH
    planner_path: str = "pl0tb0t_toolplan.json"


# -------------------------
# Config + tools persistence
# -------------------------

def load_json(path: str, default: Dict) -> Dict:
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str, data: Dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)


def load_config(path: str = CONFIG_PATH) -> OSConfig:
    data = load_json(path, {})
    return OSConfig(
        port=data.get("port"),
        baud=int(data.get("baud", 115200)),
        tools_path=data.get("tools_path", TOOLS_PATH),
        planner_path=data.get("planner_path", "pl0tb0t_toolplan.json"),
    )


def save_config(config: OSConfig, path: str = CONFIG_PATH) -> None:
    save_json(path, asdict(config))


def load_tools(path: str) -> List[Tool]:
    data = load_json(path, {"tools": []})
    tools: List[Tool] = []
    for item in data.get("tools", []):
        tools.append(
            Tool(
                name=item.get("name", "tool"),
                color=item.get("color", "black"),
                x=float(item.get("x", 0)),
                y=float(item.get("y", 0)),
                z=float(item.get("z", 0)),
                safe_z=float(item.get("safe_z", 0)),
            )
        )
    return tools


def save_tools(path: str, tools: List[Tool]) -> None:
    payload = {"tools": [asdict(t) for t in tools]}
    save_json(path, payload)


def resolve_tool(tools: List[Tool], name_or_color: str) -> Optional[Tool]:
    target = name_or_color.strip().lower()
    for t in tools:
        if t.name.lower() == target:
            return t
    for t in tools:
        if t.color.lower() == target:
            return t
    return None


# -------------------------
# Tool change planner
# -------------------------

def load_toolplan(path: str) -> Dict:
    return load_json(path, {"layers": []})


def save_toolplan(path: str, data: Dict) -> None:
    save_json(path, data)


def _iter_gcode_lines(path: str) -> Iterable[str]:
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            yield line.rstrip("\n")


def _write_lines(path: str, lines: Iterable[str]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for line in lines:
            f.write(line + "\n")


def generate_toolchange_gcode(tools: List[Tool], plan: Dict, out_path: str) -> None:
    layers = plan.get("layers", [])
    safe_z = float(plan.get("safe_z", 0))
    park = plan.get("park", {"x": 0, "y": 0, "z": safe_z})
    park_x = float(park.get("x", 0))
    park_y = float(park.get("y", 0))
    park_z = float(park.get("z", safe_z))

    output: List[str] = []
    output.append("; Pl0tb0t tool change plan")
    output.append("G90")
    output.append("G21")

    for idx, layer in enumerate(layers, start=1):
        color = layer.get("color", "")
        tool_name = layer.get("tool", color)
        gcode_path = layer.get("gcode")
        if not gcode_path:
            raise ValueError(f"Layer {idx} missing gcode path")
        tool = resolve_tool(tools, tool_name)
        if tool is None:
            raise ValueError(f"Layer {idx} tool not found: {tool_name}")

        output.append(f"; --- Layer {idx}: {color or tool.name} ---")
        output.append(f"G0 Z{safe_z:.3f}")
        output.append(f"G0 X{tool.x:.3f} Y{tool.y:.3f}")
        output.append(f"G0 Z{tool.z:.3f}")
        output.append("; Tool pickup")
        output.append(f"G0 Z{tool.safe_z:.3f}")
        output.append(f"G0 X{park_x:.3f} Y{park_y:.3f} Z{park_z:.3f}")
        output.append(f"; Begin layer gcode: {gcode_path}")
        output.extend(_iter_gcode_lines(gcode_path))
        output.append(f"; End layer gcode: {gcode_path}")

    _write_lines(out_path, output)


# -------------------------
# GRBL helpers
# -------------------------

def require_serial() -> None:
    if serial is None:
        print("pyserial not available. Install dependencies first.")
        sys.exit(1)


def list_serial_ports() -> List[Tuple[str, str]]:
    require_serial()
    ports = []
    for p in list_ports.comports():
        ports.append((p.device, p.description))
    return ports


def open_port(port: str, baud: int) -> "serial.Serial":
    require_serial()
    s = serial.Serial(port, baud, timeout=1.0)
    time.sleep(2)
    return s


def grbl_send(port: "serial.Serial", command: str, wait_ok: bool = True, verbose: bool = False) -> List[str]:
    if not command.endswith("\n"):
        command = command + "\n"
    if verbose:
        print("SND:", command.strip())
    port.write(command.encode("utf-8"))
    responses = []
    if wait_ok:
        empty_count = 0
        while True:
            line = port.readline().decode("utf-8", errors="ignore").strip()
            if not line:
                empty_count += 1
                if empty_count >= 10:
                    break  # port not responding, give up
                continue
            empty_count = 0
            responses.append(line)
            if verbose:
                print("RCV:", line)
            if line.lower().startswith("ok") or "error" in line.lower() or "alarm" in line.lower():
                break
    return responses


def grbl_home(port: "serial.Serial", verbose: bool = False) -> None:
    grbl_send(port, "$H", wait_ok=True, verbose=verbose)
    stream.wait_idle(port, verbose=verbose)


def grbl_status(port: "serial.Serial") -> str:
    port.write(b"?\n")
    line = port.readline().decode("utf-8", errors="ignore").strip()
    return line


def grbl_jog(port: "serial.Serial", axis: str, distance: float, feed: float, units: str = "mm") -> None:
    axis = axis.upper()
    if axis not in {"X", "Y", "Z"}:
        raise ValueError("axis must be X, Y, or Z")
    unit_cmd = "G21" if units == "mm" else "G20"
    cmd = f"$J=G91 {unit_cmd} {axis}{distance:.3f} F{feed:.1f}"
    grbl_send(port, cmd, wait_ok=False)


def grbl_move_abs(
    port: "serial.Serial",
    x: float,
    y: float,
    z: float,
    feed: Optional[float] = None,
    use_machine_coords: bool = False,
) -> None:
    """Move in absolute coordinates; optionally force machine coordinates (G53)."""
    coord_prefix = "G53 " if use_machine_coords else ""
    if feed is None:
        cmd = f"G90 {coord_prefix}G0 X{x:.3f} Y{y:.3f} Z{z:.3f}"
    else:
        cmd = f"G90 {coord_prefix}G1 X{x:.3f} Y{y:.3f} Z{z:.3f} F{feed:.1f}"
    grbl_send(port, cmd, wait_ok=True)


# -------------------------
# Tooling helpers
# -------------------------

def find_tool(tools: List[Tool], name: str) -> Optional[Tool]:
    for tool in tools:
        if tool.name.lower() == name.lower():
            return tool
    return None


def add_or_update_tool(tools: List[Tool], tool: Tool) -> None:
    existing = find_tool(tools, tool.name)
    if existing is None:
        tools.append(tool)
    else:
        existing.color = tool.color
        existing.x = tool.x
        existing.y = tool.y
        existing.z = tool.z
        existing.safe_z = tool.safe_z


def remove_tool(tools: List[Tool], name: str) -> bool:
    for i, tool in enumerate(tools):
        if tool.name.lower() == name.lower():
            tools.pop(i)
            return True
    return False


def export_vpype_config(tools: List[Tool], output_path: str) -> None:
    """Export tools as a vpype-compatible config file for G-code generation"""
    lines = [
        "# Pl0tb0t vpype configuration with tool-change macros",
        "# Auto-generated for multi-color plotting with dove-tail tool changer",
        "",
        "[gwrite.pl0tb0t]",
        'unit = "mm"',
        'vertical_flip = true',
        "",
        '# Document setup',
        'document_start = """G90',
        'G21',
        'G0 Z50',
        'M3',
        'G4 P0.5',
        '"""',
        "",
        '# Tool change sequence (picks up tool from dove-tail holder)',
        '# Tool positions should be configured with X spacing in 50mm increments',
        "",
    ]
    
    # Generate layer_start with tool-change macros for each layer
    lines.append("# Layer-to-tool mapping (customize based on your SVG layer colors)")
    lines.append('[gwrite.pl0tb0t]')
    lines.append('layer_start = """')
    lines.append("; === TOOL CHANGE SEQUENCE (Layer {layer_index1:d}) ===")
    lines.append("; Move to safe Z")
    lines.append("G0 Z50")
    lines.append("; Move to approach position (tool X, tool Y+50)")
    lines.append("G0 X{tool_x:.3f} Y{tool_y_approach:.3f}")
    lines.append("; Move down to engage (Z{tool_z:.3f})")
    lines.append("G0 Z{tool_z:.3f}")
    lines.append("; Short pause to let tool seat")
    lines.append("G4 P0.2")
    lines.append("; Move to tool holder Y (clipping in)")
    lines.append("G0 Y{tool_y:.3f}")
    lines.append("; Lift tool out (+50mm Z)")
    lines.append("G0 Z{tool_z_lifted:.3f}")
    lines.append("; Return to drawing approach Y")
    lines.append("G0 Y{tool_y_approach:.3f}")
    lines.append("; Ready to draw")
    lines.append('"""')
    lines.append("")
    
    lines.append('layer_end = """')
    lines.append("; === END LAYER {layer_index1:d} ===")
    lines.append("; Move to safe Z")
    lines.append("G0 Z50")
    lines.append("; Move to approach position to remove tool")
    lines.append("G0 X{tool_x:.3f} Y{tool_y_approach:.3f}")
    lines.append("; Move down to tool holder")
    lines.append("G0 Z{tool_z:.3f}")
    lines.append("; Move into holder (unclipping)")
    lines.append("G0 Y{tool_y:.3f}")
    lines.append("; Lift carriage")
    lines.append("G0 Z50")
    lines.append("; Move back to approach")
    lines.append("G0 Y{tool_y_approach:.3f}")
    lines.append('"""')
    lines.append("")
    
    lines.append('segment_first = "G0 X{x:.3f} Y{y:.3f}\\n"')
    lines.append('segment = "G1 X{x:.3f} Y{y:.3f}\\n"')
    lines.append('document_end = """')
    lines.append("G0 Z50")
    lines.append("M5")
    lines.append("M2")
    lines.append('"""')
    lines.append("")
    
    lines.append("# Tool definitions (update these based on your calibration)")
    for i, tool in enumerate(tools):
        tool_x = 100 + (i * 50)  # Tools spaced 50mm apart starting at X=100
        tool_y = 100  # All at same Y
        tool_z = 50  # Z position to clip
        tool_y_approach = tool_y + 50  # Approach height
        tool_z_lifted = tool_z + 50  # Lifted position
        
        lines.append(f"# Tool {i+1}: {tool.name} (X={tool_x}, Y={tool_y}, Z={tool_z})")
        lines.append(f"# Color: {tool.color}")
    
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    
    print(f"Vpype config exported to {output_path}")


# -------------------------
# Art integration
# -------------------------

def run_ui_py() -> int:
    return subprocess.call([sys.executable, "UI.py"])


def plot_gcode_file(port: str, baud: int, gcode_path: str, home_first: bool, verbose: bool = False) -> None:
    if not os.path.exists(gcode_path):
        raise FileNotFoundError(gcode_path)
    s = open_port(port, baud)
    if home_first:
        grbl_home(s, verbose=verbose)
    with open(gcode_path, "r", encoding="utf-8") as f:
        stream.stream_gcode(s, f, verbose=verbose)
    s.close()


# -------------------------
# Interactive menu
# -------------------------

def prompt(text: str, default: Optional[str] = None) -> str:
    suffix = f" [{default}]" if default is not None else ""
    value = input(f"{text}{suffix}: ").strip()
    return value if value else (default or "")


def menu_machine(config: OSConfig) -> None:
    while True:
        print("\nMachine")
        print("1) List ports")
        print("2) Set active port")
        print("3) Home")
        print("4) Jog")
        print("5) Status")
        print("6) Send raw G-code")
        print("0) Back")
        choice = prompt(">")
        if choice == "0":
            return
        if choice == "1":
            ports = list_serial_ports()
            if not ports:
                print("No serial ports found.")
            for dev, desc in ports:
                print(f"- {dev} ({desc})")
        elif choice == "2":
            config.port = prompt("Port", config.port)
            save_config(config)
            print("Saved.")
        elif choice == "3":
            if not config.port:
                print("Set a port first.")
                continue
            s = open_port(config.port, config.baud)
            grbl_home(s, verbose=True)
            s.close()
        elif choice == "4":
            if not config.port:
                print("Set a port first.")
                continue
            axis = prompt("Axis (X/Y/Z)", "X")
            dist = float(prompt("Distance", "1.0"))
            feed = float(prompt("Feed", "500"))
            units = prompt("Units (mm/in)", "mm")
            s = open_port(config.port, config.baud)
            grbl_jog(s, axis, dist, feed, units=units)
            s.close()
        elif choice == "5":
            if not config.port:
                print("Set a port first.")
                continue
            s = open_port(config.port, config.baud)
            print(grbl_status(s))
            s.close()
        elif choice == "6":
            if not config.port:
                print("Set a port first.")
                continue
            cmd = prompt("G-code line")
            s = open_port(config.port, config.baud)
            grbl_send(s, cmd, wait_ok=True, verbose=True)
            s.close()


def menu_tools(config: OSConfig) -> None:
    tools = load_tools(config.tools_path)
    while True:
        print("\nTools")
        print("1) List tools")
        print("2) Add/Update tool")
        print("3) Remove tool")
        print("4) Move to tool")
        print("5) Tool change planner")
        print("0) Back")
        choice = prompt(">")
        if choice == "0":
            save_tools(config.tools_path, tools)
            return
        if choice == "1":
            if not tools:
                print("No tools configured.")
            for t in tools:
                print(f"- {t.name} color={t.color} x={t.x} y={t.y} z={t.z} safe_z={t.safe_z}")
        elif choice == "2":
            name = prompt("Name")
            color = prompt("Color", "black")
            x = float(prompt("X", "0"))
            y = float(prompt("Y", "0"))
            z = float(prompt("Z", "0"))
            safe_z = float(prompt("Safe Z", "0"))
            add_or_update_tool(tools, Tool(name=name, color=color, x=x, y=y, z=z, safe_z=safe_z))
            save_tools(config.tools_path, tools)
            print("Saved.")
        elif choice == "3":
            name = prompt("Name")
            if remove_tool(tools, name):
                save_tools(config.tools_path, tools)
                print("Removed.")
            else:
                print("Tool not found.")
        elif choice == "4":
            if not config.port:
                print("Set a port first.")
                continue
            name = prompt("Name")
            tool = find_tool(tools, name)
            if tool is None:
                print("Tool not found.")
                continue
            s = open_port(config.port, config.baud)
            if tool.safe_z != tool.z:
                grbl_move_abs(s, tool.x, tool.y, tool.safe_z)
            grbl_move_abs(s, tool.x, tool.y, tool.z)
            s.close()
        elif choice == "5":
            plan_path = prompt("Plan file", config.planner_path)
            plan = load_toolplan(plan_path)
            if not plan.get("layers"):
                plan["layers"] = []
            count = int(prompt("Number of layers", str(len(plan["layers"]) or 0)))
            layers = []
            for i in range(count):
                color = prompt(f"Layer {i+1} color/tool")
                gcode = prompt(f"Layer {i+1} gcode path")
                layers.append({"color": color, "gcode": gcode})
            plan["layers"] = layers
            plan["safe_z"] = float(prompt("Safe Z", str(plan.get("safe_z", 0))))
            park = plan.get("park", {"x": 0, "y": 0, "z": plan["safe_z"]})
            park["x"] = float(prompt("Park X", str(park.get("x", 0))))
            park["y"] = float(prompt("Park Y", str(park.get("y", 0))))
            park["z"] = float(prompt("Park Z", str(park.get("z", plan["safe_z"]))))
            plan["park"] = park
            save_toolplan(plan_path, plan)
            out_path = prompt("Output gcode path", "toolplan_combined.gcode")
            generate_toolchange_gcode(tools, plan, out_path)
            print(f"Wrote {out_path}")


def menu_art(config: OSConfig) -> None:
    while True:
        print("\nArt")
        print("1) Run UI.py")
        print("2) Plot G-code file")
        print("0) Back")
        choice = prompt(">")
        if choice == "0":
            return
        if choice == "1":
            run_ui_py()
        elif choice == "2":
            if not config.port:
                print("Set a port first.")
                continue
            path = prompt("G-code path")
            home = prompt("Home first? (y/n)", "n").lower().startswith("y")
            plot_gcode_file(config.port, config.baud, path, home_first=home, verbose=True)


def run_menu(config: OSConfig) -> None:
    while True:
        print("\nPl0tb0t OS")
        print("1) Machine")
        print("2) Tools")
        print("3) Art")
        print("4) Settings")
        print("0) Exit")
        choice = prompt(">")
        if choice == "0":
            return
        if choice == "1":
            menu_machine(config)
        elif choice == "2":
            menu_tools(config)
        elif choice == "3":
            menu_art(config)
        elif choice == "4":
            config.port = prompt("Default port", config.port)
            config.baud = int(prompt("Baud", str(config.baud)))
            config.tools_path = prompt("Tools file", config.tools_path)
            config.planner_path = prompt("Planner file", config.planner_path)
            save_config(config)
            print("Saved.")


# -------------------------
# CLI
# -------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Pl0tb0t OS")
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("menu", help="Run interactive menu")

    ports = sub.add_parser("ports", help="List serial ports")
    ports.set_defaults(cmd="ports")

    machine = sub.add_parser("machine", help="Machine actions")
    machine.add_argument("--port", dest="port", default=None)
    machine.add_argument("--baud", dest="baud", type=int, default=None)
    machine.add_argument("--home", action="store_true")
    machine.add_argument("--status", action="store_true")
    machine.add_argument("--send", dest="send", default=None, help="Send raw G-code line")

    jog = sub.add_parser("jog", help="Jog the machine")
    jog.add_argument("axis", choices=["X", "Y", "Z"])
    jog.add_argument("distance", type=float)
    jog.add_argument("--feed", type=float, default=500)
    jog.add_argument("--units", choices=["mm", "in"], default="mm")
    jog.add_argument("--port", dest="port", default=None)
    jog.add_argument("--baud", dest="baud", type=int, default=None)

    tools = sub.add_parser("tools", help="Manage tools")
    tools.add_argument("action", choices=["list", "add", "update", "remove", "move"])
    tools.add_argument("--name", default=None)
    tools.add_argument("--color", default="black")
    tools.add_argument("--x", type=float, default=0)
    tools.add_argument("--y", type=float, default=0)
    tools.add_argument("--z", type=float, default=0)
    tools.add_argument("--safe-z", dest="safe_z", type=float, default=0)
    tools.add_argument("--port", dest="port", default=None)
    tools.add_argument("--baud", dest="baud", type=int, default=None)

    art = sub.add_parser("art", help="Art workflows")
    art.add_argument("action", choices=["run-ui", "plot-gcode"])
    art.add_argument("--gcode", dest="gcode", default=None)
    art.add_argument("--home", action="store_true")
    art.add_argument("--port", dest="port", default=None)
    art.add_argument("--baud", dest="baud", type=int, default=None)

    toolplan = sub.add_parser("toolplan", help="Generate tool-change gcode from a plan file")
    toolplan.add_argument("--plan", dest="plan", default=None)
    toolplan.add_argument("--out", dest="out", default="toolplan_combined.gcode")

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    config = load_config()
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.cmd in (None, "menu"):
        run_menu(config)
        return 0

    if args.cmd == "ports":
        for dev, desc in list_serial_ports():
            print(f"{dev} ({desc})")
        return 0

    if args.cmd == "machine":
        port = args.port or config.port
        baud = args.baud or config.baud
        if not port:
            print("No port specified.")
            return 1
        s = open_port(port, baud)
        if args.home:
            grbl_home(s, verbose=True)
        if args.status:
            print(grbl_status(s))
        if args.send:
            grbl_send(s, args.send, wait_ok=True, verbose=True)
        s.close()
        return 0

    if args.cmd == "jog":
        port = args.port or config.port
        baud = args.baud or config.baud
        if not port:
            print("No port specified.")
            return 1
        s = open_port(port, baud)
        grbl_jog(s, args.axis, args.distance, args.feed, units=args.units)
        s.close()
        return 0

    if args.cmd == "tools":
        tools = load_tools(config.tools_path)
        if args.action == "list":
            for t in tools:
                print(f"{t.name} color={t.color} x={t.x} y={t.y} z={t.z} safe_z={t.safe_z}")
            return 0
        if args.action in {"add", "update"}:
            if not args.name:
                print("--name required")
                return 1
            add_or_update_tool(
                tools,
                Tool(
                    name=args.name,
                    color=args.color,
                    x=args.x,
                    y=args.y,
                    z=args.z,
                    safe_z=args.safe_z,
                ),
            )
            save_tools(config.tools_path, tools)
            return 0
        if args.action == "remove":
            if not args.name:
                print("--name required")
                return 1
            if not remove_tool(tools, args.name):
                print("Tool not found.")
                return 1
            save_tools(config.tools_path, tools)
            return 0
        if args.action == "move":
            if not args.name:
                print("--name required")
                return 1
            port = args.port or config.port
            baud = args.baud or config.baud
            if not port:
                print("No port specified.")
                return 1
            tool = find_tool(tools, args.name)
            if tool is None:
                print("Tool not found.")
                return 1
            s = open_port(port, baud)
            if tool.safe_z != tool.z:
                grbl_move_abs(s, tool.x, tool.y, tool.safe_z)
            grbl_move_abs(s, tool.x, tool.y, tool.z)
            s.close()
            return 0

    if args.cmd == "art":
        port = args.port or config.port
        baud = args.baud or config.baud
        if args.action == "run-ui":
            return run_ui_py()
        if args.action == "plot-gcode":
            if not args.gcode:
                print("--gcode required")
                return 1
            if not port:
                print("No port specified.")
                return 1
            plot_gcode_file(port, baud, args.gcode, home_first=args.home, verbose=True)
            return 0

    if args.cmd == "toolplan":
        plan_path = args.plan or config.planner_path
        tools = load_tools(config.tools_path)
        plan = load_toolplan(plan_path)
        generate_toolchange_gcode(tools, plan, args.out)
        print(f"Wrote {args.out}")
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
