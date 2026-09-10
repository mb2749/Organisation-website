"""
Martha's Website — a small personal organizer (calendar, tasks, reminders).

Run with:
    pip install flask
    python server.py

Then open http://127.0.0.1:5000 in your browser.
Data is stored locally in almanac.db (SQLite) and persists between runs.
"""

import os
import sqlite3
import uuid
from datetime import date
from pathlib import Path

from flask import Flask, g, jsonify, request, render_template

DB_PATH = Path(__file__).parent / "almanac.db"

app = Flask(__name__)


# ---------------------------------------------------------------- database

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            date TEXT NOT NULL DEFAULT '',
            priority TEXT NOT NULL DEFAULT 'medium',
            done INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS today_notes (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL
        );
        """
    )
    db.commit()
    db.close()


# ------------------------------------------------------------------ pages

@app.route("/")
def index():
    return render_template("index.html")


# ------------------------------------------------------------------- state

@app.route("/api/state")
def state():
    db = get_db()
    events = [dict(r) for r in db.execute("SELECT * FROM events ORDER BY date, time")]
    tasks = [dict(r) for r in db.execute("SELECT * FROM tasks ORDER BY date")]
    reminders = [dict(r) for r in db.execute("SELECT * FROM reminders ORDER BY date, time")]
    today_notes = [dict(r) for r in db.execute("SELECT * FROM today_notes")]
    for t in tasks:
        t["done"] = bool(t["done"])
    return jsonify(events=events, tasks=tasks, reminders=reminders, today_notes=today_notes)


# ------------------------------------------------------------------- events

@app.route("/api/events", methods=["POST"])
def add_event():
    body = request.get_json(force=True)
    title = (body.get("title") or "").strip()
    if not title:
        return jsonify(error="title is required"), 400
    row = {
        "id": str(uuid.uuid4()),
        "title": title,
        "date": body.get("date") or date.today().isoformat(),
        "time": body.get("time") or "09:00",
    }
    db = get_db()
    db.execute(
        "INSERT INTO events (id, title, date, time) VALUES (:id, :title, :date, :time)",
        row,
    )
    db.commit()
    return jsonify(row), 201


@app.route("/api/events/<event_id>", methods=["DELETE"])
def delete_event(event_id):
    db = get_db()
    db.execute("DELETE FROM events WHERE id = ?", (event_id,))
    db.commit()
    return "", 204


# -------------------------------------------------------------------- tasks

@app.route("/api/tasks", methods=["POST"])
def add_task():
    body = request.get_json(force=True)
    title = (body.get("title") or "").strip()
    if not title:
        return jsonify(error="title is required"), 400
    row = {
        "id": str(uuid.uuid4()),
        "title": title,
        "date": body.get("date") or "",
        "priority": body.get("priority") or "medium",
        "done": 0,
    }
    db = get_db()
    db.execute(
        "INSERT INTO tasks (id, title, date, priority, done) VALUES (:id, :title, :date, :priority, :done)",
        row,
    )
    db.commit()
    row["done"] = False
    return jsonify(row), 201


@app.route("/api/tasks/<task_id>", methods=["PATCH"])
def update_task(task_id):
    body = request.get_json(force=True)
    db = get_db()
    if "done" in body:
        db.execute("UPDATE tasks SET done = ? WHERE id = ?", (1 if body["done"] else 0, task_id))
        db.commit()
    row = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        return jsonify(error="not found"), 404
    result = dict(row)
    result["done"] = bool(result["done"])
    return jsonify(result)


@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def delete_task(task_id):
    db = get_db()
    db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    db.commit()
    return "", 204


# --------------------------------------------------------------- reminders

@app.route("/api/reminders", methods=["POST"])
def add_reminder():
    body = request.get_json(force=True)
    title = (body.get("title") or "").strip()
    if not title:
        return jsonify(error="title is required"), 400
    row = {
        "id": str(uuid.uuid4()),
        "title": title,
        "date": body.get("date") or date.today().isoformat(),
        "time": body.get("time") or "09:00",
    }
    db = get_db()
    db.execute(
        "INSERT INTO reminders (id, title, date, time) VALUES (:id, :title, :date, :time)",
        row,
    )
    db.commit()
    return jsonify(row), 201


@app.route("/api/reminders/<reminder_id>", methods=["DELETE"])
def delete_reminder(reminder_id):
    db = get_db()
    db.execute("DELETE FROM reminders WHERE id = ?", (reminder_id,))
    db.commit()
    return "", 204


# -------------------------------------------------------------- today notes

@app.route("/api/today-notes", methods=["POST"])
def add_today_note():
    body = request.get_json(force=True)
    text = (body.get("text") or "").strip()
    if not text:
        return jsonify(error="text is required"), 400
    row = {"id": str(uuid.uuid4()), "text": text}
    db = get_db()
    db.execute("INSERT INTO today_notes (id, text) VALUES (:id, :text)", row)
    db.commit()
    return jsonify(row), 201


@app.route("/api/today-notes/<note_id>", methods=["DELETE"])
def delete_today_note(note_id):
    db = get_db()
    db.execute("DELETE FROM today_notes WHERE id = ?", (note_id,))
    db.commit()
    return "", 204


init_db()  # runs once on import too, so it works under gunicorn/production servers

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
