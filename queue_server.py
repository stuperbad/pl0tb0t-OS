#!/usr/bin/env python3
"""
Pl0tb0t Queue Server
A lightweight Flask API for the SVG print queue.
Jobs stored in SQLite; SVG files on disk in ./queue_svgs/

Usage:
    python3 queue_server.py
    QUEUE_API_KEY=mysecret python3 queue_server.py
"""

__version__ = "0.1.06"

import os, sqlite3, uuid, time, json, threading, random, subprocess, tempfile, math, re
from pathlib import Path

# ── Word-pair job IDs ─────────────────────────────────────────────────────────
_ADJ = [
    "amber","ashen","azure","blaze","briar","bronze","cedar","chalk","cobalt",
    "coral","crimson","dusk","ember","fern","flint","frost","gilt","hazy",
    "hollow","indigo","ivory","jade","lunar","mossy","murky","ochre","onyx",
    "opal","pallid","pewter","prism","rose","ruddy","rust","sage","scarlet",
    "shadow","silver","slate","smoky","solar","stark","stormy","swept","tawny",
    "umber","verdant","violet",
]
_NOUN = [
    "arc","ash","atlas","bloom","bone","chord","cloud","coil","crest","curve",
    "delta","dune","echo","field","fold","forge","glyph","grain","grid","grove",
    "helix","ink","iris","knot","lace","leaf","loop","mist","node","orbit",
    "peak","pine","pulse","quill","reed","ring","root","rune","shard","shore",
    "silk","smoke","spark","spire","stone","tide","trace","veil","vine","void",
    "wave","web","wind",
]

def _gen_job_id(db):
    for _ in range(30):
        candidate = random.choice(_ADJ) + "-" + random.choice(_NOUN)
        if not db.execute("SELECT 1 FROM jobs WHERE id=?", (candidate,)).fetchone():
            return candidate
    return str(uuid.uuid4())[:8]  # fallback
from flask import Flask, request, jsonify, send_file, abort, send_from_directory

BASE_DIR  = Path(__file__).parent
QUEUE_DIR = BASE_DIR / "queue_svgs"
MAKE_DIR  = BASE_DIR / "make_local"        # the studio UI (same files the desktop Make tab loads)
DB_PATH   = BASE_DIR / "queue.db"
API_KEY   = os.environ.get("QUEUE_API_KEY", "pl0tb0t-secret")
PORT      = int(os.environ.get("QUEUE_PORT", "5001"))

QUEUE_DIR.mkdir(exist_ok=True)

# ── Refine-estimate helpers ───────────────────────────────────────────────────
_refine_cache: dict = {}   # token → gcode_text

def _estimate_gcode_time(gcode_text: str, draw_speed_mmpm: float,
                          travel_speed_mmpm: float) -> float:
    """Estimate plot time in seconds by replaying G-code feed rates."""
    cur_f   = float(draw_speed_mmpm)
    rapid_f = float(max(travel_speed_mmpm, 100))
    total_s = 0.0
    px, py  = 0.0, 0.0
    for raw in gcode_text.splitlines():
        line = raw.strip()
        if not line or line.startswith(";"): continue
        upper = line.upper()
        fm = re.search(r'F([\d.]+)', upper)
        if fm: cur_f = float(fm.group(1))
        xm = re.search(r'X([\d.+-]+)', upper)
        ym = re.search(r'Y([\d.+-]+)', upper)
        nx = float(xm.group(1)) if xm else px
        ny = float(ym.group(1)) if ym else py
        dist = math.hypot(nx - px, ny - py)
        if upper.startswith("G0"):
            total_s += dist / max(rapid_f, 1) * 60.0
        elif upper.startswith("G1"):
            total_s += dist / max(cur_f, 1) * 60.0
        if xm or ym: px, py = nx, ny
    return total_s


app = Flask(__name__)

# ── In-memory machine state ───────────────────────────────────────────────────
_state_lock    = threading.Lock()
_machine_state = {"busy": False, "current_job_id": None, "plot_requested": None, "updated_at": 0.0}

