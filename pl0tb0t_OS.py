#!/usr/bin/env python3
"""
Pl0tb0t Local Control - PyQt6 GUI (falls back to terminal)
Direct control + tool management with dockable graphical interface
"""

__version__ = "0.5.167"
import os
import sys
import time
import re
import threading
import math
import subprocess
import shutil
import tempfile
import json
import socket
import queue as _queue
import xml.etree.ElementTree as ET
from pathlib import Path
from dataclasses import dataclass, asdict, field
from typing import Dict, List, Optional, Tuple

# Debug logging
_LOG_FILE = os.path.expanduser("~/.pl0tb0t/debug.log")
os.makedirs(os.path.dirname(_LOG_FILE), exist_ok=True)

def _debug_log(msg: str):
    ts = time.strftime("%H:%M:%S.%f")[:-3]
    try:
        with open(_LOG_FILE, "a") as f:
            f.write(f"[{ts}] {msg}\n")
    except Exception:
        pass

try:
    import serial
    from serial.tools import list_ports
except Exception:
    serial = None
    list_ports = None

has_display = (
    os.environ.get("DISPLAY") is not None
    or os.environ.get("WAYLAND_DISPLAY") is not None
    or sys.platform == "win32"      # Windows always has a GUI session
    or sys.platform == "darwin"     # macOS likewise (native Cocoa display)
)

if has_display:
    from PyQt6.QtWidgets import (
        QApplication, QMainWindow, QWidget, QDockWidget,
        QVBoxLayout, QHBoxLayout, QGridLayout,
        QGroupBox, QLabel, QPushButton, QComboBox, QLineEdit,
        QSlider, QCheckBox, QProgressBar, QListWidget,
        QSplitter, QScrollArea, QSizePolicy, QToolBar,
        QFileDialog, QMessageBox, QMenu, QFrame, QAbstractScrollArea,
        QDialog, QDialogButtonBox, QStackedWidget, QProgressDialog,
        QRadioButton, QButtonGroup, QColorDialog,
    )
    from PyQt6.QtCore import Qt, QTimer, QObject, pyqtSignal, QEvent, QByteArray, QRectF, QUrl, QFileSystemWatcher
    from PyQt6.QtGui import QPainter, QPen, QColor, QFont
    from PyQt6.QtSvg import QSvgRenderer
    try:
        from PyQt6.QtWebEngineWidgets import QWebEngineView
        from PyQt6.QtWebEngineCore import QWebEngineSettings, QWebEngineScript, QWebEngineProfile, QWebEnginePage
        _HAS_WEBENGINE = True
    except ImportError:
        _HAS_WEBENGINE = False


# ---------------------------------------------------------------------------
# Core data + persistence
# ---------------------------------------------------------------------------

CONFIG_PATH = "pl0tb0t_config.json"   # unified config + tools file


PEN_TYPES = ["stabilo", "pilot", "micron", "sharpie"]
# 120-deg V-groove: pen center shifts 1/(2*sin60) = 0.577 mm per mm of barrel diameter.
VGROOVE_K = 0.57735


@dataclass
class Tool:
    name: str
    color: str
    x: float
    y: float
    z: float
    safe_z: float
    pen_type: str = ""


@dataclass
class OSConfig:
    port: Optional[str] = None
    baud: int = 115200
    # Plot / drawing parameters
    pen_lift_z: float = 3.5       # mm — Z lift between path segments
    pen_contact_z: float = 0.0    # mm — Z when pen contacts paper
    # Tool-change parameters
    tc_unplug_mm: float = 20.0    # mm — Y approach/release offset from dock centre
    tc_rapid: int = 800           # mm/min — rapid moves during tool change
    tc_approach: int = 50         # mm/min — slow docking/undocking moves
    draw_speed: int = 3000        # mm/min — G1 feed rate while drawing
    travel_speed: int = 6000      # mm/min — G0 rapid speed (used for time estimation)
    vpype_config: str = "pl0tb0t_0x0_config.cfg"
    pen_offsets: dict = field(default_factory=dict)
    pen_diameters: dict = field(default_factory=dict)
    zero_pen_type: str = "stabilo"
    pen_types: list = field(default_factory=list)
    pen_tip_widths: dict = field(default_factory=dict)
    vpype_profile: str = "pl0tb0t_0x0"
    # Signature / attribution band
    sig_enabled: bool = False
    sig_show_preview: bool = True
    sig_suppress_export: bool = False
    sig_show_logo: bool = True
    sig_show_seed_name: bool = True
    draw_order: str = "lightest_to_darkest"   # "left_to_right" | "lightest_to_darkest"
    show_palette: list = field(default_factory=list)   # per-holder Show-mode colours
    sig_font: str = "ef"
    sig_custom_msg: str = ""
    sig_height_mm: float = 2.0
    sig_scale: float = 2.0       # visual/export scale multiplier
    sig_y_offset_mm: float = 0.0   # legacy — superseded by sig_from_margin_mm
    sig_from_margin_mm: float = 2.0  # mm from art/margin boundary downward into the margin
    sig_h_pad_mm: float = 0.0      # extra horizontal inset from margin on both sides
    pen_width_mm: float = 0.4  # nib width — inherited by signature and all sketches
    sig_logo_scale: float = 1.0    # logo size multiplier (relative to text height)
    sig_sep_scale: float = 1.3     # | separator height multiplier relative to text
    sig_sep_pad: float = 1.3       # horizontal gap on each side of | (in text-height ems)


def _load_json(path: str, default: dict) -> dict:
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_json(path: str, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)


def load_config(path: str = CONFIG_PATH) -> OSConfig:
    data = _load_json(path, {})
    return OSConfig(
        port=data.get("port"),
        baud=int(data.get("baud", 115200)),
        pen_lift_z=float(data.get("pen_lift_z", 3.5)),
        pen_contact_z=float(data.get("pen_contact_z", 0.0)),
        tc_unplug_mm=float(data.get("tc_unplug_mm", 20.0)),
        tc_rapid=int(data.get("tc_rapid", 800)),
        tc_approach=int(data.get("tc_approach", 50)),
        draw_speed=int(data.get("draw_speed", 3000)),
        travel_speed=int(data.get("travel_speed", 6000)),
        vpype_config=data.get("vpype_config", "pl0tb0t_0x0_config.cfg"),
        pen_offsets=data.get("pen_offsets", {}),
        pen_diameters=data.get("pen_diameters", {}),
        zero_pen_type=str(data.get("zero_pen_type", "stabilo")),
        pen_types=list(data.get("pen_types", []) or []),
        pen_tip_widths=data.get("pen_tip_widths", {}),
        vpype_profile=data.get("vpype_profile", "pl0tb0t_0x0"),
        sig_enabled=bool(data.get("sig_enabled", False)),
        sig_show_preview=bool(data.get("sig_show_preview", True)),
        sig_suppress_export=bool(data.get("sig_suppress_export", False)),
        sig_show_logo=bool(data.get("sig_show_logo", True)),
        sig_show_seed_name=bool(data.get("sig_show_seed_name", True)),
        draw_order=str(data.get("draw_order", "lightest_to_darkest")),
        show_palette=list(data.get("show_palette", []) or []),
        sig_font=str(data.get("sig_font", "ef")),
        sig_custom_msg=str(data.get("sig_custom_msg", "")),
        sig_height_mm=float(data.get("sig_height_mm", 2.0)),
        sig_scale=float(data.get("sig_scale", 2.0)),
        sig_y_offset_mm=float(data.get("sig_y_offset_mm", 0.0)),
        sig_from_margin_mm=float(data.get("sig_from_margin_mm", 2.0)),
        sig_h_pad_mm=float(data.get("sig_h_pad_mm", 0.0)),
        pen_width_mm=float(data.get("pen_width_mm", data.get("sig_pen_width_mm", 0.4))),
        sig_logo_scale=float(data.get("sig_logo_scale", 1.0)),
        sig_sep_scale=float(data.get("sig_sep_scale", 1.3)),
        sig_sep_pad=float(data.get("sig_sep_pad", 1.3)),
    )


def save_config(config: OSConfig, path: str = CONFIG_PATH) -> None:
    # Load existing data so we preserve the tools list
    data = _load_json(path, {})
    cfg = asdict(config)
    cfg.pop("tools_path", None)   # legacy field, not used
    data.update(cfg)
    _save_json(path, data)


def _fmt_duration(secs: float) -> str:
    s = int(secs)
    if s < 60:   return f'~{s}s'
    m = s // 60
    if m < 60:   return f'~{m} min'
    h, rm = divmod(m, 60)
    return f'~{h}h {rm}m' if rm else f'~{h}h'


def _svg_path_stats(d: str):
    """Return (length_px, lift_count) for an SVG path d attribute."""
    import re as _re, math as _math
    tokens = _re.findall(
        r'[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?',
        d or '')
    total, lifts = 0.0, 0
    px, py, sx, sy = 0.0, 0.0, 0.0, 0.0
    cmd = 'L'
    COUNTS = {'M':2,'L':2,'H':1,'V':1,'C':6,'S':4,'Q':4,'T':2,'A':7}
    i, N = 0, len(tokens)
    while i < N:
        t = tokens[i]
        if t.isalpha():
            cmd = t
            if t.upper() == 'Z':
                total += _math.hypot(sx - px, sy - py)
                px, py = sx, sy
            i += 1; continue
        c = cmd.upper(); rel = cmd.islower()
        nc = COUNTS.get(c, 0)
        if nc == 0 or i + nc > N:
            i += 1; continue
        a = [float(tokens[i + k]) for k in range(nc)]
        i += nc
        if c == 'M':
            px = (px + a[0]) if rel else a[0]
            py = (py + a[1]) if rel else a[1]
            sx, sy = px, py; lifts += 1
            cmd = 'l' if rel else 'L'
        elif c == 'L':
            ex = (px + a[0]) if rel else a[0]
            ey = (py + a[1]) if rel else a[1]
            total += _math.hypot(ex - px, ey - py); px, py = ex, ey
        elif c == 'H':
            ex = (px + a[0]) if rel else a[0]
            total += abs(ex - px); px = ex
        elif c == 'V':
            ey = (py + a[0]) if rel else a[0]
            total += abs(ey - py); py = ey
        elif c in ('C', 'S'):
            ex = (px + a[-2]) if rel else a[-2]
            ey = (py + a[-1]) if rel else a[-1]
            total += _math.hypot(ex - px, ey - py) * 1.15; px, py = ex, ey
        elif c in ('Q', 'T'):
            ex = (px + a[-2]) if rel else a[-2]
            ey = (py + a[-1]) if rel else a[-1]
            total += _math.hypot(ex - px, ey - py) * 1.1; px, py = ex, ey
        elif c == 'A':
            ex = (px + a[5]) if rel else a[5]
            ey = (py + a[6]) if rel else a[6]
            rx = abs(a[0])
            chord = _math.hypot(ex - px, ey - py)
            total += (rx * 2 * _math.asin(min(chord / (2*rx), 1.0))
                      if rx > 0 else chord)
            px, py = ex, ey
    return total, lifts


def _estimate_svg_time(svg_text: str, draw_speed_mmpm: float,
                        travel_speed_mmpm: float = 6000) -> float:
    """Estimate plot time in seconds from raw SVG text."""
    import re as _re, math as _math
    try:
        import xml.etree.ElementTree as ET
        root = ET.fromstring(svg_text)
    except Exception:
        return 0.0
    SVG_PX_PER_MM = 100.0 / 25.4
    total_mm, total_lifts = 0.0, 0
    color_set: set = set()
    SKIP = {'none', 'white', '#fff', '#ffffff', 'transparent', 'inherit'}
    def _tag(el): return el.tag.split('}')[-1] if '}' in el.tag else el.tag
    def _color(el):
        s = _re.search(r'stroke\s*:\s*([^;]+)', el.get('style', ''))
        c = (s.group(1).strip() if s else None) or el.get('stroke', '')
        return c if c and c.lower() not in SKIP else None
    for el in root.iter():
        tag = _tag(el)
        col = _color(el)
        if col: color_set.add(col)
        if tag == 'path':
            length_px, lifts = _svg_path_stats(el.get('d', ''))
            total_mm += length_px / SVG_PX_PER_MM
            total_lifts += lifts
        elif tag == 'line':
            x1, y1 = float(el.get('x1', 0)), float(el.get('y1', 0))
            x2, y2 = float(el.get('x2', 0)), float(el.get('y2', 0))
            total_mm += _math.hypot(x2 - x1, y2 - y1) / SVG_PX_PER_MM
            total_lifts += 1
        elif tag == 'circle':
            total_mm += 2 * _math.pi * float(el.get('r', 0)) / SVG_PX_PER_MM
            total_lifts += 1
        elif tag in ('polyline', 'polygon'):
            coords = [float(v) for v in _re.findall(
                r'[-+]?\d*\.?\d+', el.get('points', ''))]
            for k in range(0, len(coords) - 3, 2):
                total_mm += _math.hypot(
                    coords[k+2] - coords[k], coords[k+3] - coords[k+1]
                ) / SVG_PX_PER_MM
            total_lifts += 1
    if total_mm <= 0:
        return 0.0
    draw_s   = (total_mm / max(draw_speed_mmpm, 1)) * 60.0
    per_lift = (40.0 / max(travel_speed_mmpm, 1)) * 60.0 + 0.5
    travel_s = min(total_lifts * per_lift, draw_s * 0.25)
    tc_s     = max(0, len(color_set) - 1) * 30.0
    return draw_s + travel_s + tc_s


def _estimate_gcode_time(gcode_text: str, draw_speed_mmpm: float,
                          travel_speed_mmpm: float) -> float:
    """Estimate plot time in seconds by parsing G-code moves."""
    import re as _re, math as _math
    secs = 0.0
    cur_f = float(draw_speed_mmpm)
    rapid_f = float(max(travel_speed_mmpm, 100))
    x = y = z = 0.0
    def _coord(line, letter, default):
        m = _re.search(letter + r'([-+]?\d*\.?\d+)', line, _re.IGNORECASE)
        return float(m.group(1)) if m else default
    for raw in gcode_text.splitlines():
        line = _re.sub(r';.*', '', _re.sub(r'\(.*?\)', '', raw)).strip().upper()
        if not line: continue
        fm = _re.search(r'F([\d.]+)', line)
        if fm: cur_f = float(fm.group(1))
        if _re.match(r'G0?1\b', line):
            nx, ny, nz = _coord(line,'X',x), _coord(line,'Y',y), _coord(line,'Z',z)
            secs += _math.sqrt((nx-x)**2+(ny-y)**2+(nz-z)**2) / max(cur_f, 1) * 60.0
            x, y, z = nx, ny, nz
        elif _re.match(r'G0{1,2}\b', line):
            nx, ny, nz = _coord(line,'X',x), _coord(line,'Y',y), _coord(line,'Z',z)
            secs += _math.sqrt((nx-x)**2+(ny-y)**2+(nz-z)**2) / max(rapid_f, 1) * 60.0
            x, y, z = nx, ny, nz
    return secs


def load_tools(path: str = CONFIG_PATH) -> List[Tool]:
    data = _load_json(path, {})
    return [
        Tool(
            name=item.get("name", "tool"),
            color=item.get("color", "black"),
            x=float(item.get("x", 0)),
            y=float(item.get("y", 0)),
            z=float(item.get("z", 0)),
            safe_z=float(item.get("safe_z", 0)),
            pen_type=("" if item.get("pen_type", "") == "custom" else item.get("pen_type", "")),
        )
        for item in data.get("tools", [])
    ]


def save_tools(path: str = CONFIG_PATH, tools: List[Tool] = None) -> None:
    data = _load_json(path, {})
    data["tools"] = [asdict(t) for t in (tools or [])]
    _save_json(path, data)


DAEMON_PORT = 5002


class DaemonClient:
    """Socket client for pl0tb0t_daemon. Thread-safe; one command at a time."""

    def __init__(self):
        self._sock      = None
        self._connected = False          # daemon socket connected
        self._send_lock = threading.Lock()
        self._resp_lock = threading.Lock()
        self._resp_evt  = threading.Event()
        self._pending   = None
        self._state     = {}

        # Callbacks — set by PlotterApp
        self.on_status      = None  # (dict) → None
        self.on_progress    = None  # (sent, total) → None
        self.on_gcode_done  = None  # () → None
        self.on_gcode_error = None  # (line_num, line, msg) → None
        self.on_grbl_line   = None  # (sent, response) → None
        self.on_daemon_gone = None  # () → None

    # ── Connect / disconnect to daemon socket ─────────────────────────────

    def connect_to_daemon(self, timeout: float = 3.0) -> bool:
        if self._connected and self._sock:
            return True   # already have a live socket — don't open a second one
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            sock.connect(("127.0.0.1", DAEMON_PORT))
            sock.settimeout(None)
            self._sock = sock
            self._connected = True
            threading.Thread(target=self._recv_loop, daemon=True).start()
            return True
        except Exception:
            return False

    def disconnect_from_daemon(self):
        self._connected = False
        if self._sock:
            try: self._sock.close()
            except: pass
            self._sock = None

    def _recv_loop(self):
        buf = b""
        while self._connected:
            try:
                chunk = self._sock.recv(4096)
            except Exception:
                break
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                try:
                    data = json.loads(raw)
                except Exception:
                    continue
                if "event" in data:
                    self._handle_event(data)
                else:
                    with self._resp_lock:
                        self._pending = data
                    self._resp_evt.set()
        self._connected = False
        # Unblock any cmd() that is still waiting for a response
        with self._resp_lock:
            if self._pending is None:
                self._pending = {"ok": False, "error": "daemon disconnected"}
        self._resp_evt.set()
        if self.on_daemon_gone:
            try: self.on_daemon_gone()
            except: pass

    def _handle_event(self, data: dict):
        ev = data.get("event")
        if ev == "status":
            self._state = data
            if self.on_status:
                try: self.on_status(data)
                except: pass
        elif ev == "progress":
            if self.on_progress:
                try: self.on_progress(data.get("sent", 0), data.get("total", 0))
                except: pass
        elif ev == "gcode_done":
            if self.on_gcode_done:
                try: self.on_gcode_done()
                except: pass
        elif ev == "gcode_error":
            if self.on_gcode_error:
                try: self.on_gcode_error(
                    data.get("line_num", 0), data.get("line", ""), data.get("message", ""))
                except: pass
        elif ev == "grbl_line":
            if self.on_grbl_line:
                try: self.on_grbl_line(data.get("sent", ""), data.get("response", ""))
                except: pass

    # ── Send a command, wait for response ─────────────────────────────────

    def cmd(self, obj: dict, timeout: float = 30.0) -> dict:
        if not self._connected:
            return {"ok": False, "error": "daemon not connected"}
        with self._send_lock:
            with self._resp_lock:
                self._pending = None
            self._resp_evt.clear()
            try:
                self._sock.sendall((json.dumps(obj) + "\n").encode("utf-8"))
            except Exception as e:
                return {"ok": False, "error": str(e)}
            if not self._resp_evt.wait(timeout=timeout):
                return {"ok": False, "error": "timeout"}
            with self._resp_lock:
                return self._pending or {"ok": False, "error": "no response"}

    # ── Convenience wrappers ──────────────────────────────────────────────

    def ping(self)                  -> dict: return self.cmd({"cmd": "ping"}, timeout=2.0)
    def ports(self)                 -> list: return self.cmd({"cmd": "ports"}).get("ports", [])
    def status(self)                -> dict: return self.cmd({"cmd": "status"})
    def connect_port(self, port, baud=115200) -> dict:
        return self.cmd({"cmd": "connect", "port": port, "baud": baud}, timeout=10.0)
    def disconnect_port(self)       -> dict: return self.cmd({"cmd": "disconnect"})
    def send(self, line, wait=True) -> dict:
        return self.cmd({"cmd": "send", "line": line, "wait": wait}, timeout=30.0)
    def realtime(self, byte_val: int):       self.cmd({"cmd": "realtime", "byte": byte_val}, timeout=2.0)
    def home(self)                  -> dict: return self.cmd({"cmd": "home"}, timeout=120.0)
    def stream(self, path: str, est_s: float = 0) -> dict: return self.cmd({"cmd": "stream", "path": path, "est_s": est_s}, timeout=5.0)
    def pause(self)                 -> dict: return self.cmd({"cmd": "pause"})
    def resume(self)                -> dict: return self.cmd({"cmd": "resume"})
    def stop(self)                  -> dict: return self.cmd({"cmd": "stop"})
    def shutdown_daemon(self)       -> dict: return self.cmd({"cmd": "shutdown"}, timeout=3.0)

    @property
    def daemon_alive(self) -> bool:
        return self._connected

    @property
    def machine_connected(self) -> bool:
        return self._connected and bool(self._state.get("connected"))

    @property
    def last_state(self) -> dict:
        return self._state


def list_serial_ports() -> List[Tuple[str, str]]:
    if list_ports is None:
        return []
    return [(p.device, p.description) for p in list_ports.comports()]


def open_port(port: str, baud: int):
    if serial is None:
        raise RuntimeError("pyserial not installed")
    s = serial.Serial(port, baud, timeout=1.0)
    time.sleep(2)
    return s


def grbl_send(port, command: str, wait_ok: bool = True, verbose: bool = False):
    if not command.endswith("\n"):
        command += "\n"
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
                    break
                continue
            empty_count = 0
            responses.append(line)
            if verbose:
                print("RCV:", line)
            if line.lower().startswith("ok") or "error" in line.lower() or "alarm" in line.lower():
                break
    return responses


def grbl_home(port, verbose: bool = False) -> None:
    grbl_send(port, "$H", wait_ok=True, verbose=verbose)
    for _ in range(120):
        time.sleep(0.5)
        try:
            port.reset_input_buffer()
            port.write(b"?\n")
            line = port.readline().decode("utf-8", errors="ignore").strip()
            if "Idle" in line:
                break
        except Exception:
            break


def grbl_status(port) -> str:
    port.write(b"?\n")
    return port.readline().decode("utf-8", errors="ignore").strip()


def grbl_jog(port, axis: str, distance: float, feed: float, units: str = "mm") -> None:
    axis = axis.upper()
    unit_cmd = "G21" if units == "mm" else "G20"
    grbl_send(port, f"$J=G91 {unit_cmd} {axis}{distance:.3f} F{feed:.1f}", wait_ok=False)


def grbl_move_abs(port, x: float, y: float, z: float,
                  feed: Optional[float] = None, use_machine_coords: bool = False) -> None:
    prefix = "G53 " if use_machine_coords else ""
    if feed is None:
        cmd = f"G90 {prefix}G0 X{x:.3f} Y{y:.3f} Z{z:.3f}"
    else:
        cmd = f"G90 {prefix}G1 X{x:.3f} Y{y:.3f} Z{z:.3f} F{feed:.1f}"
    grbl_send(port, cmd, wait_ok=True)


def find_tool(tools: List[Tool], name: str) -> Optional[Tool]:
    for t in tools:
        if t.name.lower() == name.lower():
            return t
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
    for i, t in enumerate(tools):
        if t.name.lower() == name.lower():
            tools.pop(i)
            return True
    return False


def _migrate_legacy_config():
    """One-time migration: merge old separate config + tools files into unified file."""
    if os.path.exists(CONFIG_PATH):
        return   # already migrated
    merged = {}
    for old in ("pl0tb0t_os_config.json", "pl0tb0t_tools.json"):
        if os.path.exists(old):
            merged.update(_load_json(old, {}))
    _save_json(CONFIG_PATH, merged)


# ---------------------------------------------------------------------------
# PyQt6 UI
# ---------------------------------------------------------------------------

