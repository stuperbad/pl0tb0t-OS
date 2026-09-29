#!/usr/bin/env python3
"""
pl0tb0t_daemon.py — GRBL serial daemon
Holds the serial port so pl0tb0t_OS can restart freely.
Listens on TCP localhost:5002, speaks newline-delimited JSON.

Commands (UI → daemon):  {"cmd": "connect", "port": "/dev/ttyUSB0"} etc.
Events   (daemon → UI):  {"event": "status", ...}  pushed asynchronously.
"""

import sys, os, json, socket, threading, time, queue, signal

_BASE = os.path.dirname(os.path.abspath(__file__))
PID_FILE     = os.path.join(_BASE, "daemon.pid")
LOG_FILE     = os.path.join(_BASE, "daemon.log")
DAEMON_PORT  = 5002
GRBL_BAUD    = 115200
POLL_INTERVAL = 0.5

try:
    import serial
    from serial.tools import list_ports as _lp
    def _list_ports(): return [p.device for p in _lp.comports()]
except ImportError:
    serial = None
    def _list_ports(): return []

try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import pl0tb0t_probe as _probe
except Exception as _e:          # never let the probe module stop the daemon
    _probe = None


def _fmt_dur(s):
    s = int(s)
    if s < 60: return f"{s}s"
    m = s // 60
    if m < 60: return f"{m}min"
    return f"{m // 60}h {m % 60:02d}m"

def _log(msg):
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    try:
        print(line, flush=True)
    except (BrokenPipeError, OSError):
        pass
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