# ── Mobile UI template ────────────────────────────────────────────────────────
_MOBILE_HTML = """\
<!DOCTYPE html><html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>Pl0tb0t Queue</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f0f0f;color:#eee;font-family:-apple-system,BlinkMacSystemFont,sans-serif;min-height:100vh}
#bar{position:sticky;top:0;z-index:10;background:#1a1a1a;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #2a2a2a}
#bar h1{font-size:13px;color:#666;font-weight:400;letter-spacing:.06em;text-transform:uppercase}
#badge{font-size:13px;font-weight:700;padding:4px 12px;border-radius:99px;margin-top:4px;display:inline-block}
.b-idle{background:#1a3a1a;color:#4caf50}
.b-busy{background:#3a2a00;color:#ff9800}
.b-req{background:#1a2a4a;color:#64b5f6}
#rfbtn{background:none;border:1px solid #333;color:#888;padding:6px 12px;border-radius:8px;font-size:13px;cursor:pointer;flex-shrink:0}
#list{padding:12px;display:flex;flex-direction:column;gap:10px}
.card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;overflow:hidden}
.card.plotting{border-color:#ff9800}.card.done{border-color:#1a3a1a;opacity:.6}.card.error{border-color:#4a1a1a}.card.plot_requested{border-color:#2a3a6a}
.old-sum{list-style:none;cursor:pointer;padding:14px 4px;color:#555;font-size:13px;font-weight:700;letter-spacing:.04em}
.old-sum::-webkit-details-marker{display:none}
.old-wrap{display:flex;flex-direction:column;gap:10px;margin-top:4px;opacity:.65}
.thumb{width:100%;height:160px;background:#111;display:flex;align-items:center;justify-content:center;overflow:hidden}
.thumb img{max-width:100%;max-height:160px;object-fit:contain}
.thumb-empty{color:#333;font-size:28px}
.body{padding:12px}
.name{font-size:15px;font-weight:700;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{font-size:12px;color:#666;margin-bottom:8px}
.stag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;margin-bottom:10px}
.s-queued{background:#222;color:#888}.s-plotting{background:#3a2000;color:#ff9800}.s-done{background:#1a3a1a;color:#4c9}.s-error{background:#3a1a1a;color:#f44}.s-plot_requested{background:#1a2a4a;color:#64b5f6}
.acts{display:flex;gap:8px}
.bplot{flex:1;background:#fff;color:#000;border:none;padding:11px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer}
.bplot:disabled{background:#222;color:#555;cursor:default}
.bplot.req{background:#1a2a4a;color:#64b5f6}
.bdel{background:none;border:1px solid #3a1a1a;color:#f44;padding:11px 14px;border-radius:8px;font-size:14px;cursor:pointer}
#empty{text-align:center;color:#333;padding:60px 20px;font-size:16px}
</style>
</head>
<body>
<div id="bar">
  <div><div id="bar-title">PL0TB0T</div><span id="badge" class="b-idle">&#9679; Idle</span></div>
  <button id="rfbtn" onclick="load()">&#8635;</button>
</div>
<div id="list"><div id="empty">Loading&#8230;</div></div>
<details style="margin:16px;color:#555;font-size:12px;border:1px solid #2a2a2a;border-radius:8px;padding:10px 14px;">
  <summary style="cursor:pointer;color:#666;font-weight:700;list-style:none;">&#9432; How it works</summary>
  <div style="margin-top:10px;line-height:1.7;color:#888;">
    <p style="margin-bottom:8px;"><strong style="color:#aaa;">Making a piece</strong><br>
    Use the touchscreen on the machine to pick a sketch, tweak the parameters, and tap <em>&#8594; Plot</em>. The piece goes into the queue.</p>
    <p style="margin-bottom:8px;"><strong style="color:#aaa;">Remote plot request</strong><br>
    Tap <em>&#9654; Plot Now</em> on any queued job here. The operator at the machine sees a confirmation prompt and approves before anything moves. You&#8217;ll see the status change to <em>plotting</em> once it starts.</p>
    <p style="margin-bottom:8px;"><strong style="color:#aaa;">Machine status</strong><br>
    The badge at the top shows <em>Idle</em> when the plotter is free, <em>Plotting</em> when it&#8217;s running, and <em>Plot requested</em> when you&#8217;ve tapped Plot Now and the operator hasn&#8217;t confirmed yet.</p>
    <p style="margin-bottom:0;"><strong style="color:#aaa;">Queue order</strong><br>
    Jobs print one at a time. Use <em>&#10005;</em> to remove a job if you change your mind.</p>
  </div>
</details>
<script>
var KEY='__API_KEY__', reqId=null;
function hdr(){return{'X-API-Key':KEY,'Content-Type':'application/json'};}
function load(){
  fetch('/status').then(function(r){return r.json();}).then(upSt).catch(function(){});
  fetch('/jobs?api_key='+KEY).then(function(r){
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.json();
  }).then(render).catch(function(e){
    var l=document.getElementById('list');
    l.innerHTML='<div id=empty style="color:#f66;font-size:13px;padding:30px">Could not load jobs: '+e.message+'<br><small>Server: '+window.location.host+'</small></div>';
  });
}
function upSt(s){
  reqId=s.plot_requested;
  var b=document.getElementById('badge');
  if(s.busy){b.className='b-busy';b.textContent='\\u25cf Plotting';}
  else if(s.plot_requested){b.className='b-req';b.textContent='\\u23f3 Plot requested';}
  else{b.className='b-idle';b.textContent='\\u25cf Idle';}
}
function mkCard(j){
  var isQ=j.status==='queued',isR=reqId===j.id;
  var age=j.created_at?new Date(j.created_at*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';
  var c=document.createElement('div');
  c.className='card '+(j.status||'');
  c.innerHTML='<div class=thumb><img src="/jobs/'+j.id+'/svg?api_key='+KEY+'" onerror="this.outerHTML=\'<span class=thumb-empty>&#8767;</span>\'" alt=""></div>'
    +'<div class=body>'
      +'<div class=name>'+(j.sketch_name||'Untitled')+'</div>'
      +'<div class=meta>'+(j.paper_size||'')+(age?' &middot; '+age:'')+'</div>'
      +'<span class="stag s-'+(j.status||'queued')+'">'+(j.status||'queued')+'</span>'
      +'<div class=acts>'
        +(isQ?'<button class="bplot'+(isR?' req':'')+'" onclick="reqPlot(\\\''+j.id+'\\\',this)">'+(isR?'&#9203; Waiting&hellip;':'&#9654; Plot Now')+'</button>':'')
        +(isQ?'<button class=bdel onclick="del(\\\''+j.id+'\\\',this)">&#10005;</button>':'')
      +'</div>'
    +'</div>';
  return c;
}
function render(jobs){
  var l=document.getElementById('list');
  if(!jobs||!jobs.length){l.innerHTML='<div id=empty>Queue is empty.</div>';return;}
  l.innerHTML='';
  var now=Date.now()/1000;
  var recent=jobs.filter(function(j){return now-(j.created_at||0)<86400;});
  var old=jobs.filter(function(j){return now-(j.created_at||0)>=86400;});
  var show=recent.length?recent:jobs;
  show.forEach(function(j){l.appendChild(mkCard(j));});
  if(old.length&&recent.length){
    var det=document.createElement('details');det.open=true;
    var sum=document.createElement('summary');
    sum.className='old-sum';sum.textContent='Old ('+old.length+')';
    det.appendChild(sum);
    var wrap=document.createElement('div');
    wrap.className='old-wrap';
    old.forEach(function(j){wrap.appendChild(mkCard(j));});
    det.appendChild(wrap);
    l.appendChild(det);
  }
}
function reqPlot(id,btn){
  btn.disabled=true;btn.textContent='Requesting\\u2026';
  fetch('/jobs/'+id+'/plot-request',{method:'POST',headers:hdr()})
    .then(function(r){return r.json();})
    .then(function(){btn.className='bplot req';btn.textContent='\\u23f3 Waiting for operator\\u2026';setTimeout(load,1000);})
    .catch(function(e){btn.disabled=false;btn.textContent='\\u25b6 Plot Now';alert('Error: '+e.message);});
}
function del(id,btn){
  if(!confirm('Delete this job?'))return;
  fetch('/jobs/'+id,{method:'DELETE',headers:hdr()}).then(function(){setTimeout(load,400);}).catch(function(e){alert('Error: '+e.message);});
}
load();setInterval(load,8000);
</script>
</body>
</html>
"""

