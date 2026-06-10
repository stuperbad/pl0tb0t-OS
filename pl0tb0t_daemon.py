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
                lines, err = [], None
                deadline = time.time() + timeout
                while time.time() < deadline:
                    try:
                        resp = self._resp_q.get(timeout=0.5)
                    except queue.Empty:
                        continue
                    lines.append(resp)
                    rl = resp.lower()
                    if rl.startswith("ok"):
                        break
                    if rl.startswith("[msg:"):
                        # Informational message, ignore
                        continue
                    if rl.startswith("error") or rl.startswith("alarm"):
                        err = resp
                        break
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
            if self._ser and not self._cmd_lock.locked():
                try:
                    with self._write_lock:
                        self._ser.write(b"?")
                except Exception:
                    pass

    def _parse_status(self, s: str):
        try:
            parts = s[1:].rstrip(">").split("|")
            self._state = parts[0]
            for p in parts[1:]:
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
        except Exception:
            pass

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
            s = serial.Serial(port, baud, timeout=1.0, dsrdtr=False, rtscts=False)
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
        return {"ok": not bool(err), "response": "\n".join(resp_lines), "error": err}

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
        }

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
        total = len(lines)
        self._stream_pause.set()
        self._stream_stop.clear()
        self._streaming = True
        _log(f"Streaming {total} lines")

        RX_BUF = 120  # GRBL serial Rx buffer is 128 bytes; keep margin

        def _run():
            sent          = 0
            c_line        = []   # byte lengths of in-flight lines awaiting ok
            _last_progress = 0.0
            _last_status   = 0.0

            try:
                with self._cmd_lock:
                    # Drain any stale responses
                    while not self._resp_q.empty():
                        try: self._resp_q.get_nowait()
                        except: pass
                    self._capturing = True

                    line_idx = 0
                    err = None

                    while (line_idx < len(lines) or c_line) and err is None:
                        if self._stream_stop.is_set():
                            break

                        # Pause: drain in-flight oks then block until resumed
                        if not self._stream_pause.is_set():
                            while c_line:
                                try:
                                    r = self._resp_q.get(timeout=0.5)
                                except queue.Empty:
                                    if self._stream_stop.is_set():
                                        break
                                    continue
                                rl = r.lower()
                                if rl.startswith("ok"):
                                    del c_line[0]; sent += 1
                                elif rl.startswith(("error", "alarm")):
                                    del c_line[0]; sent += 1; err = r; break
                            if err or self._stream_stop.is_set():
                                break
                            self._stream_pause.wait()
                            continue

                        # Send: fill GRBL RX buffer with as many lines as fit
                        while line_idx < len(lines):
                            line = lines[line_idx]
                            lb = len(line.encode("utf-8")) + 1  # +1 for \n
                            if c_line and sum(c_line) + lb >= RX_BUF:
                                break
                            with self._write_lock:
                                self._ser.write((line + "\n").encode("utf-8"))
                            c_line.append(lb)
                            line_idx += 1

                        # Drain one ok (blocks until GRBL executes a command
                        # and frees a planner slot, keeping buffer always full)
                        if c_line:
                            while not self._stream_stop.is_set():
                                try:
                                    r = self._resp_q.get(timeout=0.1)
                                except queue.Empty:
                                    now = time.time()
                                    if now - _last_status >= 0.5:
                                        self._realtime(b"?")
                                        _last_status = now
                                    continue
                                rl = r.lower()
                                if rl.startswith("ok"):
                                    del c_line[0]; sent += 1
                                    break
                                elif rl.startswith(("error", "alarm")):
                                    _log(f"Stream error at {sent}: {r}")
                                    self._broadcast({"event": "gcode_error",
                                                     "line_num": sent, "line": "", "message": r})
                                    del c_line[0]; sent += 1; err = r
                                    break

                        now = time.time()
                        if now - _last_progress >= 0.25:
                            self._broadcast({"event": "progress", "sent": sent, "total": total})
                            _last_progress = now
                        if now - _last_status >= 0.5:
                            self._realtime(b"?")
                            _last_status = now

            except Exception as e:
                _log(f"Stream exception: {e}")
                self._broadcast({"event": "gcode_error",
                                 "line_num": 0, "line": "", "message": str(e)})
            finally:
                self._capturing = False
                self._streaming = False
                self._stream_stop.clear()
                self._stream_pause.set()
                _log("Stream done")
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