if has_display:

    class _Signals(QObject):
        update_status  = pyqtSignal(str)
        update_dro     = pyqtSignal(dict, dict)
        update_progress = pyqtSignal(float)
        show_error     = pyqtSignal(str, str)
        show_info      = pyqtSignal(str, str)
        gcode_done     = pyqtSignal()
        wcs_offset_ready = pyqtSignal(float, float, float)
        gcode_status   = pyqtSignal(str)
        gcode_highlight = pyqtSignal(int)
        grbl_log       = pyqtSignal(str)
        queue_jobs_ready = pyqtSignal(list)
        queue_pen_assign = pyqtSignal(object)  # carries ctx dict from _queue_plot_selected
        confirm_and_run_gcode = pyqtSignal(str, str, object, str, str)  # job_id, gcode_path, paper_mm, base_url, key -- marshals the single-pass plot path's g-code-ready confirm dialog onto the main thread
        update_banner  = pyqtSignal(str)    # update Make tab banner text
        plot_progress  = pyqtSignal(str)    # rich plot progress (JSON) -> setPlotProgress
        daemon_indicator = pyqtSignal()   # refresh daemon status dot (thread-safe)

    class AspectSvgPreviewWidget(QWidget):
        """SVG preview that letterboxes instead of stretching to the pane."""
        def __init__(self):
            super().__init__()
            self._renderer = None
            self.setStyleSheet("background:white;border:1px solid #eee;border-radius:4px;")

        def load(self, data):
            renderer = QSvgRenderer()
            ok = renderer.load(QByteArray(data))
            self._renderer = renderer if ok else None
            self.update()
            return ok

        def clear(self):
            self._renderer = None
            self.update()

        def paintEvent(self, event):
            painter = QPainter(self)
            painter.fillRect(self.rect(), QColor("white"))
            if not self._renderer or not self._renderer.isValid():
                return
            size = self._renderer.defaultSize()
            if size.width() <= 0 or size.height() <= 0:
                view_box = self._renderer.viewBoxF()
                svg_w = max(view_box.width(), 1.0)
                svg_h = max(view_box.height(), 1.0)
            else:
                svg_w = size.width()
                svg_h = size.height()
            pad = 4
            avail_w = max(self.width() - 2 * pad, 1)
            avail_h = max(self.height() - 2 * pad, 1)
            scale = min(avail_w / svg_w, avail_h / svg_h)
            draw_w = svg_w * scale
            draw_h = svg_h * scale
            x = (self.width() - draw_w) / 2
            y = (self.height() - draw_h) / 2
            self._renderer.render(painter, QRectF(x, y, draw_w, draw_h))

    class GcodePreviewWidget(QWidget):
        def __init__(self):
            super().__init__()
            self.segments = []      # (x0,y0,x1,y1, mode, color_hex)
            self.bounds = None
            self.artboard = None     # (width_mm, height_mm), work origin at lower-left
            self.visible_colors = None   # None = all visible
            self._zoom = 1.0
            self._pan = [0.0, 0.0]
            self._drag_start = None
            self._pan_origin = [0.0, 0.0]
            self.setMinimumHeight(150)
            self.setStyleSheet("background: white;")

        def set_data(self, segments, bounds, artboard=None):
            self.segments = segments
            self.bounds = bounds
            self.artboard = artboard
            self._zoom = 1.0
            self._pan = [0.0, 0.0]
            self.update()

        def set_visible_colors(self, colors):
            self.visible_colors = colors
            self.update()

        def paintEvent(self, event):
            painter = QPainter(self)
            painter.fillRect(self.rect(), QColor("#f8f8f8" if self.artboard else "white"))
            if (not self.segments or not self.bounds) and not self.artboard:
                painter.setPen(QColor("#aaaaaa"))
                painter.drawText(10, 20, "No preview available")
                return
            w, h = self.width(), self.height()
            pad = 10
            if self.bounds:
                min_x, min_y, max_x, max_y = self.bounds
            else:
                min_x = min_y = max_x = max_y = 0.0
            if self.artboard:
                page_w, page_h = self.artboard
                min_x = min(min_x, 0.0)
                min_y = min(min_y, 0.0)
                max_x = max(max_x, page_w)
                max_y = max(max_y, page_h)
            span_x = max(max_x - min_x, 1e-6)
            span_y = max(max_y - min_y, 1e-6)
            scale = min((w - 2 * pad) / span_x, (h - 2 * pad) / span_y)
            zoom, pan_x, pan_y = self._zoom, self._pan[0], self._pan[1]

            def mp(px, py):
                cx = pad + (px - min_x) * scale
                cy = h - pad - (py - min_y) * scale
                return cx * zoom + pan_x, cy * zoom + pan_y

            if self.artboard:
                page_w, page_h = self.artboard
                x0, y0 = mp(0.0, 0.0)
                x1, y1 = mp(page_w, page_h)
                painter.setBrush(QColor("white"))
                painter.setPen(QPen(QColor("#999999"), 1))
                painter.drawRect(
                    int(min(x0, x1)), int(min(y0, y1)),
                    int(abs(x1 - x0)), int(abs(y1 - y0)))

            rapid_color = QColor("#dddddd")
            for x0, y0, x1, y1, mode, color in self.segments:
                if self.visible_colors is not None and color not in self.visible_colors:
                    continue
                sx0, sy0 = mp(x0, y0)
                sx1, sy1 = mp(x1, y1)
                if mode == "G0":
                    painter.setPen(rapid_color)
                else:
                    c = QColor(color)
                    # darken very light colors so they show on white background
                    if c.lightness() > 220:
                        c = c.darker(180)
                    painter.setPen(c)
                painter.drawLine(int(sx0), int(sy0), int(sx1), int(sy1))

            if zoom != 1.0 or pan_x != 0.0 or pan_y != 0.0:
                painter.setPen(QColor("#888888"))
                painter.setFont(QFont("Arial", 7))
                painter.drawText(w - 165, 15, f"zoom {zoom:.1f}×  dbl-click to reset")

        def wheelEvent(self, event):
            delta = event.angleDelta().y()
            factor = 1.25 if delta > 0 else 0.8
            pos = event.position()
            mx, my = pos.x(), pos.y()
            self._pan[0] = mx + (self._pan[0] - mx) * factor
            self._pan[1] = my + (self._pan[1] - my) * factor
            self._zoom = max(0.05, min(200.0, self._zoom * factor))
            self.update()

        def mousePressEvent(self, event):
            if event.button() == Qt.MouseButton.LeftButton:
                pos = event.position()
                self._drag_start = (pos.x(), pos.y())
                self._pan_origin = list(self._pan)

        def mouseMoveEvent(self, event):
            if self._drag_start:
                pos = event.position()
                self._pan[0] = self._pan_origin[0] + pos.x() - self._drag_start[0]
                self._pan[1] = self._pan_origin[1] + pos.y() - self._drag_start[1]
                self.update()

        def mouseReleaseEvent(self, event):
            self._drag_start = None

        def mouseDoubleClickEvent(self, event):
            self._zoom = 1.0
            self._pan = [0.0, 0.0]
            self.update()

    class _SnapDock(QDockWidget):
        """QDockWidget with collapsible title bar and right-click re-dock menu."""
        def __init__(self, title, parent):
            super().__init__(title, parent)
            self._collapsed = False
            self._title_text = title
            self._pre_collapse_min_w = 0
            self._build_title_bar()

        def _build_title_bar(self):
            bar = QWidget()
            bar.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
            bar.customContextMenuRequested.connect(
                lambda pos: self._ctx_menu(bar.mapToParent(pos)))

            hl = QHBoxLayout(bar)
            hl.setContentsMargins(6, 2, 4, 2)
            hl.setSpacing(4)

            self._caret = QPushButton("▼")
            self._caret.setFixedSize(16, 16)
            self._caret.setFlat(True)
            self._caret.setToolTip("Collapse / expand")
            self._caret.clicked.connect(self._toggle_collapse)
            hl.addWidget(self._caret)

            lbl = QLabel(self._title_text)
            f = lbl.font()
            f.setBold(True)
            lbl.setFont(f)
            hl.addWidget(lbl, 1)

            float_btn = QPushButton("⧉")
            float_btn.setFixedSize(16, 16)
            float_btn.setFlat(True)
            float_btn.setToolTip("Float / dock")
            float_btn.clicked.connect(lambda: self.setFloating(not self.isFloating()))
            hl.addWidget(float_btn)

            self.setTitleBarWidget(bar)

        def _toggle_collapse(self):
            self._collapsed = not self._collapsed
            w = self.widget()
            if w:
                w.setVisible(not self._collapsed)
            self._caret.setText("▶" if self._collapsed else "▼")
            title_h = max(24, self.titleBarWidget().sizeHint().height() if self.titleBarWidget() else 24)
            if self._collapsed:
                self._pre_collapse_min_w = self.minimumWidth()
                self.setMinimumWidth(0)
                self.setMinimumHeight(title_h)
                self.setMaximumHeight(title_h)
            else:
                self.setMinimumHeight(0)
                self.setMaximumHeight(16777215)
                self.setMinimumWidth(0)
                if w:
                    w.setVisible(True)
                    w.updateGeometry()
            mw = self.window()
            if hasattr(mw, "_rebalance_dock_heights"):
                QTimer.singleShot(0, mw._rebalance_dock_heights)

        def _ctx_menu(self, pos):
            if not self.isFloating():
                return
            menu = QMenu(self)
            menu.addAction("⬅  Dock Left",   lambda: self._snap(Qt.DockWidgetArea.LeftDockWidgetArea))
            menu.addAction("➡  Dock Right",  lambda: self._snap(Qt.DockWidgetArea.RightDockWidgetArea))
            menu.addAction("⬇  Dock Bottom", lambda: self._snap(Qt.DockWidgetArea.BottomDockWidgetArea))
            menu.exec(self.mapToGlobal(pos))

        def _snap(self, area):
            mw = self.parent()
            while mw and not isinstance(mw, QMainWindow):
                mw = mw.parent()
            if mw:
                mw.addDockWidget(area, self)


    class JobCard(QFrame):
        """One queue job displayed as a card with a top-right delete button."""
        deleted  = pyqtSignal(str)   # emits job_id
        selected = pyqtSignal(str)   # emits job_id

        STATUS_COLORS = {
            'queued':   ('#888888', '#f5f5f5'),
            'plotting': ('#c06000', '#fff8ee'),
            'done':     ('#2a7a2a', '#f0fff0'),
            'error':    ('#aa0000', '#fff0f0'),
        }

        def __init__(self, job: dict, parent=None, locked: bool = False):
            super().__init__(parent)
            self.job = job
            self.job_id = job['id']
            self.locked = locked
            self._setup_ui()

        def _setup_ui(self):
            job = self.job
            status = job.get('status', 'queued')
            dot_color, bg = self.STATUS_COLORS.get(status, ('#888', '#f5f5f5'))

            self.setFrameShape(QFrame.Shape.StyledPanel)
            self.setStyleSheet(f"""
                JobCard {{
                    background: {bg};
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    margin: 2px 0;
                }}
                JobCard:hover {{ border-color: #999; }}
            """)
            self.setCursor(Qt.CursorShape.PointingHandCursor)

            root = QVBoxLayout(self)
            root.setContentsMargins(10, 8, 10, 8)
            root.setSpacing(3)

            # ── header row: sketch name + X button ──────────────────────────
            header = QHBoxLayout()
            name_lbl = QLabel(job.get('sketch_name') or 'Untitled')
            name_lbl.setStyleSheet('font-weight: 600; font-size: 13px;')
            header.addWidget(name_lbl, 1)

            self._del_btn = QPushButton('✕')
            self._del_btn.setFixedSize(22, 22)
            self._del_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            self._del_btn.setStyleSheet("""
                QPushButton {
                    border: none; border-radius: 11px;
                    background: transparent;
                    color: #bbb; font-size: 14px; font-weight: bold;
                }
                QPushButton:hover { background: #ffdddd; color: #c00; }
            """)
            self._del_btn.clicked.connect(self._confirm_delete)
            header.addWidget(self._del_btn)
            root.addLayout(header)

            # ── meta row: paper + orientation + file size ───────────────────
            paper   = job.get('paper_size', '')
            orient  = job.get('orientation', '')
            job_id  = job.get('id', '')
            size    = self._format_bytes(job.get('file_size') or job.get('file_size_bytes'))
            recipe_size = self._format_bytes(job.get('recipe_size') or job.get('recipe_size_bytes'))
            recipe_meta = f"recipe {recipe_size}" if recipe_size else ("recipe" if job.get("has_recipe") else "")
            provenance  = "☁ web" if job.get("cloud_id") else "⌘ local"
            est_raw = job.get('est_time_s') or 0
            est_str = _fmt_duration(est_raw) if est_raw > 0 else ""
            meta_parts = [p for p in [paper, orient, size, recipe_meta, est_str] if p]
            meta = '  ·  '.join(meta_parts)
            if job_id:
                meta = f'{meta}  ·  {job_id}' if meta else job_id
            meta = f'{meta}  ·  {provenance}' if meta else provenance
            meta_lbl = QLabel(meta)
            meta_lbl.setStyleSheet('color: #666; font-size: 11px;')
            root.addWidget(meta_lbl)

            # ── status + age row ────────────────────────────────────────────
            age      = self._time_ago(job.get('created_at', 0))
            status_lbl = QLabel(f'● {status}  ·  {age}')
            status_lbl.setStyleSheet(f'color: {dot_color}; font-size: 11px;')
            root.addWidget(status_lbl)

            if job.get('notes'):
                notes_lbl = QLabel(job['notes'])
                notes_lbl.setStyleSheet('color: #888; font-size: 10px; font-style: italic;')
                root.addWidget(notes_lbl)

        def _time_ago(self, ts):
            if not ts: return ''
            delta = __import__('time').time() - ts
            if delta < 60:    return 'just now'
            if delta < 3600:  return f'{int(delta/60)}m ago'
            if delta < 86400: return f'{int(delta/3600)}h ago'
            return f'{int(delta/86400)}d ago'

        def _format_bytes(self, n):
            try:
                n = int(n or 0)
            except Exception:
                return ''
            if n <= 0:
                return ''
            if n < 1024:
                return f'{n} B'
            if n < 1024 * 1024:
                return f'{n / 1024:.1f} KB' if n < 10 * 1024 else f'{n / 1024:.0f} KB'
            return f'{n / (1024 * 1024):.1f} MB' if n < 10 * 1024 * 1024 else f'{n / (1024 * 1024):.0f} MB'

        def _confirm_delete(self):
            status = self.job.get('status', 'queued')
            if status in ('error', 'done'):
                self.deleted.emit(self.job_id)
                return
            # Capture everything needed BEFORE the modal dialog opens.
            # The 3s refresh fires inside QMessageBox's nested event loop
            # and calls deleteLater() on this card, destroying the C++ object
            # before QMessageBox returns. Never touch `self` after this point.
            job_id   = self.job_id
            name     = self.job.get('sketch_name') or 'this job'
            do_delete = getattr(self.window(), '_queue_delete', None)
            reply = QMessageBox.question(
                None, 'Delete Job',
                f"Remove '{name}' from the queue? This cannot be undone.",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            )
            if reply == QMessageBox.StandardButton.Yes and do_delete:
                do_delete(job_id)

        def mousePressEvent(self, ev):
            self.selected.emit(self.job_id)
            super().mousePressEvent(ev)

    class PlotterApp(QMainWindow):
        def __init__(self):
            super().__init__()
            self.setWindowTitle(f"Pl0tb0t Control v{__version__}")

            _migrate_legacy_config()
            self.config = load_config()
            self.port = None
            self.tools = load_tools()
            self.machine_pos = {"x": 0.0, "y": 0.0, "z": 0.0}
            self.work_pos    = {"x": 0.0, "y": 0.0, "z": 0.0}
            self.work_offset = {"x": 0.0, "y": 0.0, "z": 0.0}

            self.gcode_path = None
            self.gcode_segments = []
            self.gcode_bounds = None
            self.gcode_preview_truncated = False
            self.gcode_total_lines = 0
            self.gcode_sent_lines = 0
            self.gcode_lines = []
            self.gcode_line_index = 0
            self.gcode_running = False
            self.gcode_paused = False
            self.gcode_stop = False

            self._svg_layers = []
            self._layer_colors = []       # [(hex, label), ...]
            self._visible_colors = set()
            self._serial_lock = threading.Lock()  # kept for any legacy paths
            self._poll_running = False

            # Daemon client — replaces direct serial access
            self._daemon = DaemonClient()
            self._daemon.on_status      = self._on_daemon_status
            self._daemon.on_progress    = self._on_daemon_progress
            self._daemon.on_gcode_done  = self._on_daemon_gcode_done
            self._daemon.on_gcode_error = self._on_daemon_gcode_error
            self._daemon.on_grbl_line   = self._on_daemon_grbl_line
            self._daemon.on_daemon_gone = self._on_daemon_gone
            self._daemon_proc   = None   # subprocess handle
            self._daemon_status_label = None  # set in _build_connection_panel
            self._gcode_tmp_path = None  # temp file for feed-override-processed gcode

            self.jog_keys_held = set()
            self._continuous_jog_active = False
            self._shift_held = False
            self.rapid_jog_speed = 3000
            self._release_timers = {}   # debounce X11 fake auto-repeat releases
            self._jog_seq = 0           # incremented on cancel to invalidate stale send threads

            self.signals = _Signals()
            self.signals.update_status.connect(self._on_update_status)
            self.signals.update_dro.connect(self._on_update_dro)
            self.signals.update_progress.connect(lambda v: self.gcode_progress.setValue(int(v)))
            self.signals.show_error.connect(lambda t, m: QMessageBox.critical(self, t, m))
            self.signals.show_info.connect(lambda t, m: QMessageBox.information(self, t, m))
            self.signals.gcode_done.connect(self._reset_gcode_buttons)
            self.signals.wcs_offset_ready.connect(self._on_wcs_offset_ready)
            self.signals.gcode_status.connect(lambda s: self.gcode_status_label.setText(s))
            self.signals.gcode_highlight.connect(self._highlight_gcode_line_at)
            self.signals.grbl_log.connect(self._append_grbl_log)
            self.signals.queue_jobs_ready.connect(self._queue_apply_jobs)
            self.signals.queue_pen_assign.connect(self._queue_on_pen_assign)
            self.signals.confirm_and_run_gcode.connect(self._on_confirm_and_run_gcode)
            self.signals.update_banner.connect(
                lambda t: self._make_webview.page().runJavaScript(f"setBannerText({repr(t)})"))
            self.signals.plot_progress.connect(
                lambda j: self._make_webview.page().runJavaScript(f"setPlotProgress({j})"))

            self.signals.daemon_indicator.connect(self._update_daemon_indicator)

            self._build_ui()
            self._restore_layout()
            QApplication.instance().installEventFilter(self)
            self.refresh_ports()
            self.refresh_tool_list()
            self.refresh_pen_buttons()

            self._status_timer = QTimer()
            self._status_timer.timeout.connect(self._poll_status)
            self._status_timer.start(500)

            screen = QApplication.primaryScreen().size()
            self.resize(min(1400, screen.width() - 40), min(900, screen.height() - 60))
            self.setMinimumSize(900, 600)

        # ------------------------------------------------------------------
        # UI construction
        # ------------------------------------------------------------------

        def _dock(self, title, widget, name=None):
            d = _SnapDock(title, self)
            if name:
                d.setObjectName(name)
            d.setMinimumWidth(0)
            d.setWidget(widget)
            if widget:
                widget.setMinimumWidth(0)
            if not hasattr(self, "_managed_docks"):
                self._managed_docks = []
            self._managed_docks.append(d)
            return d

        def _dock_target_height(self, dock):
            if getattr(dock, "_collapsed", False):
                return max(24, dock.titleBarWidget().sizeHint().height() if dock.titleBarWidget() else 24)
            w = dock.widget()
            if not w:
                return 120
            hint = w.sizeHint().height()
            minimum = w.minimumSizeHint().height()
            return max(60, min(max(hint, minimum), 520))

        def _rebalance_dock_heights(self):
            docks = [d for d in getattr(self, "_managed_docks", [])
                     if d.isVisible() and not d.isFloating()]
            if not docks:
                return
            try:
                self.resizeDocks(docks, [self._dock_target_height(d) for d in docks],
                                 Qt.Orientation.Vertical)
            except Exception:
                pass

        def _scrolled(self, widget):
            s = QScrollArea()
            s.setWidgetResizable(True)
            s.setMinimumWidth(0)
            s.setSizeAdjustPolicy(QAbstractScrollArea.SizeAdjustPolicy.AdjustIgnored)
            s.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
            s.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Expanding)
            if widget:
                widget.setMinimumWidth(0)
                widget.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Preferred)
            s.setWidget(widget)
            return s

        def _panel(self, title, widget, collapsed=False):
            panel = QFrame()
            panel.setFrameShape(QFrame.Shape.StyledPanel)
            panel.setMinimumWidth(0)
            panel.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Preferred)
            root = QVBoxLayout(panel)
            root.setContentsMargins(0, 0, 0, 0)
            root.setSpacing(0)

            bar = QWidget()
            bar.setMinimumHeight(24)
            bar_lay = QHBoxLayout(bar)
            bar_lay.setContentsMargins(4, 2, 4, 2)
            bar_lay.setSpacing(4)
            caret = QPushButton("▶" if collapsed else "▼")
            caret.setFixedSize(18, 18)
            caret.setFlat(True)
            label = QLabel(title)
            font = label.font()
            font.setBold(True)
            label.setFont(font)
            bar_lay.addWidget(caret)
            bar_lay.addWidget(label, 1)
            root.addWidget(bar)

            content = widget
            content.setMinimumWidth(0)
            root.addWidget(content, 1)
            panel._collapsed = bool(collapsed)
            panel._panel_stretch = 1
            panel._content_widget = content
            panel._title_bar = bar

            def apply_state():
                content.setVisible(not panel._collapsed)
                caret.setText("▶" if panel._collapsed else "▼")
                title_h = max(24, bar.sizeHint().height())
                if panel._collapsed:
                    panel.setMinimumHeight(title_h)
                    panel.setMaximumHeight(title_h)
                    panel.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Fixed)
                else:
                    panel.setMinimumHeight(title_h)
                    panel.setMaximumHeight(16777215)
                    panel.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Preferred)
                panel.updateGeometry()

            def toggle():
                panel._collapsed = not panel._collapsed
                apply_state()
                parent = panel.parent()
                if isinstance(parent, QSplitter):
                    QTimer.singleShot(0, lambda p=parent: self._pack_panel_splitter(p))

            caret.clicked.connect(toggle)
            bar.mouseDoubleClickEvent = lambda event: toggle()
            apply_state()
            return panel

        def _natural_content_height(self, widget):
            # Drills through nested AdjustIgnored QScrollAreas and QSplitters,
            # whose own sizeHint() lies about the real content size beneath them.
            if widget is None:
                return 0
            if isinstance(widget, QScrollArea):
                inner = widget.widget()
                return self._natural_content_height(inner) if inner is not None else widget.sizeHint().height()
            if isinstance(widget, QSplitter):
                heights = [self._natural_content_height(widget.widget(i)) for i in range(widget.count())]
                if not heights:
                    return 0
                if widget.orientation() == Qt.Orientation.Vertical:
                    return sum(heights) + widget.handleWidth() * max(0, len(heights) - 1)
                return max(heights)
            if isinstance(widget, QListWidget):
                # intentionally-scrollable log/list sub-regions — bounded, not grown to fit every row
                return max(60, min(widget.sizeHint().height(), 180))
            return widget.sizeHint().height()

        def _pack_panel_splitter(self, splitter):
            sizes = []
            used = 0
            preview_idx = None
            for i in range(splitter.count()):
                panel = splitter.widget(i)
                if getattr(panel, "_column_spacer", False):
                    continue
                if getattr(panel, "_collapsed", False):
                    title_bar = getattr(panel, "_title_bar", None)
                    size = max(24, title_bar.sizeHint().height() if title_bar else 24)
                    panel.setMaximumHeight(size)
                elif getattr(panel, "_is_preview", False):
                    # Preview/visualizer panels (SVG preview, G-code view): bigger is
                    # always better, so no content cap — and they're first in line for
                    # any leftover column space instead of the inert spacer below.
                    title_bar = getattr(panel, "_title_bar", None)
                    title_h = max(24, title_bar.sizeHint().height() if title_bar else 24)
                    stretch = max(1, int(getattr(panel, "_panel_stretch", 1)))
                    size = title_h + 280 * stretch
                    panel.setMaximumHeight(16777215)
                    preview_idx = len(sizes)
                else:
                    title_bar = getattr(panel, "_title_bar", None)
                    title_h = max(24, title_bar.sizeHint().height() if title_bar else 24)
                    content = getattr(panel, "_content_widget", None)
                    inner = content.widget() if content and hasattr(content, 'widget') else content
                    content_h = self._natural_content_height(inner) if inner else 200
                    size = max(80, title_h + content_h + 8)
                    panel.setMaximumHeight(16777215)
                sizes.append(size)
                used += size
            spacer_size = max(1, splitter.height() - used - 12 * max(0, splitter.count() - 1))
            if preview_idx is not None:
                sizes[preview_idx] += spacer_size
                spacer_size = 1
            sizes.append(spacer_size)
            splitter.setSizes(sizes)

        def _repack_all_columns(self):
            for col in (getattr(self, '_left_col', None), getattr(self, '_middle_col', None), getattr(self, '_right_col', None)):
                if col is not None:
                    self._pack_panel_splitter(col)

        _PREVIEW_PANEL_TITLES = {"Print Queue", "G-code Runner"}

        def _panel_column(self, panel_specs):
            splitter = QSplitter(Qt.Orientation.Vertical)
            splitter.setChildrenCollapsible(False)
            splitter.setHandleWidth(7)
            splitter.setMinimumWidth(0)
            splitter.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Expanding)
            for i, (title, widget, collapsed, stretch) in enumerate(panel_specs):
                panel = self._panel(title, widget, collapsed)
                panel._panel_stretch = max(1, int(stretch))
                panel._is_preview = title in self._PREVIEW_PANEL_TITLES
                splitter.addWidget(panel)
                splitter.setStretchFactor(i, panel._panel_stretch)
            spacer = QWidget()
            spacer._column_spacer = True
            spacer.setMinimumHeight(1)
            spacer.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Expanding)
            splitter.addWidget(spacer)
            splitter.setStretchFactor(splitter.count() - 1, 100)
            QTimer.singleShot(0, lambda s=splitter: self._pack_panel_splitter(s))
            return splitter

        def _build_ui(self):
            # status bar — compact fixed toolbar
            status_bar = QToolBar("Status")
            status_bar.setObjectName("toolbar_status")
            status_bar.setMovable(False)
            status_bar.setFloatable(False)
            status_widget = QWidget()
            status_widget.setLayout(self._make_status_bar())
            status_bar.addWidget(status_widget)
            self.addToolBar(Qt.ToolBarArea.TopToolBarArea, status_bar)

            main_splitter = QSplitter(Qt.Orientation.Horizontal)
            main_splitter.setChildrenCollapsible(False)
            main_splitter.setHandleWidth(7)
            main_splitter.setMinimumWidth(0)

            left_col = self._panel_column([
                ("Connection",       self._scrolled(self._build_connection_panel()), False, 0),
                ("Jogging",          self._scrolled(self._build_jog_panel()),        False, 0),
                ("Work Zero",        self._scrolled(self._build_workzero_panel()),   False, 0),
                ("Machine Settings",   self._scrolled(self._build_settings_panel()),   True, 1),
                ("Make Tab Settings",  self._scrolled(self._build_make_tab_settings_panel()), False, 1),
                ("Show Mode Palette",  self._scrolled(self._build_show_palette_panel()), False, 1),
            ])
            middle_col = self._panel_column([
                ("Pen Type Offsets",   self._scrolled(self._build_pen_offsets_panel()), False, 0),
                ("Pen Holder Management",  self._scrolled(self._build_tool_panel()),    False, 2),
                ("Test Pen Generator", self._scrolled(self._build_testpen_panel()), True,  1),
                # "Signature Settings" panel removed -- signature is now owned by the make
                # tab (make_local/scripts/signatureSettings.js). _build_signature_panel
                # remains defined but unused; slated for deletion in a later cleanup.
            ])
            right_col = self._panel_column([
                ("Print Queue",     self._scrolled(self._build_queue_panel()),  False, 1),
                ("Vpype Settings",  self._scrolled(self._build_vpype_panel()),  True,  0),
                ("G-code Runner",   self._scrolled(self._build_gcode_panel()),  False, 2),
            ])

            self._left_col, self._middle_col, self._right_col = left_col, middle_col, right_col
            main_splitter.addWidget(left_col)
            main_splitter.addWidget(middle_col)
            main_splitter.addWidget(right_col)
            main_splitter.setStretchFactor(0, 0)
            main_splitter.setStretchFactor(1, 1)
            main_splitter.setStretchFactor(2, 1)
            main_splitter.setSizes([300, 520, 520])

            self._central_stack = QStackedWidget()
            self._central_stack.addWidget(main_splitter)   # index 0: machine
            if _HAS_WEBENGINE:
                self._central_stack.addWidget(self._build_make_widget())  # index 1: make
            self.setCentralWidget(self._central_stack)

        def _make_status_bar(self):
            layout = QHBoxLayout()
            layout.setContentsMargins(8, 4, 8, 4)
            layout.setSpacing(12)

            self.status_label = QLabel("🔴 DISCONNECTED")
            f = QFont("Arial", 12)
            f.setBold(True)
            self.status_label.setFont(f)
            layout.addWidget(self.status_label)

            self.port_label = QLabel("Port: None")
            self.port_label.setFont(QFont("Arial", 10))
            layout.addWidget(self.port_label)

            for attr, heading in [("machine_label", "Machine:"), ("work_label", "Work (G54):")]:
                grp = QWidget()
                v = QVBoxLayout(grp)
                v.setContentsMargins(0, 0, 0, 0)
                v.setSpacing(0)
                lbl = QLabel(heading)
                lbl.setFont(QFont("Arial", 8))
                v.addWidget(lbl)
                val = QLabel("X: 0.00  Y: 0.00  Z: 0.00")
                val.setFont(QFont("Courier", 9))
                setattr(self, attr, val)
                v.addWidget(val)
                layout.addWidget(grp)

            wcs_grp = QWidget()
            wcs_v = QVBoxLayout(wcs_grp)
            wcs_v.setContentsMargins(0, 0, 0, 0)
            wcs_v.setSpacing(0)
            wcs_v.addWidget(QLabel("Work Offset:"))
            self.wcs_combo = QComboBox()
            self.wcs_combo.addItems(["G54", "G55", "G56", "G57", "G58", "G59"])
            self.wcs_combo.setFixedWidth(80)
            self.wcs_combo.currentTextChanged.connect(self._on_wcs_combo_changed)
            wcs_v.addWidget(self.wcs_combo)
            layout.addWidget(wcs_grp)

            layout.addStretch()

            if _HAS_WEBENGINE:
                self._make_mode_btn = QPushButton("Make →")
                self._make_mode_btn.setCheckable(True)
                self._make_mode_btn.setFont(QFont("Arial", 11))
                self._make_mode_btn.setFixedHeight(30)
                self._make_mode_btn.setStyleSheet(
                    "QPushButton { padding: 0 12px; border: 1px solid #aaa; border-radius: 4px; }"
                    "QPushButton:checked { background: #111; color: #fff; border-color: #111; }"
                )
                self._make_mode_btn.clicked.connect(self._toggle_make_mode)
                layout.addWidget(self._make_mode_btn)

            self._fullscreen_btn = QPushButton("⛶")
            self._fullscreen_btn.setFixedSize(30, 30)
            self._fullscreen_btn.setFont(QFont("Arial", 13))
            self._fullscreen_btn.setToolTip("Toggle fullscreen (F11)")
            self._fullscreen_btn.setStyleSheet("QPushButton { border: 1px solid #aaa; border-radius: 4px; }")
            self._fullscreen_btn.clicked.connect(self._toggle_fullscreen)
            layout.addWidget(self._fullscreen_btn)

            ver = QLabel(f"v{__version__}")
            ver.setFont(QFont("Arial", 9))
            layout.addWidget(ver)
            return layout

        def _toggle_fullscreen(self):
            if self.isFullScreen():
                self.showNormal()
            else:
                self.showFullScreen()

        def keyPressEvent(self, event):
            if event.key() == Qt.Key.Key_F11:
                self._toggle_fullscreen()
            else:
                super().keyPressEvent(event)

        def _toggle_make_mode(self, checked: bool):
            self._central_stack.setCurrentIndex(1 if checked else 0)
            self._make_mode_btn.setText("← Machine" if checked else "Make →")

        def _build_make_widget(self):
            w = QWidget()
            lay = QVBoxLayout(w)
            lay.setContentsMargins(0, 0, 0, 0)
            lay.setSpacing(0)
            view = QWebEngineView()
            # Named (persistent) profile so localStorage -- and therefore the
            # whole Pens registry (window.plotPens) -- survives app restarts
            # instead of silently resetting to the hardcoded CMYK Stabilo
            # default every time. The disk HTTP cache (the actual cause of
            # the old "stale file after edit" problem this used to dodge by
            # going off-the-record) is disabled explicitly below instead, so
            # edited JS/HTML still always reload fresh.
            profile = QWebEngineProfile("pl0tb0t_persistent", view)
            profile.setHttpCacheType(QWebEngineProfile.HttpCacheType.NoCache)
            page = QWebEnginePage(profile, view)
            view.setPage(page)
            make_html = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'make_local', 'index.html')
            view.setUrl(QUrl.fromLocalFile(make_html))
            view.page().loadFinished.connect(
                lambda ok: (self._push_pen_width(), self._push_make_tab_settings(), self._push_pen_types_to_make(), self._push_draw_order(), self._push_machine_connected(), self._push_show_palette()) if ok else None)
            settings = view.page().settings()
            settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
            settings.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
            api_key = os.environ.get("QUEUE_API_KEY", "pl0tb0t-secret")
            # Queue URL from the app's queue settings (queue_config.json) so the
            # make tab posts Save/plot jobs wherever the OS is pointed -- e.g.
            # http://pl0tb0tpi5:5001 when driving from a PC and plotting on the Pi.
            try:
                import json as _qj, pathlib as _qp
                queue_url = _qj.loads((_qp.Path(__file__).parent / "queue_config.json").read_text()).get("url", "http://localhost:5001")
            except Exception:
                queue_url = "http://localhost:5001"
            # DocumentCreation: globals available before page scripts run
            inject = QWebEngineScript()
            inject.setName("pl0tb0t_inject")
            inject.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentCreation)
            inject.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
            inject.setSourceCode(f"window.QUEUE_URL = '{queue_url}'; window.QUEUE_API_KEY = '{api_key}'; window._pl0tMode = 'full';")
            view.page().scripts().insert(inject)
            # DocumentReady: force ctrl-col width via inline style so it wins
            # regardless of whatever CSS the webview ends up serving.
            width_inject = QWebEngineScript()
            width_inject.setName("pl0tb0t_ctrl_width")
            width_inject.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentReady)
            width_inject.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
            width_inject.setSourceCode(
                "(function(){"
                "var c=document.getElementById('ctrl-col');"
                "if(c){c.style.flex='0 0 320px';c.style.minWidth='0';c.style.overflow='hidden';}"
                "})();"
            )
            view.page().scripts().insert(width_inject)
            self._make_webview = view
            lay.addWidget(view)

            # Watch make_local/ for file changes and hard-reload (bypass cache).
            make_local_dir = os.path.dirname(make_html)
            self._make_watcher = QFileSystemWatcher()
            self._make_watcher.addPath(make_local_dir)
            for root, _dirs, files in os.walk(make_local_dir):
                for fn in files:
                    self._make_watcher.addPath(os.path.join(root, fn))
            def _hard_reload():
                self._make_webview.page().triggerAction(
                    QWebEnginePage.WebAction.ReloadAndBypassCache)
            def _on_file_changed(path):
                self._make_watcher.addPath(path)   # re-watch after inode replace
                QTimer.singleShot(150, _hard_reload)
            def _on_dir_changed(path):
                for root, _dirs, files in os.walk(path):
                    for fn in files:
                        self._make_watcher.addPath(os.path.join(root, fn))
                QTimer.singleShot(150, _hard_reload)
            self._make_watcher.fileChanged.connect(_on_file_changed)
            self._make_watcher.directoryChanged.connect(_on_dir_changed)
            return w

        def _build_connection_panel(self):
            w = QWidget()
            layout = QVBoxLayout(w)
            layout.setContentsMargins(8, 8, 8, 8)
            layout.setSpacing(8)

            # Daemon status indicator
            daemon_row = QHBoxLayout()
            self._daemon_status_label = QLabel("⬤ Daemon: not running")
            self._daemon_status_label.setStyleSheet("color: #888; font-size: 11px;")
            daemon_row.addWidget(self._daemon_status_label)
            daemon_row.addStretch()
            self._daemon_stop_btn = QPushButton("Stop Daemon")
            self._daemon_stop_btn.setFixedHeight(22)
            self._daemon_stop_btn.setStyleSheet("font-size: 10px; color: #c44;")
            self._daemon_stop_btn.setVisible(False)
            self._daemon_stop_btn.clicked.connect(self._stop_daemon)
            daemon_row.addWidget(self._daemon_stop_btn)
            layout.addLayout(daemon_row)

            port_row = QHBoxLayout()
            port_row.addWidget(QLabel("Port:"))
            self.port_combo = QComboBox()
            self.port_combo.setMinimumWidth(120)
            port_row.addWidget(self.port_combo, 1)
            layout.addLayout(port_row)

            row1 = QHBoxLayout()
            for text, cmd in [("Refresh", self.refresh_ports),
                               ("Connect", self.connect_port),
                               ("Disconnect", self.disconnect_port)]:
                btn = QPushButton(text)
                btn.clicked.connect(cmd)
                row1.addWidget(btn)
            layout.addLayout(row1)

            row2 = QHBoxLayout()
            home_btn = QPushButton("🏠 Home")
            home_btn.clicked.connect(self.home_machine)
            unlock_btn = QPushButton("🔓 Unlock")
            unlock_btn.clicked.connect(self.unlock_machine)
            grbl_btn = QPushButton("$$ Settings")
            grbl_btn.clicked.connect(self.query_grbl_settings)
            row2.addWidget(home_btn)
            row2.addWidget(unlock_btn)
            row2.addWidget(grbl_btn)
            layout.addLayout(row2)

            layout.addStretch()

            # Try connecting to an already-running daemon on startup
            QTimer.singleShot(500, self._try_reconnect_daemon)
            return w

        def _build_make_tab_settings_panel(self):
            w = QWidget()
            layout = QVBoxLayout(w)
            layout.setContentsMargins(8, 8, 8, 8)
            layout.setSpacing(8)

            # Render mode toggle — first in panel
            self._render_mode = 'full'
            self._render_mode_btn = QPushButton('Mode: Home ■ (full hatch)')
            self._render_mode_btn.setToolTip(
                'Show Mode: canvas-tile fills, fast for live use\n'
                'Home Mode: full geometry fills, higher quality'
            )
            def _toggle_render_mode():
                self._render_mode = 'full' if self._render_mode == 'fast' else 'fast'
                mode = self._render_mode
                self._render_mode_btn.setText(
                    'Mode: Show ► (fast hatch)' if mode == 'fast' else 'Mode: Home ■ (full hatch)'
                )
                self._make_webview.page().runJavaScript(
                    f"window._pl0tMode = '{mode}';"
                    f"if(window.makeSketchApp&&window.makeSketchApp.setRenderMode)"
                    f"window.makeSketchApp.setRenderMode('{mode}');"
                )
            self._render_mode_btn.clicked.connect(_toggle_render_mode)
            layout.addWidget(self._render_mode_btn)

            layout.addSpacing(8)

            # Paper size
            paper_row = QHBoxLayout()
            paper_lbl = QLabel('Paper size:')
            paper_lbl.setFixedWidth(80)
            paper_row.addWidget(paper_lbl)
            self._make_paper_combo = QComboBox()
            for val, lbl in [('5x7','5 × 7"'), ('9x12','9 × 12"'),
                              ('11x14','11 × 14"'), ('11x17','11 × 17"'), ('14x17','14 × 17"')]:
                self._make_paper_combo.addItem(lbl, val)
            idx = self._make_paper_combo.findData('9x12')
            if idx >= 0: self._make_paper_combo.setCurrentIndex(idx)
            self._make_paper_combo.currentIndexChanged.connect(self._push_make_tab_settings)
            paper_row.addWidget(self._make_paper_combo, 1)
            layout.addLayout(paper_row)

            # Margin
            margin_row = QHBoxLayout()
            margin_lbl = QLabel('Margin:')
            margin_lbl.setFixedWidth(80)
            margin_row.addWidget(margin_lbl)
            self._make_margin_combo = QComboBox()
            for val, lbl in [('0','0 (none)'), ('0.5','½ inch'), ('0.75','¾ inch'), ('1','1 inch')]:
                self._make_margin_combo.addItem(lbl, val)
            idx = self._make_margin_combo.findData('1')
            if idx >= 0: self._make_margin_combo.setCurrentIndex(idx)
            self._make_margin_combo.currentIndexChanged.connect(self._push_make_tab_settings)
            margin_row.addWidget(self._make_margin_combo, 1)
            layout.addLayout(margin_row)

            layout.addStretch()
            return w

        def _push_make_tab_settings(self):
            """Push paper size, margin and render mode to the active Make tab sketch."""
            paper  = self._make_paper_combo.currentData()
            margin = self._make_margin_combo.currentData()
            mode   = getattr(self, '_render_mode', 'fast')
            js = (
                f'try{{'
                f'if(window.makeSketchApp&&window.makeSketchApp.setRenderMode)'
                f'window.makeSketchApp.setRenderMode("{mode}");'
                f'if(window.sketchAPI&&window.sketchAPI.applyParamsSnapshot){{'
                f'window.sketchAPI.applyParamsSnapshot(['
                f'{{"id":"paperSize","value":"{paper}"}},'
                f'{{"id":"margin","value":"{margin}"}}]);'
                f'}}}}catch(e){{}}'
            )
            try:
                self._make_webview.page().runJavaScript(js)
            except Exception:
                pass

        def _build_jog_panel(self):
            grp = QWidget()
            layout = QVBoxLayout(grp)
            layout.setContentsMargins(8, 8, 8, 8)
            layout.setSpacing(8)

            info = QLabel("Tap = step  |  Hold (0.35s) = continuous  |  Shift = rapid")
            info.setStyleSheet("color: blue; font-style: italic;")
            info.setFont(QFont("Arial", 8))
            layout.addWidget(info)

            layout.addWidget(QLabel("Distance (mm):"))
            self.jog_dist_slider = QSlider(Qt.Orientation.Horizontal)
            self.jog_dist_slider.setRange(1, 500)   # /10 → 0.1–50
            self.jog_dist_slider.setValue(10)
            layout.addWidget(self.jog_dist_slider)
            self.jog_dist_label = QLabel("1.0 mm")
            self.jog_dist_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            layout.addWidget(self.jog_dist_label)
            self.jog_dist_slider.valueChanged.connect(
                lambda v: self.jog_dist_label.setText(f"{v/10.0:.1f} mm"))

            layout.addWidget(QLabel("Speed (mm/min):"))
            self.jog_speed_slider = QSlider(Qt.Orientation.Horizontal)
            self.jog_speed_slider.setRange(10, 2000)
            self.jog_speed_slider.setValue(500)
            layout.addWidget(self.jog_speed_slider)
            self.jog_speed_label = QLabel("500 mm/min")
            self.jog_speed_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            layout.addWidget(self.jog_speed_label)
            self.jog_speed_slider.valueChanged.connect(
                lambda v: self.jog_speed_label.setText(f"{v} mm/min"))

            grid = QGridLayout()
            grid.setSpacing(4)
            grid.addWidget(self._jog_btn("↑↑↑ +Y", lambda: self.jog_axis("Y",  self._jog_dist())), 0, 1)
            grid.addWidget(self._jog_btn("← -X",   lambda: self.jog_axis("X", -self._jog_dist())), 1, 0)
            center = QPushButton("CENTER")
            center.setToolTip("Set work offset to current position")
            center.clicked.connect(self.jog_zero)
            grid.addWidget(center, 1, 1)
            grid.addWidget(self._jog_btn("+X →",   lambda: self.jog_axis("X",  self._jog_dist())), 1, 2)
            grid.addWidget(self._jog_btn("↓↓↓ -Y", lambda: self.jog_axis("Y", -self._jog_dist())), 2, 1)
            layout.addLayout(grid)

            z_row = QHBoxLayout()
            z_row.addWidget(self._jog_btn("↑ +Z", lambda: self.jog_axis("Z",  self._jog_dist())))
            z_row.addWidget(self._jog_btn("↓ -Z", lambda: self.jog_axis("Z", -self._jog_dist())))
            layout.addLayout(z_row)
            layout.addStretch()
            return grp

        def _jog_btn(self, label, fn):
            b = QPushButton(label)
            b.clicked.connect(fn)
            return b

        def _jog_dist(self):
            return self.jog_dist_slider.value() / 10.0

        def _jog_speed(self):
            return self.jog_speed_slider.value()

        def _build_workzero_panel(self):
            grp = QWidget()
            layout = QVBoxLayout(grp)
            layout.setContentsMargins(8, 8, 8, 8)
            layout.setSpacing(8)

            hdr = QHBoxLayout()
            hdr.addWidget(QLabel("Active WCS:"))
            self.wcs_active_label = QLabel("G54")
            self.wcs_active_label.setFont(QFont("Arial", 9))
            hdr.addWidget(self.wcs_active_label)
            hdr.addStretch()
            ref_btn = QPushButton("↺")
            ref_btn.setFixedWidth(30)
            ref_btn.setToolTip("Fetch stored WCS offsets from GRBL ($#)")
            ref_btn.clicked.connect(
                lambda: threading.Thread(target=self._refresh_wcs_offsets, daemon=True).start())
            hdr.addWidget(ref_btn)
            layout.addLayout(hdr)

            self.wcs_offset_label = QLabel("Offset  X: —    Y: —    Z: —")
            self.wcs_offset_label.setFont(QFont("Courier", 8))
            self.wcs_offset_label.setStyleSheet("color: gray;")
            layout.addWidget(self.wcs_offset_label)

            zero_row = QHBoxLayout()
            for axis in ["X", "Y", "Z"]:
                btn = QPushButton(f"Zero {axis}")
                btn.clicked.connect(lambda _, a=axis: self.zero_wcs_axis(a))
                zero_row.addWidget(btn)
            all_btn = QPushButton("Zero All")
            all_btn.clicked.connect(self.zero_wcs_all)
            zero_row.addWidget(all_btn)
            layout.addLayout(zero_row)

            touch_row = QHBoxLayout()
            touch_row.addWidget(QLabel("Touch off Z:"))
            self.touchoff_z_edit = QLineEdit("0.0")
            self.touchoff_z_edit.setFixedWidth(70)
            touch_row.addWidget(self.touchoff_z_edit)
            touch_row.addWidget(QLabel("mm"))
            set_btn = QPushButton("Set")
            set_btn.setToolTip("Tell GRBL the current Z is this value in the active WCS.")
            set_btn.clicked.connect(self.touchoff_z)
            touch_row.addWidget(set_btn)
            touch_row.addStretch()
            layout.addLayout(touch_row)

            # Travel-to buttons
            travel_lbl = QLabel("Travel to:")
            travel_lbl.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            layout.addWidget(travel_lbl)

            travel_row1 = QHBoxLayout()
            for label, cmd in [
                ("→ X0",   lambda: self._travel_to(x=0)),
                ("→ Y0",   lambda: self._travel_to(y=0)),
                ("→ Z0",   lambda: self._travel_to(z=0)),
                ("→ XYZ0", lambda: self._travel_to(x=0, y=0, z=0)),
            ]:
                b = QPushButton(label)
                b.clicked.connect(cmd)
                travel_row1.addWidget(b)
            layout.addLayout(travel_row1)

            travel_row2 = QHBoxLayout()
            xy_safe_btn = QPushButton("→ XY0 at Safe Z")
            xy_safe_btn.setToolTip("Raise to safe clearance height, then move to work X0 Y0")
            xy_safe_btn.clicked.connect(self._travel_xy_safe)
            travel_row2.addWidget(xy_safe_btn)
            layout.addLayout(travel_row2)

            layout.addStretch()
            return grp

        def _build_settings_panel(self):
            w = QWidget()
            layout = QVBoxLayout(w)
            layout.setContentsMargins(8, 8, 8, 8)
            layout.setSpacing(8)

            def _section(title):
                lbl = QLabel(title)
                lbl.setStyleSheet("font-weight: bold; color: #444;")
                lbl.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
                layout.addWidget(lbl)

            def _field(label, attr, tooltip=""):
                row = QHBoxLayout()
                lbl = QLabel(label)
                lbl.setFixedWidth(170)
                row.addWidget(lbl)
                edit = QLineEdit(str(getattr(self.config, attr)))
                if tooltip:
                    edit.setToolTip(tooltip)
                def _save(text, a=attr):
                    try:
                        val = float(text)
                        setattr(self.config, a, int(val) if isinstance(getattr(self.config, a), int) else val)
                        save_config(self.config)
                    except ValueError:
                        pass
                edit.editingFinished.connect(lambda e=edit, a=attr: _save(e.text(), a))
                row.addWidget(edit, 1)
                layout.addLayout(row)
                return edit

            _section("Pen / Drawing")
            self._cfg_draw_speed  = _field("Draw speed (mm/min):", "draw_speed",
                                           "G1 feed rate while drawing — saved to OSConfig and patched into the vpype .cfg")
            # When draw speed changes, also patch the F value in the vpype .cfg file
            self._cfg_draw_speed.editingFinished.connect(self._sync_draw_speed_to_vpype_cfg)
            self._cfg_pen_lift    = _field("Lift Z between segments (mm):", "pen_lift_z",
                                           "How high Z rises between strokes inside vpype layer G-code")
            self._cfg_pen_contact = _field("Contact Z (pen on paper) (mm):", "pen_contact_z",
                                           "Z position when the pen is on the paper surface")
            self._cfg_pen_width   = _field("Pen width (mm):", "pen_width_mm",
                                           "Nib width — affects fill density and stroke weight in all sketches")
            self._cfg_pen_width.editingFinished.connect(lambda: self._push_pen_width())
            self._cfg_pen_width.editingFinished.connect(lambda: self._push_signature_config())
            self._cfg_travel_speed = _field("Travel speed (mm/min):", "travel_speed",
                                            "G0 rapid speed — used only for plot-time estimation")

            _section("Tool Changes")
            self._cfg_tc_unplug   = _field("Unplug offset (mm):",  "tc_unplug_mm",
                                           "Y distance behind dock centre for approach/release")
            self._cfg_tc_rapid    = _field("Rapid speed (mm/min):", "tc_rapid",
                                           "Travel speed for non-contact tool-change moves")
            self._cfg_tc_approach = _field("Approach speed (mm/min):", "tc_approach",
                                           "Slow docking/undocking speed")

            layout.addStretch()
            return w

        def _push_signature_config(self):
            """Deprecated: signature config is now OWNED by the make tab
            (make_local/scripts/signatureSettings.js, persisted in localStorage).
            Kept as a no-op so existing on-change connections don't error and no
            longer clobber the make tab's own config."""
            return

        def _push_pen_width(self):
            """Push pen_width_mm and plot-speed globals to the Make tab."""
            val  = self.config.pen_width_mm
            ds   = self.config.draw_speed
            ts   = self.config.travel_speed
            js = (f'window._pl0tPenWidthMm={val};'
                  f'window._pl0tDrawSpeed={ds};'
                  f'window._pl0tTravelSpeed={ts};'
                  f'try{{if(window.makeSketch&&window.makeSketch.setParam)'
                  f'window.makeSketch.setParam("penWidthMm",{val});}}catch(e){{}}')
            try:
                self._make_webview.page().runJavaScript(js)
            except Exception:
                pass

        def _build_show_palette_panel(self):
            w = QWidget()
            layout = QVBoxLayout(w)
            layout.setContentsMargins(8, 8, 8, 8)
            layout.setSpacing(6)
            info = QLabel("Show-mode colour palette \u2014 one swatch per holder. Click a swatch to set the colour used for that slot in Show mode. This palette drives every Show-mode colour picker across sketches.")
            info.setWordWrap(True)
            info.setStyleSheet("color:#666; font-size:11px;")
            layout.addWidget(info)
            self._show_palette_row = QWidget()
            self._show_palette_layout = QHBoxLayout(self._show_palette_row)
            self._show_palette_layout.setContentsMargins(0, 0, 0, 0)
            self._show_palette_layout.setSpacing(6)
            layout.addWidget(self._show_palette_row)
            refresh = QPushButton("\u21bb Match holders")
            refresh.setToolTip("Rebuild the swatch row to match the current number of holders")
            refresh.clicked.connect(self._rebuild_show_palette_swatches)
            layout.addWidget(refresh)
            layout.addStretch()
            self._rebuild_show_palette_swatches()
            return w

        def _style_show_swatch(self, btn, col):
            if col:
                btn.setStyleSheet("background:%s; border:1px solid #888; border-radius:5px;" % col)
                btn.setText("")
            else:
                btn.setStyleSheet("background:#eee; border:1px dashed #aaa; border-radius:5px; color:#999; font-size:16px;")
                btn.setText("+")

        def _rebuild_show_palette_swatches(self):
            lay = getattr(self, "_show_palette_layout", None)
            if lay is None:
                return
            while lay.count():
                it = lay.takeAt(0)
                wdg = it.widget()
                if wdg:
                    wdg.deleteLater()
            n = max(1, len(self.tools))
            pal = list(self.config.show_palette or [])
            while len(pal) < n:
                pal.append("")
            self.config.show_palette = pal[:max(n, len(pal))]
            for i in range(n):
                col = self.config.show_palette[i] if i < len(self.config.show_palette) else ""
                btn = QPushButton()
                btn.setFixedSize(34, 34)
                nm = self.tools[i].name if i < len(self.tools) else ("Slot %d" % (i + 1))
                btn.setToolTip("%s \u2014 click to set Show-mode colour" % nm)
                self._style_show_swatch(btn, col)
                btn.clicked.connect(lambda checked=False, idx=i: self._pick_show_color(idx))
                lay.addWidget(btn)
            lay.addStretch()

        def _pick_show_color(self, idx):
            from PyQt6.QtGui import QColor
            while len(self.config.show_palette) <= idx:
                self.config.show_palette.append("")
            cur = self.config.show_palette[idx]
            initial = QColor(cur) if cur else QColor("#888888")
            c = QColorDialog.getColor(initial, self, "Pick Show-mode colour")
            if c.isValid():
                self.config.show_palette[idx] = c.name()
                save_config(self.config)
                item = self._show_palette_layout.itemAt(idx)
                btn = item.widget() if item else None
                if btn:
                    self._style_show_swatch(btn, c.name())
                self._push_show_palette()

        def _push_show_palette(self):
            try:
                import json as _json
                cols = [c for c in (self.config.show_palette or []) if c]
                js = ("window._pl0tShowPalette = " + _json.dumps(cols) + ";"
                      "if (window.makeSketchApp && window.makeSketchApp.onPensChanged) window.makeSketchApp.onPensChanged();")
                self._make_webview.page().runJavaScript(js)
            except Exception:
                pass

        def _build_signature_panel(self):
            w = QWidget()
            layout = QVBoxLayout(w)
            layout.setContentsMargins(8, 8, 8, 8)
            layout.setSpacing(8)

            def _sig_check(label, attr, tip=''):
                cb = QCheckBox(label)
                cb.setChecked(bool(getattr(self.config, attr)))
                if tip: cb.setToolTip(tip)
                def _toggle(state, a=attr):
                    setattr(self.config, a, bool(state))
                    save_config(self.config)
                    self._push_signature_config()
                cb.stateChanged.connect(_toggle)
                layout.addWidget(cb)
                return cb

            def _sig_field(label, attr, w_px=70, tip=''):
                row = QHBoxLayout()
                lbl = QLabel(label)
                lbl.setFixedWidth(160)
                if tip: lbl.setToolTip(tip)
                row.addWidget(lbl)
                edit = QLineEdit(str(getattr(self.config, attr)))
                if tip: edit.setToolTip(tip)
                def _save(a=attr, e=edit):
                    try:
                        setattr(self.config, a, float(e.text()))
                        save_config(self.config)
                        self._push_signature_config()
                    except ValueError:
                        pass
                edit.editingFinished.connect(_save)
                row.addWidget(edit, 1)
                layout.addLayout(row)
                return edit

            self._sig_enabled_cb  = _sig_check('Enable signature',          'sig_enabled',  tip='Draw an attribution band at the bottom of every sketch')
            self._sig_preview_cb  = _sig_check('Show preview on canvas',    'sig_show_preview', tip='Render the band in the Make tab canvas (does not affect SVG export)')
            self._sig_suppress_cb = _sig_check('Suppress from SVG export',  'sig_suppress_export', tip='Omit the signature band from SVG files sent to the plotter')
            self._sig_logo_cb     = _sig_check('Include 90% logo',          'sig_show_logo',  tip='Add the 90percent art logo flush with the right margin')
            self._sig_seed_cb     = _sig_check('Include random seed name',   'sig_show_seed_name', tip='Print the auto-generated seed name (e.g. "rust lace") in the signature band')

            # Font selector
            font_row = QHBoxLayout()
            font_lbl = QLabel('Font:')
            font_lbl.setFixedWidth(160)
            font_row.addWidget(font_lbl)
            self._sig_font_combo = QComboBox()
            self._sig_font_combo.addItems(['EF Script', 'Hershey'])
            self._sig_font_combo.setCurrentIndex(0 if self.config.sig_font == 'ef' else 1)
            def _on_font_change(idx):
                self.config.sig_font = 'ef' if idx == 0 else 'hershey'
                save_config(self.config)
                self._push_signature_config()
            self._sig_font_combo.currentIndexChanged.connect(_on_font_change)
            font_row.addWidget(self._sig_font_combo)
            font_row.addStretch()
            layout.addLayout(font_row)

            # Numeric fields
            self._sig_height_edit   = _sig_field('Text height (mm):',        'sig_height_mm',  tip='Height of the signature text in mm (e.g. 2.0)')
            self._sig_scale_edit    = _sig_field('Scale:',                   'sig_scale',      tip='Multiplies text height — scale the whole band up/down without changing the mm value')
            self._sig_frombottom_edit = _sig_field('Offset into margin (mm):', 'sig_from_margin_mm', tip='Distance from the art/margin boundary downward into the margin. 0 = text flush with art edge. Leave at -1 to auto-center within whatever margin you have set.')
            self._sig_hpad_edit     = _sig_field('Band padding (mm):',        'sig_h_pad_mm',   tip='Pulls the text and logo inward from the margin edges on both sides of the signature band')
            self._sig_logo_scale_edit = _sig_field('Logo scale:',              'sig_logo_scale', tip='Scale the 90% logo independently from the text (1.0 = same height as text)')
            self._sig_sep_scale_edit  = _sig_field('Separator scale:',          'sig_sep_scale',  tip='Makes | dividers taller than the text — 1.3 = 30% taller')
            self._sig_sep_pad_edit    = _sig_field('Separator padding (em):',    'sig_sep_pad',    tip='Gap on each side of | in multiples of text height (1 em = 1x text height). Increase to spread text away from the | dividers equally on both sides.')

            # Custom message (full-width)
            msg_lbl = QLabel('Custom message:')
            layout.addWidget(msg_lbl)
            self._sig_msg_edit = QLineEdit(self.config.sig_custom_msg)
            def _on_msg_done():
                self.config.sig_custom_msg = self._sig_msg_edit.text()
                save_config(self.config)
                self._push_signature_config()
            self._sig_msg_edit.editingFinished.connect(_on_msg_done)
            layout.addWidget(self._sig_msg_edit)

            layout.addStretch()
            return w

        def _push_pen_types_to_make(self):
            try:
                import json as _json
                js = ("window._pl0tPenTypes = " + _json.dumps(self._pen_types()) + ";"
                      "window._pl0tPenTipWidths = " + _json.dumps({pt: self._pen_tip_width(pt) for pt in self._pen_types()}) + ";"
                      "window._pl0tPenZOffsets = " + _json.dumps({pt: round(self._pen_tip_delta(pt)[2], 4) for pt in self._pen_types()}) + ";"
                      "window._pl0tPenContactZ = " + _json.dumps(float(self.config.pen_contact_z)) + ";"
                      "if (window.makeSketchApp && window.makeSketchApp.onPensChanged) window.makeSketchApp.onPensChanged();")
                self._make_webview.page().runJavaScript(js)
            except Exception:
                pass

        def _pen_offset(self, ptype):
            o = (self.config.pen_offsets or {}).get(ptype)
            if isinstance(o, (list, tuple)) and len(o) >= 3:
                try: return [float(o[0]), float(o[1]), float(o[2])]
                except (TypeError, ValueError): return [0.0, 0.0, 0.0]
            return [0.0, 0.0, 0.0]

        def _read_js_pen_map(self):
            # MAIN THREAD ONLY. Reads the loaded-pen registry (window.plotPens)
            # from the Make webview and returns {colour_lower: pen_type}. Used to
            # drive the plot's Z/Y offset from the pen the user says is loaded.
            from PyQt6.QtCore import QEventLoop
            import json as _json
            result = ['[]']
            loop = QEventLoop()
            js = ('(function(){try{if(window.plotPens&&window.plotPens.pens){'
                  'return JSON.stringify(window.plotPens.pens().map(function(p){'
                  'return {c:(p.color||"").toLowerCase(),t:p.pen_type||""};}));}}'
                  'catch(e){}return "[]";})()')
            def _cb(val):
                result[0] = val or '[]'
                loop.quit()
            try:
                self._make_webview.page().runJavaScript(js, _cb)
                loop.exec()
            except Exception:
                return {}
            out = {}
            try:
                for e in _json.loads(result[0]):
                    c = (e.get('c') or '').lower(); t = e.get('t') or ''
                    if c and t:
                        out[c] = t
            except Exception:
                pass
            return out

        def _read_js_skip_set(self):
            # MAIN THREAD ONLY. Reads the session-only Skip Layers panel
            # (window._pl0tSkippedLayers) from the Make webview and returns a
            # set of lowercase hex colours to exclude from this plot's
            # per-layer vpype/tool-change generation.
            from PyQt6.QtCore import QEventLoop
            import json as _json
            result = ['[]']
            loop = QEventLoop()
            js = ('(function(){try{return JSON.stringify((window._pl0tSkippedLayers||[])'
                  '.map(function(c){return (c||"").toLowerCase();}));}'
                  'catch(e){}return "[]";})()')
            def _cb(val):
                result[0] = val or '[]'
                loop.quit()
            try:
                self._make_webview.page().runJavaScript(js, _cb)
                loop.exec()
            except Exception:
                return set()
            try:
                return set(_json.loads(result[0]))
            except Exception:
                return set()

        def _read_js_pen_slot_map(self):
            # MAIN THREAD ONLY. Returns {colour_lower: index} from the JS Pens
            # registry's own order (index 0 = slot 1 = rightmost chip in the
            # editor). This is the user-declared holder position for each
            # colour and should drive which physical tool a colour's tool
            # change goes to -- NOT whichever order colours happen to appear
            # in this particular file (the old behaviour, which meant the
            # same colour could land on a different holder plot to plot).
            from PyQt6.QtCore import QEventLoop
            import json as _json
            result = ['[]']
            loop = QEventLoop()
            js = ('(function(){try{if(window.plotPens&&window.plotPens.pens){'
                  'return JSON.stringify(window.plotPens.pens().map(function(p){'
                  'return (p.color||"").toLowerCase();}));}}'
                  'catch(e){}return "[]";})()')
            def _cb(val):
                result[0] = val or '[]'
                loop.quit()
            try:
                self._make_webview.page().runJavaScript(js, _cb)
                loop.exec()
            except Exception:
                return {}
            out = {}
            try:
                for i, c in enumerate(_json.loads(result[0])):
                    if c and c not in out:
                        out[c] = i
            except Exception:
                pass
            return out

        def _read_js_draw_order(self):
            # MAIN THREAD ONLY. Reads window._pl0tDrawOrder (set by the Make
            # tab's Advanced > Draw order select) if present, else falls back
            # to the persisted config value.
            from PyQt6.QtCore import QEventLoop
            result = [None]
            loop = QEventLoop()
            js = '(function(){try{return window._pl0tDrawOrder||"";}catch(e){}return "";})()'
            def _cb(val):
                result[0] = val or None
                loop.quit()
            try:
                self._make_webview.page().runJavaScript(js, _cb)
                loop.exec()
            except Exception:
                return self.config.draw_order
            return result[0] or self.config.draw_order

        def _push_draw_order(self):
            try:
                import json as _json
                js = "window._pl0tDrawOrder = " + _json.dumps(self.config.draw_order) + ";"
                self._make_webview.page().runJavaScript(js)
            except Exception:
                pass

        def _dedupe_assignments_by_color(self, assignments):
            # _split_svg_by_color() extracts every path of a given colour from the
            # WHOLE svg regardless of which layer/sculpture triggered the call, so
            # if `assignments` has multiple entries sharing a colour (e.g. several
            # sculptures/shapes using the same pen), each one would independently
            # regenerate and re-plot ALL of that colour's content from scratch --
            # the same lines drawn N times in a row (same colour throughout, since
            # it's one pen pickup covering all N repeats). Call this right before
            # gcode generation (not inside the shared assignment-building helpers --
            # some callers index into their result positionally against the full,
            # non-deduped per-layer list). Keeps the first entry per colour.
            seen = set()
            out = []
            for layer, tool in assignments:
                c = (layer.get("color") or "").lower()
                if c in seen:
                    continue
                seen.add(c)
                out.append((layer, tool))
            return out

        def _apply_draw_order(self, assignments, order_mode=None):
            # Re-sequence an already-built (layer, tool) assignments list so
            # the FIRST tool picked up matches the chosen convention, instead
            # of whatever order colours happened to appear in the file.
            mode = order_mode or self.config.draw_order
            if mode == "left_to_right":
                # Ascending physical X = leftmost holder first. If a machine's
                # X axis runs the other way, this is the one line to flip.
                return sorted(assignments, key=lambda pair: pair[1].x)
            # default: lightest to darkest
            return sorted(assignments, key=lambda pair: -self._luminance(pair[0].get("color") or ""))

        def _effective_pen_type(self, color, tool):
            # The loaded-pen type for this colour (from the JS pen panel) if it's
            # a known pen type, else fall back to the holder's own pen_type. This
            # is what drives the Z tip-length and V-groove Y offsets, so it must
            # reflect the pen PHYSICALLY loaded, which the user declares in the
            # Make-tab pen panel.
            pm = getattr(self, '_active_pen_map', None) or {}
            c = (color or '').lower()
            pt = pm.get(c)
            if pt and pt in self._pen_types():
                return pt
            return getattr(tool, 'pen_type', 'custom')

        def _pen_tip_delta(self, ptype):
            if not ptype or ptype not in self._pen_types():
                return (0.0, 0.0, 0.0)
            a = self._pen_offset(ptype)
            b = self._pen_offset(getattr(self.config, 'zero_pen_type', 'stabilo'))
            return (a[0] - b[0], a[1] - b[1], a[2] - b[2])

        def _pen_diameter(self, ptype):
            try: return float((self.config.pen_diameters or {}).get(ptype, 0) or 0)
            except (TypeError, ValueError): return 0.0

        def _pen_tip_width(self, ptype):
            try: return float((self.config.pen_tip_widths or {}).get(ptype, 0) or 0)
            except (TypeError, ValueError): return 0.0

        def _pen_xy_delta(self, ptype):
            # V-groove technique shifts the pen center along Y only; X never moves.
            if not ptype or ptype not in self._pen_types():
                return (0.0, 0.0)
            zt = getattr(self.config, 'zero_pen_type', 'stabilo')
            dy = VGROOVE_K * (self._pen_diameter(ptype) - self._pen_diameter(zt))
            # manual per-pen Y trim (pen_offsets Y slot), relative to the zero pen
            dy += self._pen_offset(ptype)[1] - self._pen_offset(zt)[1]
            return (0.0, dy)

        def _save_pen_offsets(self):
            offs = {}; dias = {}; tips = {}
            for pt, eds in self._pen_offset_edits.items():
                try: dias[pt] = float(eds[0].text())
                except ValueError: dias[pt] = self._pen_diameter(pt)
                try: tips[pt] = float(eds[1].text())
                except ValueError: tips[pt] = self._pen_tip_width(pt)
                try: offs[pt] = [0.0, float(eds[2].text()), float(eds[3].text())]
                except ValueError: offs[pt] = self._pen_offset(pt)
            self.config.pen_offsets = offs
            self.config.pen_diameters = dias
            self.config.pen_tip_widths = tips
            self.config.zero_pen_type = self._zero_pen_combo.currentData()
            save_config(self.config)
            self._push_pen_types_to_make()

        def _pen_types(self):
            pts = [str(p).strip() for p in (self.config.pen_types or []) if str(p).strip() and str(p).strip() != "custom"]
            if not pts:
                pts = list(PEN_TYPES)
            return pts

        def _add_pen_type(self):
            name = (self._new_pen_edit.text() or "").strip().lower()
            if not name:
                return
            pts = self._pen_types()
            if name in pts:
                self._new_pen_edit.clear(); return
            pts.append(name)
            self.config.pen_types = pts
            save_config(self.config)
            self._new_pen_edit.clear()
            self._rebuild_pen_dyn()
            self._refresh_tool_pen_combo()
            self._push_pen_types_to_make()

        def _delete_pen_type(self, name):
            self._save_pen_offsets()
            pts = [p for p in self._pen_types() if p != name]
            self.config.pen_types = pts
            if isinstance(self.config.pen_offsets, dict): self.config.pen_offsets.pop(name, None)
            if isinstance(self.config.pen_diameters, dict): self.config.pen_diameters.pop(name, None)
            if getattr(self.config, 'zero_pen_type', '') == name:
                _eff = pts or list(PEN_TYPES)
                self.config.zero_pen_type = _eff[0] if _eff else ""
            save_config(self.config)
            self._rebuild_pen_dyn()
            self._refresh_tool_pen_combo()
            self._push_pen_types_to_make()

        def _refresh_tool_pen_combo(self):
            cb = getattr(self, 'tool_pen_type_combo', None)
            if cb is None:
                return
            cur = cb.currentData()
            cb.blockSignals(True)
            cb.clear()
            for pt in self._pen_types():
                cb.addItem(pt.capitalize(), pt)
            i = cb.findData(cur)
            if i < 0: i = 0
            if i >= 0 and cb.count(): cb.setCurrentIndex(i)
            cb.blockSignals(False)

        def _rebuild_pen_dyn(self):
            old = getattr(self, '_pen_dyn', None)
            if old is not None:
                old.setParent(None); old.deleteLater()
            dyn = QWidget()
            v = QVBoxLayout(dyn); v.setContentsMargins(0, 0, 0, 0); v.setSpacing(8)
            zrow = QHBoxLayout()
            zlbl = QLabel("Zeroed with:"); zlbl.setFixedWidth(90); zrow.addWidget(zlbl)
            self._zero_pen_combo = QComboBox()
            for pt in self._pen_types(): self._zero_pen_combo.addItem(pt.capitalize(), pt)
            _zi = self._zero_pen_combo.findData(getattr(self.config, 'zero_pen_type', 'stabilo'))
            if _zi >= 0: self._zero_pen_combo.setCurrentIndex(_zi)
            self._zero_pen_combo.currentIndexChanged.connect(self._save_pen_offsets)
            zrow.addWidget(self._zero_pen_combo, 1); v.addLayout(zrow)
            grid = QGridLayout(); grid.setSpacing(4)
            grid.addWidget(QLabel("Pen type"), 0, 0)
            for _c, _h in enumerate(["Ø mm", "Tip mm", "Y trim", "Z off"], start=1):
                _hl = QLabel(_h); _hl.setAlignment(Qt.AlignmentFlag.AlignCenter); grid.addWidget(_hl, 0, _c)
            self._pen_offset_edits = {}
            for _r, pt in enumerate(self._pen_types(), start=1):
                grid.addWidget(QLabel(pt.capitalize()), _r, 0)
                _off = self._pen_offset(pt)
                _vals = [self._pen_diameter(pt), self._pen_tip_width(pt), _off[1], _off[2]]
                _eds = []
                for _c in range(4):
                    _e = QLineEdit(str(_vals[_c])); _e.setFixedWidth(58)
                    _e.editingFinished.connect(self._save_pen_offsets)
                    grid.addWidget(_e, _r, _c + 1); _eds.append(_e)
                self._pen_offset_edits[pt] = _eds
                if pt:
                    _del = QPushButton("✕"); _del.setFixedWidth(24); _del.setToolTip("Remove " + pt)
                    _del.clicked.connect(lambda _checked=False, _n=pt: self._delete_pen_type(_n))
                    grid.addWidget(_del, _r, 5)
            grid.setColumnStretch(0, 1)
            v.addLayout(grid); v.addStretch()
            self._pen_dyn = dyn
            self._pen_outer.addWidget(dyn)

        def _build_pen_offsets_panel(self):
            w = QWidget()
            self._pen_outer = QVBoxLayout(w)
            self._pen_outer.setContentsMargins(8, 8, 8, 8)
            self._pen_outer.setSpacing(8)
            info = QLabel("Per pen type: Ø (mm) drives the V-groove Y correction (0.577 mm per mm of Ø); "
                          "Y trim (mm) is a manual calibration offset added on top — measure it with the "
                          "Calibration sketch's vernier gauge. Z = tip length. All values apply relative "
                          "to the 'Zeroed with' pen. Add your own brands below.")
            info.setWordWrap(True); info.setStyleSheet("color:#667085;font-size:11px;")
            self._pen_outer.addWidget(info)
            arow = QHBoxLayout()
            self._new_pen_edit = QLineEdit(); self._new_pen_edit.setPlaceholderText("New pen type (e.g. posca)")
            self._new_pen_edit.returnPressed.connect(self._add_pen_type)
            arow.addWidget(self._new_pen_edit, 1)
            _addbtn = QPushButton("➕ Add"); _addbtn.clicked.connect(self._add_pen_type)
            arow.addWidget(_addbtn)
            self._pen_outer.addLayout(arow)
            self._pen_dyn = None
            self._rebuild_pen_dyn()
            return w

        def _build_tool_panel(self):
            splitter = QSplitter(Qt.Orientation.Vertical)
            splitter.setChildrenCollapsible(False)
            splitter.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)

            # --- top: tool list ---
            list_widget = QWidget()
            ll = QVBoxLayout(list_widget)
            ll.setContentsMargins(0, 0, 0, 0)
            ll.setSpacing(2)
            hdr = QLabel("Tools:")
            hdr.setFont(QFont("Arial", 10))
            hdr.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            ll.addWidget(hdr)
            self.tools_list = QListWidget()
            self.tools_list.setFont(QFont("Courier", 9))
            self.tools_list.setMinimumHeight(40)
            self.tools_list.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Ignored)
            self.tools_list.currentRowChanged.connect(self.on_tool_select)
            ll.addWidget(self.tools_list)
            splitter.addWidget(list_widget)

            # --- bottom: edit form + action buttons + pen shortcuts ---
            controls_widget = QWidget()
            cl = QVBoxLayout(controls_widget)
            cl.setContentsMargins(0, 0, 0, 0)
            cl.setSpacing(6)

            order_grp = QGroupBox("Draw Order (multi-color plots)")
            order_v = QVBoxLayout(order_grp)
            order_v.setSpacing(2)
            self.draw_order_ltr_rb = QRadioButton("Left to right (by holder X position)")
            self.draw_order_ltr_rb.setToolTip("Pick up pens in order of increasing physical X \u2014 leftmost holder first.")
            self.draw_order_ldk_rb = QRadioButton("Lightest to darkest")
            self.draw_order_ldk_rb.setToolTip("Pick up pens in order of ink luminance, lightest first, so darker passes go down last.")
            order_v.addWidget(self.draw_order_ltr_rb)
            order_v.addWidget(self.draw_order_ldk_rb)
            self.draw_order_group = QButtonGroup(order_grp)
            self.draw_order_group.addButton(self.draw_order_ltr_rb)
            self.draw_order_group.addButton(self.draw_order_ldk_rb)
            if self.config.draw_order == "left_to_right":
                self.draw_order_ltr_rb.setChecked(True)
            else:
                self.draw_order_ldk_rb.setChecked(True)
            def _on_draw_order_change(checked, mode="left_to_right"):
                if not checked:
                    return
                self.config.draw_order = mode
                save_config(self.config)
                self._push_draw_order()
            self.draw_order_ltr_rb.toggled.connect(lambda c: _on_draw_order_change(c, "left_to_right"))
            self.draw_order_ldk_rb.toggled.connect(lambda c: _on_draw_order_change(c, "lightest_to_darkest"))
            cl.addWidget(order_grp)

            edit_grp = QGroupBox("Edit Tool")
            eg = QGridLayout(edit_grp)
            eg.setSpacing(4)
            eg.addWidget(QLabel("Holder:"), 0, 0)
            self.tool_name_edit = QLineEdit()
            eg.addWidget(self.tool_name_edit, 0, 1, 1, 3)
            self.tool_color_edit = QLineEdit()
            self.tool_color_edit.hide()
            for row, (lx, ax, ly, ay) in enumerate([
                ("X:", "tool_x_edit", "Y:", "tool_y_edit"),
                ("Z:", "tool_z_edit", "Safe Z:", "tool_safe_z_edit"),
            ], start=1):
                eg.addWidget(QLabel(lx), row, 0)
                ex = QLineEdit("0.0")
                setattr(self, ax, ex)
                eg.addWidget(ex, row, 1)
                eg.addWidget(QLabel(ly), row, 2)
                ey = QLineEdit("0.0" if ay != "tool_safe_z_edit" else "50")
                setattr(self, ay, ey)
                eg.addWidget(ey, row, 3)
            eg.addWidget(QLabel("Pen type:"), 3, 0)
            self.tool_pen_type_combo = QComboBox()
            for _pt in self._pen_types(): self.tool_pen_type_combo.addItem(_pt.capitalize(), _pt)
            eg.addWidget(self.tool_pen_type_combo, 3, 1, 1, 3)
            eg.setColumnStretch(1, 1)
            eg.setColumnStretch(3, 1)
            cl.addWidget(edit_grp)

            btn_row = QHBoxLayout()
            btn_row.setSpacing(4)
            for text, cmd in [
                ("➕ Add", self.add_tool),
                ("💾 Save", self.save_tool),
                ("📍 From Pos", self._save_tool_from_position),
                ("🎯 Go To", self.go_to_tool),
                ("🗑️ Delete", self.delete_tool),
                ("🔄 Refresh", self.refresh_tool_list),
                ("📤 Export TOML", self.export_toml),
            ]:
                b = QPushButton(text)
                b.clicked.connect(cmd)
                btn_row.addWidget(b)
            cl.addLayout(btn_row)

            pen_grp = QGroupBox("Pen Shortcuts")
            pen_inner = QVBoxLayout(pen_grp)
            pen_inner.setSpacing(2)
            self.pen_quarter_speed_cb = QCheckBox("¼ speed")
            self.pen_quarter_speed_cb.setToolTip("Move at 25% speed — useful for verifying pen positions")
            pen_inner.addWidget(self.pen_quarter_speed_cb)
            self.pen_buttons_widget = QWidget()
            self.pen_buttons_layout = QVBoxLayout(self.pen_buttons_widget)
            self.pen_buttons_layout.setContentsMargins(0, 0, 0, 0)
            self.pen_buttons_layout.setSpacing(2)
            pen_inner.addWidget(self.pen_buttons_widget)
            cl.addWidget(pen_grp)
            cl.addStretch()   # collect extra space at bottom, don't stretch widgets

            # wrap controls in a scroll area so dragging the splitter adds
            # whitespace at the bottom rather than stretching fields/buttons
            controls_scroll = QScrollArea()
            controls_scroll.setWidgetResizable(True)
            controls_scroll.setMinimumWidth(0)
            controls_scroll.setSizeAdjustPolicy(QAbstractScrollArea.SizeAdjustPolicy.AdjustIgnored)
            controls_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
            controls_scroll.setFrameShape(QScrollArea.Shape.NoFrame)
            controls_widget.setMinimumWidth(0)
            controls_scroll.setWidget(controls_widget)

            splitter.addWidget(controls_scroll)
            splitter.setStretchFactor(0, 1)
            splitter.setStretchFactor(1, 0)
            splitter.setSizes([300, 400])
            return splitter

        def _build_testpen_panel(self):
            container = QWidget()
            vl = QVBoxLayout(container)
            vl.setContentsMargins(8, 8, 8, 8)
            vl.setSpacing(8)

            fields_widget = QWidget()
            layout = QGridLayout(fields_widget)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setColumnStretch(1, 1)
            fields = [
                ("Number of pens to cycle:", "testpen_count_edit",    "3"),
                ("Number of cycles:",        "testpen_cycles_edit",   "5"),
                ("Rapid speed (mm/min):",    "testpen_rapid_edit",    "800"),
                ("Approach speed (mm/min):", "testpen_approach_edit", "50"),
                ("Overshoot (mm):",          "testpen_overshoot_edit","0.03"),
                ("Unplug offset (mm):",      "testpen_unplug_edit",   "20.0"),
                ("Lift offset (mm):",        "testpen_lift_edit",     "50.0"),
            ]
            for row, (label, attr, default) in enumerate(fields):
                layout.addWidget(QLabel(label), row, 0)
                edit = QLineEdit(default)
                setattr(self, attr, edit)
                layout.addWidget(edit, row, 1)
                edit.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            gen = QPushButton("Generate Test G-code")
            gen.clicked.connect(self.generate_testpen_gcode)
            layout.addWidget(gen, len(fields), 0, 1, 2)

            vl.addWidget(fields_widget)
            vl.addStretch()
            return container

        def _build_vpype_panel(self):
            w = QWidget()
            layout = QVBoxLayout(w)
            layout.setContentsMargins(8, 8, 8, 8)
            layout.setSpacing(8)

            svg_row = QHBoxLayout()
            svg_row.addWidget(QLabel("SVG:"))
            self.vpype_svg_edit = QLineEdit()
            svg_row.addWidget(self.vpype_svg_edit, 1)
            b = QPushButton("Browse")
            b.clicked.connect(self.browse_vpype_svg)
            svg_row.addWidget(b)
            layout.addLayout(svg_row)

            self.svg_layer_grp = QGroupBox("Detected Layers")
            sll = QVBoxLayout(self.svg_layer_grp)
            self.svg_layer_hint = QLabel("Load an SVG to see layers & pen order")
            self.svg_layer_hint.setStyleSheet("color: gray; font-style: italic;")
            self.svg_layer_hint.setFont(QFont("Arial", 8))
            sll.addWidget(self.svg_layer_hint)
            self.svg_layer_rows_widget = QWidget()
            self.svg_layer_rows_layout = QVBoxLayout(self.svg_layer_rows_widget)
            self.svg_layer_rows_layout.setContentsMargins(0, 0, 0, 0)
            self.svg_layer_rows_layout.setSpacing(2)
            sll.addWidget(self.svg_layer_rows_widget)
            self.svg_pen_order_label = QLabel("")
            self.svg_pen_order_label.setFont(QFont("Arial", 8))
            self.svg_pen_order_label.setStyleSheet("color: #555; font-weight: bold;")
            sll.addWidget(self.svg_pen_order_label)
            layout.addWidget(self.svg_layer_grp)

            out_row = QHBoxLayout()
            out_row.addWidget(QLabel("Output:"))
            self.vpype_output_edit = QLineEdit()
            out_row.addWidget(self.vpype_output_edit, 1)
            bb = QPushButton("Browse")
            bb.clicked.connect(self.browse_vpype_output)
            out_row.addWidget(bb)
            layout.addLayout(out_row)

            opt_row = QHBoxLayout()
            self.vpype_splitall_cb    = QCheckBox("splitall"); self.vpype_splitall_cb.setToolTip("Break paths into individual segments before linemerge — use for Rhino/GH exports with disconnected segments.")
            self.vpype_linemerge_cb   = QCheckBox("linemerge");   self.vpype_linemerge_cb.setChecked(True)
            self.vpype_linemerge_tol_edit = QLineEdit("0.5"); self.vpype_linemerge_tol_edit.setFixedWidth(46)
            self.vpype_linemerge_tol_edit.setToolTip("linemerge tolerance (mm) — raise to join near-miss endpoints in Rhino/GH exports")
            self.vpype_linesort_cb    = QCheckBox("linesort");    self.vpype_linesort_cb.setChecked(True)
            self.vpype_twoopt_cb      = QCheckBox("two-opt"); self.vpype_twoopt_cb.setToolTip("Extra linesort optimization; slower, good for final plots.")
            self.vpype_reloop_cb      = QCheckBox("reloop")
            self.vpype_toolchanges_cb = QCheckBox("tool changes"); self.vpype_toolchanges_cb.setChecked(True)
            for cb in [self.vpype_splitall_cb, self.vpype_linemerge_cb]:
                opt_row.addWidget(cb)
            opt_row.addWidget(self.vpype_linemerge_tol_edit)
            opt_row.addWidget(QLabel("mm"))
            for cb in [self.vpype_linesort_cb, self.vpype_twoopt_cb,
                       self.vpype_reloop_cb, self.vpype_toolchanges_cb]:
                opt_row.addWidget(cb)
            layout.addLayout(opt_row)

            simp_row = QHBoxLayout()
            self.vpype_linesimplify_cb = QCheckBox("linesimplify"); self.vpype_linesimplify_cb.setChecked(True)
            simp_row.addWidget(self.vpype_linesimplify_cb)
            simp_row.addWidget(QLabel("tol (mm):"))
            self.vpype_simplify_tol_edit = QLineEdit("0.1")
            self.vpype_simplify_tol_edit.setFixedWidth(60)
            self.vpype_simplify_tol_edit.setToolTip("linesimplify tolerance — lower = more detail, 0.1 recommended for curves")
            simp_row.addWidget(self.vpype_simplify_tol_edit)
            simp_row.addStretch()
            gen_btn = QPushButton("Generate via vpype")
            gen_btn.clicked.connect(self.run_vpype)
            simp_row.addWidget(gen_btn)
            layout.addLayout(simp_row)
            self._est_lbl = QLabel("")
            self._est_lbl.setStyleSheet("color: #888; font-size: 11px; padding: 2px 0;")
            layout.addWidget(self._est_lbl)
            layout.addStretch()
            return w

        def _build_gcode_panel(self):
            w = QWidget()
            layout = QVBoxLayout(w)
            layout.setContentsMargins(8, 8, 8, 8)
            layout.setSpacing(8)

            file_row = QHBoxLayout()
            file_row.addWidget(QLabel("File:"))
            self.gcode_entry = QLineEdit()
            file_row.addWidget(self.gcode_entry, 1)
            bb = QPushButton("Browse")
            bb.clicked.connect(self.browse_gcode_file)
            file_row.addWidget(bb)
            layout.addLayout(file_row)

            self.gcode_home_first_cb = QCheckBox("Home before run")
            layout.addWidget(self.gcode_home_first_cb)

            self.gcode_status_label = QLabel("No file loaded")
            layout.addWidget(self.gcode_status_label)

            self.gcode_progress = QProgressBar()
            self.gcode_progress.setRange(0, 100)
            layout.addWidget(self.gcode_progress)

            # layer color toggles — populated after file load, hidden for single-color files
            self.layer_toggles_widget = QWidget()
            self.layer_toggles_layout = QHBoxLayout(self.layer_toggles_widget)
            self.layer_toggles_layout.setContentsMargins(0, 0, 0, 0)
            self.layer_toggles_layout.setSpacing(6)
            self.layer_toggles_widget.hide()
            layout.addWidget(self.layer_toggles_widget)

            pv_split = QSplitter(Qt.Orientation.Vertical)
            pv_split.setChildrenCollapsible(False)
            pv_split.setHandleWidth(6)

            # --- top: text viewer ---
            viewer_tabs = QSplitter(Qt.Orientation.Horizontal)
            viewer_tabs.setChildrenCollapsible(False)

            viewer_grp = QGroupBox("G-code Text Viewer")
            vl = QVBoxLayout(viewer_grp)
            self.gcode_list = QListWidget()
            self.gcode_list.setFont(QFont("Courier", 8))
            self.gcode_list.setMinimumHeight(40)
            self.gcode_list.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Ignored)
            vl.addWidget(self.gcode_list)
            vbr = QHBoxLayout()
            for text, cmd in [
                ("Send Selected Line", self.send_selected_gcode_line),
                ("Send Next Line",     self.send_next_gcode_line),
                ("Reset Line Index",   self.reset_gcode_line_index),
            ]:
                b = QPushButton(text)
                b.clicked.connect(cmd)
                vbr.addWidget(b)
            vl.addLayout(vbr)
            viewer_tabs.addWidget(viewer_grp)

            grbl_grp = QGroupBox("GRBL Log / Terminal")
            gl = QVBoxLayout(grbl_grp)
            self.grbl_log_list = QListWidget()
            self.grbl_log_list.setFont(QFont("Courier", 8))
            self.grbl_log_list.setMinimumHeight(40)
            self.grbl_log_list.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Ignored)
            gl.addWidget(self.grbl_log_list)
            clr_btn = QPushButton("Clear")
            clr_btn.clicked.connect(self.grbl_log_list.clear)
            gl.addWidget(clr_btn)
            cmd_row = QHBoxLayout()
            self.grbl_cmd_edit = QLineEdit()
            self.grbl_cmd_edit.setPlaceholderText("GRBL command  e.g. $$  $120=500  $H")
            self.grbl_cmd_edit.setFont(QFont("Courier", 9))
            self.grbl_cmd_edit.returnPressed.connect(self._send_grbl_terminal_cmd)
            grbl_send_btn = QPushButton("Send")
            grbl_send_btn.setFixedWidth(52)
            grbl_send_btn.clicked.connect(self._send_grbl_terminal_cmd)
            cmd_row.addWidget(self.grbl_cmd_edit, 1)
            cmd_row.addWidget(grbl_send_btn)
            gl.addLayout(cmd_row)
            viewer_tabs.addWidget(grbl_grp)
            viewer_tabs.setSizes([9999, 9999])

            pv_split.addWidget(viewer_tabs)

            # --- bottom: preview canvas ---
            preview_container = QWidget()
            pcl = QVBoxLayout(preview_container)
            pcl.setContentsMargins(0, 0, 0, 0)
            pcl.setSpacing(2)
            preview_lbl = QLabel("Gcode Visualizer")
            preview_lbl.setStyleSheet("font-weight: bold; color: #555;")
            preview_lbl.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            pcl.addWidget(preview_lbl)
            self.preview_widget = GcodePreviewWidget()
            self.preview_widget.setMinimumHeight(150)
            self.preview_widget.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Ignored)
            pcl.addWidget(self.preview_widget)
            pv_split.addWidget(preview_container)

            pv_split.setStretchFactor(0, 0)
            pv_split.setStretchFactor(1, 1)
            pv_split.setSizes([80, 300])
            layout.addWidget(pv_split, 1)

            # --- feed overrides (placed above run buttons, away from accidental clicks) ---
            def _override_row(label, attr):
                row = QHBoxLayout()
                lbl = QLabel(label)
                lbl.setFixedWidth(90)
                row.addWidget(lbl)
                slider = QSlider(Qt.Orientation.Horizontal)
                slider.setRange(10, 300)
                slider.setValue(100)
                slider.setTickInterval(25)
                slider.setTickPosition(QSlider.TickPosition.TicksBelow)
                row.addWidget(slider, 1)
                val_lbl = QLabel("100%")
                val_lbl.setFixedWidth(42)
                val_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
                row.addWidget(val_lbl)
                reset = QPushButton("↺")
                reset.setFixedWidth(24)
                reset.setToolTip("Reset to 100%")
                reset.clicked.connect(lambda: slider.setValue(100))
                row.addWidget(reset)
                def _on_change(v, lbl=val_lbl):
                    lbl.setText(f"{v}%")
                    lbl.setStyleSheet(
                        "color: red; font-weight: bold;" if v != 100 else "")
                slider.valueChanged.connect(_on_change)
                setattr(self, attr, slider)
                return row

            layout.addLayout(_override_row("Draw:", "feed_override_slider"))
            layout.addLayout(_override_row("TC:", "tc_override_slider"))

            # --- run controls pinned to bottom ---
            btn_row = QHBoxLayout()
            self.gcode_run_btn = QPushButton("▶ Run")
            self.gcode_run_btn.clicked.connect(self.run_gcode)
            self.gcode_pause_btn = QPushButton("⏸ Pause")
            self.gcode_pause_btn.clicked.connect(self.toggle_pause_gcode)
            self.gcode_pause_btn.setEnabled(False)
            self.gcode_stop_btn = QPushButton("⏹ Stop")
            self.gcode_stop_btn.clicked.connect(self.stop_gcode)
            self.gcode_stop_btn.setEnabled(False)
            for b in [self.gcode_run_btn, self.gcode_pause_btn, self.gcode_stop_btn]:
                btn_row.addWidget(b)
            btn_row.addStretch()
            layout.addLayout(btn_row)
            return w

        # ------------------------------------------------------------------
        # Signal slots
        # ------------------------------------------------------------------

        def _on_update_status(self, state):
            if hasattr(self, "_queue_on_signal") and isinstance(state, str) and state.startswith("__q_"):
                self._queue_on_signal(state); return

            if hasattr(self, "_queue_on_signal") and isinstance(state, str) and state.startswith("__q_"):
                self._queue_on_signal(state); return

            ok = {"Idle", "Run", "Jog", "Hold", "Home", "Check", "Connected"}
            sym = "🟢" if state in ok else "🔴"
            self.status_label.setText(f"{sym} {state.upper()}")
            if self.config.port:
                self.port_label.setText(f"Port: {self.config.port}")

        def _on_update_dro(self, mpos, wpos):
            self.machine_label.setText(
                f"X: {mpos['x']:.2f}  Y: {mpos['y']:.2f}  Z: {mpos['z']:.2f}")
            self.work_label.setText(
                f"X: {wpos['x']:.2f}  Y: {wpos['y']:.2f}  Z: {wpos['z']:.2f}")

        def _on_wcs_offset_ready(self, x, y, z):
            self.wcs_offset_label.setText(f"Offset  X:{x:.3f}  Y:{y:.3f}  Z:{z:.3f}")

        # ------------------------------------------------------------------
        # Daemon event callbacks (called from DaemonClient recv thread)
        # ------------------------------------------------------------------

        def _on_daemon_status(self, data: dict):
            """Daemon pushed a status update — refresh UI from the main thread."""
            self.machine_pos = {"x": data.get("mx", 0.0), "y": data.get("my", 0.0), "z": data.get("mz", 0.0)}
            self.work_pos    = {"x": data.get("wx", 0.0), "y": data.get("wy", 0.0), "z": data.get("wz", 0.0)}
            wco = data.get("wco", [0.0, 0.0, 0.0])
            self.work_offset = {"x": wco[0], "y": wco[1], "z": wco[2]}
            state = data.get("state", "Connected")
            # Keep self.port in sync — this is how the UI learns the daemon (re)connected
            self.port = True if data.get("connected") else None
            self.signals.update_status.emit(state)
            self.signals.update_dro.emit(self.machine_pos, self.work_pos)
            self.signals.daemon_indicator.emit()

        def _on_daemon_progress(self, sent: int, total: int):
            self.gcode_sent_lines = sent
            self.signals.gcode_highlight.emit(max(0, sent - 1))
            if total > 0:
                pct = (sent / total) * 100.0
                self.signals.update_progress.emit(pct)
                try:
                    import json as _json
                    payload = {"pct": round(pct, 1)}
                    info = self._current_plot_layer(sent)
                    if info:
                        payload["color"] = info[0]
                        payload["label"] = info[1]
                        payload["layer"] = info[2]
                        payload["layers"] = info[3]
                    self.signals.plot_progress.emit(_json.dumps(payload))
                except Exception:
                    pass

        def _on_daemon_gcode_done(self):
            tmp = getattr(self, "_gcode_tmp_path", None)
            if tmp:
                try:
                    os.unlink(tmp)
                except Exception:
                    pass
                self._gcode_tmp_path = None
            self.gcode_running = False
            self.gcode_paused = False
            self.gcode_stop = False
            self._queue_post_machine_status(False)
            self.signals.gcode_done.emit()
            self.signals.update_banner.emit("● Plot complete — machine idle")
            QTimer.singleShot(5000, lambda: self.signals.update_banner.emit(""))
            _pending = getattr(self, "_queue_pending_done", None)
            if _pending:
                self._queue_pending_done = None
                _jid, _burl, _key = _pending
                def _inc_count():
                    try:
                        self._queue_http(f"/jobs/{_jid}/status",
                                         "PATCH", {"increment_plot_count": True},
                                         base_url=_burl, key=_key)
                    except Exception:
                        pass
                import threading as _t
                _t.Thread(target=_inc_count, daemon=True).start()

        def _on_daemon_gcode_error(self, line_num: int, line: str, msg: str):
            self.signals.show_error.emit(
                "GRBL Error",
                f"GRBL stopped at line {line_num}:\n{msg}\n\nSent:\n{line}")

        def _on_daemon_grbl_line(self, sent: str, response: str):
            self.signals.grbl_log.emit(f"→ {sent}")
            if response:
                self.signals.grbl_log.emit(f"← {response}")

        def _on_daemon_gone(self):
            """Daemon connection dropped unexpectedly."""
            self.port = None
            self.signals.update_status.emit("Disconnected")
            self.signals.daemon_indicator.emit()

        # ------------------------------------------------------------------
        # Serial / GRBL
        # ------------------------------------------------------------------

        def _poll_status(self):
            # Daemon pushes status automatically; this timer is kept for compat
            # but is a no-op unless daemon is unavailable.
            pass

        def _update_position_internal(self):
            """Read current position from daemon's last known state and refresh UI."""
            self._poll_running = True
            try:
                if not self._daemon.daemon_alive:
                    return
                st = self._daemon.last_state
                if not st:
                    return
                self.machine_pos = {"x": st.get("mx", 0.0), "y": st.get("my", 0.0), "z": st.get("mz", 0.0)}
                self.work_pos    = {"x": st.get("wx", 0.0), "y": st.get("wy", 0.0), "z": st.get("wz", 0.0)}
                wco = st.get("wco", [0.0, 0.0, 0.0])
                self.work_offset = {"x": wco[0], "y": wco[1], "z": wco[2]}
                self.signals.update_status.emit(st.get("state", "Connected"))
                self.signals.update_dro.emit(self.machine_pos, self.work_pos)
            except Exception:
                pass
            finally:
                self._poll_running = False

        def _send_grbl_terminal_cmd(self):
            line = self.grbl_cmd_edit.text().strip()
            if not line:
                return
            if not self._daemon.daemon_alive:
                self.signals.grbl_log.emit("! not connected")
                return
            self.grbl_cmd_edit.clear()
            self.signals.grbl_log.emit(f">>> {line}")

            def _run():
                try:
                    result = self._daemon.send(line)
                    resp = result.get("lines", [])
                    if not resp and not result.get("ok"):
                        resp = [result.get("error", "error")]
                    for l in resp:
                        self.signals.grbl_log.emit(f"    {l}")
                except Exception as e:
                    self.signals.grbl_log.emit(f"! {e}")

            threading.Thread(target=_run, daemon=True).start()

        def _query_grbl_max_rates(self):
            if not self.port:
                return
            try:
                result = self._daemon.send("$$")
                lines = result.get("lines", [])
                rates = {}
                for line in lines:
                    m = re.match(r"\$(\d+)=([\d.]+)", line)
                    if m:
                        rates[int(m.group(1))] = float(m.group(2))
                if 110 in rates and 111 in rates:
                    self.rapid_jog_speed = int(min(rates[110], rates[111]))
                self._grbl_max_rates = {k: int(v) for k, v in rates.items() if k in (110, 111, 112)}
                x   = rates.get(110, '?')
                y   = rates.get(111, '?')
                z   = rates.get(112, '?')
                ax  = rates.get(120, '?')
                ay  = rates.get(121, '?')
                az  = rates.get(122, '?')
                def _fmt(v): return int(v) if isinstance(v, float) else v
                status_txt = (
                    f"GRBL  rate X:{_fmt(x)} Y:{_fmt(y)} Z:{_fmt(z)} mm/min  "
                    f"accel X:{_fmt(ax)} Y:{_fmt(ay)} Z:{_fmt(az)} mm/s²"
                )
                QTimer.singleShot(0, lambda: self.gcode_status_label.setText(status_txt))
                self.signals.grbl_log.emit(
                    f"$110={_fmt(x)}  $111={_fmt(y)}  $112={_fmt(z)}  (max rate mm/min)")
                self.signals.grbl_log.emit(
                    f"$120={_fmt(ax)}  $121={_fmt(ay)}  $122={_fmt(az)}  (accel mm/s²)")
            except Exception:
                pass

        def _refresh_wcs_offsets(self):
            if not self.port:
                return
            try:
                result = self._daemon.send("$#")
                lines = result.get("lines", [])
                wcs = self.wcs_combo.currentText()
                for line in lines:
                    if line.startswith(f"[{wcs}:"):
                        inner = line[len(f"[{wcs}:"):-1]
                        parts = inner.split(",")
                        if len(parts) == 3:
                            x, y, z = float(parts[0]), float(parts[1]), float(parts[2])
                            self.work_offset = {"x": x, "y": y, "z": z}
                            self.signals.wcs_offset_ready.emit(x, y, z)
                            return
            except Exception:
                pass

        def wcs_to_p(self, wcs: str) -> int:
            return {"G54": 1, "G55": 2, "G56": 3, "G57": 4, "G58": 5, "G59": 6}.get(wcs, 1)

        # ------------------------------------------------------------------
        # Connection
        # ------------------------------------------------------------------

        def refresh_ports(self):
            ports = list_serial_ports()
            names = [dev for dev, _ in ports]
            self.port_combo.blockSignals(True)
            self.port_combo.clear()
            self.port_combo.addItems(names)
            if self.config.port in names:
                self.port_combo.setCurrentText(self.config.port)
            elif names:
                self.port_combo.setCurrentIndex(0)
            self.port_combo.blockSignals(False)

        # ── Daemon lifecycle ───────────────────────────────────────────────

        def _ensure_daemon(self) -> bool:
            """Connect to running daemon, or spawn one and connect."""
            if self._daemon.connect_to_daemon(timeout=0.5):
                return True
            daemon_script = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         "pl0tb0t_daemon.py")
            if not os.path.exists(daemon_script):
                return False
            self._daemon_proc = subprocess.Popen(
                [sys.executable, daemon_script],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            for _ in range(25):
                time.sleep(0.2)
                if self._daemon.connect_to_daemon(timeout=0.3):
                    return True
            return False

        def _try_reconnect_daemon(self):
            """Called at startup — silently attach to a running daemon.
            self.port is set automatically when the first status event arrives."""
            if self._daemon.connect_to_daemon(timeout=0.5):
                self._update_daemon_indicator()

        def _update_daemon_indicator(self):
            if not hasattr(self, "_daemon_status_label") or self._daemon_status_label is None:
                return
            alive = self._daemon.daemon_alive
            mc    = self._daemon.machine_connected
            st    = self._daemon.last_state
            homed = st.get("homed", False)
            _debug_log(f"Daemon state: alive={alive}, machine_connected={mc}, homed={homed}, port={st.get('port','?')}")
            if alive and mc:
                txt = f"⬤ Daemon · Connected{' · Homed ✓' if homed else ''}"
                col = "#2a7"
            elif alive:
                txt = "⬤ Daemon: running (no serial)"
                col = "#fa0"
            else:
                txt = "⬤ Daemon: not running"
                col = "#888"
            self._daemon_status_label.setText(txt)
            self._daemon_status_label.setStyleSheet(f"color: {col}; font-size: 11px;")
            self._daemon_stop_btn.setVisible(alive)
            self._push_machine_connected()
            QTimer.singleShot(0, self._repack_all_columns)

        def _push_machine_connected(self):
            # Mirror the machine-connected state into the Make webview so the
            # Plot button can refuse (with a clear message) BEFORE running the
            # whole pen-confirm + gcode-generation flow only to dead-end.
            try:
                val = 'true' if self.port else 'false'
                self._make_webview.page().runJavaScript(
                    f"window._pl0tMachineConnected = {val};")
            except Exception:
                pass

        def _stop_daemon(self):
            if QMessageBox.question(self, "Stop Daemon",
                    "Stop the daemon? The serial port will close.") == QMessageBox.StandardButton.Yes:
                self.port = None
                def _do():
                    try:
                        self._daemon.shutdown_daemon()   # 3s timeout
                    except Exception:
                        pass
                    # Close our socket — triggers _recv_loop → on_daemon_gone → UI update
                    self._daemon.disconnect_from_daemon()
                    proc = self._daemon_proc
                    if proc and proc.poll() is None:
                        try: proc.terminate()
                        except Exception: pass
                    self._daemon_proc = None
                threading.Thread(target=_do, daemon=True).start()

        # ── Connect / disconnect ───────────────────────────────────────────

        def connect_port(self):
            port_name = self.port_combo.currentText()
            _debug_log(f"Button: Connect clicked, port={port_name}")
            if not port_name:
                QMessageBox.critical(self, "Error", "Select a port first")
                _debug_log("Connect: no port selected")
                return
            def _do():
                try:
                    _debug_log("Connect: ensuring daemon...")
                    if not self._ensure_daemon():
                        _debug_log("Connect: failed to ensure daemon")
                        self.signals.show_error.emit("Error", "Could not start GRBL daemon")
                        return
                    _debug_log("Connect: daemon ready, checking if port already open...")
                    st = self._daemon.last_state
                    already_open = st.get("connected") and st.get("port") == port_name
                    if not already_open:
                        _debug_log(f"Connect: connecting to {port_name}...")
                        result = self._daemon.connect_port(port_name, self.config.baud)
                        if not result.get("ok"):
                            _debug_log(f"Connect: failed - {result.get('error','?')}")
                            self.signals.show_error.emit("Error", f"Connect failed: {result.get('error','?')}")
                            return
                        _debug_log(f"Connect: success")
                    else:
                        _debug_log(f"Connect: port {port_name} already open")
                    self.port = True
                    self.config.port = port_name
                    save_config(self.config)
                    self._daemon.send("G90", wait=True)   # absolute mode
                    self._query_grbl_max_rates()
                    self._refresh_wcs_offsets()
                    self.apply_wcs_selection(silent=True)
                    msg = f"Reconnected to {port_name}" if already_open else f"Connected to {port_name}"
                    _debug_log(f"Connect: {msg}")
                    self.signals.show_info.emit("Success", msg)
                except Exception as e:
                    _debug_log(f"Connect: exception - {e}")
                    self.signals.show_error.emit("Error", f"Failed to connect: {e}")
            threading.Thread(target=_do, daemon=True).start()

        def disconnect_port(self):
            _debug_log(f"Button: Disconnect clicked, port={self.port}")
            if not self.port:
                QMessageBox.information(self, "Info", "Not connected")
                _debug_log("Disconnect: not connected")
                return
            self.port = None
            self.status_label.setText("🔴 DISCONNECTED")
            self.port_label.setText("Port: None")
            self._update_daemon_indicator()
            _debug_log("Disconnect: port cleared, calling daemon disconnect")
            def _do():
                self._daemon.disconnect_port()
                _debug_log("Disconnect: daemon.disconnect_port() completed")
                self.signals.show_info.emit("Disconnected", "Serial port closed (daemon still running)")
            threading.Thread(target=_do, daemon=True).start()

        def query_grbl_settings(self):
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            def _do():
                try:
                    result = self._daemon.send("$$")
                    text = result.get("response", "(no response)")
                    self.signals.show_info.emit("GRBL $$ Settings", text)
                except Exception as e:
                    self.signals.show_error.emit("Error", str(e))
            threading.Thread(target=_do, daemon=True).start()

        def unlock_machine(self):
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            def _do():
                result = self._daemon.send("$X")
                if result.get("ok"):
                    self.signals.show_info.emit("Unlocked", "Machine unlocked")
                else:
                    self.signals.show_error.emit("Error", f"Unlock failed: {result.get('error','?')}")
            threading.Thread(target=_do, daemon=True).start()

        def home_machine(self):
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            if QMessageBox.question(self, "Confirm", "Home the machine?") == QMessageBox.StandardButton.Yes:
                def _do():
                    result = self._daemon.home()
                    if result.get("ok"):
                        self.signals.show_info.emit("Success", "Homing complete")
                    else:
                        self.signals.show_error.emit("Error", f"Home failed: {result.get('error','?')}")
                threading.Thread(target=_do, daemon=True).start()

        # ------------------------------------------------------------------
        # WCS
        # ------------------------------------------------------------------

        def _on_wcs_combo_changed(self, text):
            self.wcs_active_label.setText(text)
            self.apply_wcs_selection(silent=False)
            threading.Thread(target=self._refresh_wcs_offsets, daemon=True).start()

        def apply_wcs_selection(self, silent=False):
            if not self.port:
                if not silent:
                    QMessageBox.warning(self, "Warning", "Not connected; WCS will apply after connect")
                return
            try:
                wcs = self.wcs_combo.currentText()
                self._daemon.send(wcs)
                QTimer.singleShot(200, self._update_position_internal)
                if not silent:
                    QMessageBox.information(self, "WCS", f"Active work coordinate system: {wcs}")
            except Exception as e:
                if not silent:
                    QMessageBox.critical(self, "Error", f"Failed to set WCS: {e}")

        def zero_wcs_axis(self, axis: str):
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            try:
                wcs = self.wcs_combo.currentText()
                self._daemon.send(f"G10 L20 P{self.wcs_to_p(wcs)} {axis}0")
                QTimer.singleShot(200, self._update_position_internal)
                threading.Thread(target=self._refresh_wcs_offsets, daemon=True).start()
                QMessageBox.information(self, "Work Zero", f"{wcs} {axis} set to 0")
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Failed to zero {axis}: {e}")

        def zero_wcs_all(self):
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            try:
                wcs = self.wcs_combo.currentText()
                self._daemon.send(f"G10 L20 P{self.wcs_to_p(wcs)} X0 Y0 Z0")
                QTimer.singleShot(200, self._update_position_internal)
                threading.Thread(target=self._refresh_wcs_offsets, daemon=True).start()
                QMessageBox.information(self, "Work Zero", f"{wcs} X/Y/Z set to 0")
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Failed to zero all: {e}")

        def touchoff_z(self):
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            try:
                val = float(self.touchoff_z_edit.text())
                wcs = self.wcs_combo.currentText()
                self._daemon.send(f"G10 L20 P{self.wcs_to_p(wcs)} Z{val:.3f}")
                QTimer.singleShot(200, self._update_position_internal)
                QTimer.singleShot(350, lambda: threading.Thread(
                    target=self._refresh_wcs_offsets, daemon=True).start())
                QMessageBox.information(self, "Touch Off",
                    f"{wcs} Z set to {val:.3f} mm at current position")
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Touch off failed: {e}")

        # ------------------------------------------------------------------
        # Jogging
        # ------------------------------------------------------------------

        def jog_axis(self, axis, distance):
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            try:
                speed = self._jog_speed()
                self._daemon.send(f"$J=G91 G21 {axis}{distance:.3f} F{speed:.1f}", wait=False)
                self._update_position_internal()
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Jog failed: {e}")

        def jog_zero(self):
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            try:
                wcs = self.wcs_combo.currentText()
                self._daemon.send(f"G10 L20 P{self.wcs_to_p(wcs)} X0 Y0 Z0")
                QTimer.singleShot(200, self._update_position_internal)
                QMessageBox.information(self, "Info", f"{wcs} zero set to current position")
            except Exception as e:
                self.work_offset = self.machine_pos.copy()
                QMessageBox.warning(self, "Warning", f"Set local work offset only. Reason: {e}")

        def eventFilter(self, obj, event):
            t = event.type()
            if t in (QEvent.Type.KeyPress, QEvent.Type.KeyRelease):
                focused = QApplication.focusWidget()
                if isinstance(focused, QLineEdit):
                    return False
                key = event.key()
                if key in self._JOG_KEY_MAP or key == Qt.Key.Key_Shift:
                    if t == QEvent.Type.KeyPress:
                        self.keyPressEvent(event)
                    else:
                        self.keyReleaseEvent(event)
                    return True
            return False

        _JOG_KEY_MAP = {
            Qt.Key.Key_Up:       ("Y",  1),
            Qt.Key.Key_Down:     ("Y", -1),
            Qt.Key.Key_Left:     ("X", -1),
            Qt.Key.Key_Right:    ("X",  1),
            Qt.Key.Key_U:        ("Z",  1),
            Qt.Key.Key_D:        ("Z", -1),
            Qt.Key.Key_PageUp:   ("Z",  1),
            Qt.Key.Key_PageDown: ("Z", -1),
        }

        def _jog_cancel(self):
            """Real-time jog cancel — invalidates pending send threads, no lock needed."""
            self._jog_seq += 1
            if self.port:
                self._daemon.realtime(0x85)

        def _start_continuous_jog(self):
            """Send a single combined jog command for all currently held axes."""
            if not self.jog_keys_held or not self.port:
                return
            self._continuous_jog_active = True
            self._jog_seq += 1
            seq = self._jog_seq
            speed = self.rapid_jog_speed if self._shift_held else self._jog_speed()
            parts = []
            for key in list(self.jog_keys_held):
                axis, sign = self._JOG_KEY_MAP[key]
                parts.append(f"{axis}{sign * 10000:.1f}")
            cmd = f"$J=G91 G21 {' '.join(parts)} F{speed:.1f}"
            def _send():
                if self._jog_seq != seq:
                    return   # superseded by a newer cancel or jog command
                self._daemon.send(cmd, wait=False)
            threading.Thread(target=_send, daemon=True).start()

        def _restart_status_poll(self):
            self._update_position_internal()

        _JOG_RELEASE_DEBOUNCE_MS = 15   # absorbs X11 fake auto-repeat release+press pairs (< 5ms)

        def keyPressEvent(self, event):
            if event.isAutoRepeat():
                return
            key = event.key()

            # If a debounced release is pending for this key it was X11 auto-repeat — cancel it
            if key in self._release_timers:
                self._release_timers.pop(key).stop()
                return

            if key == Qt.Key.Key_Shift:
                self._shift_held = True
                if self.jog_keys_held and self.port:
                    self._jog_cancel()
                    self._start_continuous_jog()
                return

            if not self.port or key not in self._JOG_KEY_MAP:
                super().keyPressEvent(event)
                return
            if key in self.jog_keys_held:
                return

            if not self.jog_keys_held:
                self._status_timer.stop()

            was_jogging = bool(self.jog_keys_held)
            self.jog_keys_held.add(key)

            if was_jogging:
                self._jog_cancel()
                self._start_continuous_jog()
            else:
                self._start_continuous_jog()

        def keyReleaseEvent(self, event):
            if event.isAutoRepeat():
                return
            key = event.key()

            if key == Qt.Key.Key_Shift:
                # Shift release: just clear the flag, don't cancel or restart.
                # The running jog continues at whatever speed it was started with.
                # Speed change on Shift release introduces races; user can re-press
                # the arrow key to get normal speed.
                self._shift_held = False
                return

            if key not in self._JOG_KEY_MAP:
                super().keyReleaseEvent(event)
                return

            if key in self._release_timers:
                self._release_timers.pop(key).stop()
            t = QTimer()
            t.setSingleShot(True)
            t.timeout.connect(lambda k=key: self._do_jog_release(k))
            self._release_timers[key] = t
            t.start(self._JOG_RELEASE_DEBOUNCE_MS)

        def _do_jog_release(self, key):
            self._release_timers.pop(key, None)
            self.jog_keys_held.discard(key)
            # Only send cancel when ALL jog keys are released.
            # Never restart for remaining keys — that's what caused the
            # one-motor-keeps-running bug on simultaneous release.
            if not self.jog_keys_held:
                self._jog_cancel()
                self._continuous_jog_active = False
                QTimer.singleShot(300, self._restart_status_poll)

        # ------------------------------------------------------------------
        # Tool management
        # ------------------------------------------------------------------

        def refresh_tool_list(self):
            self.tools_list.clear()
            for idx, t in enumerate(self.tools, start=1):
                _pt = getattr(t, 'pen_type', '') or '-'
                self.tools_list.addItem(
                    f"{idx}. {t.name} [{_pt}] - X:{t.x:.1f} Y:{t.y:.1f} Z:{t.z:.1f}")

        def on_tool_select(self, idx):
            if idx < 0 or idx >= len(self.tools):
                return
            t = self.tools[idx]
            self.tool_name_edit.setText(t.name)
            self.tool_color_edit.setText(t.color)
            self.tool_x_edit.setText(str(t.x))
            self.tool_y_edit.setText(str(t.y))
            self.tool_z_edit.setText(str(t.z))
            self.tool_safe_z_edit.setText(str(t.safe_z))
            _pi = self.tool_pen_type_combo.findData(getattr(t, 'pen_type', ''))
            if _pi < 0: _pi = 0
            if _pi >= 0 and self.tool_pen_type_combo.count(): self.tool_pen_type_combo.setCurrentIndex(_pi)

        def _read_tool_form(self) -> Tool:
            return Tool(
                name=self.tool_name_edit.text().strip(),
                color=self.tool_color_edit.text().strip() or "holder",
                x=float(self.tool_x_edit.text()),
                y=float(self.tool_y_edit.text()),
                z=float(self.tool_z_edit.text()),
                safe_z=float(self.tool_safe_z_edit.text()),
                pen_type=self.tool_pen_type_combo.currentData() or '',
            )

        def _save_tool_from_position(self):
            mp = getattr(self, 'machine_pos', None) or {"x": 0.0, "y": 0.0, "z": 0.0}
            self.tool_x_edit.setText(f"{mp['x']:.3f}")
            self.tool_y_edit.setText(f"{mp['y']:.3f}")
            self.tool_z_edit.setText(f"{mp['z']:.3f}")
            idx = self.tools_list.currentRow()
            if 0 <= idx < len(self.tools):
                t = self.tools[idx]
                t.x = float(mp['x']); t.y = float(mp['y']); t.z = float(mp['z'])
                save_tools(tools=self.tools)
                self.refresh_tool_list()
                self.tools_list.setCurrentRow(idx)
                QMessageBox.information(self, "Saved", f"Machine position written to '{t.name}'  (X{t.x:.2f} Y{t.y:.2f} Z{t.z:.2f})")
            else:
                QMessageBox.information(self, "Position captured", "Filled X/Y/Z from the machine. Set name + pen type, then Add.")

        def add_tool(self):
            try:
                tool = self._read_tool_form()
            except Exception:
                QMessageBox.critical(self, "Error", "Invalid coordinates")
                return
            if not tool.name:
                QMessageBox.warning(self, "Warning", "Enter a tool name")
                return
            add_or_update_tool(self.tools, tool)
            save_tools(tools=self.tools)
            self.refresh_tool_list()
            self.refresh_pen_buttons()
            QMessageBox.information(self, "Success", f"Tool '{tool.name}' added")

        def save_tool(self):
            idx = self.tools_list.currentRow()
            if idx < 0:
                QMessageBox.warning(self, "Warning", "Select a tool to edit")
                return
            try:
                tool = self._read_tool_form()
            except Exception:
                QMessageBox.critical(self, "Error", "Invalid coordinates")
                return
            if not tool.name:
                QMessageBox.warning(self, "Warning", "Enter a tool name")
                return
            self.tools[idx] = tool
            save_tools(tools=self.tools)
            self.refresh_tool_list()
            self.refresh_pen_buttons()
            QMessageBox.information(self, "Success", f"Tool '{tool.name}' updated")

        def go_to_tool(self):
            idx = self.tools_list.currentRow()
            if idx < 0:
                QMessageBox.warning(self, "Warning", "Select a tool")
                return
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            t = self.tools[idx]
            def _do():
                try:
                    if t.safe_z != t.z:
                        coord_prefix = "G53 G0" if True else "G90 G0"
                        self._daemon.send(f"{coord_prefix} X{t.x:.3f} Y{t.y:.3f} Z{t.safe_z:.3f}")
                        time.sleep(0.5)
                    self._daemon.send(f"G53 G0 X{t.x:.3f} Y{t.y:.3f} Z{t.z:.3f}")
                    QTimer.singleShot(1000, self._update_position_internal)
                    self.signals.show_info.emit("Success", f"Moved to {t.name}")
                except Exception as e:
                    self.signals.show_error.emit("Error", f"Move failed: {e}")
            threading.Thread(target=_do, daemon=True).start()

        def delete_tool(self):
            idx = self.tools_list.currentRow()
            if idx < 0:
                QMessageBox.warning(self, "Warning", "Select a tool")
                return
            t = self.tools[idx]
            if QMessageBox.question(self, "Confirm", f"Delete '{t.name}'?") == QMessageBox.StandardButton.Yes:
                remove_tool(self.tools, t.name)
                save_tools(tools=self.tools)
                self.refresh_tool_list()
                self.refresh_pen_buttons()
                QMessageBox.information(self, "Success", f"Deleted '{t.name}'")

        def export_toml(self):
            try:
                from toml import dumps as toml_dumps
            except ImportError:
                QMessageBox.critical(self, "Error", "toml module not installed. Run: pip install toml")
                return
            path, _ = QFileDialog.getSaveFileName(
                self, "Export TOML", "pl0tb0t_tools_export.toml", "TOML files (*.toml)")
            if not path:
                return
            data = {"tools": [{"name": t.name, "color": t.color,
                                "x": t.x, "y": t.y, "z": t.z, "safe_z": t.safe_z}
                               for t in self.tools]}
            with open(path, "w") as f:
                f.write(toml_dumps(data))
            QMessageBox.information(self, "Exported", f"Exported to {path}")

        def refresh_pen_buttons(self):
            while self.pen_buttons_layout.count():
                child = self.pen_buttons_layout.takeAt(0)
                if child.widget():
                    child.widget().deleteLater()
            if not self.tools:
                self.pen_buttons_layout.addWidget(QLabel("(No tools)"))
                return
            for tool in self.tools:
                row = QWidget()
                row.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
                rl = QHBoxLayout(row)
                rl.setContentsMargins(0, 0, 0, 0)
                rl.setSpacing(4)
                lbl = QLabel(tool.name)
                lbl.setFixedWidth(80)
                rl.addWidget(lbl)
                for text, fn in [
                    ("⇑ SafeY↑", lambda *_, t=tool: self.move_to_pen_safe_y(t, use_safe_z=True)),
                    ("⇓ SafeY↓", lambda *_, t=tool: self.move_to_pen_safe_y(t, use_safe_z=False)),
                    ("↑ Up",     lambda *_, t=tool: self.move_to_pen_safe_z(t)),
                    ("↓ Down",   lambda *_, t=tool: self.move_to_pen(t)),
                ]:
                    b = QPushButton(text)
                    b.clicked.connect(fn)
                    rl.addWidget(b, 1)
                self.pen_buttons_layout.addWidget(row)

        def _pen_speeds(self):
            rapid    = self.config.tc_rapid
            approach = self.config.tc_approach
            if self.pen_quarter_speed_cb.isChecked():
                rapid    = max(1, rapid // 4)
                approach = max(1, approach // 4)
            return rapid, approach

        def _pen_send(self, *cmds):
            """Send a sequence of G-code strings, checking port each time."""
            for cmd in cmds:
                if not self.port:
                    return
                self._daemon.send(cmd, wait=True)
                time.sleep(0.1)
            time.sleep(0.2)
            self._update_position_internal()

        # ⇑ SafeY↑ — approach lane (Y+offset), safe_z height
        # Y moves first (approach direction), then X, then Z if needed
        def move_to_pen_safe_y(self, tool, use_safe_z=True):
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            rapid, approach = self._pen_speeds()
            offset_y = tool.y + self.config.tc_unplug_mm
            try:
                self._pen_send(
                    # SafeY^: raise to safe Z FIRST so the approach-lane move is
                    # collision-free from any starting height. SafeY_v: stay put, drop last.
                    *([f"G53 G1 Z{tool.safe_z:.3f} F{rapid}"] if use_safe_z else []),
                    f"G53 G1 Y{offset_y:.3f} F{rapid}",
                    f"G53 G1 X{tool.x:.3f} F{rapid}",
                    *([] if use_safe_z else [f"G53 G1 Z{tool.z:.3f} F{approach}"]),
                )
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Move failed: {e}")

        # ↑ Up — dock position (X,Y), safe_z height — all axes together
        def move_to_pen_safe_z(self, tool):
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            rapid, approach = self._pen_speeds()
            try:
                self._pen_send(f"G53 G1 X{tool.x:.3f} Y{tool.y:.3f} Z{tool.safe_z:.3f} F{rapid}")
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Move failed: {e}")

        # ↓ Down — dock position (X,Y), dock_z height — all axes together
        def move_to_pen(self, tool):
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            rapid, approach = self._pen_speeds()
            try:
                self._pen_send(f"G53 G1 X{tool.x:.3f} Y{tool.y:.3f} Z{tool.z:.3f} F{approach}")
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Move failed: {e}")

        def _travel_to(self, x=None, y=None, z=None):
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            parts = []
            if x is not None: parts.append(f"X{x:.3f}")
            if y is not None: parts.append(f"Y{y:.3f}")
            if z is not None: parts.append(f"Z{z:.3f}")
            if not parts:
                return
            def _do():
                try:
                    self._daemon.send(f"G90 G0 {' '.join(parts)}")
                    self._update_position_internal()
                except Exception as e:
                    self.signals.show_error.emit("Error", f"Travel failed: {e}")
            threading.Thread(target=_do, daemon=True).start()

        def _travel_xy_safe(self):
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            safe_z = self.tools[0].safe_z if self.tools else None
            def _do():
                try:
                    if safe_z is not None:
                        self._daemon.send(f"G53 G0 Z{safe_z:.3f}")
                    self._daemon.send("G90 G0 X0 Y0")
                    self._update_position_internal()
                except Exception as e:
                    self.signals.show_error.emit("Error", f"Travel failed: {e}")
            threading.Thread(target=_do, daemon=True).start()

        # ------------------------------------------------------------------
        # SVG / color helpers  (pure logic — unchanged from tkinter version)
        # ------------------------------------------------------------------

        _HEX_COLOR_NAMES = {
            "#000000": "black",  "#1a1a1a": "black",  "#111111": "black",
            "#ffffff": "white",
            "#ff0000": "red",    "#cc0000": "red",
            "#00ff00": "green",  "#008000": "green",
            "#0000ff": "blue",   "#0000cc": "blue",
            "#ffff00": "yellow", "#ffd700": "yellow",
            "#00ffff": "cyan",   "#00b4d8": "cyan",   "#0099cc": "cyan",
            "#ff00ff": "magenta","#cc00cc": "magenta","#ff00b4": "magenta",
            "#ff8000": "orange", "#ffa500": "orange",
            "#800080": "purple", "#8b008b": "purple",
        }

        def _hex_to_rgb(self, hex_color: str):
            h = hex_color.lstrip("#")
            if len(h) == 3:
                h = "".join(c * 2 for c in h)
            if len(h) != 6:
                return None
            try:
                return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
            except ValueError:
                return None

        def _closest_color_name(self, hex_color: str) -> str:
            if not hex_color or not hex_color.startswith("#"):
                return hex_color or ""
            low = hex_color.lower()
            if low in self._HEX_COLOR_NAMES:
                return self._HEX_COLOR_NAMES[low]
            rgb = self._hex_to_rgb(low)
            if rgb is None:
                return hex_color
            best_name, best_dist = hex_color, float("inf")
            for ref_hex, name in self._HEX_COLOR_NAMES.items():
                ref_rgb = self._hex_to_rgb(ref_hex)
                if ref_rgb is None:
                    continue
                dist = sum((a - b) ** 2 for a, b in zip(rgb, ref_rgb))
                if dist < best_dist:
                    best_dist, best_name = dist, name
            return best_name

        def _parse_svg_layers(self, svg_path: str) -> list:
            INK_NS = "http://www.inkscape.org/namespaces/inkscape"
            _SKIP = {"none", "inherit", "transparent", "white", "#ffffff", "#fff"}

            def style_color(style_str):
                m = re.search(r"stroke\s*:\s*([^;]+)", style_str or "")
                if m:
                    val = m.group(1).strip()
                    if val.lower() not in _SKIP:
                        return val
                return None

            def elem_color(el):
                c = style_color(el.get("style", ""))
                if c:
                    return c
                v = el.get("stroke", "")
                if v and v.lower() not in _SKIP:
                    return v
                return None

            def layer_dominant_color(group):
                def _find(el, inh=""):
                    c = elem_color(el) or inh
                    tag = el.tag.split("}")[-1] if "}" in el.tag else el.tag
                    if tag in ("path", "line", "polyline", "polygon", "circle", "ellipse"):
                        return c if c else None
                    child_inh = elem_color(el) or inh
                    for child in el:
                        result = _find(child, child_inh)
                        if result:
                            return result
                    return None
                return _find(group)

            layers = []
            try:
                tree = ET.parse(svg_path)
                root = tree.getroot()
                ink_layers = [el for el in root.iter()
                              if el.get(f"{{{INK_NS}}}groupmode") == "layer"]
                if ink_layers:
                    for g in ink_layers:
                        label = g.get(f"{{{INK_NS}}}label", "Unnamed Layer")
                        layers.append({"label": label, "color": layer_dominant_color(g)})
                else:
                    seen = []
                    def _collect(el, inh=""):
                        c = elem_color(el) or inh
                        tag = el.tag.split("}")[-1] if "}" in el.tag else el.tag
                        if tag in ("path", "line", "polyline", "polygon", "circle", "ellipse"):
                            if c and c not in seen and c.lower() not in _SKIP:
                                seen.append(c)
                                layers.append({"label": c, "color": c})
                        else:
                            child_inh = elem_color(el) or inh
                            for child in el:
                                _collect(child, child_inh)
                    for child in root:
                        _collect(child)
                # Relabel the signature layer if the SVG has id="signature"
                sig_el = next((el for el in root.iter() if el.get('id') == 'signature'), None)
                if sig_el is not None:
                    sig_color = layer_dominant_color(sig_el)
                    if sig_color:
                        for layer in layers:
                            if layer.get('color', '').lower() == sig_color.lower():
                                layer['label'] = 'Signature Layer'
                                break
            except Exception:
                pass
            return layers

        def _match_color_to_tool(self, label: str, color_hex):
            label_low = (label or "").lower()
            color_name = self._closest_color_name(color_hex) if color_hex else ""
            for tool in self.tools:
                t = tool.color.lower()
                if t and (t in label_low or label_low in t or t == color_name):
                    return tool
            for tool in self.tools:
                if tool.name.lower() in label_low or label_low in tool.name.lower():
                    return tool
            return None

        def _luminance(self, hex_color: str) -> float:
            rgb = self._hex_to_rgb(hex_color or "")
            if rgb is None:
                return 0.0
            r, g, b = rgb
            return 0.299 * r + 0.587 * g + 0.114 * b

        def _sort_layers_light_to_dark(self, layers: list) -> list:
            return sorted(layers, key=lambda e: -self._luminance(e.get("color") or ""))

        def _sort_layers_light_to_dark_matched(self, matched: list) -> list:
            return sorted(matched, key=lambda x: -self._luminance(x[0].get("color") or ""))

        def _ordered_svg_layers_for_plot(self, layers: list) -> list:
            drawable = [l for l in layers if l.get("color")]
            if not self.vpype_toolchanges_cb.isChecked():
                return drawable
            return self._sort_layers_light_to_dark(drawable)

        _NAME_RGB = {
            "black": (0, 0, 0), "white": (255, 255, 255),
            "red": (255, 0, 0), "green": (0, 128, 0), "blue": (0, 0, 255),
            "yellow": (255, 255, 0), "cyan": (0, 255, 255), "magenta": (255, 0, 255),
            "orange": (255, 165, 0), "purple": (128, 0, 128), "gray": (128, 128, 128),
            "grey": (128, 128, 128),
        }

        def _color_to_rgb(self, c):
            # Accepts "#rrggbb", "#rgb", or a CSS-ish colour name; returns an
            # (r,g,b) tuple or None. Holder colours are stored as names
            # (e.g. "magenta"); SVG layer colours arrive as hex.
            if not c:
                return None
            c = str(c).strip().lower()
            if c.startswith("#"):
                return self._hex_to_rgb(c)
            return self._NAME_RGB.get(c)

        def _assign_colors_to_holders(self, colors):
            # Greedy nearest-colour matching of distinct SVG colours onto the
            # physical holders (self.tools), each holder used at most once.
            # Best (smallest-distance) colour/holder pairs are matched first so
            # exact matches win regardless of ordering. Colours with no holder
            # left over fall back to their nearest already-used holder.
            # Returns {colour_lower: Tool}.
            tools = list(self.tools or [])
            result = {}
            if not tools:
                return result
            seen = []
            for c in colors:
                cl = (c or "").lower()
                if cl and cl not in seen:
                    seen.append(cl)
            # Build all (dist, colour, holder_idx) triples with resolvable RGB.
            pairs = []
            for cl in seen:
                crgb = self._color_to_rgb(cl)
                for ti, t in enumerate(tools):
                    trgb = self._color_to_rgb(getattr(t, "color", ""))
                    if crgb is None or trgb is None:
                        dist = float("inf")
                    else:
                        dist = sum((a - b) ** 2 for a, b in zip(crgb, trgb))
                    pairs.append((dist, cl, ti))
            pairs.sort(key=lambda p: p[0])
            used_idx = set()
            for dist, cl, ti in pairs:
                if cl in result or ti in used_idx:
                    continue
                if dist == float("inf"):
                    continue
                result[cl] = tools[ti]
                used_idx.add(ti)
            # Any colour still unmatched (more colours than holders, or
            # unresolvable RGB): fall back to nearest holder ignoring
            # uniqueness, so it still plots rather than being dropped.
            for cl in seen:
                if cl in result:
                    continue
                crgb = self._color_to_rgb(cl)
                best_t, best_d = tools[-1], float("inf")
                for t in tools:
                    trgb = self._color_to_rgb(getattr(t, "color", ""))
                    if crgb is None or trgb is None:
                        continue
                    d = sum((a - b) ** 2 for a, b in zip(crgb, trgb))
                    if d < best_d:
                        best_d, best_t = d, t
                result[cl] = best_t
            return result

        def _assign_layers_to_holder_slots(self, layers: list) -> list:
            ordered = self._ordered_svg_layers_for_plot(layers)
            color_to_tool = self._assign_colors_to_holders(
                [(l.get("color") or "").lower() for l in ordered])
            assignments = []
            for layer in ordered:
                color = (layer.get("color") or "").lower()
                tool = color_to_tool.get(color)
                if tool is None:
                    continue
                assignments.append((layer, tool))
            return assignments

        def _confirm_pen_assignments(self, assignments: list, paper_size_mm=None, colors_exceed_slots=False) -> bool:
            dlg = QDialog(self)
            dlg.setWindowTitle("Confirm Pen Assignments")
            layout = QVBoxLayout(dlg)

            msg = "SVG colors will be plotted in this order.\nMake sure each slot has the correct pen loaded."
            if paper_size_mm:
                msg += f"\n\nPaper: {paper_size_mm[0]:.1f} × {paper_size_mm[1]:.1f} mm"
            if colors_exceed_slots:
                msg += "\n\n⚠ More colors than slots — only assigned colors will plot."
            layout.addWidget(QLabel(msg))
            # collapse duplicate color→slot rows
            seen_rows = {}
            slot_idx = 0
            for (layer, tool) in assignments:
                color = (layer.get("color") or "").lower()
                tool_id = id(tool)
                key = (color, tool_id)
                if key in seen_rows:
                    seen_rows[key]["count"] += 1
                    continue
                slot_idx += 1
                seen_rows[key] = {"color": color, "tool": tool, "slot": slot_idx, "count": 1}
            for entry in seen_rows.values():
                color = entry["color"]
                tool = entry["tool"]
                slot_label = tool.name if tool else f"Slot {entry['slot']}"
                extra = f"  ×{entry['count']} layers" if entry["count"] > 1 else ""
                # Effective pen type + the exact Z it will draw at -- the safety
                # info that catches a loaded-pen / holder-type mismatch.
                ept = self._effective_pen_type(color, tool)
                zoff = self._pen_tip_delta(ept)[2]
                contact = self.config.pen_contact_z + zoff
                loaded = ((getattr(self, '_active_pen_map', None) or {}).get((color or '').lower()))
                if loaded and loaded in self._pen_types():
                    pen_note = f"{ept} (loaded)"
                else:
                    pen_note = f"{ept} (holder default)"
                row = QWidget()
                rl = QHBoxLayout(row)
                rl.setContentsMargins(0, 2, 0, 2)
                rl.setSpacing(8)
                swatch = QLabel()
                swatch.setFixedSize(16, 16)
                fill = color if (color.startswith("#") and len(color) in (4, 7)) else "#888888"
                swatch.setStyleSheet(f"background:{fill}; border:1px solid #555;")
                rl.addWidget(swatch)
                rl.addWidget(QLabel(f"{color}   →   Slot {entry['slot']}: {slot_label}{extra}   ·   {pen_note}   ·   Z {contact:+.2f} mm"))
                rl.addStretch()
                layout.addWidget(row)
            btns = QDialogButtonBox(
                QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
            )
            btns.button(QDialogButtonBox.StandardButton.Ok).setText("Plot")
            btns.accepted.connect(dlg.accept)
            btns.rejected.connect(dlg.reject)
            layout.addWidget(btns)
            return dlg.exec() == QDialog.DialogCode.Accepted

        def _split_svg_by_color(self, svg_path: str, target_color: str, tmp_path: str) -> bool:
            for prefix, uri in [
                ("",         "http://www.w3.org/2000/svg"),
                ("xlink",    "http://www.w3.org/1999/xlink"),
                ("inkscape", "http://www.inkscape.org/namespaces/inkscape"),
                ("sodipodi", "http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd"),
                ("dc",       "http://purl.org/dc/elements/1.1/"),
                ("cc",       "http://creativecommons.org/ns#"),
                ("rdf",      "http://www.w3.org/1999/02/22-rdf-syntax-ns#"),
            ]:
                ET.register_namespace(prefix, uri)
            DRAW_TAGS = {"path", "line", "polyline", "polygon", "circle", "ellipse"}
            target = target_color.lower()

            def stroke_of(el):
                m = re.search(r"stroke\s*:\s*([^;]+)", el.get("style", ""))
                if m:
                    return m.group(1).strip().lower()
                return el.get("stroke", "").lower()

            try:
                import copy
                tree = ET.parse(svg_path)
                root = tree.getroot()
                new_root = ET.Element(root.tag, root.attrib)
                found = False

                def filtered_copy(el, inherited=""):
                    nonlocal found
                    raw_tag = el.tag.split("}")[-1] if "}" in el.tag else el.tag
                    el_stroke = stroke_of(el) or inherited
                    if raw_tag in DRAW_TAGS:
                        if el_stroke == target:
                            found = True
                            return copy.deepcopy(el)
                        return None
                    if raw_tag == "g":
                        child_inh = stroke_of(el) or inherited
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
                ET.ElementTree(new_root).write(tmp_path, encoding="unicode", xml_declaration=True)
                return True
            except Exception:
                return False

        def _sync_draw_speed_to_vpype_cfg(self):
            """Patch the F value in the user's vpype .cfg segment line to match draw_speed."""
            cfg_path = self.config.vpype_config.strip()
            if not cfg_path or not os.path.exists(cfg_path):
                return
            try:
                with open(cfg_path, "r", encoding="utf-8") as f:
                    content = f.read()
                speed = self.config.draw_speed
                # Replace or insert F value on the segment = "G1 ..." line
                updated = re.sub(
                    r'(^\s*segment\s*=\s*"G1\s+[^"]*?)(?:\s+F[\d.]+)?(\\n"\s*$)',
                    f'\\1 F{speed}\\2',
                    content, flags=re.MULTILINE
                )
                if updated != content:
                    with open(cfg_path, "w", encoding="utf-8") as f:
                        f.write(updated)
            except Exception:
                pass

        def _apply_feed_override(self, line: str) -> str:
            """Scale F values using separate sliders for draw and tool-change moves."""
            is_g53 = line.upper().startswith("G53")
            pct = self.tc_override_slider.value() if is_g53 else self.feed_override_slider.value()
            if pct == 100:
                return line
            factor = pct / 100.0
            return re.sub(
                r'F([\d.]+)',
                lambda m: f"F{max(1, int(float(m.group(1)) * factor))}",
                line, flags=re.IGNORECASE
            )

        def _write_layer_vpype_config(self, path: str, safe_z: float = -5.0, z_offset: float = 0.0) -> None:
            lift    = self.config.pen_lift_z + z_offset
            contact = self.config.pen_contact_z + z_offset
            speed   = self.config.draw_speed
            content = (
                '[gwrite.pl0tb0t_layer]\n'
                'unit = "mm"\n'
                'vertical_flip = true\n'
                f'segment_first = "G0 Z{lift:.3f}\\nG0 X{{x:.4f}} Y{{y:.4f}}\\nG0 Z{contact:.3f}\\n"\n'
                f'segment = "G1 X{{x:.4f}} Y{{y:.4f}} F{speed}\\n"\n'
            )
            with open(path, "w") as f:
                f.write(content)

        def _first_draw_xy(self, gcode_path: str):
            """Return (x, y) of the first X/Y move in a G-code file, or None."""
            try:
                with open(gcode_path, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        m = re.search(r'[Xx]([-\d.]+).*[Yy]([-\d.]+)', line)
                        if not m:
                            m = re.search(r'[Yy]([-\d.]+).*[Xx]([-\d.]+)', line)
                            if m:
                                return float(m.group(2)), float(m.group(1))
                        else:
                            return float(m.group(1)), float(m.group(2))
            except Exception:
                pass
            return None

        def _tool_pickup_gcode(self, tool, from_drop: bool = False) -> list:
            rapid    = self.config.tc_rapid
            approach = self.config.tc_approach
            ay = tool.y + self.config.tc_unplug_mm
            lines = [f"; === PICK UP: {tool.name} ==="]
            if not from_drop:
                # First pickup: coming from drawing position, need full approach
                lines += [
                    f"G53 G1 Z{tool.safe_z:.3f} F{rapid}",   # raise Z (fast)
                    f"G53 G1 Y{ay:.3f} F{rapid}",             # Y to unplug (fast)
                ]
            # from_drop=True: previous drop left us at unplug Y, Z already clear — just X
            lines += [
                f"G53 G1 X{tool.x:.3f} F{rapid}",         # X to dock column (fast)
                f"G53 G1 Z{tool.z:.3f} F{rapid}",         # lower Z at unplug (fast)
                f"G53 G1 Y{tool.y:.3f} F{approach}",      # Y to dock while down (slow)
                f"G53 G1 Z{tool.safe_z:.3f} F{rapid}",   # raise Z with pen (fast)
                f"G53 G1 Y{ay:.3f} F{rapid}",             # Y back to unplug — clearance before X rapid (fast)
            ]
            return lines

        def _tool_drop_gcode(self, tool, chain_next: bool = False) -> list:
            rapid    = self.config.tc_rapid
            approach = self.config.tc_approach
            ay = tool.y + self.config.tc_unplug_mm
            lines = [
                f"; === DROP: {tool.name} ===",
                f"G53 G1 Z{tool.safe_z:.3f} F{rapid}",   # raise Z with pen (fast)
                f"G53 G1 Y{ay:.3f} F{rapid}",             # Y to unplug position (fast)
                f"G53 G1 X{tool.x:.3f} F{rapid}",         # X to dock column (fast)
                f"G53 G1 Y{tool.y:.3f} F{rapid}",         # Y to dock while up (fast)
                f"G53 G1 Z{tool.z:.3f} F{approach}",      # Z down to seat pen (slow)
                f"G53 G1 Y{ay:.3f} F{rapid}",             # Y retract to unplug — undock carriage (fast)
            ]
            if not chain_next:
                # Last drop before end: raise Z so final park move is safe
                lines.append(f"G53 G1 Z{tool.safe_z:.3f} F{rapid}")
            # chain_next=True: next pickup starts with X travel — Z raise skipped (3 lines → 1)
            return lines

        # ------------------------------------------------------------------
        # SVG layer display
        # ------------------------------------------------------------------

        def _update_svg_layer_display(self, layers: list):
            while self.svg_layer_rows_layout.count():
                child = self.svg_layer_rows_layout.takeAt(0)
                if child.widget():
                    child.widget().deleteLater()
            self.svg_pen_order_label.setText("")

            if not layers:
                self.svg_layer_hint.setText("No layers detected in SVG")
                return

            self.svg_layer_hint.setText("")
            pen_order = []
            display_layers = self._ordered_svg_layers_for_plot(layers)
            assignments = self._assign_layers_to_holder_slots(layers)

            for idx, entry in enumerate(display_layers):
                label = entry["label"]
                color = entry["color"]
                tool = assignments[idx][1] if idx < len(assignments) else None

                row = QWidget()
                rl = QHBoxLayout(row)
                rl.setContentsMargins(0, 0, 0, 0)
                rl.setSpacing(4)

                swatch = QLabel()
                swatch.setFixedSize(14, 14)
                fill = color if (color and color.startswith("#") and len(color) in (4, 7)) else "#333333"
                swatch.setStyleSheet(f"background: {fill}; border: 1px solid #555;")
                rl.addWidget(swatch)

                color_hint = f" ({self._closest_color_name(color)})" if color else ""
                rl.addWidget(QLabel(f'"{label}"{color_hint}'))
                rl.addWidget(QLabel("→"))

                if tool:
                    ml = QLabel(f"{tool.name} holder")
                    ml.setStyleSheet("color: #2a9d2a; font-weight: bold;")
                    rl.addWidget(ml)
                    pen_order.append(f"{tool.name}: {color}")
                else:
                    nm = QLabel("no holder slot")
                    nm.setStyleSheet("color: orange;")
                    rl.addWidget(nm)
                    pen_order.append(f"? ({color or label})")

                rl.addStretch()
                self.svg_layer_rows_layout.addWidget(row)

            if pen_order:
                self.svg_pen_order_label.setText("Pen order:  " + "  →  ".join(pen_order))

        # ------------------------------------------------------------------
        # vpype
        # ------------------------------------------------------------------

        def browse_vpype_svg(self):
            path, _ = QFileDialog.getOpenFileName(self, "Open SVG", "", "SVG files (*.svg)")
            if not path:
                return
            self.vpype_svg_edit.setText(path)
            if not self.vpype_output_edit.text():
                self.vpype_output_edit.setText(os.path.splitext(path)[0] + "_vpype.gcode")
            layers = self._parse_svg_layers(path)
            self._svg_layers = layers
            self._update_svg_layer_display(layers)
            try:
                _svg_text = pathlib.Path(path).read_text(encoding="utf-8", errors="replace")
                _est_s = _estimate_svg_time(_svg_text,
                                            self.config.draw_speed,
                                            self.config.travel_speed)
                _est_str = _fmt_duration(_est_s) if _est_s > 0 else ""
                lbl = getattr(self, "_est_lbl", None)
                if lbl is not None:
                    lbl.setText(f"Est. plot time: {_est_str}" if _est_str else "")
            except Exception:
                pass

        def browse_vpype_config(self):
            pass   # config path is now in Machine Settings

        def browse_vpype_output(self):
            path, _ = QFileDialog.getSaveFileName(
                self, "Save G-code", "", "G-code files (*.gcode)")
            if path:
                self.vpype_output_edit.setText(path)

        def _run_vpype_cmd(self, svg_path, cfg_path, profile, out_path,
                           silent=False, _err_out=None, xy_offset=(0.0, 0.0)) -> bool:
            steps = ["read", svg_path]
            try: _ox, _oy = float(xy_offset[0]), float(xy_offset[1])
            except (TypeError, ValueError, IndexError): _ox, _oy = 0.0, 0.0
            # gcode-space offset: +X directly; Y via gwrite vertical_flip (translate -dy => +dy in gcode)
            if abs(_ox) > 1e-4 or abs(_oy) > 1e-4:
                steps.extend(["translate", f"{_ox:.4f}mm", f"{-_oy:.4f}mm"])
            if getattr(self, "vpype_splitall_cb", None) and self.vpype_splitall_cb.isChecked():
                steps.append("splitall")
            if self.vpype_linemerge_cb.isChecked():
                try:
                    lm_tol = float(self.vpype_linemerge_tol_edit.text())
                except Exception:
                    lm_tol = 0.5
                steps.extend(["linemerge", "-t", f"{lm_tol}mm"])
            if self.vpype_linesort_cb.isChecked():
                steps.append("linesort")
                use_twoopt = bool(getattr(self, "vpype_twoopt_cb", None) and self.vpype_twoopt_cb.isChecked())
                try:
                    big_file = os.path.getsize(svg_path) > 5_000_000
                except OSError:
                    big_file = False
                if use_twoopt and big_file:
                    use_twoopt = False
                    if _err_out is not None:
                        _err_out.append("(auto) skipped --two-opt: file is large enough that the full "
                                         "pairwise optimization previously froze the machine; used plain "
                                         "linesort instead.")
                if use_twoopt:
                    steps.append("--two-opt")
            if self.vpype_reloop_cb.isChecked():      steps.append("reloop")
            if self.vpype_linesimplify_cb.isChecked():
                try:
                    tol = float(self.vpype_simplify_tol_edit.text())
                except Exception:
                    tol = 0.05
                steps.extend(["linesimplify", "-t", f"{tol}mm"])
            # pre_steps can inject scaleto/crop before the optimisation steps
            all_steps = getattr(self, "_vpype_pre_steps", []) + steps
            vpype_bin = str(Path.home() / ".local/bin/vpype")
            cmd = [vpype_bin, "-v", "-c", cfg_path, *all_steps, "gwrite", "-p", profile, out_path]
            # Stage list for live progress. vpype emits no %, but with -v it
            # logs one line per pipeline stage; we know the stages up front.
            _VPYPE_STAGE_CMDS = ("read", "translate", "splitall", "linemerge",
                                 "linesort", "reloop", "linesimplify", "scaleto",
                                 "crop", "layout", "gwrite")
            _stage_names = [t for t in (list(all_steps) + ["gwrite"]) if t in _VPYPE_STAGE_CMDS]
            _total_stages = max(1, len(_stage_names))
            _stage_line_re = re.compile(r"executing (?:global|layer) processor [`']([^`']+)[`']")
            _stage_label = {"read": "reading SVG", "translate": "positioning",
                            "splitall": "splitting", "linemerge": "merging lines",
                            "linesort": "sorting (travel)", "reloop": "relooping",
                            "linesimplify": "simplifying", "scaleto": "scaling",
                            "crop": "cropping", "layout": "laying out",
                            "gwrite": "writing g-code"}

            # Popen + poll (not subprocess.run) so the busy banner can show elapsed
            # time -- visible proof the process is alive, not frozen -- and so a
            # runaway can be killed on a hard timeout instead of taking the whole
            # machine down with it (this is what happened before this fix).
            TIMEOUT_S = 480
            log_fd, log_path = tempfile.mkstemp(prefix="pl0tb0t_vpype_", suffix=".log")
            t0 = time.monotonic()

            def _cap_child_memory():
                # Runs in the child, before exec. Caps virtual memory so a
                # runaway vpype stage fails cleanly (MemoryError inside vpype,
                # reported as a normal vpype-failed error) instead of the
                # whole Pi swap-thrashing into unresponsiveness -- that's what
                # happened twice before this cap existed.
                try:
                    import resource as _resource
                    _cap = 5 * 1024 * 1024 * 1024  # 5GB — validated against a real 108K-path file that needs
                                                    # this much just to parse; leaves ~2.9GB headroom on the
                                                    # Pi's 7.9GB total for OS/app/webengine (measured ~700MB idle)
                    _resource.setrlimit(_resource.RLIMIT_AS, (_cap, _cap))
                except Exception:
                    pass   # non-POSIX or unsupported — best effort, not fatal

            try:
                with os.fdopen(log_fd, "wb") as _logf:
                    try:
                        proc = subprocess.Popen(cmd, stdout=_logf, stderr=subprocess.STDOUT, preexec_fn=_cap_child_memory)
                    except FileNotFoundError:
                        msg = "vpype not found — install it and ensure it's on PATH"
                        if _err_out is not None:
                            _err_out[:] = [msg]
                        if not silent:
                            QMessageBox.critical(self, "Error", msg)
                        return False
                    timed_out = False
                    while True:
                        try:
                            proc.wait(timeout=1.0)
                            break
                        except subprocess.TimeoutExpired:
                            elapsed = int(time.monotonic() - t0)
                            _stage_txt = ""
                            try:
                                with open(log_path, "r", encoding="utf-8", errors="ignore") as _sf:
                                    _seen = _stage_line_re.findall(_sf.read())
                                if _seen:
                                    _lbl = _stage_label.get(_seen[-1], _seen[-1])
                                    _stage_txt = f" — step {min(len(_seen), _total_stages)}/{_total_stages}: {_lbl}"
                            except OSError:
                                pass
                            try:
                                self.signals.update_banner.emit(f"● Plotting… vpype{_stage_txt} ({elapsed}s)")
                            except Exception:
                                pass
                            QApplication.processEvents()
                            if elapsed > TIMEOUT_S:
                                timed_out = True
                                proc.kill()
                                try:
                                    proc.wait(timeout=5)
                                except Exception:
                                    pass
                                break
                if timed_out:
                    msg = f"vpype timed out after {TIMEOUT_S}s — aborted instead of freezing the machine."
                    if _err_out is not None:
                        _err_out[:] = [msg]
                    if not silent:
                        QMessageBox.critical(self, "vpype Error", msg)
                    return False
                if proc.returncode != 0:
                    try:
                        with open(log_path, "r", encoding="utf-8", errors="ignore") as _rf:
                            log_text = "\n".join(l for l in _rf.read().splitlines()
                                                   if not l.startswith("INFO:")).strip()
                    except OSError:
                        log_text = ""
                    msg = log_text or "vpype failed"
                    if _err_out is not None:
                        _err_out[:] = [msg]
                    if not silent:
                        QMessageBox.critical(self, "vpype Error", msg)
                    return False
                # vpype claims success (exit 0) -- verify it actually wrote a
                # non-empty output. gwrite can exit 0 while writing nothing
                # (e.g. an empty document after the optimisation steps), which
                # otherwise surfaces downstream as a baffling FileNotFoundError
                # AND (because of the finally below) with the vpype log already
                # deleted. Capture a persistent diagnostic and fail cleanly.
                try:
                    _out_ok = os.path.exists(out_path) and os.path.getsize(out_path) > 0
                except OSError:
                    _out_ok = False
                if not _out_ok:
                    try:
                        with open(log_path, "r", encoding="utf-8", errors="ignore") as _rf:
                            _vlog = "\n".join(l for l in _rf.read().splitlines()
                                               if not l.startswith("INFO:")).strip()
                    except OSError:
                        _vlog = ""
                    try:
                        with open("/tmp/pl0tb0t_vpype_diag.log", "w", encoding="utf-8") as _df:
                            _df.write("vpype exited 0 but wrote no output file.\n")
                            _df.write("out_path: %s\n" % out_path)
                            _df.write("exists: %s\n" % os.path.exists(out_path))
                            _df.write("cmd: %s\n" % " ".join(cmd))
                            _df.write("--- vpype stdout/stderr ---\n")
                            _df.write(_vlog or "(empty)")
                            _df.write("\n")
                    except OSError:
                        pass
                    msg = ("vpype produced no g-code for this layer: its geometry is "
                           "positioned outside the page bounds (off-page) and was "
                           "clipped away, leaving an empty drawing. Check the source "
                           "SVG's coordinates/transforms. Diagnostic: /tmp/pl0tb0t_vpype_diag.log")
                    if _err_out is not None:
                        _err_out[:] = [msg]
                    if not silent:
                        QMessageBox.critical(self, "vpype Error", msg)
                    return False
                return True
            finally:
                try:
                    os.remove(log_path)
                except OSError:
                    pass

        def _run_vpype_with_toolchanges(self, svg_path, cfg_path, profile, output_path, matched):
            prog = QProgressDialog("Generating G-code…", None, 0, 0, self)
            prog.setWindowTitle("pl0tb0t")
            prog.setWindowModality(Qt.WindowModality.ApplicationModal)
            prog.setMinimumDuration(0)
            prog.show()
            QApplication.processEvents()

            # result: [None] until done, then ("ok",) or ("err", msg)
            result = [None]

            def _generate():
                tmp_dir = tempfile.mkdtemp(prefix="pl0tb0t_")
                try:
                    layer_cfg = os.path.join(tmp_dir, "layer.cfg")
                    safe_z = matched[0][1].safe_z
                    self._write_layer_vpype_config(layer_cfg, safe_z=safe_z)
                    final_lines = [
                        "; Pl0tb0t multi-color plot — auto-generated tool changes",
                        "; Assumes: machine is homed, all pens are in holders, carriage is empty",
                        "G21 G90",
                        f"G53 G0 Z{safe_z:.3f}",
                        f"G1 F{self.config.draw_speed}",
                    ]
                    err_out = []
                    # pre-filter: only layers with actual drawable paths
                    active_layers = []
                    for i, (layer, tool) in enumerate(matched):
                        color = layer.get("color", "")
                        pre_svg = os.path.join(tmp_dir, f"layer_{i}.svg")
                        if self._split_svg_by_color(svg_path, color, pre_svg):
                            active_layers.append((layer, tool, pre_svg, i))
                        else:
                            final_lines.append(f"; layer {i+1} ({color}) skipped — no drawable paths")
                    if not active_layers:
                        result[0] = ("err", "No drawable layers found in SVG")
                        return
                    n_layers = len(active_layers)
                    for j, (layer, tool, pre_svg, orig_i) in enumerate(active_layers):
                        color = layer.get("color", "")
                        label = layer.get("label", color)
                        tmp_gcode = os.path.join(tmp_dir, f"layer_{orig_i}.gcode")
                        err_out.clear()
                        _ept = self._effective_pen_type(color, tool)
                        self._write_layer_vpype_config(layer_cfg, safe_z=safe_z, z_offset=self._pen_tip_delta(_ept)[2])
                        if not self._run_vpype_cmd(pre_svg, layer_cfg, "pl0tb0t_layer",
                                                   tmp_gcode, silent=True, _err_out=err_out,
                                                   xy_offset=self._pen_xy_delta(_ept)):
                            msg = err_out[0] if err_out else "vpype failed"
                            result[0] = ("err", f"vpype failed for layer {label}: {msg}")
                            return
                        is_last = (j == n_layers - 1)
                        final_lines.extend(self._tool_pickup_gcode(tool, from_drop=(j > 0)))
                        first_xy = self._first_draw_xy(tmp_gcode)
                        if first_xy:
                            final_lines.append("; traverse X in the safe-Y lane first, then drop Y into the drawing")
                            final_lines.append(f"G0 X{first_xy[0]:.4f}")
                            final_lines.append(f"G0 Y{first_xy[1]:.4f}")
                        final_lines.append(
                            f"; --- Layer {j+1}: {tool.name} holder - {label} ({color}) ---")
                        with open(tmp_gcode, "r", encoding="utf-8", errors="ignore") as f:
                            for ln in f:
                                ln = ln.strip()
                                if ln:
                                    final_lines.append(ln)
                        final_lines.extend(self._tool_drop_gcode(tool, chain_next=not is_last))
                    final_lines += [
                        "; === END ===",
                        f"G53 G0 Z{safe_z:.3f}",
                        "G53 G0 X-300.000 Y-200.000",
                        "M2",
                    ]
                    with open(output_path, "w", encoding="utf-8") as f:
                        f.write("\n".join(final_lines) + "\n")
                    result[0] = ("ok",)
                except Exception as e:
                    result[0] = ("err", str(e))
                finally:
                    shutil.rmtree(tmp_dir, ignore_errors=True)

            t = threading.Thread(target=_generate, daemon=True)
            t.start()

            poll = QTimer(self)

            def _check():
                if t.is_alive():
                    return
                poll.stop()
                prog.close()
                if result[0] is None or result[0][0] == "err":
                    msg = result[0][1] if result[0] else "G-code generation failed"
                    QMessageBox.critical(self, "Error", msg)
                    return
                self.load_gcode_file(output_path, artboard_mm=self._svg_page_mm(svg_path))
                QMessageBox.information(self, "Success",
                    f"G-code with tool changes saved to {output_path}")

            poll.timeout.connect(_check)
            poll.start(100)


        # ======================================================================
        # Print Queue dock
        # ======================================================================

        def _build_queue_panel(self):
            # Outer widget holds a horizontal splitter: list | preview
            outer = QWidget()
            outer_lay = QVBoxLayout(outer)
            outer_lay.setContentsMargins(0, 0, 0, 0)
            outer_lay.setSpacing(0)

            splitter = QSplitter(Qt.Orientation.Horizontal)
            splitter.setHandleWidth(4)
            outer_lay.addWidget(splitter)

            # ── Left side: controls + card list ──────────────────────────────
            w = QWidget()
            lay = QVBoxLayout(w)
            lay.setContentsMargins(8, 8, 8, 8)
            lay.setSpacing(8)
            splitter.addWidget(w)

            # ── Right side: SVG preview ───────────────────────────────────────
            preview_container = QWidget()
            preview_container.setMinimumWidth(70)
            preview_container.setStyleSheet(
                "background:#f8f8f8;border-left:1px solid #ddd;")
            prev_lay = QVBoxLayout(preview_container)
            prev_lay.setContentsMargins(8, 8, 8, 8)
            prev_lay.setSpacing(8)

            self._queue_svg_widget = AspectSvgPreviewWidget()
            self._queue_svg_widget.setSizePolicy(
                QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
            prev_lay.addWidget(self._queue_svg_widget, 1)

            self._queue_preview_lbl = QLabel("Select a job\nto preview")
            self._queue_preview_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self._queue_preview_lbl.setStyleSheet(
                "color:#bbb;font-size:10px;background:transparent;")
            prev_lay.addWidget(self._queue_preview_lbl)

            splitter.addWidget(preview_container)
            splitter.setStretchFactor(0, 1)
            splitter.setStretchFactor(1, 1)
            splitter.setSizes([10000, 10000])

            self._queue_preview_cache = {}   # job_id → svg bytes

            # Server config
            cfg_row = QHBoxLayout()
            cfg_row.addWidget(QLabel("Server:"))
            self._queue_url_edit = QLineEdit(
                self._queue_load_cfg().get("url", "http://localhost:5001"))
            self._queue_url_edit.setPlaceholderText("http://pl0tb0tpi5:5001")
            cfg_row.addWidget(self._queue_url_edit, 1)
            cfg_row.addWidget(QLabel("Key:"))
            self._queue_key_edit = QLineEdit(
                self._queue_load_cfg().get("key", "pl0tb0t-secret"))
            self._queue_key_edit.setEchoMode(QLineEdit.EchoMode.Password)
            self._queue_key_edit.setFixedWidth(120)
            cfg_row.addWidget(self._queue_key_edit)
            self._queue_save_btn = QPushButton("Save")
            self._queue_save_btn.setFixedWidth(48)
            self._queue_save_btn.clicked.connect(self._queue_save_cfg)
            cfg_row.addWidget(self._queue_save_btn)
            lay.addLayout(cfg_row)

            # Filter + refresh
            ctrl = QHBoxLayout()
            self._queue_filter = QComboBox()
            self._queue_filter.addItems(["All", "Queued", "Plotting", "Done", "Error"])
            self._queue_filter.currentTextChanged.connect(self._queue_refresh)
            ctrl.addWidget(self._queue_filter, 1)
            self._queue_refresh_btn = QPushButton("\u27f3 Refresh")
            self._queue_refresh_btn.clicked.connect(self._queue_refresh)
            ctrl.addWidget(self._queue_refresh_btn)
            lay.addLayout(ctrl)

            self._queue_status_lbl = QLabel("")
            self._queue_status_lbl.setStyleSheet("color:#666;font-size:11px;")
            lay.addWidget(self._queue_status_lbl)

            # Job cards
            self._queue_cards_widget = QWidget()
            self._queue_cards_vlay   = QVBoxLayout(self._queue_cards_widget)
            self._queue_cards_vlay.setContentsMargins(0, 0, 0, 0)
            self._queue_cards_vlay.setSpacing(4)
            self._queue_cards_vlay.addStretch()
            scroll = QScrollArea()
            scroll.setWidgetResizable(True)
            scroll.setWidget(self._queue_cards_widget)
            scroll.setFrameShape(QFrame.Shape.NoFrame)
            lay.addWidget(scroll, 1)

            # Action buttons
            btn_row = QHBoxLayout()
            self._queue_add_local_btn = QPushButton("\u002b Add Local SVG")
            self._queue_add_local_btn.setToolTip("Add a local SVG file to the print queue")
            self._queue_add_local_btn.clicked.connect(self._queue_add_local_svg)
            btn_row.addWidget(self._queue_add_local_btn)
            lay.addLayout(btn_row)

            self._queue_plot_btn = QPushButton("\u2699  SVG \u2192 Gcode")
            self._queue_plot_btn.setEnabled(False)
            self._queue_plot_btn.setToolTip(
                "Download SVG, run vpype with current panel settings, load gcode")
            self._queue_plot_btn.setStyleSheet(
                "QPushButton:enabled{background:#4477bb;color:white;font-weight:bold;"
                "border-radius:4px;padding:5px 12px;}"
                "QPushButton:disabled{color:#aaa;}")
            self._queue_plot_btn.clicked.connect(self._queue_load_into_vpype)
            lay.addWidget(self._queue_plot_btn)

            self._queue_selected_id = None
            self._queue_jobs_cache  = {}
            self._plot_request_dialog_open = False
            # Auto-fix if old Cloudflare Worker URL was saved in config
            if "workers.dev" in self._queue_url_edit.text():
                self._queue_url_edit.setText("http://localhost:5001")
                self._queue_key_edit.setText("pl0tb0t-secret")
                self._queue_save_cfg()
            self._queue_auto_timer = QTimer()
            self._queue_auto_timer.timeout.connect(self._queue_refresh)
            self._queue_auto_timer.timeout.connect(self._queue_check_plot_request)
            self._queue_auto_timer.start(3000)
            self._cloud_sync_timer = QTimer()
            self._cloud_sync_timer.timeout.connect(self._cloud_sync)
            self._cloud_sync_timer.start(30000)
            self._queue_refresh()
            self._cloud_sync()
            return outer

        def _queue_load_cfg(self):
            import pathlib, json as _j
            p = pathlib.Path(__file__).parent / "queue_config.json"
            try:    return _j.loads(p.read_text())
            except: return {"url": "http://localhost:5001", "key": "pl0tb0t-secret"}

        def _queue_save_cfg(self):
            import pathlib, json as _j
            existing = self._queue_load_cfg()
            cfg = {**existing,
                   "url": self._queue_url_edit.text().rstrip("/"),
                   "key": self._queue_key_edit.text()}
            (pathlib.Path(__file__).parent / "queue_config.json").write_text(
                _j.dumps(cfg, indent=2))
            self._queue_status_lbl.setText("Config saved.")
            self._queue_refresh()

        def _queue_server_params(self):
            def _resolve_key(value):
                key = (value or "").strip()
                if not key:
                    return ""
                import pathlib
                key_path = key[1:] if key.startswith("@") else key
                p = pathlib.Path(key_path)
                if not p.is_absolute():
                    p = pathlib.Path(__file__).parent / key_path
                if p.exists() and p.is_file():
                    try:
                        return p.read_text(encoding="utf-8").strip()
                    except Exception:
                        return key
                return key

            return (
                self._queue_url_edit.text().rstrip("/"),
                _resolve_key(self._queue_key_edit.text()),
            )

        def _cloud_server_params(self):
            cfg = self._queue_load_cfg()
            cloud_url = cfg.get("cloud_url", "").rstrip("/")
            if not cloud_url:
                return None, None
            raw = cfg.get("cloud_key", "").strip()
            key = raw
            if raw:
                import pathlib
                key_path = raw[1:] if raw.startswith("@") else raw
                p = pathlib.Path(key_path)
                if not p.is_absolute():
                    p = pathlib.Path(__file__).parent / key_path
                if p.exists() and p.is_file():
                    try:
                        key = p.read_text(encoding="utf-8").strip()
                    except Exception:
                        pass
            return cloud_url, key

        def _cloud_sync(self):
            cloud_url, cloud_key = self._cloud_server_params()
            if not cloud_url:
                return
            local_url, local_key = self._queue_server_params()
            import json as _j
            def _run():
                try:
                    cloud_jobs = self._queue_http("/jobs?status=queued",
                                                  base_url=cloud_url, key=cloud_key)
                    if not cloud_jobs:
                        return
                    local_jobs = self._queue_http("/jobs",
                                                  base_url=local_url, key=local_key)
                    existing = {j.get("cloud_id") for j in local_jobs if j.get("cloud_id")}
                    ingested = 0
                    for cj in cloud_jobs:
                        cid = cj.get("id")
                        if not cid or cid in existing:
                            continue
                        try:
                            svg = self._queue_fetch_text(
                                f"/jobs/{cid}/svg", base_url=cloud_url, key=cloud_key)
                            recipe = None
                            if cj.get("has_recipe"):
                                try:
                                    recipe = _j.loads(self._queue_fetch_text(
                                        f"/jobs/{cid}/recipe",
                                        base_url=cloud_url, key=cloud_key))
                                except Exception:
                                    pass
                            self._queue_http("/jobs", "POST", {
                                "svg":         svg,
                                "recipe":      recipe,
                                "sketch_name": cj.get("sketch_name", "Untitled"),
                                "paper_size":  cj.get("paper_size",  "8.5x11"),
                                "orientation": cj.get("orientation", "portrait"),
                                "notes":       cj.get("notes", ""),
                                "cloud_id":    cid,
                            }, base_url=local_url, key=local_key)
                            self._queue_http(f"/jobs/{cid}/status", "PATCH",
                                             {"status": "plotting"},
                                             base_url=cloud_url, key=cloud_key)
                            existing.add(cid)
                            ingested += 1
                        except Exception:
                            pass
                    if ingested:
                        self.signals.update_status.emit(f"__q_cloud__{ingested}")
                except Exception:
                    pass
            threading.Thread(target=_run, daemon=True).start()

        def _cloud_push_status(self, local_job_id, status):
            cloud_url, cloud_key = self._cloud_server_params()
            if not cloud_url:
                return
            job = self._queue_jobs_cache.get(local_job_id, {})
            cloud_id = job.get("cloud_id")
            if not cloud_id:
                return
            def _push():
                try:
                    self._queue_http(f"/jobs/{cloud_id}/status", "PATCH",
                                     {"status": status},
                                     base_url=cloud_url, key=cloud_key)
                except Exception:
                    pass
            threading.Thread(target=_push, daemon=True).start()

        def _queue_post_machine_status(self, busy: bool, job_id=None):
            """Fire-and-forget: push machine busy state to the queue server."""
            def _post():
                try:
                    self._queue_http("/status", "POST",
                                     {"busy": busy, "current_job_id": job_id})
                except Exception:
                    pass
            threading.Thread(target=_post, daemon=True).start()

        def _queue_check_plot_request(self):
            """Check for a remote plot request and show a confirmation dialog."""
            if self.gcode_running:
                return
            if getattr(self, "_plot_request_dialog_open", False):
                return
            def _check():
                try:
                    state = self._queue_http("/status")
                    req_id = state.get("plot_requested")
                    if req_id and req_id in getattr(self, "_queue_jobs_cache", {}):
                        self.signals.update_status.emit(f"__q_plot_req__{req_id}")
                except Exception:
                    pass
            threading.Thread(target=_check, daemon=True).start()

        def _queue_http(self, path, method="GET", body=None, base_url=None, key=None, timeout=20):
            import urllib.request, json as _j
            if base_url is None or key is None:
                base_url, key = self._queue_server_params()
            url  = base_url.rstrip("/") + path
            data = (_j.dumps(body).encode() if body else None)
            headers = {
                "User-Agent": f"pl0tb0t-OS/{__version__}",
                "Content-Type": "application/json",
            }
            if key:
                headers["X-API-Key"] = key
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return _j.loads(r.read())

        def _queue_refresh(self):
            import threading
            base_url, key = self._queue_server_params()
            filt = self._queue_filter.currentText().lower()
            def _fetch():
                try:
                    path = f"/jobs?status={filt}" if filt != "all" else "/jobs"
                    jobs = self._queue_http(path, base_url=base_url, key=key)
                    self.signals.queue_jobs_ready.emit(jobs)
                except Exception as e:
                    self.signals.update_status.emit(f"__q_err__{e}")
            threading.Thread(target=_fetch, daemon=True).start()

        def _queue_apply_jobs(self, jobs):
            self._queue_jobs_cache = {j["id"]: j for j in jobs}
            self._queue_status_lbl.setText(f"{len(jobs)} job(s) in queue")
            self._queue_rebuild_cards(list(self._queue_jobs_cache.values()))
            self._queue_archive_missing_jobs(jobs)

        def _queue_on_signal(self, msg):
            if msg == "__q_refresh__":
                self._queue_refresh()
            elif msg.startswith("__q_deleted__"):
                job_id = msg.split("__q_deleted__", 1)[1]
                if self._queue_selected_id == job_id:
                    self._queue_selected_id = None
                self._queue_jobs_cache.pop(job_id, None)
                self._queue_rebuild_cards(list(self._queue_jobs_cache.values()))
                self._queue_status_lbl.setText("Job deleted.")
            elif msg.startswith("__q_delete_err__"):
                err = msg.split("__q_delete_err__", 1)[1]
                self._queue_status_lbl.setText(f"Delete failed: {err}")
            elif msg.startswith("__q_ok__"):
                n = msg.split("__q_ok__", 1)[1]
                self._queue_status_lbl.setText(f"{n} job(s) in queue")
            elif msg.startswith("__q_err__"):
                err = msg.split("__q_err__", 1)[1]
                self._queue_status_lbl.setText(f"Error: {err}")
            elif msg.startswith("__q_plot_req__"):
                req_id = msg.split("__q_plot_req__", 1)[1]
                job = self._queue_jobs_cache.get(req_id, {})
                sketch = job.get("sketch_name", req_id) or req_id
                def _clear_req():
                    try:
                        self._queue_http("/status", "POST", {"plot_requested": None})
                    except Exception:
                        pass
                threading.Thread(target=_clear_req, daemon=True).start()
                self._queue_status_lbl.setText(f"Auto-plotting: {sketch}…")
                self._queue_selected_id = req_id
                self._queue_plot_selected()
            elif msg == "__q_autorun__":
                self.feed_override_slider.setValue(100)
                self.tc_override_slider.setValue(100)
                self.run_gcode()
                self.signals.update_banner.emit("● Plot in progress... you may continue making art.")
            elif msg.startswith("__q_cloud__"):
                n = msg.split("__q_cloud__", 1)[1]
                self._queue_status_lbl.setText(f"Ingested {n} job(s) from cloud ↓")
                self._queue_refresh()
            elif msg.startswith("__q_prev__") and not msg.startswith("__q_prev_err__"):
                job_id = msg.split("__q_prev__", 1)[1]
                if job_id == self._queue_selected_id:
                    self._queue_apply_preview(job_id)
            elif msg.startswith("__q_prev_err__"):
                self._queue_preview_lbl.setText("Preview\nunavailable")
            elif msg.startswith("__q_vpype__"):
                svg_path = msg.split("__q_vpype__", 1)[1]
                self._queue_status_lbl.setText("Running vpype\u2026")
                # Populate vpype panel fields
                self.vpype_svg_edit.setText(svg_path)
                import os
                base = os.path.splitext(svg_path)[0]
                self.vpype_output_edit.setText(base + ".gcode")
                layers = self._parse_svg_layers(svg_path)
                self._svg_layers = layers
                self._update_svg_layer_display(layers)
                self.run_vpype()
                self._queue_status_lbl.setText("Gcode ready \u2713")
                self._queue_plot_btn.setEnabled(
                    self._queue_selected_id is not None)

        def _queue_rebuild_cards(self, jobs):
            vlay = self._queue_cards_vlay
            while vlay.count() > 1:
                item = vlay.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
            locked = bool(getattr(self, "gcode_running", False))
            for job in jobs:
                card = JobCard(job, locked=False)
                card.deleted.connect(self._queue_delete)
                card.selected.connect(self._queue_select)
                if job["id"] == self._queue_selected_id:
                    card.setStyleSheet(card.styleSheet() +
                                       "JobCard{border:2px solid #2a7;}")
                vlay.insertWidget(vlay.count() - 1, card)
            queued_sel = (
                self._queue_selected_id is not None and
                self._queue_jobs_cache.get(
                    self._queue_selected_id, {}).get("status") == "queued")
            self._queue_plot_btn.setEnabled((not locked) and queued_sel)

        def _queue_select(self, job_id):
            self._queue_selected_id = job_id
            self._queue_rebuild_cards(list(self._queue_jobs_cache.values()))
            self._queue_load_preview(job_id)

        def _queue_load_preview(self, job_id):
            """Download SVG for job_id and render it in the preview pane."""
            if not hasattr(self, "_queue_svg_widget"):
                return
            # Instant render if already cached
            if job_id in self._queue_preview_cache:
                self._queue_apply_preview(job_id)
                return
            self._queue_svg_widget.clear()   # clear while loading
            self._queue_preview_lbl.setText("Loading\u2026")
            import threading
            base_url, key = self._queue_server_params()
            def _fetch():
                try:
                    import urllib.request
                    url = base_url.rstrip("/") + f"/jobs/{job_id}/svg"
                    headers = {"User-Agent": f"pl0tb0t-OS/{__version__}"}
                    if key:
                        headers["X-API-Key"] = key
                    req = urllib.request.Request(url, headers=headers)
                    with urllib.request.urlopen(req, timeout=20) as r:
                        data = r.read()
                    self._queue_preview_cache[job_id] = data
                    self.signals.update_status.emit(f"__q_prev__{job_id}")
                except Exception:
                    self.signals.update_status.emit(f"__q_prev_err__{job_id}")
            threading.Thread(target=_fetch, daemon=True).start()

        def _queue_apply_preview(self, job_id):
            data = self._queue_preview_cache.get(job_id, b"")
            if data and hasattr(self, "_queue_svg_widget"):
                self._queue_svg_widget.load(data)
                self._queue_preview_lbl.setText("")
            else:
                self._queue_preview_lbl.setText("No preview")

        def _queue_archive_dir(self):
            import pathlib
            path = pathlib.Path(__file__).parent / "SVG Archive"
            path.mkdir(parents=True, exist_ok=True)
            return path

        def _queue_recipe_archive_dir(self):
            import pathlib
            path = pathlib.Path(__file__).parent / "Recipe Archive"
            path.mkdir(parents=True, exist_ok=True)
            return path

        def _queue_safe_filename(self, value: str) -> str:
            import re as _re
            safe = _re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "Untitled")).strip("-._")
            return safe[:60] or "Untitled"

        def _queue_archive_path_for_job(self, job: dict):
            archive_dir = self._queue_archive_dir()
            job_id = str(job.get("id", "unknown"))
            existing = list(archive_dir.glob(f"*_{job_id}_*.svg"))
            if existing:
                return existing[0]
            created = int(job.get("created_at") or __import__("time").time())
            sketch = self._queue_safe_filename(job.get("sketch_name") or "Untitled")
            return archive_dir / f"{created}_{job_id}_{sketch}.svg"

        def _queue_recipe_archive_path_for_job(self, job: dict):
            archive_dir = self._queue_recipe_archive_dir()
            job_id = str(job.get("id", "unknown"))
            existing = list(archive_dir.glob(f"*_{job_id}_*.json"))
            if existing:
                return existing[0]
            created = int(job.get("created_at") or __import__("time").time())
            sketch = self._queue_safe_filename(job.get("sketch_name") or "Untitled")
            return archive_dir / f"{created}_{job_id}_{sketch}.json"

        def _queue_archive_svg(self, job: dict, svg_text: str):
            path = self._queue_archive_path_for_job(job)
            if not path.exists():
                path.write_text(svg_text, encoding="utf-8")
            return path

        def _queue_archive_recipe(self, job: dict, recipe_text: str):
            path = self._queue_recipe_archive_path_for_job(job)
            if not path.exists():
                path.write_text(recipe_text, encoding="utf-8")
            return path

        def _queue_archive_recipe_if_available(self, job: dict, base_url=None, key=None):
            if not job or not job.get("has_recipe"):
                return None
            path = self._queue_recipe_archive_path_for_job(job)
            if path.exists():
                return path
            job_id = str(job.get("id", ""))
            if not job_id:
                return None
            recipe_text = self._queue_fetch_text(
                f"/jobs/{job_id}/recipe", base_url=base_url, key=key, timeout=30)
            return self._queue_archive_recipe(job, recipe_text)

        def _queue_fetch_text(self, path: str, base_url=None, key=None, timeout=30) -> str:
            import urllib.request
            if base_url is None or key is None:
                base_url, key = self._queue_server_params()
            url = base_url.rstrip("/") + path
            headers = {"User-Agent": f"pl0tb0t-OS/{__version__}"}
            if key:
                headers["X-API-Key"] = key
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")

        def _queue_archive_missing_jobs(self, jobs):
            import threading
            base_url, key = self._queue_server_params()
            pending = [job for job in jobs if not self._queue_archive_path_for_job(job).exists()]
            recipe_pending = [
                job for job in jobs
                if job.get("has_recipe") and not self._queue_recipe_archive_path_for_job(job).exists()
            ]
            if not pending and not recipe_pending:
                return
            def _run():
                for job in pending:
                    job_id = str(job.get("id", ""))
                    if not job_id:
                        continue
                    try:
                        svg_text = self._queue_fetch_text(
                            f"/jobs/{job_id}/svg", base_url=base_url, key=key, timeout=30)
                        self._queue_archive_svg(job, svg_text)
                    except Exception:
                        pass
                for job in recipe_pending:
                    try:
                        self._queue_archive_recipe_if_available(job, base_url=base_url, key=key)
                    except Exception:
                        pass
            threading.Thread(target=_run, daemon=True).start()

        def _queue_delete(self, job_id):
            self._queue_status_lbl.setText(f"Deleting {job_id}...")
            import threading
            base_url, key = self._queue_server_params()
            def _run():
                try:
                    self._queue_http(f"/jobs/{job_id}", method="DELETE", base_url=base_url, key=key)
                    self.signals.update_status.emit(f"__q_deleted__{job_id}")
                except Exception as e:
                    self.signals.update_status.emit(f"__q_delete_err__{e}")
            threading.Thread(target=_run, daemon=True).start()

        def _queue_add_local_svg(self):
            """Open a file picker and add the chosen SVG to the print queue."""
            path, _ = QFileDialog.getOpenFileName(
                self, "Add SVG to Queue", "", "SVG files (*.svg)")
            if not path:
                return
            import pathlib, threading
            fname = pathlib.Path(path).stem
            svg_text = pathlib.Path(path).read_text(encoding="utf-8", errors="replace")
            try:
                _est_s = _estimate_svg_time(svg_text,
                                            self.config.draw_speed,
                                            self.config.travel_speed)
            except Exception:
                _est_s = 0.0
            base_url, key = self._queue_server_params()
            def _post():
                try:
                    import json as _j, urllib.request
                    body = _j.dumps({
                        "svg": svg_text,
                        "sketch_name": fname,
                        "paper_size": "8.5x11",
                        "orientation": "portrait",
                        "est_time_s": round(_est_s),
                    }).encode()
                    headers = {
                        "User-Agent": f"pl0tb0t-OS/{__version__}",
                        "Content-Type": "application/json",
                    }
                    if key:
                        headers["X-API-Key"] = key
                    req = urllib.request.Request(
                        base_url.rstrip("/") + "/jobs",
                        data=body, method="POST", headers=headers)
                    with urllib.request.urlopen(req, timeout=20) as r:
                        result = _j.loads(r.read())
                    self.signals.update_status.emit(
                        f"__q_ok__{len(self._queue_jobs_cache) + 1}")
                    self.signals.update_status.emit("__q_refresh__")
                except Exception as e:
                    self.signals.show_error.emit("Queue", f"Add local SVG failed: {e}")
            threading.Thread(target=_post, daemon=True).start()

        def _queue_svg_physical_page(self, svg_text: str, job: dict) -> str:
            paper = (job or {}).get("paper_size", "9x12")
            orient = (job or {}).get("orientation", "portrait")
            try:
                parts = [float(p) for p in str(paper).lower().replace("x", " ").split()[:2]]
            except Exception:
                parts = []
            if len(parts) < 2:
                parts = [9.0, 12.0]
            pw, ph = parts[0], parts[1]
            _ = orient  # orientation is derived from the SVG below, not this field

            import re as _re
            def _set_attr(tag: str, name: str, value: str) -> str:
                pattern = r'\s' + name + r'\s*=\s*["\'][^"\']*["\']'
                if _re.search(pattern, tag, flags=_re.I):
                    return _re.sub(pattern, f' {name}="{value}"', tag, count=1, flags=_re.I)
                return tag[:-1] + f' {name}="{value}">'

            def _attr(tag: str, name: str):
                m = _re.search(r'\s' + name + r'\s*=\s*["\']([^"\']*)["\']', tag, flags=_re.I)
                return m.group(1) if m else None

            def _numeric_length(value):
                if not value:
                    return None
                m = _re.match(r'\s*([-+]?\d*\.?\d+)', value)
                if not m:
                    return None
                try:
                    return float(m.group(1))
                except Exception:
                    return None

            def _replace(match):
                tag = match.group(0)
                # Orient the physical page to match how the SVG was actually drawn
                # (viewBox / width:height aspect). The job orientation field is
                # unreliable, and a portrait page over a landscape viewBox squishes
                # the art (non-uniform scale -> distortion + doubled-looking strokes).
                _pw, _ph = pw, ph
                _land = None
                _vb = _attr(tag, "viewBox")
                if _vb:
                    try:
                        _v = [float(x) for x in _vb.replace(",", " ").split()]
                        if len(_v) == 4 and _v[2] and _v[3]:
                            _land = _v[2] > _v[3]
                    except Exception:
                        _land = None
                if _land is None:
                    _ow = _numeric_length(_attr(tag, "width"))
                    _oh = _numeric_length(_attr(tag, "height"))
                    if _ow and _oh:
                        _land = _ow > _oh
                if _land is not None:
                    if _land and _pw < _ph:
                        _pw, _ph = _ph, _pw
                    elif (not _land) and _pw > _ph:
                        _pw, _ph = _ph, _pw
                if not _attr(tag, "viewBox"):
                    old_w = _numeric_length(_attr(tag, "width"))
                    old_h = _numeric_length(_attr(tag, "height"))
                    if old_w and old_h:
                        tag = _set_attr(tag, "viewBox", f"0 0 {old_w:g} {old_h:g}")
                tag = _set_attr(tag, "width", f"{_pw:g}in")
                tag = _set_attr(tag, "height", f"{_ph:g}in")
                return tag

            return _re.sub(r'<svg\b[^>]*>', _replace, svg_text, count=1, flags=_re.I)

        def _queue_load_into_vpype(self):
            """Download the selected queue job's SVG and load it into the vpype panel."""
            if self.gcode_running:
                self._queue_status_lbl.setText("Drawing active - SVG to G-code is disabled")
                return
            job_id = self._queue_selected_id
            job    = self._queue_jobs_cache.get(job_id)
            if not job:
                return
            import threading
            self._queue_plot_btn.setEnabled(False)
            self._queue_status_lbl.setText(f"Downloading {job_id}\u2026")
            base_url, key = self._queue_server_params()
            def _run():
                import tempfile, pathlib, urllib.request
                try:
                    url = base_url.rstrip("/") + f"/jobs/{job_id}/svg"
                    headers = {"User-Agent": f"pl0tb0t-OS/{__version__}"}
                    if key:
                        headers["X-API-Key"] = key
                    req = urllib.request.Request(url, headers=headers)
                    with urllib.request.urlopen(req, timeout=30) as r:
                        svg_data = r.read()
                    # Strip visual-only gray border rect before vpype.
                    import re as _re
                    svg_text = svg_data.decode("utf-8", errors="replace")
                    svg_text = _re.sub(
                        r'<rect\b[^>]+stroke=["\'][#][bBcCdDeEfF][0-9a-fA-F]{5}["\'][^>]*/>',
                        "", svg_text)
                    self._queue_archive_svg(job, svg_text)
                    try:
                        self._queue_archive_recipe_if_available(job, base_url=base_url, key=key)
                    except Exception:
                        pass
                    svg_text = self._queue_svg_physical_page(svg_text, job)
                    # Write to a named temp file the vpype panel can read
                    tmp = pathlib.Path(tempfile.mkdtemp())
                    sketch = job.get("sketch_name", job_id) or job_id
                    svg_path = tmp / f"{sketch}.svg"
                    svg_path.write_text(svg_text, encoding="utf-8")
                    # Set vpype SVG field and default output on main thread
                    self.signals.update_status.emit(
                        f"__q_vpype__{str(svg_path)}")
                except Exception as e:
                    self.signals.show_error.emit("Queue", f"Load failed: {e}")
                finally:
                    self.signals.update_status.emit("__q_refresh__")
            threading.Thread(target=_run, daemon=True).start()

        def _queue_plot_selected(self):
            job_id = self._queue_selected_id
            job    = self._queue_jobs_cache.get(job_id)
            _debug_log(f"Button: Plot clicked, job_id={job_id}")
            if not job:
                _debug_log(f"Plot: job not found in cache")
                return
            import threading
            self._queue_plot_btn.setEnabled(False)
#             prog = QProgressDialog(f"Fetching {job_id}\u2026", None, 0, 0, self)
#             prog.setWindowTitle("Loading SVG")
#             prog.setWindowModality(Qt.WindowModality.ApplicationModal)
#             prog.show()
            _debug_log('dialog shown, about to get params')
            _debug_log('params received')
            base_url, key = self._queue_server_params()

            def _fetch():
                import tempfile, pathlib, urllib.request, re as _re
                try:
                    _debug_log("THREAD EXECUTING")
                    url = base_url.rstrip("/") + f"/jobs/{job_id}/svg"
                    headers = {"User-Agent": f"pl0tb0t-OS/{__version__}"}
                    if key:
                        headers["X-API-Key"] = key
                    req = urllib.request.Request(url, headers=headers)
                    with urllib.request.urlopen(req, timeout=30) as r:
                        _svg_raw = r.read()
                    _debug_log(f"SVG fetched: {len(_svg_raw)} bytes")
                    _svg_txt = _svg_raw.decode("utf-8", errors="replace")
                    _svg_txt = _re.sub(
                        r'<rect\b[^>]+stroke=["\'][#][bBcCdDeEfF][0-9a-fA-F]{5}["\'][^>]*/>',
                        "", _svg_txt)
                    self._queue_archive_svg(job, _svg_txt)
                    try:
                        self._queue_archive_recipe_if_available(job, base_url=base_url, key=key)
                    except Exception:
                        pass
                    _svg_txt = self._queue_svg_physical_page(_svg_txt, job)
                    tmp = pathlib.Path(tempfile.mkdtemp())
                    svg_path = tmp / f"{job_id}.svg"
                    svg_path.write_text(_svg_txt, encoding="utf-8")
                    layers   = self._parse_svg_layers(str(svg_path))
                    drawable = [l for l in layers if l.get("color")]
                    # Plot in palette/document order so the pen order matches the JS confirm dialog
                    # (previously re-sorted light-to-dark here, which crossed pen slots vs. the dialog).
                    ordered  = drawable
                    self.signals.queue_pen_assign.emit({
                        "job_id":   job_id,
                        "job":      job,
                        "svg_path": str(svg_path),
                        "tmp":      str(tmp),
                        "layers":   ordered,
                        "base_url": base_url,
                        "key":      key,
                    })
                except Exception as e:
                    self.signals.show_error.emit("Queue Error", str(e))
                    self.signals.update_status.emit("__q_refresh__")

            _debug_log("about to start thread")
            threading.Thread(target=_fetch, daemon=True).start()

        def _get_queue_sig_svg(self, edition: int) -> str:
            """Generate a fresh signature SVG fragment via the webview (main thread)."""
            from PyQt6.QtCore import QEventLoop
            result = ['']
            loop = QEventLoop()
            js = (
                '(function(ed){'
                'try{'
                '  var cfg=window._signatureConfig;'
                '  if(!cfg||!cfg.enabled)return "";'
                '  if(!window.makeSketchApp||!window.makeSketchApp.getSignatureSvgForQueue)return "";'
                '  var prev=cfg._editionOverride;'
                '  cfg._editionOverride=ed;'
                '  var r=window.makeSketchApp.getSignatureSvgForQueue(null)||"";'
                '  cfg._editionOverride=prev;'
                '  return r;'
                '}catch(e){return "";}'
                f'}})({edition})'
            )
            def _cb(val):
                result[0] = val or ''
                loop.quit()
            try:
                self._make_webview.page().runJavaScript(js, _cb)
                loop.exec()
            except Exception:
                pass
            return result[0]

        def _confirm_gcode_preview(self, job_id: str, gcode_path: str, paper_mm=None) -> bool:
            """Modal preview of the ACTUAL generated g-code before it's sent to the
            machine. The make-tab's own canvas preview can look correct while the
            exported g-code is wrong (e.g. a clipping bug drawing past the paper
            edge -- the canvas preview is protected by a ctx.clip() the SVG export
            doesn't always apply) -- this is the last chance to catch that before
            the pen moves. Returns True to proceed with plotting, False if the
            user cancelled.
            """
            try:
                self.load_gcode_file(gcode_path, artboard_mm=paper_mm)
            except Exception:
                pass

            dlg = QDialog(self)
            dlg.setWindowTitle(f"Confirm G-code — {job_id}")
            dlg.resize(720, 680)
            layout = QVBoxLayout(dlg)

            info = "Review the actual toolpath before it's sent to the machine."
            bounds = getattr(self, 'gcode_bounds', None)
            segments = getattr(self, 'gcode_segments', None) or []
            if paper_mm:
                info += f"\nPaper: {paper_mm[0]:.1f} × {paper_mm[1]:.1f} mm"
            if bounds:
                w = bounds[2] - bounds[0]
                h = bounds[3] - bounds[1]
                info += f"\nArtwork: {w:.1f} × {h:.1f} mm  ·  {len(segments)} draw segments"
                if paper_mm:
                    pad = 0.5  # mm tolerance for float noise
                    if (bounds[0] < -pad or bounds[1] < -pad or
                            bounds[2] > paper_mm[0] + pad or bounds[3] > paper_mm[1] + pad):
                        info += "\n⚠ Artwork extends past the paper edge — check the preview below."
            layout.addWidget(QLabel(info))

            preview = GcodePreviewWidget()
            preview.setMinimumHeight(440)
            preview.set_data(segments, bounds, artboard=paper_mm)
            layout.addWidget(preview)

            btns = QDialogButtonBox(
                QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
            btns.button(QDialogButtonBox.StandardButton.Ok).setText("Looks good — Plot")
            btns.accepted.connect(dlg.accept)
            btns.rejected.connect(dlg.reject)
            layout.addWidget(btns)
            return dlg.exec() == QDialog.DialogCode.Accepted

        def _on_confirm_and_run_gcode(self, job_id, gcode_path, paper_mm, base_url, key):
            """Main-thread handler for the single-pass queue-plot path (its g-code
            generation runs on a background thread, which can't show a QDialog
            directly -- see confirm_and_run_gcode signal). Mirrors the confirm +
            autorun-or-cancel behavior already inline in _queue_on_pen_assign's
            multi-color path."""
            import threading
            proceed = self._confirm_gcode_preview(job_id, gcode_path, paper_mm)

            def _mark(status):
                try:
                    self._queue_http(f"/jobs/{job_id}/status",
                                     "PATCH", {"status": status},
                                     base_url=base_url, key=key)
                    self._cloud_push_status(job_id, status)
                except Exception:
                    pass
                self.signals.update_status.emit("__q_refresh__")

            if not proceed:
                threading.Thread(target=lambda: _mark("queued"), daemon=True).start()
                self._queue_status_lbl.setText(f"Plot cancelled for {job_id}")
                return

            self.gcode_path = gcode_path
            if self.port:
                self.signals.update_status.emit("__q_autorun__")
            else:
                self.signals.show_info.emit(
                    "Not Connected",
                    "The g-code is ready, but the machine isn't connected, "
                    "so it wasn't sent.\n\nClick Connect on the Machine tab, "
                    "then press Run to plot.")
            threading.Thread(target=lambda: _mark("done"), daemon=True).start()

        def _queue_on_pen_assign(self, ctx):
            import threading, tempfile, pathlib, shutil
            job_id   = ctx["job_id"]
            job      = ctx["job"]
            svg_path = ctx["svg_path"]
            tmp      = pathlib.Path(ctx["tmp"])
            ordered  = ctx["layers"]
            base_url = ctx["base_url"]
            key      = ctx["key"]
            gcode_path = tmp / f"{job_id}.gcode"

            # Map each color layer to a tool slot: prefer the position the
            # user declared in the Pens editor (stable across files); fall
            # back to dynamic first-seen assignment only for colours that
            # aren't in that registry at all.
            color_to_tool = self._assign_colors_to_holders(
                [(l.get("color") or "").lower() for l in ordered])
            assignments = []
            for layer in ordered:
                color = (layer.get("color") or "").lower()
                tool = color_to_tool.get(color)
                if tool is None:
                    continue
                assignments.append((layer, tool))

            if assignments:
                colors_exceed = len(assignments) < len(ordered)
                paper_mm = self._svg_page_mm(svg_path)
                # Read the loaded-pen panel (main thread) so Z/Y offsets and the
                # confirm dialog reflect the pens actually loaded, and show the
                # last-look safety gate before committing a multi-colour plot.
                # The Make-tab web pen-confirm dialog already gated this plot;
                # just capture the loaded-pen map (drives the real Z/Y offset).
                self._active_pen_map = self._read_js_pen_map()
                self._active_skip_set = self._read_js_skip_set()
                _draw_order = self._read_js_draw_order()
                assignments = self._apply_draw_order(assignments, _draw_order)
                if _draw_order != self.config.draw_order:
                    self.config.draw_order = _draw_order
                    save_config(self.config)
                assignments = self._dedupe_assignments_by_color(assignments)
            def _mark_plotting():
                try:
                    self._queue_http(f"/jobs/{job_id}/status",
                                     "PATCH", {"status": "plotting"},
                                     base_url=base_url, key=key)
                    self._cloud_push_status(job_id, "plotting")
                except Exception:
                    pass
            threading.Thread(target=_mark_plotting, daemon=True).start()
            self._queue_status_lbl.setText(f"Processing {job_id}\u2026")

            # Generate fresh signature SVG with correct edition number (main thread)
            _edition = int((job or {}).get("plot_count", 0)) + 1
            _sig_svg = self._get_queue_sig_svg(_edition)
            self._queue_pending_done = (job_id, base_url, key)

            # \u2500\u2500 Multi-color: per-layer vpype + tool changes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
            if assignments:
                self.signals.update_banner.emit("● Plotting… generating gcode via vpype")
                # prog = QProgressDialog("Generating G-code\u2026", None, 0, 0, self)
                # prog.setWindowTitle("pl0tb0t")
                # prog.setWindowModality(Qt.WindowModality.ApplicationModal)
                # prog.setMinimumDuration(0)
                # prog.show()
                QApplication.processEvents()
                result = [None]

                def _generate():
                    gen_tmp = pathlib.Path(tempfile.mkdtemp(prefix="pl0tb0t_"))
                    try:
                        def _strip_sig(s):
                            m = 'id="signature"'
                            if m not in s: return s
                            idx = s.find(m)
                            g0 = s.rfind('<g', 0, idx)
                            if g0 == -1: return s
                            depth, i, n = 0, g0, len(s)
                            while i < n:
                                if s[i:i+2] == '<g' and (i+2 >= n or s[i+2] in ' \t\n\r>'):
                                    depth += 1; i += 2
                                elif s[i:i+4] == '</g>':
                                    depth -= 1
                                    if depth == 0: return s[:g0] + s[i+4:]
                                    i += 4
                                else: i += 1
                            return s
                        _svg_str = pathlib.Path(svg_path).read_text(encoding='utf-8')
                        _svg_str = _strip_sig(_svg_str)
                        if _sig_svg:
                            _svg_str = _svg_str.rstrip()
                            if _svg_str.endswith('</svg>'):
                                _svg_str = _svg_str[:-6] + _sig_svg + '\n</svg>'
                        pathlib.Path(svg_path).write_text(_svg_str, encoding='utf-8')

                        layer_cfg = str(gen_tmp / "layer.cfg")
                        safe_z = assignments[0][1].safe_z
                        self._write_layer_vpype_config(layer_cfg, safe_z=safe_z)
                        final_lines = [
                            "; Pl0tb0t multi-color plot \u2014 auto-generated tool changes",
                            "; Assumes: machine is homed, all pens are in holders, carriage is empty",
                            "G21 G90",
                            f"G53 G0 Z{safe_z:.3f}",
                            f"G1 F{self.config.draw_speed}",
                        ]
                        err_out = []
                        # pre-filter: only layers with actual drawable paths
                        active_layers = []
                        _skip = getattr(self, "_active_skip_set", None) or set()
                        for i, (layer, tool) in enumerate(assignments):
                            color = layer.get("color", "")
                            if (color or "").lower() in _skip:
                                final_lines.append(f"; layer {i+1} ({color}) skipped by user (skip-layer toggle)")
                                continue
                            pre_svg = str(gen_tmp / f"layer_{i}.svg")
                            if self._split_svg_by_color(svg_path, color, pre_svg):
                                active_layers.append((layer, tool, pre_svg, i))
                            else:
                                final_lines.append(f"; layer {i+1} ({color}) skipped — no drawable paths")
                        if not active_layers:
                            result[0] = ("err", "No drawable layers found in SVG")
                            return
                        n_layers = len(active_layers)
                        for j, (layer, tool, pre_svg, orig_i) in enumerate(active_layers):
                            color  = layer.get("color", "")
                            label  = layer.get("label", color)
                            l_gcode = str(gen_tmp / f"layer_{orig_i}.gcode")
                            err_out.clear()
                            _ept = self._effective_pen_type(color, tool)
                            self._write_layer_vpype_config(layer_cfg, safe_z=safe_z, z_offset=self._pen_tip_delta(_ept)[2])
                            if not self._run_vpype_cmd(pre_svg, layer_cfg, "pl0tb0t_layer",
                                                       l_gcode, silent=True, _err_out=err_out,
                                                       xy_offset=self._pen_xy_delta(_ept)):
                                msg = err_out[0] if err_out else "vpype failed"
                                result[0] = ("err", f"vpype failed for {label}: {msg}")
                                return
                            is_last = (j == n_layers - 1)
                            final_lines.extend(self._tool_pickup_gcode(tool, from_drop=(j > 0)))
                            first_xy = self._first_draw_xy(l_gcode)
                            if first_xy:
                                final_lines.append("; traverse X in the safe-Y lane first, then drop Y into the drawing")
                                final_lines.append(f"G0 X{first_xy[0]:.4f}")
                                final_lines.append(f"G0 Y{first_xy[1]:.4f}")
                            final_lines.append(
                                f"; --- Layer {j+1}: {tool.name} - {label} ({color}) ---")
                            with open(l_gcode, "r", encoding="utf-8", errors="ignore") as f:
                                for ln in f:
                                    ln = ln.strip()
                                    if ln:
                                        final_lines.append(ln)
                            final_lines.extend(self._tool_drop_gcode(tool, chain_next=not is_last))
                        final_lines += [
                            "; === END ===",
                            f"G53 G0 Z{safe_z:.3f}",
                            "G53 G0 X-300.000 Y-200.000",
                            "M2",
                        ]
                        with open(str(gcode_path), "w", encoding="utf-8") as f:
                            f.write("\n".join(final_lines) + "\n")
                        result[0] = ("ok",)
                    except Exception as e:
                        result[0] = ("err", str(e))
                    finally:
                        shutil.rmtree(str(gen_tmp), ignore_errors=True)

                t = threading.Thread(target=_generate, daemon=True)
                t.start()
                poll = QTimer(self)

                def _check():
                    if t.is_alive():
                        return
                    poll.stop()
                    # prog.close()  # dialog removed
                    if result[0] is None or result[0][0] == "err":
                        msg = result[0][1] if result[0] else "G-code generation failed"
                        QMessageBox.critical(self, "Error", msg)
                        def _mark_err():
                            try:
                                self._queue_http(f"/jobs/{job_id}/status",
                                                 "PATCH", {"status": "error"},
                                                 base_url=base_url, key=key)
                                self._cloud_push_status(job_id, "error")
                            except Exception:
                                pass
                            self.signals.update_status.emit("__q_refresh__")
                        threading.Thread(target=_mark_err, daemon=True).start()
                        return
                    self.signals.update_banner.emit("● Plotting… ready for review")
                    if not gcode_path.exists():
                        QMessageBox.critical(self, "Error", "G-code generation reported success but the file is missing.")
                        def _mark_missing():
                            try:
                                self._queue_http(f"/jobs/{job_id}/status",
                                                 "PATCH", {"status": "error"},
                                                 base_url=base_url, key=key)
                                self._cloud_push_status(job_id, "error")
                            except Exception:
                                pass
                            self.signals.update_status.emit("__q_refresh__")
                        threading.Thread(target=_mark_missing, daemon=True).start()
                        return
                    if not self._confirm_gcode_preview(job_id, str(gcode_path), self._svg_page_mm(svg_path)):
                        def _mark_cancelled():
                            try:
                                self._queue_http(f"/jobs/{job_id}/status",
                                                 "PATCH", {"status": "queued"},
                                                 base_url=base_url, key=key)
                            except Exception:
                                pass
                            self.signals.update_status.emit("__q_refresh__")
                        threading.Thread(target=_mark_cancelled, daemon=True).start()
                        self._queue_status_lbl.setText(f"Plot cancelled for {job_id}")
                        return
                    _debug_log(f"_check: gcode={gcode_path} exists={gcode_path.exists()} port={self.port} running={self.gcode_running}")
                    if self.port:
                        _debug_log("_check: emitting __q_autorun__")
                        self.signals.update_status.emit("__q_autorun__")
                    else:
                        self.signals.show_info.emit(
                            "Not Connected",
                            "The g-code is ready, but the machine isn't connected, "
                            "so it wasn't sent.\n\nClick Connect on the Machine tab, "
                            "then press Run to plot.")
                    def _mark_done():
                        try:
                            self._queue_http(f"/jobs/{job_id}/status",
                                             "PATCH", {"status": "done"},
                                             base_url=base_url, key=key)
                            self._cloud_push_status(job_id, "done")
                        except Exception:
                            pass
                        self.signals.update_status.emit("__q_refresh__")
                    threading.Thread(target=_mark_done, daemon=True).start()

                poll.timeout.connect(_check)
                poll.start(100)
                return

            # \u2500\u2500 Single-pass: use auto-generated config that includes F feedrate \u2500
            def _single():
                try:
                    import subprocess as _sp
                    layer_cfg = tmp / "layer.cfg"
                    _z0 = self._pen_tip_delta(getattr(self.tools[0], 'pen_type', 'custom'))[2] if self.tools else 0.0
                    self._write_layer_vpype_config(str(layer_cfg), z_offset=_z0)
                    vpype_exe = str(pathlib.Path.home() / ".local/bin/vpype")
                    try:
                        simplify_tol = float(self.vpype_simplify_tol_edit.text())
                    except (ValueError, AttributeError):
                        simplify_tol = 0.1
                    _xy = self._pen_xy_delta(getattr(self.tools[0], 'pen_type', 'custom')) if self.tools else (0.0, 0.0)
                    _err_out = []
                    if not self._run_vpype_cmd(str(svg_path), str(layer_cfg), "pl0tb0t_layer", str(gcode_path),
                                               silent=True, _err_out=_err_out, xy_offset=_xy):
                        raise RuntimeError(_err_out[0] if _err_out else "vpype returned non-zero exit code")
                    if self.tools and gcode_path.exists():
                        tool = self.tools[0]
                        raw_lines = pathlib.Path(gcode_path).read_text(encoding='utf-8', errors='ignore').splitlines()
                        body = [ln for ln in raw_lines if ln.strip()]
                        wrapped = [
                            "; Pl0tb0t single-pass plot — auto tool pickup",
                            "G21 G90",
                            f"G53 G0 Z{tool.safe_z:.3f}",
                            f"G1 F{self.config.draw_speed}",
                        ]
                        wrapped.extend(self._tool_pickup_gcode(tool, from_drop=False))
                        _fxy = self._first_draw_xy(str(gcode_path))
                        if _fxy:
                            wrapped.append("; traverse X in the safe-Y lane first, then drop Y into the drawing")
                            wrapped.append(f"G0 X{_fxy[0]:.4f}")
                            wrapped.append(f"G0 Y{_fxy[1]:.4f}")
                        wrapped.extend(body)
                        wrapped.extend(self._tool_drop_gcode(tool, chain_next=False))
                        wrapped += [
                            "; === END ===",
                            f"G53 G0 Z{tool.safe_z:.3f}",
                            "G53 G0 X-300.000 Y-200.000",
                            "M2",
                        ]
                        pathlib.Path(gcode_path).write_text('\n'.join(wrapped) + '\n', encoding='utf-8')
                    if gcode_path.exists():
                        # _single() runs on this background thread -- can't show a
                        # QDialog here, so marshal the confirm+autorun-or-cancel
                        # decision onto the main thread via a signal (see
                        # _on_confirm_and_run_gcode).
                        self.signals.confirm_and_run_gcode.emit(
                            job_id, str(gcode_path), self._svg_page_mm(svg_path), base_url, key)
                    else:
                        self.signals.show_info.emit(
                            "Queue", f"vpype done but {gcode_path.name} is missing.")
                        try:
                            self._queue_http(f"/jobs/{job_id}/status",
                                             "PATCH", {"status": "error"},
                                             base_url=base_url, key=key)
                            self._cloud_push_status(job_id, "error")
                        except Exception:
                            pass
                except Exception as e:
                    try:
                        self._queue_http(f"/jobs/{job_id}/status",
                                         "PATCH", {"status": "error"},
                                         base_url=base_url, key=key)
                        self._cloud_push_status(job_id, "error")
                    except Exception:
                        pass
                    self.signals.show_error.emit("Queue Error", str(e))
                finally:
                    self.signals.update_status.emit("__q_refresh__")

            threading.Thread(target=_single, daemon=True).start()

        def run_vpype(self):
            svg_path    = self.vpype_svg_edit.text().strip()
            config_path = self.config.vpype_config.strip()
            profile     = self.config.vpype_profile.strip()
            output_path = self.vpype_output_edit.text().strip()

            if not svg_path:
                QMessageBox.critical(self, "Error", "Select an SVG file first"); return
            if not os.path.exists(svg_path):
                QMessageBox.critical(self, "Error", "SVG file not found"); return
            if not config_path:
                QMessageBox.critical(self, "Error",
                    "Set vpype config path in Machine Settings first"); return
            if not os.path.exists(config_path):
                QMessageBox.critical(self, "Error",
                    f"vpype config not found: {config_path}"); return
            if not output_path:
                output_path = os.path.splitext(svg_path)[0] + "_vpype.gcode"
                self.vpype_output_edit.setText(output_path)

            if self.vpype_toolchanges_cb.isChecked() and self._svg_layers:
                assignments = self._assign_layers_to_holder_slots(self._svg_layers)
                if assignments:
                    colors_exceed = len(assignments) < len(self._ordered_svg_layers_for_plot(self._svg_layers))
                    self._active_pen_map = self._read_js_pen_map()
                    if not self._confirm_pen_assignments(assignments, colors_exceed_slots=colors_exceed):
                        return
                    self._run_vpype_with_toolchanges(
                        svg_path, config_path, profile, output_path,
                        self._dedupe_assignments_by_color(assignments))
                    return
                else:
                    QMessageBox.warning(self, "No holder slots",
                        "Tool changes enabled but no holder slots are configured — "
                        "falling back to single-pass vpype.")

            prog = QProgressDialog("Generating G-code…", None, 0, 0, self)
            prog.setWindowTitle("pl0tb0t")
            prog.setWindowModality(Qt.WindowModality.ApplicationModal)
            prog.setMinimumDuration(0)
            prog.show()
            QApplication.processEvents()

            result = [False]
            err_out = []

            def _run():
                result[0] = self._run_vpype_cmd(
                    svg_path, config_path, profile, output_path,
                    silent=True, _err_out=err_out)

            t = threading.Thread(target=_run, daemon=True)
            t.start()

            poll = QTimer(self)

            def _check():
                if t.is_alive():
                    return
                poll.stop()
                prog.close()
                if not result[0]:
                    msg = err_out[0] if err_out else "vpype failed"
                    QMessageBox.critical(self, "vpype Error", msg)
                    return
                self.load_gcode_file(output_path, artboard_mm=self._svg_page_mm(svg_path))
                QMessageBox.information(self, "Success", f"G-code saved to {output_path}")

            poll.timeout.connect(_check)
            poll.start(100)

        # ------------------------------------------------------------------
        # G-code
        # ------------------------------------------------------------------

        def _svg_page_mm(self, svg_path: str):
            """Return SVG root page size in mm for visual preview context."""
            def _length_mm(raw):
                if raw is None:
                    return None
                m = re.match(r"^\s*([-+]?\d*\.?\d+)\s*([a-zA-Z%]*)\s*$", str(raw))
                if not m:
                    return None
                value = float(m.group(1))
                unit = (m.group(2) or "").lower()
                if unit == "mm":
                    return value
                if unit == "cm":
                    return value * 10.0
                if unit == "in":
                    return value * 25.4
                if unit == "pt":
                    return value * 25.4 / 72.0
                # Website sketches use 100 SVG units per inch.
                if unit in ("", "px"):
                    return value * 25.4 / 100.0
                return None

            try:
                root = ET.parse(svg_path).getroot()
                width = _length_mm(root.attrib.get("width"))
                height = _length_mm(root.attrib.get("height"))
                if width and height:
                    return (width, height)
                view_box = root.attrib.get("viewBox") or root.attrib.get("viewbox")
                if view_box:
                    parts = [float(p) for p in re.split(r"[\s,]+", view_box.strip()) if p]
                    if len(parts) == 4 and parts[2] > 0 and parts[3] > 0:
                        return (parts[2] * 25.4 / 100.0, parts[3] * 25.4 / 100.0)
            except Exception:
                pass
            return None

        def _clean_gcode_line(self, line: str) -> str:
            line = line.strip()
            if not line:
                return ""
            line = re.sub(r"\(.*?\)", "", line)
            if line.lstrip().startswith(";"):
                return ""
            if ";" in line:
                line = line.split(";", 1)[0]
            return line.strip().upper()

        def browse_gcode_file(self):
            path, _ = QFileDialog.getOpenFileName(
                self, "Open G-code", "",
                "G-code files (*.gcode *.gc *.nc *.tap);;All files (*)")
            if path:
                self.load_gcode_file(path)

        def load_gcode_file(self, file_path: str, artboard_mm=None):
            self.gcode_path = file_path
            self.gcode_entry.setText(file_path)
            self._load_gcode_lines(file_path)
            self._build_plot_layer_bounds(file_path)
            self.parse_gcode_for_preview(file_path, artboard_mm=artboard_mm)
            self.refresh_gcode_viewer()
            try:
                _gc_text = pathlib.Path(file_path).read_text(encoding="utf-8", errors="ignore")
                _est_s = _estimate_gcode_time(_gc_text,
                                              self.config.draw_speed,
                                              self.config.travel_speed)
                self._gcode_est_s = _est_s
                _est_str = _fmt_duration(_est_s) if _est_s > 0 else ""
                if _est_str:
                    self.gcode_run_btn.setText(f"\u25b6 Run  ·  {_est_str}")
                    self.gcode_status_label.setText(f"Loaded · est. {_est_str}")
                else:
                    self.gcode_run_btn.setText("\u25b6 Run")
            except Exception:
                pass

        def _build_plot_layer_bounds(self, file_path: str):
            # Map each "; --- Layer N: label (color) ---" marker to the number
            # of CLEANED (streamable) lines before it, so live progress can tell
            # which colour is currently drawing. Cleaned-line counting mirrors
            # exactly what run_gcode streams to the daemon.
            bounds = []
            clean_count = 0
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    for raw in f:
                        s = raw.strip()
                        if s.startswith(";"):
                            m = re.search(r"Layer \d+:\s*(.+?)\s*\((#[0-9a-fA-F]{6})\)", s)
                            if m:
                                lbl = m.group(1)
                                if " - " in lbl:
                                    lbl = lbl.split(" - ", 1)[1]
                                bounds.append((clean_count, m.group(2).lower(), lbl))
                            continue
                        if self._clean_gcode_line(raw):
                            clean_count += 1
            except Exception:
                bounds = []
            self._plot_layer_bounds = bounds

        def _current_plot_layer(self, sent: int):
            bounds = getattr(self, "_plot_layer_bounds", None)
            if not bounds:
                return None
            cur = None
            for i, (start, color, label) in enumerate(bounds):
                if start <= sent:
                    cur = (color, label, i + 1, len(bounds))
            return cur

        def _load_gcode_lines(self, file_path: str):
            self.gcode_lines = []
            self.gcode_line_index = 0
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    for raw in f:
                        clean = self._clean_gcode_line(raw)
                        if clean:
                            self.gcode_lines.append(clean)
            except Exception:
                self.gcode_lines = []

        def refresh_gcode_viewer(self):
            self.gcode_list.clear()
            if not self.gcode_lines:
                self.gcode_list.addItem("(no executable gcode lines)")
                return
            for i, line in enumerate(self.gcode_lines):
                self.gcode_list.addItem(f"{i+1:04d}: {line}")
            self._highlight_gcode_line()

        def _highlight_gcode_line(self):
            if not self.gcode_lines:
                return
            idx = min(self.gcode_line_index, len(self.gcode_lines) - 1)
            self.gcode_list.setCurrentRow(idx)
            self.gcode_list.scrollToItem(self.gcode_list.currentItem())

        def _highlight_gcode_line_at(self, idx):
            if not self.gcode_lines:
                return
            idx = min(idx, len(self.gcode_lines) - 1)
            self.gcode_line_index = idx
            self.gcode_list.setCurrentRow(idx)
            self.gcode_list.scrollToItem(self.gcode_list.currentItem())

        _GRBL_LOG_MAX = 500

        def _append_grbl_log(self, text):
            self.grbl_log_list.addItem(text)
            if self.grbl_log_list.count() > self._GRBL_LOG_MAX:
                self.grbl_log_list.takeItem(0)
            self.grbl_log_list.scrollToBottom()

        def reset_gcode_line_index(self):
            self.gcode_line_index = 0
            self._highlight_gcode_line()

        def send_selected_gcode_line(self):
            if self.gcode_running:
                QMessageBox.warning(self, "Warning", "Stop the current run first")
                return
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            idx = self.gcode_list.currentRow()
            if idx < 0 or idx >= len(self.gcode_lines):
                QMessageBox.warning(self, "Warning", "Select a line first")
                return
            try:
                result = self._daemon.send(self.gcode_lines[idx])
                if not result.get("ok"):
                    raise Exception(result.get("error", "Unknown error"))
                self.gcode_line_index = min(idx + 1, len(self.gcode_lines) - 1)
                self._highlight_gcode_line()
                self.gcode_status_label.setText(f"Sent line {idx+1}")
            except Exception as e:
                QMessageBox.critical(self, "G-code Error", str(e))

        def send_next_gcode_line(self):
            if self.gcode_running:
                QMessageBox.warning(self, "Warning", "Stop the current run first")
                return
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!")
                return
            if not self.gcode_lines:
                QMessageBox.warning(self, "Warning", "Load a G-code file first")
                return
            idx = min(self.gcode_line_index, len(self.gcode_lines) - 1)
            try:
                result = self._daemon.send(self.gcode_lines[idx])
                if not result.get("ok"):
                    raise Exception(result.get("error", "Unknown error"))
                self.gcode_line_index = min(idx + 1, len(self.gcode_lines) - 1)
                self._highlight_gcode_line()
                self.gcode_status_label.setText(f"Sent line {idx+1}")
            except Exception as e:
                QMessageBox.critical(self, "G-code Error", str(e))

        def parse_gcode_for_preview(self, file_path: str, artboard_mm=None):
            segments, bounds = [], None
            truncated = False
            max_seg = 250000
            x = y = 0.0
            abs_mode = True
            motion_mode = "G0"
            total_lines = 0
            current_color = "#222222"
            layer_colors = []   # [(hex, label), ...] ordered by first appearance

            def _register_color(hex_color, label):
                if not any(h == hex_color for h, _ in layer_colors):
                    layer_colors.append((hex_color, label))

            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    for raw in f:
                        raw_s = raw.strip()
                        # Parse artwork color hints from generated layer comments.
                        # Holder pickup/drop comments are machine instructions, not
                        # preview color channels.
                        if raw_s.startswith(";"):
                            m = re.search(r"Layer \d+:.*?\((#[0-9a-fA-F]{6})\)", raw_s)
                            if m:
                                current_color = m.group(1).lower()
                                label = re.search(r"Layer \d+:\s*(.+?)\s*\(", raw_s)
                                _register_color(current_color, label.group(1) if label else current_color)
                            continue

                        clean = self._clean_gcode_line(raw)
                        if not clean:
                            continue
                        if clean.startswith("G53"):
                            continue
                        total_lines += 1
                        words = re.findall(r"([A-Z])\s*([-+]?\d*\.?\d+)", clean)
                        if not words:
                            continue
                        g_codes = [int(float(v)) for l, v in words if l == "G"]
                        if 90 in g_codes: abs_mode = True
                        if 91 in g_codes: abs_mode = False
                        if 0 in g_codes:  motion_mode = "G0"
                        if 1 in g_codes:  motion_mode = "G1"
                        x_val = y_val = None
                        for letter, val in words:
                            if letter == "X": x_val = float(val)
                            elif letter == "Y": y_val = float(val)
                        if x_val is None and y_val is None:
                            continue
                        new_x = (x + x_val if not abs_mode else x_val) if x_val is not None else x
                        new_y = (y + y_val if not abs_mode else y_val) if y_val is not None else y
                        if new_x != x or new_y != y:
                            # Preview and bounds should represent drawing moves only.
                            # G0 travel/parking moves otherwise dominate the extents
                            # and can hide most plotted content in dense CMYK files.
                            if motion_mode == "G1":
                                if bounds is None:
                                    bounds = [x, y, x, y]
                                bounds[0] = min(bounds[0], x, new_x)
                                bounds[1] = min(bounds[1], y, new_y)
                                bounds[2] = max(bounds[2], x, new_x)
                                bounds[3] = max(bounds[3], y, new_y)
                                if len(segments) < max_seg:
                                    segments.append((x, y, new_x, new_y, motion_mode, current_color))
                                else:
                                    truncated = True
                            x, y = new_x, new_y

                self.gcode_segments = segments
                self.gcode_bounds = bounds
                self.gcode_preview_truncated = truncated
                self.gcode_total_lines = total_lines
                self._layer_colors = layer_colors
                self.preview_widget.set_data(segments, bounds, artboard=artboard_mm)
                self._rebuild_layer_toggles()

                if bounds:
                    w = bounds[2] - bounds[0]
                    h = bounds[3] - bounds[1]
                    extra = " (preview truncated)" if truncated else ""
                    page = ""
                    if artboard_mm:
                        page = f"  |  Artboard {artboard_mm[0]:.2f} x {artboard_mm[1]:.2f} mm"
                    self.gcode_status_label.setText(
                        f"Loaded: {Path(file_path).name}  |  Artwork {w:.2f} x {h:.2f} mm{page}{extra}")
                else:
                    self.gcode_status_label.setText(
                        f"Loaded: {Path(file_path).name}  |  No XY moves found")
            except Exception as e:
                self.gcode_segments = []
                self.gcode_bounds = None
                self.preview_widget.set_data([], None, artboard=None)
                self.gcode_status_label.setText(f"Failed to load: {e}")

        def run_gcode(self):
            _debug_log(f"run_gcode: port={self.port} path={self.gcode_path} running={self.gcode_running}")
            if not self.port:
                QMessageBox.critical(self, "Error", "Not connected!"); return
            if not self.gcode_path:
                QMessageBox.critical(self, "Error", "Load a G-code file first"); return
            if self.gcode_running:
                QMessageBox.warning(self, "Warning", "G-code already running"); return

            draw_pct = self.feed_override_slider.value()
            tc_pct   = self.tc_override_slider.value()
            if draw_pct != 100 or tc_pct != 100:
                msg = f"Feed overrides are not at 100%:\n  Draw: {draw_pct}%\n  TC:   {tc_pct}%\n\nReset to 100% before running?"
                reply = QMessageBox.question(self, "Override Active", msg,
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No |
                    QMessageBox.StandardButton.Cancel)
                if reply == QMessageBox.StandardButton.Cancel:
                    return
                if reply == QMessageBox.StandardButton.Yes:
                    self.feed_override_slider.setValue(100)
                    self.tc_override_slider.setValue(100)

            self.gcode_running = True
            self.gcode_paused = False
            self.gcode_stop = False
            self._queue_post_machine_status(True)
            self.gcode_sent_lines = 0
            self.gcode_progress.setValue(0)
            self.gcode_run_btn.setEnabled(False)
            self.gcode_pause_btn.setEnabled(True)
            self.gcode_pause_btn.setText("⏸ Pause")
            self.gcode_stop_btn.setEnabled(True)
            self._queue_rebuild_cards(list(getattr(self, "_queue_jobs_cache", {}).values()))

            def runner():
                try:
                    if self.gcode_home_first_cb.isChecked():
                        result = self._daemon.home()
                        if not result.get("ok"):
                            self.signals.show_error.emit("Home Error", result.get("error", "?"))
                            self.gcode_running = False
                            self.signals.gcode_done.emit()
                            return
                        time.sleep(0.5)
                    # Apply feed overrides into a temp file for the daemon to stream
                    import tempfile
                    with open(self.gcode_path, "r", encoding="utf-8", errors="ignore") as f_in:
                        raw_lines = f_in.readlines()
                    with tempfile.NamedTemporaryFile(
                            mode="w", suffix=".gcode", delete=False, encoding="utf-8") as f_tmp:
                        self._gcode_tmp_path = f_tmp.name
                        for raw in raw_lines:
                            line = self._clean_gcode_line(raw)
                            if not line:
                                continue
                            line = self._apply_feed_override(line)
                            f_tmp.write(line + "\n")
                    _debug_log(f"runner: streaming {self._gcode_tmp_path}")
                    result = self._daemon.stream(self._gcode_tmp_path, est_s=getattr(self, "_gcode_est_s", 0))
                    _debug_log(f"runner: stream result={result}")
                    if not result.get("ok"):
                        self.signals.show_error.emit("Stream Error", result.get("error", "?"))
                        self.gcode_running = False
                        self.gcode_paused = False
                        self.gcode_stop = False
                        self._queue_post_machine_status(False)
                        self.signals.gcode_done.emit()
                except Exception as e:
                    self.signals.show_error.emit("G-code Error", str(e))
                    self.gcode_running = False
                    self.gcode_paused = False
                    self.gcode_stop = False
                    self._queue_post_machine_status(False)
                    self.signals.gcode_done.emit()
                # If stream started OK, gcode_done fires from _on_daemon_gcode_done

            threading.Thread(target=runner, daemon=True).start()

        def _reset_gcode_buttons(self):
            self.gcode_run_btn.setEnabled(True)
            self.gcode_pause_btn.setEnabled(False)
            self.gcode_pause_btn.setText("⏸ Pause")
            self.gcode_stop_btn.setEnabled(False)
            if hasattr(self, "_queue_cards_vlay"):
                self._queue_rebuild_cards(list(getattr(self, "_queue_jobs_cache", {}).values()))

        def toggle_pause_gcode(self):
            if not self.gcode_running:
                return
            self.gcode_paused = not self.gcode_paused
            if self.gcode_paused:
                self._daemon.pause()
                self.gcode_pause_btn.setText("▶ Resume")
            else:
                self._daemon.resume()
                self.gcode_pause_btn.setText("⏸ Pause")

        def stop_gcode(self):
            self.gcode_stop = True
            self.gcode_paused = False
            self._daemon.stop()  # daemon sends feed-hold then soft-reset, fires gcode_done

        def _grbl_soft_reset(self):
            self._daemon.realtime(0x18)

        def _rebuild_layer_toggles(self):
            while self.layer_toggles_layout.count():
                child = self.layer_toggles_layout.takeAt(0)
                if child.widget():
                    child.widget().deleteLater()

            if len(self._layer_colors) < 2:
                self.layer_toggles_widget.hide()
                self.preview_widget.set_visible_colors(None)
                return

            self._visible_colors = {c for c, _ in self._layer_colors}
            self.layer_toggles_widget.show()

            for color, label in self._layer_colors:
                cb = QCheckBox(label)
                cb.setChecked(True)
                cb.setStyleSheet(
                    f"QCheckBox::indicator:checked {{"
                    f"  background: {color}; border: 2px solid #333; border-radius: 2px; }}"
                    f"QCheckBox::indicator:unchecked {{"
                    f"  background: #eee; border: 2px solid #aaa; border-radius: 2px; }}"
                )
                cb.toggled.connect(lambda checked, c=color: self._toggle_layer_color(c, checked))
                self.layer_toggles_layout.addWidget(cb)

            self.layer_toggles_layout.addStretch()
            self.preview_widget.set_visible_colors(None)

        def _toggle_layer_color(self, color, visible):
            if visible:
                self._visible_colors.add(color)
            else:
                self._visible_colors.discard(color)
            all_visible = len(self._visible_colors) == len(self._layer_colors)
            self.preview_widget.set_visible_colors(
                None if all_visible else set(self._visible_colors)
            )

        # ------------------------------------------------------------------
        # Test pen
        # ------------------------------------------------------------------

        def generate_testpen_gcode(self):
            try:
                pen_count    = int(self.testpen_count_edit.text())
                cycles       = int(self.testpen_cycles_edit.text())
                rapid        = int(self.testpen_rapid_edit.text())
                approach     = int(self.testpen_approach_edit.text())
                if self.testpen_quarter_speed_cb.isChecked():
                    rapid    = max(1, rapid // 4)
                    approach = max(1, approach // 4)
                overshoot    = float(self.testpen_overshoot_edit.text())
                unplug_offset = float(self.testpen_unplug_edit.text())
                lift_offset  = float(self.testpen_lift_edit.text())
            except Exception:
                QMessageBox.critical(self, "Error", "All fields must be numeric")
                return
            if pen_count < 1 or cycles < 1:
                QMessageBox.critical(self, "Error", "Pen count and cycles must be > 0")
                return
            self.tools = load_tools()
            if pen_count > len(self.tools):
                QMessageBox.critical(self, "Error",
                    f"Not enough tools defined (have {len(self.tools)})")
                return
            tools = self.tools[:pen_count]
            file_path, _ = QFileDialog.getSaveFileName(
                self, "Save Test G-code", "test_pen_cycle.gcode", "G-code files (*.gcode)")
            if not file_path:
                return

            lines = [
                f"; Test pen cycle: {pen_count} pens, {cycles} cycles, rapid {rapid}, "
                f"approach {approach}, overshoot {overshoot}",
                f"; Unplug offset: {unplug_offset}, lift offset: {lift_offset}",
                "G21 ; mm mode", "G90 ; absolute mode", "G17 ; XY plane",
            ]
            unplug_offset = abs(unplug_offset)
            prev_tool = None
            for c in range(cycles):
                for t in tools:
                    unplug_y = t.y + unplug_offset
                    undock_z = t.z + lift_offset
                    approach_step = min(10.0, unplug_offset)
                    if c == 0 and prev_tool is None:
                        lines.append(f"G53 G0 Z{t.safe_z:.2f} F{rapid}")
                        lines.append(f"G53 G0 X{t.x:.2f} Y{unplug_y:.2f} F{rapid}")
                        lines.append(f"G53 G1 Z{t.z:.2f} F{approach}")
                    else:
                        lines.append(f"G53 G0 X{t.x:.2f} Y{unplug_y:.2f} Z{t.z:.2f} F{rapid}")
                    if unplug_offset > approach_step:
                        lines.append(f"G53 G0 X{t.x:.2f} Y{t.y + approach_step:.2f} F{rapid}")
                    lines.append(f"G53 G1 X{t.x:.2f} Y{t.y:.2f} F{approach}")
                    if abs(undock_z - t.z) > 10.0:
                        lines.append(f"G53 G1 Z{t.z + 10.0:.2f} F{approach}")
                        lines.append(f"G53 G0 Z{undock_z:.2f} F{rapid}")
                    else:
                        lines.append(f"G53 G1 Z{undock_z:.2f} F{approach}")
                    lines.append(f"G3 X{t.x:.2f} Y{t.y:.2f} I0.00 J5.00 F{rapid}")
                    if abs(undock_z - t.z) > 10.0:
                        lines.append(f"G53 G0 Z{t.z + 10.0:.2f} F{rapid}")
                        lines.append(f"G53 G1 Z{t.z:.2f} F{approach}")
                    else:
                        lines.append(f"G53 G1 Z{t.z:.2f} F{approach}")
                    lines.append(f"G53 G1 X{t.x:.2f} Y{t.y:.2f} F{approach}")
                    lines.append(f"G53 G1 X{t.x:.2f} Y{t.y + approach_step:.2f} F{approach}")
                    if unplug_offset > approach_step:
                        lines.append(f"G53 G0 X{t.x:.2f} Y{unplug_y:.2f} F{rapid}")
                    else:
                        lines.append(f"G53 G1 X{t.x:.2f} Y{unplug_y:.2f} F{approach}")
                    prev_tool = t
            if tools:
                lines.append(f"G53 G0 Z{tools[-1].safe_z:.2f} F{rapid}")
            lines.append("M2")

            with open(file_path, "w") as f:
                f.write("\n".join(lines))
            self.load_gcode_file(file_path)
            QMessageBox.information(self, "Success",
                f"Test G-code saved to {file_path} ({len(lines)} lines)")

        # ------------------------------------------------------------------
        # Layout persistence
        # ------------------------------------------------------------------

        _LAYOUT_PATH = "pl0tb0t_layout_splitter_v4.json"

        def _save_layout(self):
            data = {
                "geometry": self.saveGeometry().toHex().data().decode(),
                "state":    self.saveState().toHex().data().decode(),
            }
            _save_json(self._LAYOUT_PATH, data)

        def _restore_layout(self):
            data = _load_json(self._LAYOUT_PATH, {})
            if "geometry" in data:
                from PyQt6.QtCore import QByteArray
                self.restoreGeometry(QByteArray.fromHex(data["geometry"].encode()))
            if "state" in data:
                from PyQt6.QtCore import QByteArray
                self.restoreState(QByteArray.fromHex(data["state"].encode()))

        # ------------------------------------------------------------------
        # Close
        # ------------------------------------------------------------------

        def closeEvent(self, event):
            self._save_layout()
            self._status_timer.stop()
            event.accept()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if not has_display:
        print("No display found. Running terminal mode instead...")
        import pl0tb0t_control
        try:
            controller = pl0tb0t_control.PlotterControl()
            controller.menu_main()
        except KeyboardInterrupt:
            print("\n\nInterrupted!")
            sys.exit(0)
    else:
        # Wayland's mouse-grab restriction breaks QDockWidget drag/float.
        # Prefer XWayland (xcb) when available; fall back to native Wayland if not.
        if "WAYLAND_DISPLAY" in os.environ and "QT_QPA_PLATFORM" not in os.environ:
            import ctypes.util
            if ctypes.util.find_library("xcb-cursor") is not None:
                os.environ["QT_QPA_PLATFORM"] = "xcb"
        app = QApplication(sys.argv)
        app.setStyle("Fusion")
        # Force Fusion's light palette so the UI stays consistent regardless of the
        # OS theme. On Windows 11 dark mode, Qt was tinting window/input backgrounds
        # dark while the light stylesheet kept text/boxes light -- a jarring mix.
        app.setPalette(app.style().standardPalette())
        app.setStyleSheet("""
            QPushButton {
                padding: 4px 10px;
                min-height: 22px;
                border: 1px solid #bbb;
                border-radius: 4px;
                background: #f7f7f7;
            }
            QPushButton:hover { background: #ececec; }
            QPushButton:pressed { background: #dcdcdc; }
            QPushButton:disabled { color: #999; background: #f0f0f0; }
            QLineEdit, QComboBox {
                padding: 3px 6px;
                min-height: 20px;
                border: 1px solid #bbb;
                border-radius: 4px;
            }
            QComboBox::drop-down { border: none; width: 18px; }
        """)
        window = PlotterApp()
        window.show()
        sys.exit(app.exec())


if __name__ == "__main__":
    main()