# ── CORS (allow make.html browser requests) ──────────────────────────────────

@app.after_request
def add_cors(resp):
    resp.headers["Access-Control-Allow-Origin"]  = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-API-Key"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    resp.headers["Access-Control-Allow-Private-Network"] = "true"
    return resp

@app.route("/", defaults={"path": ""}, methods=["OPTIONS"])
@app.route("/<path:path>", methods=["OPTIONS"])
def options_handler(path):
    return "", 204

# ── Capabilities handshake ────────────────────────────────────────────────────
# Machine self-description so any client (e.g. the make tab on another computer)
# can confirm what this plotter host is, and which pen tools it can physically
# load, BEFORE sending a job. Author-time work stays hardware-agnostic; this is
# where a drawing is validated against the specific machine it's being sent to.
@app.route("/capabilities", methods=["GET"])
def capabilities():
    import socket
    caps = {
        "name": socket.gethostname(),
        "role": "plotter-host",
        "queue_version": __version__,
        "formats": ["svg"],
        "tools": [],
    }
    try:
        tools_path = BASE_DIR / "pl0tb0t_tools.json"
        if tools_path.exists():
            data = json.loads(tools_path.read_text())
            for t in (data.get("tools", []) if isinstance(data, dict) else []):
                # colour + name only -- the physical z/x/y offsets stay machine-side
                caps["tools"].append({"color": t.get("color"), "name": t.get("name")})
    except Exception:
        pass
    return jsonify(caps)