class GrblDaemon:

    def __init__(self):
        self._ser       = None
        self._ser_name  = None
        self._write_lock = threading.Lock()  # guards raw serial writes
        self._cmd_lock   = threading.Lock()  # one command at a time
        self._capturing  = False             # reader routes all lines into _resp_q
        self._resp_q     = queue.Queue()

        # Machine state
        self._state  = "Disconnected"
        self._homed  = False
        self._mx = self._my = self._mz = 0.0
        self._wx = self._wy = self._wz = 0.0
        self._wco = [0.0, 0.0, 0.0]
        self._wcs = "G54"
        self._pins = ""                      # GRBL "Pn:" field, e.g. "P" = probe
        self._status_evt = threading.Event()  # set on every <...> report
        self._probing = False
        self._probe_stop = threading.Event()   # Stop button aborts a manual probe

        # Clients: list of (socket, write_lock)
        self._clients      = []
        self._clients_lock = threading.Lock()

        # Streaming flags
        self._streaming     = False
        self._stream_pause  = threading.Event()
        self._stream_stop   = threading.Event()
        self._stream_pause.set()   # not paused initially

        self._running = True

    # ── Serial reader ──────────────────────────────────────────────────────

    def _reader_thread(self):
        """Read all GRBL output continuously and route each line."""
        buf = b""
        while self._running:
            if not self._ser:
                time.sleep(0.1)
                buf = b""
                continue
            try:
                data = self._ser.read(256)
            except Exception:
                time.sleep(0.05)
                continue
            if not data:
                continue
            buf += data
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                line = raw.decode("utf-8", errors="ignore").strip()
                if not line:
                    continue
                if line.startswith("<"):
                    # Status report — never goes into resp_q
                    self._parse_status(line)
                    self._broadcast_status()
                elif self._capturing:
                    # During a command: capture everything (handles $$ multi-line)
                    self._resp_q.put(line)
                elif line.lower().startswith(("ok", "error", "alarm")):
                    self._resp_q.put(line)
                else:
                    self._broadcast({"event": "grbl_log", "line": line})

    # ── GRBL send/receive ──────────────────────────────────────────────────

    def _grbl_send(self, line: str, wait_ok: bool = True, timeout: float = 30.0):
        """Send one line; return (response_lines_list, error_or_None)."""
        if not self._ser:
            return [], "not connected"
        with self._cmd_lock:
            # Drain stale queue
            while not self._resp_q.empty():
                try: self._resp_q.get_nowait()
                except: pass
            self._capturing = True
            try:
                with self._write_lock:
                    self._ser.write((line.strip() + "\n").encode("utf-8"))
                if not wait_ok:
                    return [], None
                lines, err, got_ok = [], None, False
                deadline = time.time() + timeout
                while time.time() < deadline:
                    try:
                        resp = self._resp_q.get(timeout=0.5)
                    except queue.Empty:
                        continue
                    lines.append(resp)
                    rl = resp.lower()
                    if rl.startswith("ok"):
                        got_ok = True
                        break
                    if rl.startswith("[msg:"):
                        # Informational message, ignore
                        continue
                    if rl.startswith("error"):
                        # Record error but keep waiting for ok (homing may have errors en route)
                        if not err:
                            err = resp
                        continue
                    if rl.startswith("alarm"):
                        err = resp
                        break
                # If we were waiting for ok but never got it, that's an error
                if wait_ok and not got_ok:
                    if not err:
                        err = "timeout: no response from controller"
                return lines, err
            finally:
                self._capturing = False

    def _realtime(self, data: bytes):
        """Write real-time byte(s) — bypass cmd_lock, bypass GRBL buffer."""
        if self._ser:
            try:
                self._ser.write(data)
                self._ser.flush()
            except Exception:
                pass

    # ── Status polling ─────────────────────────────────────────────────────

    def _poll_thread(self):
        while self._running:
            time.sleep(POLL_INTERVAL)
            # "?" is a GRBL real-time command: it is answered immediately with a
            # <...> status line and never consumes a planner slot, so it is safe
            # to send even mid-stream. The reader routes <...> to _parse_status
            # (never into the command response queue), so this can't corrupt a
            # command in flight. Sending it unconditionally (not gated on the
            # cmd lock) is what keeps the DRO / machine position live WHILE a
            # plot is streaming, instead of freezing until the stream ends.
            if self._ser:
                try:
                    with self._write_lock:
                        self._ser.write(b"?")
                except Exception:
                    pass

    def _parse_status(self, s: str):
        try:
            parts = s[1:].rstrip(">").split("|")
            self._state = parts[0]
            pins = ""
            for p in parts[1:]:
                if p.startswith("Pn:"):
                    pins = p[3:]
                if p.startswith("MPos:"):
                    xyz = p[5:].split(",")
                    self._mx, self._my, self._mz = float(xyz[0]), float(xyz[1]), float(xyz[2])
                    self._wx = self._mx - self._wco[0]
                    self._wy = self._my - self._wco[1]
                    self._wz = self._mz - self._wco[2]
                elif p.startswith("WPos:"):
                    xyz = p[5:].split(",")
                    self._wx, self._wy, self._wz = float(xyz[0]), float(xyz[1]), float(xyz[2])
                elif p.startswith("WCO:"):
                    self._wco = [float(x) for x in p[4:].split(",")]
            self._pins = pins      # GRBL omits Pn entirely when nothing is active
        except Exception:
            pass
        self._status_evt.set()

    # ── Broadcast ──────────────────────────────────────────────────────────

    def _broadcast(self, event: dict):
        msg = (json.dumps(event) + "\n").encode("utf-8")
        dead = []
        with self._clients_lock:
            for entry in list(self._clients):
                sock, lock = entry
                try:
                    with lock:
                        sock.sendall(msg)
                except Exception:
                    dead.append(entry)
            for d in dead:
                try: self._clients.remove(d)
                except: pass

    def _broadcast_status(self):
        self._broadcast({
            "event":     "status",
            "connected": self._ser is not None,
            "port":      self._ser_name,
            "state":     self._state,
            "homed":     self._homed,
            "streaming": self._streaming,
            "mx": self._mx, "my": self._my, "mz": self._mz,
            "wx": self._wx, "wy": self._wy, "wz": self._wz,
            "wco":       self._wco,
            "wcs":       self._wcs,
            "pins":      self._pins,
            "probing":   self._probing,
        })

    # ── Command handlers ───────────────────────────────────────────────────

    def _h_ports(self, _):
        return {"ok": True, "ports": _list_ports()}

    def _h_connect(self, data):
        if serial is None:
            return {"ok": False, "error": "pyserial not installed"}
        port = data.get("port", "")
        baud = int(data.get("baud", GRBL_BAUD))
        if not port:
            return {"ok": False, "error": "port required"}
        try:
            if self._ser:
                self._ser.close()
            s = serial.Serial(port, baud, timeout=0.001, dsrdtr=False, rtscts=False)
            time.sleep(2)
            s.flushInput()
            self._ser = s
            self._ser_name = port
            self._state = "Connected"
            _log(f"Connected to {port} @ {baud}")
            self._broadcast_status()
            return {"ok": True, "port": port}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _h_disconnect(self, _):
        if self._ser:
            try: self._ser.close()
            except: pass
            self._ser = None
            self._ser_name = None
            self._state = "Disconnected"
            self._homed = False
            _log("Serial disconnected")
            self._broadcast({"event": "disconnected"})
            self._broadcast_status()  # Update UI with new state
        return {"ok": True}

    def _h_send(self, data):
        line = data.get("line", "").strip()
        if not line:
            return {"ok": False, "error": "empty line"}
        resp_lines, err = self._grbl_send(line, wait_ok=data.get("wait", True))
        resp = "\n".join(resp_lines)
        if err:
            return {"ok": False, "error": err, "response": resp, "lines": resp_lines}
        return {"ok": True, "response": resp, "lines": resp_lines}

    def _h_realtime(self, data):
        bval = data.get("byte")
        if bval is None:
            return {"ok": False, "error": "byte required"}
        self._realtime(bytes([bval]))
        return {"ok": True}

    def _h_home(self, _):
        _log("Homing...")
        resp_lines, err = self._grbl_send("$H", wait_ok=True, timeout=120.0)
        if not err:
            self._homed = True
            _log("Homing complete")
            self._broadcast_status()
            return {"ok": True, "response": "\n".join(resp_lines)}
        else:
            _log(f"Homing failed: {err}")
            return {"ok": False, "error": err, "response": "\n".join(resp_lines)}

    def _h_status(self, _):
        return {
            "ok": True,
            "connected": self._ser is not None,
            "port":      self._ser_name,
            "state":     self._state,
            "homed":     self._homed,
            "streaming": self._streaming,
            "mx": self._mx, "my": self._my, "mz": self._mz,
            "wx": self._wx, "wy": self._wy, "wz": self._wz,
            "wco":       self._wco,
            "wcs":       self._wcs,
            "pins":      self._pins,
        }

    # ── Pen probing ────────────────────────────────────────────────────────

    def _fresh_status(self, timeout=1.5):
        """Ask for a status report and wait for it (the poller is only 2 Hz)."""
        self._status_evt.clear()
        self._realtime(b"?")
        self._status_evt.wait(timeout)

    def _wait_idle(self, timeout=180.0):
        """Let everything already sent finish moving. G4 P0 makes GRBL drain
        its planner before it answers ok; then confirm Idle from a status."""
        _, err = self._grbl_send("G4 P0.01", wait_ok=True, timeout=timeout)
        if err:
            raise RuntimeError(f"waiting for motion to finish: {err}")
        t_end = time.time() + 10.0
        while time.time() < t_end:
            self._fresh_status()
            if self._state.startswith("Idle"):
                return
            time.sleep(0.1)
        raise RuntimeError(f"machine not idle before probing (state {self._state})")

    def _probe_pen(self, cfg, pred=(0.0, 0.0, 0.0), stop_evt=None, return_home=True):
        """Measure the loaded pen. Returns (measured_xyz, info). Raises on failure."""
        if _probe is None:
            raise RuntimeError("pl0tb0t_probe.py missing next to the daemon")
        self._wait_idle()
        self._fresh_status()
        if "P" in (self._pins or ""):
            raise _probe.ProbeError("probe input reads TRIGGERED before moving -- "
                                    "check wiring and $6 (NC probe needs $6=1)")
        start = (self._mx, self._my, self._mz)

        def _send(line, timeout=90.0):
            return self._grbl_send(line, wait_ok=True, timeout=timeout)

        def _say(msg):
            _log(msg)
            self._broadcast({"event": "probe", "kind": "log", "message": msg})

        pr = _probe.Prober(_send, cfg, log=_say, stop_evt=stop_evt)
        self._probing = True
        try:
            meas, info = pr.measure(tuple(pred or (0.0, 0.0, 0.0)))
            if return_home:
                pr.go_back(start)
            return meas, info
        except Exception:
            # leave the pen up and clear of the stylus whatever happened
            try:
                self._grbl_send("G90", wait_ok=True, timeout=5.0)
                self._grbl_send(f"G53 G1 Z{float(cfg.get('travel_z', -5.0)):.4f} "
                                f"F{int(cfg.get('travel_feed', 800))}", wait_ok=True, timeout=60.0)
            except Exception:
                pass
            raise
        finally:
            self._probing = False

    def _h_probe(self, data):
        """Manual probe from the UI (test / set reference). Runs in the
        background so Stop and status keep working; the result comes back as
        a {"event": "probe", "kind": "manual", ...} broadcast carrying `tag`."""
        if self._streaming:
            return {"ok": False, "error": "busy streaming"}
        if self._probing:
            return {"ok": False, "error": "already probing"}
        if not self._ser:
            return {"ok": False, "error": "not connected"}
        cfg = data.get("cfg") or {}
        tag = data.get("tag") or {}
        self._probe_stop.clear()

        def _run():
            out = {"event": "probe", "kind": "manual", "tag": tag}
            try:
                meas, info = self._probe_pen(cfg, data.get("pred") or (0.0, 0.0, 0.0),
                                             stop_evt=self._probe_stop,
                                             return_home=bool(data.get("return", False)))
                out.update({"ok": True, "measured": list(meas), "info": info})
                if cfg.get("ref"):
                    try:
                        out["correction"] = list(_probe.correction_from(meas, cfg, data.get("type", "")))
                    except Exception as e:
                        out["correction_error"] = str(e)
                _log(f"Probe: {meas}")
            except Exception as e:
                _log(f"Probe failed: {e}")
                out.update({"ok": False, "error": str(e)})
            finally:
                self._probing = False
            self._broadcast(out)

        self._probing = True     # claim it before the thread starts
        threading.Thread(target=_run, daemon=True).start()
        return {"ok": True, "started": True}

    def _stream_directive(self, d, xf, probe_cfg):
        """Handle one @PL0T directive mid-stream. Returns an error string to
        stop the stream, or None to carry on."""
        op = d.get("op")
        if op == "clear":
            xf.clear()
            return None
        if op != "pen":
            return f"unknown stream directive: {d}"
        tool = d.get("tool", "?")
        ptype = d.get("type", "")
        pred = [float(v) for v in (d.get("pred") or [0.0, 0.0, 0.0])][:3]
        off, source = pred, "predicted"
        if probe_cfg and probe_cfg.get("enabled"):
            try:
                if not probe_cfg.get("ref"):
                    raise _probe.ProbeError("no probe reference set -- use Pen Probe > "
                                            "Set reference with the zero pen first")
                self._broadcast({"event": "probe", "kind": "start", "tool": tool, "type": ptype})
                meas, info = self._probe_pen(probe_cfg, pred, stop_evt=self._stream_stop)
                off = list(_probe.correction_from(meas, probe_cfg, ptype))
                source = "probed"
                self._broadcast({"event": "probe", "kind": "result", "tool": tool, "type": ptype,
                                 "measured": list(meas), "correction": off,
                                 "predicted": pred, "info": info})
            except Exception as e:
                if self._stream_stop.is_set():
                    return "stopped"
                msg = f"probe failed for {tool} ({ptype}): {e}"
                _log(msg)
                if str(probe_cfg.get("on_fail", "stop")) != "predicted":
                    return msg
                self._broadcast({"event": "probe", "kind": "warn", "tool": tool,
                                 "message": msg + " -- using predicted offsets"})
                off, source = pred, "predicted (probe failed)"
            if xf.last_f:
                self._grbl_send(f"F{xf.last_f:g}", wait_ok=True)   # G38 changed modal feed
        xf.set(*off)
        _log(f"Pen {tool} ({ptype}): offset {off[0]:+.3f} {off[1]:+.3f} {off[2]:+.3f} [{source}]")
        self._broadcast({"event": "probe", "kind": "offset", "tool": tool, "type": ptype,
                         "offset": off, "source": source})
        return None

    def _h_stream(self, data):
        path = data.get("path", "")
        if not path or not os.path.exists(path):
            return {"ok": False, "error": f"file not found: {path}"}
        if self._streaming:
            return {"ok": False, "error": "already streaming"}
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                lines = [l.strip() for l in f if l.strip() and not l.strip().startswith(";")]
        except Exception as e:
            return {"ok": False, "error": str(e)}
        is_dir = (lambda l: _probe is not None and l.startswith(_probe.DIRECTIVE_PREFIX))
        if _probe is None and any(l.startswith("@PL0T") for l in lines):
            return {"ok": False, "error": "file has live-offset directives but pl0tb0t_probe.py is missing"}
        probe_cfg = data.get("probe") or None
        total = sum(1 for l in lines if not is_dir(l))
        self._stream_pause.set()
        self._stream_stop.clear()
        self._streaming = True
        _est_s = float(data.get("est_s", 0))
        _est_tag = f" (est ~{_fmt_dur(_est_s)})" if _est_s > 0 else ""
        _log(f"Streaming {total} lines{_est_tag}")
        _stream_t0 = time.time()

        def _run():
            sent = 0
            xf = _probe.OffsetTransformer() if _probe is not None else None
            try:
                _last_progress = time.time()
                for line in lines:
                    if self._stream_stop.is_set():
                        break
                    self._stream_pause.wait()
                    if self._stream_stop.is_set():
                        break
                    if is_dir(line):
                        d = _probe.parse_directive(line)
                        derr = self._stream_directive(d, xf, probe_cfg)
                        if derr:
                            if derr != "stopped":
                                self._broadcast({"event": "gcode_error", "line_num": sent,
                                                 "line": line, "message": derr})
                            break
                        continue
                    if xf is not None:
                        line = xf.apply(line)
                    resp_lines, err = self._grbl_send(line, wait_ok=True)
                    # Do NOT broadcast grbl_line per move — sendall() blocks when the
                    # UI socket buffer fills, stalling the GRBL planner between lines.
                    if err:
                        _log(f"Stream error at line {sent}: {err}")
                        self._broadcast({"event": "gcode_error",
                                         "line_num": sent, "line": line, "message": err})
                        break
                    sent += 1
                    now = time.time()
                    if now - _last_progress >= 0.25:   # throttle progress to ~4 Hz
                        self._broadcast({"event": "progress", "sent": sent, "total": total})
                        _last_progress = now
            except Exception as e:
                _log(f"Stream exception: {e}")
                self._broadcast({"event": "gcode_error",
                                 "line_num": 0, "line": "", "message": str(e)})
            finally:
                self._streaming = False
                self._stream_stop.clear()
                self._stream_pause.set()
                _elapsed = time.time() - _stream_t0
                _est_tag = f" (est was ~{_fmt_dur(_est_s)})" if _est_s > 0 else ""
                _log(f"Stream done in {_fmt_dur(_elapsed)}{_est_tag}")
                self._broadcast({"event": "progress", "sent": sent, "total": total})
                self._broadcast({"event": "gcode_done"})

        threading.Thread(target=_run, daemon=True).start()
        return {"ok": True, "total": total}

    def _h_pause(self, _):
        self._stream_pause.clear()
        self._realtime(b"!")
        return {"ok": True}

    def _h_resume(self, _):
        self._stream_pause.set()
        self._realtime(b"~")
        return {"ok": True}

    def _h_stop(self, _):
        self._probe_stop.set()
        self._stream_stop.set()
        self._stream_pause.set()   # unblock wait so thread can see stop
        self._realtime(b"!")
        def _reset():
            time.sleep(0.35)
            self._realtime(b"\x18")
        threading.Thread(target=_reset, daemon=True).start()
        return {"ok": True}

    def _h_ping(self, _):
        return {"ok": True, "pong": True,
                "daemon_port": DAEMON_PORT,
                "connected": self._ser is not None,
                "streaming": self._streaming}

    def _h_shutdown(self, _):
        _log("Shutdown requested by UI")
        self._running = False
        # Close all client sockets so their _handle_client threads unblock from recv()
        with self._clients_lock:
            for sock, lock in list(self._clients):
                try: sock.close()
                except Exception: pass
        return {"ok": True}

    _HANDLERS = {
        "ports":      _h_ports,
        "connect":    _h_connect,
        "disconnect": _h_disconnect,
        "send":       _h_send,
        "realtime":   _h_realtime,
        "home":       _h_home,
        "status":     _h_status,
        "stream":     _h_stream,
        "pause":      _h_pause,
        "resume":     _h_resume,
        "stop":       _h_stop,
        "probe":      _h_probe,
        "ping":       _h_ping,
        "shutdown":   _h_shutdown,
    }

    # ── Client connection handler ──────────────────────────────────────────

    def _handle_client(self, conn, addr):
        write_lock = threading.Lock()
        entry = (conn, write_lock)
        with self._clients_lock:
            self._clients.append(entry)
        try:
            _log(f"UI connected from {addr}")

            def _send(obj):
                try:
                    with write_lock:
                        conn.sendall((json.dumps(obj) + "\n").encode("utf-8"))
                except Exception:
                    pass

            _send(self._h_status({}))   # greet with full state

            buf = b""
            while self._running:
                try:
                    chunk = conn.recv(4096)
                except Exception:
                    break
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    raw, buf = buf.split(b"\n", 1)
                    line = raw.decode("utf-8", errors="ignore").strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                    except Exception:
                        _send({"ok": False, "error": "invalid JSON"})
                        continue
                    cmd = data.get("cmd", "")
                    handler = self._HANDLERS.get(cmd)
                    if handler:
                        try:
                            result = handler(self, data)
                            if result is not None:
                                _send(result)
                        except Exception as e:
                            _send({"ok": False, "error": str(e)})
                    else:
                        _send({"ok": False, "error": f"unknown cmd: {cmd}"})
        finally:
            with self._clients_lock:
                try: self._clients.remove(entry)
                except: pass
            try: conn.close()
            except: pass
            _log(f"UI disconnected from {addr}")

    # ── Main ───────────────────────────────────────────────────────────────

    def run(self):
        try:
            with open(PID_FILE, "w") as f:
                f.write(str(os.getpid()))
        except Exception:
            pass

        threading.Thread(target=self._reader_thread, daemon=True).start()
        threading.Thread(target=self._poll_thread,   daemon=True).start()

        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("127.0.0.1", DAEMON_PORT))
        srv.listen(5)
        srv.settimeout(1.0)
        _log(f"Pl0tb0t GRBL Daemon  port={DAEMON_PORT}  pid={os.getpid()}")
        _log(f"Log: {LOG_FILE}")

        try:
            while self._running:
                try:
                    conn, addr = srv.accept()
                    threading.Thread(target=self._handle_client,
                                     args=(conn, addr), daemon=True).start()
                except socket.timeout:
                    continue
        finally:
            srv.close()
            if self._ser:
                try: self._ser.close()
                except: pass
            try: os.remove(PID_FILE)
            except: pass
            _log("Daemon stopped")


if __name__ == "__main__":
    daemon = GrblDaemon()
    signal.signal(signal.SIGTERM, lambda *_: setattr(daemon, "_running", False))
    try:
        daemon.run()
    except KeyboardInterrupt:
        daemon._running = False
