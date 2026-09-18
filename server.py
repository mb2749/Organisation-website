import os
import sqlite3
import uuid
from datetime import date
from functools import wraps
from pathlib import Path
 
from flask import Flask, g, jsonify, request, render_template, redirect, session, url_for
from werkzeug.security import generate_password_hash, check_password_hash
 
DB_PATH = Path(__file__).parent / "almanac.db"
 
app = Flask(__name__)
 
# Session signing key. Set a SECRET_KEY environment variable on Render so
# sessions survive restarts/redeploys instead of logging everyone out; falls
# back to a random key generated at process start if it isn't set.
app.secret_key = os.environ.get("SECRET_KEY") or uuid.uuid4().hex
 
 
#database
 
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
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
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            title TEXT NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            title TEXT NOT NULL,
            date TEXT NOT NULL DEFAULT '',
            priority TEXT NOT NULL DEFAULT 'medium',
            done INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            title TEXT NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS today_notes (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            text TEXT NOT NULL
        );
        """
    )
    db.commit()
    db.close()
 
 
#authentication
 
def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            if request.path.startswith("/api/"):
                return jsonify(error="not logged in"), 401
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapped
 
 
@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "GET":
        return render_template("signup.html", error=None)
 
    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""
    confirm = request.form.get("confirm") or ""
 
    if not username or not password:
        return render_template("signup.html", error="Username and password are both required."), 400
    if password != confirm:
        return render_template("signup.html", error="Passwords don't match."), 400
    if len(password) < 8:
        return render_template("signup.html", error="Password must be at least 8 characters."), 400
 
    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if existing is not None:
        return render_template("signup.html", error="That username is already taken."), 400
 
    user_id = str(uuid.uuid4())
    db.execute(
        "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
        (user_id, username, generate_password_hash(password)),
    )
    db.commit()
 
    session.clear()
    session["user_id"] = user_id
    session["username"] = username
    return redirect(url_for("index"))
 
 
@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return render_template("login.html", error=None)
 
    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""
 
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if user is None or not check_password_hash(user["password_hash"], password):
        return render_template("login.html", error="Incorrect username or password."), 400
 
    session.clear()
    session["user_id"] = user["id"]
    session["username"] = user["username"]
    return redirect(url_for("index"))
 
 
@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))
 
 
#pages
 
@app.route("/")
@login_required
def index():
    return render_template("index.html", username=session.get("username"))
 
 
#state
 
@app.route("/api/state")
@login_required
def state():
    uid = session["user_id"]
    db = get_db()
    events = [dict(r) for r in db.execute("SELECT * FROM events WHERE user_id = ? ORDER BY date, time", (uid,))]
    tasks = [dict(r) for r in db.execute("SELECT * FROM tasks WHERE user_id = ? ORDER BY date", (uid,))]
    reminders = [dict(r) for r in db.execute("SELECT * FROM reminders WHERE user_id = ? ORDER BY date, time", (uid,))]
    today_notes = [dict(r) for r in db.execute("SELECT * FROM today_notes WHERE user_id = ?", (uid,))]
    for t in tasks:
        t["done"] = bool(t["done"])
    for row_list in (events, tasks, reminders, today_notes):
        for row in row_list:
            row.pop("user_id", None)
    return jsonify(events=events, tasks=tasks, reminders=reminders, today_notes=today_notes)
 
 
#events
 
@app.route("/api/events", methods=["POST"])
@login_required
def add_event():
    body = request.get_json(force=True)
    title = (body.get("title") or "").strip()
    if not title:
        return jsonify(error="title is required"), 400
    row = {
        "id": str(uuid.uuid4()),
        "user_id": session["user_id"],
        "title": title,
        "date": body.get("date") or date.today().isoformat(),
        "time": body.get("time") or "09:00",
    }
    db = get_db()
    db.execute(
        "INSERT INTO events (id, user_id, title, date, time) VALUES (:id, :user_id, :title, :date, :time)",
        row,
    )
    db.commit()
    row.pop("user_id")
    return jsonify(row), 201
 
 
@app.route("/api/events/<event_id>", methods=["DELETE"])
@login_required
def delete_event(event_id):
    db = get_db()
    db.execute("DELETE FROM events WHERE id = ? AND user_id = ?", (event_id, session["user_id"]))
    db.commit()
    return "", 204
 
 
#tasks
 
@app.route("/api/tasks", methods=["POST"])
@login_required
def add_task():
    body = request.get_json(force=True)
    title = (body.get("title") or "").strip()
    if not title:
        return jsonify(error="title is required"), 400
    row = {
        "id": str(uuid.uuid4()),
        "user_id": session["user_id"],
        "title": title,
        "date": body.get("date") or "",
        "priority": body.get("priority") or "medium",
        "done": 0,
    }
    db = get_db()
    db.execute(
        "INSERT INTO tasks (id, user_id, title, date, priority, done) VALUES (:id, :user_id, :title, :date, :priority, :done)",
        row,
    )
    db.commit()
    row.pop("user_id")
    row["done"] = False
    return jsonify(row), 201
 
 
@app.route("/api/tasks/<task_id>", methods=["PATCH"])
@login_required
def update_task(task_id):
    body = request.get_json(force=True)
    uid = session["user_id"]
    db = get_db()
    if "done" in body:
        db.execute("UPDATE tasks SET done = ? WHERE id = ? AND user_id = ?", (1 if body["done"] else 0, task_id, uid))
    if "date" in body:
        db.execute("UPDATE tasks SET date = ? WHERE id = ? AND user_id = ?", (body["date"] or "", task_id, uid))
    if "priority" in body:
        db.execute("UPDATE tasks SET priority = ? WHERE id = ? AND user_id = ?", (body["priority"], task_id, uid))
    db.commit()
    row = db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, uid)).fetchone()
    if row is None:
        return jsonify(error="not found"), 404
    result = dict(row)
    result["done"] = bool(result["done"])
    return jsonify(result)
 
 
@app.route("/api/tasks/<task_id>", methods=["DELETE"])
@login_required
def delete_task(task_id):
    db = get_db()
    db.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, session["user_id"]))
    db.commit()
    return "", 204
 
 
#reminders
 
@app.route("/api/reminders", methods=["POST"])
@login_required
def add_reminder():
    body = request.get_json(force=True)
    title = (body.get("title") or "").strip()
    if not title:
        return jsonify(error="title is required"), 400
    row = {
        "id": str(uuid.uuid4()),
        "user_id": session["user_id"],
        "title": title,
        "date": body.get("date") or date.today().isoformat(),
        "time": body.get("time") or "09:00",
    }
    db = get_db()
    db.execute(
        "INSERT INTO reminders (id, user_id, title, date, time) VALUES (:id, :user_id, :title, :date, :time)",
        row,
    )
    db.commit()
    row.pop("user_id")
    return jsonify(row), 201
 
 
@app.route("/api/reminders/<reminder_id>", methods=["DELETE"])
@login_required
def delete_reminder(reminder_id):
    db = get_db()
    db.execute("DELETE FROM reminders WHERE id = ? AND user_id = ?", (reminder_id, session["user_id"]))
    db.commit()
    return "", 204
 
 
#today notes
 
@app.route("/api/today-notes", methods=["POST"])
@login_required
def add_today_note():
    body = request.get_json(force=True)
    text = (body.get("text") or "").strip()
    if not text:
        return jsonify(error="text is required"), 400
    row = {"id": str(uuid.uuid4()), "user_id": session["user_id"], "text": text}
    db = get_db()
    db.execute("INSERT INTO today_notes (id, user_id, text) VALUES (:id, :user_id, :text)", row)
    db.commit()
    row.pop("user_id")
    return jsonify(row), 201
 
 
@app.route("/api/today-notes/<note_id>", methods=["DELETE"])
@login_required
def delete_today_note(note_id):
    db = get_db()
    db.execute("DELETE FROM today_notes WHERE id = ? AND user_id = ?", (note_id, session["user_id"]))
    db.commit()
    return "", 204
 
 
init_db()  # runs once on import too, so it works under gunicorn/production servers
 
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