# ── DB ────────────────────────────────────────────────────────────────────────

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db

def init_db():
    with get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id          TEXT PRIMARY KEY,
                sketch_name TEXT DEFAULT '',
                paper_size  TEXT DEFAULT '8.5x11',
                orientation TEXT DEFAULT 'portrait',
                status      TEXT DEFAULT 'queued',
                created_at  REAL,
                notes       TEXT DEFAULT '',
                cloud_id    TEXT DEFAULT NULL,
                recipe      TEXT DEFAULT NULL
            )
        """)
        for col, typedef in [
            ("cloud_id",    "TEXT DEFAULT NULL"),
            ("recipe",      "TEXT DEFAULT NULL"),
            ("plot_count",  "INTEGER DEFAULT 0"),
        ]:
            try:
                db.execute(f"ALTER TABLE jobs ADD COLUMN {col} {typedef}")
            except Exception:
                pass

# ── Auth ──────────────────────────────────────────────────────────────────────

def check_auth():
    key = request.headers.get("X-API-Key") or request.args.get("api_key")
    if key != API_KEY:
        abort(401, description="Invalid or missing API key")

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/jobs", methods=["POST"])
def create_job():
    check_auth()
    # Accept JSON body or multipart form
    data = request.get_json(silent=True) or {}
    svg = data.get("svg") or request.form.get("svg")
    if not svg:
        f = request.files.get("svg")
        svg = f.read().decode("utf-8") if f else None
    if not svg:
        return jsonify({"error": "svg field required"}), 400

    cloud_id = data.get("cloud_id") or request.form.get("cloud_id") or None
    recipe_raw = data.get("recipe") or None
    recipe_str = json.dumps(recipe_raw) if recipe_raw is not None else None

    with get_db() as db:
        job_id = _gen_job_id(db)
        (QUEUE_DIR / f"{job_id}.svg").write_text(svg, encoding="utf-8")
        db.execute(
            "INSERT INTO jobs(id,sketch_name,paper_size,orientation,status,created_at,notes,cloud_id,recipe)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            (job_id,
             data.get("sketch_name") or request.form.get("sketch_name", "Untitled"),
             data.get("paper_size")  or request.form.get("paper_size",  "8.5x11"),
             data.get("orientation") or request.form.get("orientation", "portrait"),
             "queued",
             time.time(),
             data.get("notes") or request.form.get("notes", ""),
             cloud_id,
             recipe_str)
        )
    return jsonify({"job_id": job_id, "status": "queued", "cloud_id": cloud_id,
                    "has_recipe": recipe_str is not None}), 201


@app.route("/rasterize", methods=["POST"])
def rasterize_svg():
    """Render an SVG to PNG with rsvg-convert (native). Body: {svg}. ?w=px width."""
    check_auth()
    import shutil
    data = request.get_json(silent=True) or {}
    svg = data.get("svg") or request.form.get("svg")
    if not svg:
        f = request.files.get("svg")
        svg = f.read().decode("utf-8", "ignore") if f else None
    if not svg:
        return jsonify({"error": "svg field required"}), 400
    try:
        w = max(100, min(2400, int(request.args.get("w", 900))))
    except Exception:
        w = 900
    tmp_dir = tempfile.mkdtemp(prefix="pl0traster_")
    src = os.path.join(tmp_dir, "in.svg")
    out = os.path.join(tmp_dir, "out.png")
    try:
        with open(src, "w", encoding="utf-8") as fh:
            fh.write(svg)
        r = subprocess.run(["rsvg-convert", "-w", str(w), "-b", "white", src, "-o", out],
                           capture_output=True, timeout=240)
        if r.returncode != 0 or not os.path.exists(out):
            return jsonify({"error": "rasterize failed",
                            "detail": (r.stderr or b"").decode("utf-8", "ignore")[:400]}), 500
        with open(out, "rb") as fh:
            png = fh.read()
        return png, 200, {"Content-Type": "image/png", "Cache-Control": "no-store"}
    except subprocess.TimeoutExpired:
        return jsonify({"error": "rasterize timed out"}), 504
    finally:
        try: shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception: pass


@app.route("/jobs", methods=["GET"])
def list_jobs():
    check_auth()
    status = request.args.get("status")
    with get_db() as db:
        if status:
            rows = db.execute(
                "SELECT * FROM jobs WHERE status=? ORDER BY created_at DESC", (status,)
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC"
            ).fetchall()
    def _job_dict(r):
        d = dict(r)
        d["has_recipe"] = d.pop("recipe", None) is not None
        return d
    return jsonify([_job_dict(r) for r in rows])


@app.route("/jobs/<job_id>", methods=["GET"])
def get_job(job_id):
    check_auth()
    with get_db() as db:
        row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    d = dict(row)
    d["has_recipe"] = d.pop("recipe", None) is not None
    return jsonify(d)


@app.route("/jobs/<job_id>/svg", methods=["GET"])
def get_svg(job_id):
    check_auth()
    svg_path = QUEUE_DIR / f"{job_id}.svg"
    if not svg_path.exists():
        abort(404)
    return send_file(svg_path, mimetype="image/svg+xml")


@app.route("/jobs/<job_id>/recipe", methods=["GET"])
def get_recipe(job_id):
    check_auth()
    with get_db() as db:
        row = db.execute("SELECT recipe FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row or not row["recipe"]:
        abort(404)
    return row["recipe"], 200, {"Content-Type": "application/json"}


@app.route("/jobs/<job_id>/status", methods=["PATCH"])
def update_status(job_id):
    check_auth()
    data = request.get_json(silent=True) or {}
    new_status = data.get("status")
    inc = data.get("increment_plot_count", False)
    if not new_status and not inc:
        return jsonify({"error": "status or increment_plot_count required"}), 400
    with get_db() as db:
        if new_status:
            db.execute("UPDATE jobs SET status=? WHERE id=?", (new_status, job_id))
        if inc:
            db.execute("UPDATE jobs SET plot_count = plot_count + 1 WHERE id=?", (job_id,))
    return jsonify({"job_id": job_id, "status": new_status})


@app.route("/jobs/<job_id>", methods=["DELETE"])
def delete_job(job_id):
    check_auth()
    with get_db() as db:
        row = db.execute("SELECT id FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            return jsonify({"error": "not found"}), 404
        db.execute("DELETE FROM jobs WHERE id=?", (job_id,))
    svg_path = QUEUE_DIR / f"{job_id}.svg"
    if svg_path.exists():
        svg_path.unlink()
    return jsonify({"deleted": job_id})


# ── Machine status ────────────────────────────────────────────────────────────

@app.route("/refine_estimate", methods=["POST"])
def refine_estimate():
    check_auth()
    data = request.get_json(silent=True) or {}
    svg  = data.get("svg", "")
    if not svg:
        return jsonify({"ok": False, "error": "svg required"}), 400

    # Read draw/travel speeds from config
    try:
        cfg = json.loads((BASE_DIR / "pl0tb0t_config.json").read_text())
    except Exception:
        cfg = {}
    draw_speed   = float(cfg.get("draw_speed",   2500))
    travel_speed = float(cfg.get("travel_speed", 6000))
    vpype_bin    = str(Path.home() / ".local/bin/vpype")

    with tempfile.TemporaryDirectory() as tmp:
        svg_p   = os.path.join(tmp, "in.svg")
        gc_p    = os.path.join(tmp, "out.gcode")
        with open(svg_p, "w", encoding="utf-8") as f:
            f.write(svg)
        cmd = [vpype_bin, "read", svg_p,
               "linemerge", "-t", "0.5mm",
               "linesort",
               "linesimplify", "-t", "0.1mm",
               "gwrite", gc_p]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            return jsonify({"ok": False, "error": "vpype timed out"}), 504
        except FileNotFoundError:
            return jsonify({"ok": False, "error": "vpype not found"}), 500
        if res.returncode != 0:
            return jsonify({"ok": False, "error": res.stderr.strip() or "vpype failed"}), 500
        gcode = open(gc_p, encoding="utf-8", errors="ignore").read()

    est_s = _estimate_gcode_time(gcode, draw_speed, travel_speed)
    token = str(uuid.uuid4())[:8]
    _refine_cache[token] = gcode
    return jsonify({"ok": True, "est_s": est_s, "token": token})


@app.route("/status", methods=["GET"])
def get_status():
    with _state_lock:
        return jsonify(dict(_machine_state))

@app.route("/status", methods=["POST"])
def set_status():
    check_auth()
    data = request.get_json(silent=True) or {}
    with _state_lock:
        for k in ("busy", "current_job_id", "plot_requested"):
            if k in data:
                _machine_state[k] = data[k]
        _machine_state["updated_at"] = time.time()
    return jsonify({"ok": True})

@app.route("/jobs/<job_id>/plot-request", methods=["POST"])
def plot_request(job_id):
    check_auth()
    with get_db() as db:
        row = db.execute("SELECT id FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    with _state_lock:
        _machine_state["plot_requested"] = job_id
        _machine_state["updated_at"] = time.time()
    return jsonify({"ok": True, "plot_requested": job_id})

# ── Online studio ─────────────────────────────────────────────────────────────
# Serves the SAME make_local/ UI the desktop Make tab uses, in 'web' mode.
# Generation is 100% client-side, so this runs on the visitor's machine and
# POSTs finished jobs back to /jobs here. Machine control stays Pi-only.
_STUDIO_INJECT = (
    "<script>"
    "window.QUEUE_URL = location.origin;"
    "window.QUEUE_API_KEY = '__API_KEY__';"
    "window._pl0tMode = 'web';"
    "</script>"
)


@app.route("/studio/")
def studio():
    index = MAKE_DIR / "index.html"
    if not index.exists():
        abort(404)
    html = index.read_text(encoding="utf-8")
    # Inject before the first script so QUEUE_URL/_pl0tMode exist for every script.
    html = html.replace("<head>", "<head>" + _STUDIO_INJECT.replace("__API_KEY__", API_KEY), 1)
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


@app.route("/studio/<path:sub>")
def studio_assets(sub):
    # Relative asset paths resolve under /studio/ thanks to the trailing slash.
    return send_from_directory(str(MAKE_DIR), sub)


@app.route("/mobile")
def mobile():
    return _MOBILE_HTML.replace("__API_KEY__", API_KEY)

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print(f"Pl0tb0t Queue Server v{__version__}")
    print(f"  Listening on  http://0.0.0.0:{PORT}")
    print(f"  Queue dir:    {QUEUE_DIR}")
    print(f"  API key:      {API_KEY}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
