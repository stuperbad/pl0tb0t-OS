#!/usr/bin/env python3
"""
Pl0tb0t Queue Server
A lightweight Flask API for the SVG print queue.
Jobs stored in SQLite; SVG files on disk in ./queue_svgs/

Usage:
    python3 queue_server.py
    QUEUE_API_KEY=mysecret python3 queue_server.py
"""

import os, sqlite3, uuid, time, json
from pathlib import Path
from flask import Flask, request, jsonify, send_file, abort

BASE_DIR  = Path(__file__).parent
QUEUE_DIR = BASE_DIR / "queue_svgs"
DB_PATH   = BASE_DIR / "queue.db"
API_KEY   = os.environ.get("QUEUE_API_KEY", "pl0tb0t-secret")
PORT      = int(os.environ.get("QUEUE_PORT", "5001"))

QUEUE_DIR.mkdir(exist_ok=True)

app = Flask(__name__)

# ── CORS (allow make.html browser requests) ──────────────────────────────────

@app.after_request
def add_cors(resp):
    resp.headers["Access-Control-Allow-Origin"]  = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-API-Key"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    return resp

@app.route("/", defaults={"path": ""}, methods=["OPTIONS"])
@app.route("/<path:path>", methods=["OPTIONS"])
def options_handler(path):
    return "", 204

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
                notes       TEXT DEFAULT ''
            )
        """)

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

    job_id = str(uuid.uuid4())[:8]
    (QUEUE_DIR / f"{job_id}.svg").write_text(svg, encoding="utf-8")

    with get_db() as db:
        db.execute(
            "INSERT INTO jobs(id,sketch_name,paper_size,orientation,status,created_at,notes) VALUES(?,?,?,?,?,?,?)",
            (job_id,
             data.get("sketch_name") or request.form.get("sketch_name", "Untitled"),
             data.get("paper_size")  or request.form.get("paper_size",  "8.5x11"),
             data.get("orientation") or request.form.get("orientation", "portrait"),
             "queued",
             time.time(),
             data.get("notes") or request.form.get("notes", ""))
        )
    return jsonify({"job_id": job_id, "status": "queued"}), 201


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
    return jsonify([dict(r) for r in rows])


@app.route("/jobs/<job_id>", methods=["GET"])
def get_job(job_id):
    check_auth()
    with get_db() as db:
        row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    return jsonify(dict(row))


@app.route("/jobs/<job_id>/svg", methods=["GET"])
def get_svg(job_id):
    check_auth()
    svg_path = QUEUE_DIR / f"{job_id}.svg"
    if not svg_path.exists():
        abort(404)
    return send_file(svg_path, mimetype="image/svg+xml")


@app.route("/jobs/<job_id>/status", methods=["PATCH"])
def update_status(job_id):
    check_auth()
    data = request.get_json(silent=True) or {}
    new_status = data.get("status")
    if not new_status:
        return jsonify({"error": "status required"}), 400
    with get_db() as db:
        db.execute("UPDATE jobs SET status=? WHERE id=?", (new_status, job_id))
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


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print(f"Pl0tb0t Queue Server v1.0")
    print(f"  Listening on  http://0.0.0.0:{PORT}")
    print(f"  Queue dir:    {QUEUE_DIR}")
    print(f"  API key:      {API_KEY}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
