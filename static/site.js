const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January","February","March","April","May","June","July","August",
                "September","October","November","December"];
 
const state = { events: [], tasks: [], reminders: [], todayNotes: [], view: "today", calCursor: new Date(), calSelected: new Date() };
 
const $main = document.getElementById("main");
 
function pad(n) { return n < 10 ? "0" + n : "" + n; }
function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function sameDay(a, b) { return keyOf(a) === keyOf(b); }
function today() { return new Date(); }
 
async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 204) return null;
  return res.json();
}
 
async function loadState() {
  const data = await api("/api/state");
  state.events = data.events;
  state.tasks = data.tasks;
  state.reminders = data.reminders;
  state.todayNotes = data.today_notes;
}
 
//routing
 
document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.view = btn.dataset.view;
    render();
  });
});
 
document.getElementById("sidebar-date").textContent =
  today().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
 
//sidebar hide
 
const $shell = document.getElementById("shell");
const $hideSidebarBtn = document.getElementById("hide-sidebar");
const $showSidebarBtn = document.getElementById("show-sidebar");
 
function setSidebarHidden(hidden) {
  $shell.classList.toggle("sidebar-hidden", hidden);
  localStorage.setItem("sidebarHidden", hidden ? "1" : "0");
}
 
setSidebarHidden(localStorage.getItem("sidebarHidden") === "1");
$hideSidebarBtn.addEventListener("click", () => setSidebarHidden(true));
$showSidebarBtn.addEventListener("click", () => setSidebarHidden(false));
 
function render() {
  if (state.view === "today") renderToday();
  else if (state.view === "calendar") renderCalendar();
  else if (state.view === "tasks") renderTasks();
  else if (state.view === "reminders") renderReminders();
}
 
//today
 
function renderToday() {
  const t = today();
  const tKey = keyOf(t);
 
  const items = [];
  state.events.filter(e => e.date === tKey).forEach(e =>
    items.push({ kind: "event", time: e.time, title: e.title, id: e.id }));
  state.reminders.filter(r => r.date === tKey).forEach(r =>
    items.push({ kind: "reminder", time: r.time, title: r.title, id: r.id }));
  state.tasks.filter(x => x.date === tKey && !x.done).forEach(x =>
    items.push({ kind: "task", time: null, title: x.title, id: x.id, priority: x.priority }));
  items.sort((a, b) => {
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time.localeCompare(b.time);
  });
 
  $main.innerHTML = `
    <div class="view">
      <p class="today-weekday">${t.toLocaleDateString(undefined, { weekday: "long" })}</p>
      <h1 class="today-date font-display">${t.getDate()} <span class="month">${MONTHS[t.getMonth()]}</span></h1>
      ${items.length === 0
        ? `<p class="agenda-empty">Nothing scheduled yet. Add a task, event, or reminder to see it here.</p>`
        : `<div class="agenda">${items.map(agendaItemHtml).join("")}</div>`}
 
      <div class="today-notes">
        <p class="today-notes-label">Notes</p>
        ${state.todayNotes.length === 0 ? `<p class="empty-note">Nothing here yet — add whatever you like below.</p>` : ""}
        ${state.todayNotes.map(n => `
          <div class="today-note-row">
            <p>${escapeHtml(n.text)}</p>
            <button class="icon-ghost" data-remove-note="${n.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>`).join("")}
        <div class="today-note-add">
          <input type="text" id="note-text" placeholder="Add a note or reminder to yourself">
          <button class="btn-icon" id="note-add">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>
    </div>`;
 
  $main.querySelectorAll("[data-toggle-task]").forEach(el => {
    el.addEventListener("click", async () => {
      const id = el.dataset.toggleTask;
      const task = state.tasks.find(x => x.id === id);
      await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ done: !task.done }) });
      await loadState();
      render();
    });
  });
 
  $main.querySelectorAll("[data-remove-note]").forEach(el => {
    el.addEventListener("click", async () => {
      await api(`/api/today-notes/${el.dataset.removeNote}`, { method: "DELETE" });
      await loadState();
      renderToday();
    });
  });
 
  const addNote = async () => {
    const input = document.getElementById("note-text");
    const text = input.value.trim();
    if (!text) return;
    await api("/api/today-notes", { method: "POST", body: JSON.stringify({ text }) });
    await loadState();
    renderToday();
  };
  document.getElementById("note-add").addEventListener("click", addNote);
  document.getElementById("note-text").addEventListener("keydown", e => { if (e.key === "Enter") addNote(); });
}
 
function agendaItemHtml(item) {
  const meta = item.time ? item.time : (item.kind === "task" ? `Task · ${item.priority} priority` : "All day");
  const checkbox = item.kind === "task"
    ? `<button class="checkbox" data-toggle-task="${item.id}"></button>`
    : "";
  return `
    <div class="agenda-item">
      <span class="agenda-dot ${item.kind}"></span>
      <div class="agenda-row">
        ${checkbox}
        <div>
          <p class="agenda-title">${escapeHtml(item.title)}</p>
          <p class="agenda-meta">${meta}</p>
        </div>
      </div>
    </div>`;
}
 
//calendar
 
function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - startOffset);
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  return days;
}
 
function renderCalendar() {
  const cursor = state.calCursor;
  const selected = state.calSelected;
  const days = buildMonthGrid(cursor.getFullYear(), cursor.getMonth());
 
  const eventsByDay = {};
  state.events.forEach(e => { (eventsByDay[e.date] ||= []).push(e); });
  Object.values(eventsByDay).forEach(list => list.sort((a, b) => a.time.localeCompare(b.time)));
 
  const selectedEvents = eventsByDay[keyOf(selected)] || [];
 
  $main.innerHTML = `
    <div class="calendar-layout">
      <div class="calendar-main">
        <div class="calendar-header">
          <h1 class="font-display">${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}</h1>
          <div style="display:flex; gap:4px;">
            <button class="calendar-nav-btn" id="cal-prev">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <button class="calendar-nav-btn" id="cal-next">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
        </div>
        <div class="weekday-row">${WEEKDAYS.map(w => `<span>${w}</span>`).join("")}</div>
        <div class="day-grid">
          ${days.map(d => dayCellHtml(d, cursor, selected, eventsByDay)).join("")}
        </div>
      </div>
      <div class="day-panel">
        <p class="weekday">${selected.toLocaleDateString(undefined, { weekday: "long" })}</p>
        <h2>${MONTHS[selected.getMonth()]} ${selected.getDate()}</h2>
        <div class="event-list">
          ${selectedEvents.length === 0
            ? `<p class="event-list-empty">No events yet.</p>`
            : selectedEvents.map(e => `
              <div class="event-row">
                <div>
                  <p>${escapeHtml(e.title)}</p>
                  <p class="time">${e.time}</p>
                </div>
                <button class="icon-ghost" data-delete-event="${e.id}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>`).join("")}
        </div>
        <div class="event-form">
          <input type="text" id="event-title" placeholder="Add an event">
          <div class="event-form-row">
            <input type="time" id="event-time" value="09:00">
            <button class="btn-icon" id="event-add">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>`;
 
  document.getElementById("cal-prev").addEventListener("click", () => {
    state.calCursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById("cal-next").addEventListener("click", () => {
    state.calCursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    renderCalendar();
  });
  $main.querySelectorAll("[data-select-day]").forEach(el => {
    el.addEventListener("click", () => {
      state.calSelected = new Date(el.dataset.selectDay);
      renderCalendar();
    });
  });
  $main.querySelectorAll("[data-delete-event]").forEach(el => {
    el.addEventListener("click", async () => {
      await api(`/api/events/${el.dataset.deleteEvent}`, { method: "DELETE" });
      await loadState();
      renderCalendar();
    });
  });
 
  const addEvent = async () => {
    const titleEl = document.getElementById("event-title");
    const title = titleEl.value.trim();
    if (!title) return;
    const time = document.getElementById("event-time").value || "09:00";
    await api("/api/events", { method: "POST", body: JSON.stringify({ title, date: keyOf(selected), time }) });
    await loadState();
    renderCalendar();
  };
  document.getElementById("event-add").addEventListener("click", addEvent);
  document.getElementById("event-title").addEventListener("keydown", e => { if (e.key === "Enter") addEvent(); });
}
 
function dayCellHtml(d, cursor, selected, eventsByDay) {
  const inMonth = d.getMonth() === cursor.getMonth();
  const isToday = sameDay(d, today());
  const isSelected = sameDay(d, selected);
  const dots = (eventsByDay[keyOf(d)] || []).slice(0, 3);
  const classes = ["day-cell"];
  if (!inMonth) classes.push("outside");
  if (isToday) classes.push("today");
  if (isSelected) classes.push("selected");
  return `
    <button class="${classes.join(" ")}" data-select-day="${keyOf(d)}">
      <span class="day-num">${d.getDate()}</span>
      <div class="day-dots">${dots.map(() => "<span></span>").join("")}</div>
    </button>`;
}
 
//tasks
 
const priorityColor = { high: "#B5652A", medium: "#C7A24A", low: "#8B8B84" };
 
function renderTasks() {
  const tKey = keyOf(today());
  const open = state.tasks.filter(t => !t.done);
  const groups = {
    "Due today": open.filter(t => t.date === tKey),
    "Upcoming": open.filter(t => t.date && t.date !== tKey),
    "No date": open.filter(t => !t.date),
    "Completed": state.tasks.filter(t => t.done),
  };
 
  $main.innerHTML = `
    <div class="view">
      <h1 class="view-title">Tasks</h1>
      <div class="tasks-add-row">
        <input type="text" id="task-title" placeholder="Add a task">
        <input type="date" id="task-date">
        <select id="task-priority">
          <option value="high">High</option>
          <option value="medium" selected>Medium</option>
          <option value="low">Low</option>
        </select>
        <button class="btn-icon" id="task-add">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
      ${Object.entries(groups).map(([label, items]) => items.length ? `
        <div class="task-section">
          <p class="task-section-label">${label}</p>
          ${items.map(taskRowHtml).join("")}
        </div>` : "").join("")}
      ${state.tasks.length === 0 ? `<p class="empty-note">No tasks yet — add your first one above.</p>` : ""}
    </div>`;
 
  $main.querySelectorAll("[data-toggle]").forEach(el => {
    el.addEventListener("click", async () => {
      const t = state.tasks.find(x => x.id === el.dataset.toggle);
      await api(`/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ done: !t.done }) });
      await loadState();
      renderTasks();
    });
  });
  $main.querySelectorAll("[data-remove-task]").forEach(el => {
    el.addEventListener("click", async () => {
      await api(`/api/tasks/${el.dataset.removeTask}`, { method: "DELETE" });
      await loadState();
      renderTasks();
    });
  });
  $main.querySelectorAll("[data-set-date]").forEach(el => {
    el.addEventListener("change", async () => {
      await api(`/api/tasks/${el.dataset.setDate}`, { method: "PATCH", body: JSON.stringify({ date: el.value }) });
      await loadState();
      renderTasks();
    });
  });
 
  const addTask = async () => {
    const titleEl = document.getElementById("task-title");
    const title = titleEl.value.trim();
    if (!title) return;
    const priority = document.getElementById("task-priority").value;
    const date = document.getElementById("task-date").value || "";
    await api("/api/tasks", { method: "POST", body: JSON.stringify({ title, priority, date }) });
    await loadState();
    renderTasks();
  };
  document.getElementById("task-add").addEventListener("click", addTask);
  document.getElementById("task-title").addEventListener("keydown", e => { if (e.key === "Enter") addTask(); });
}
 
function taskRowHtml(t) {
  return `
    <div class="task-row">
      <button class="checkbox ${t.done ? "checked" : ""}" data-toggle="${t.id}">
        ${t.done ? `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>` : ""}
      </button>
      <span class="dot" style="background:${priorityColor[t.priority]}"></span>
      <p class="title ${t.done ? "done" : ""}">${escapeHtml(t.title)}</p>
      <input type="date" class="date-input" value="${t.date || ""}" data-set-date="${t.id}">
      <button class="icon-ghost" data-remove-task="${t.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>
      </button>
    </div>`;
}
 
//reminders
 
function renderReminders() {
  const sorted = [...state.reminders].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const t = today();
 
  $main.innerHTML = `
    <div class="view">
      <h1 class="view-title">Reminders</h1>
      <div class="reminder-form">
        <input type="text" id="reminder-title" placeholder="Remind me to...">
        <div class="reminder-form-row">
          <input type="date" id="reminder-date" value="${keyOf(t)}">
          <input type="time" id="reminder-time" value="09:00">
          <button class="btn-text" id="reminder-add">Set reminder</button>
        </div>
      </div>
      ${sorted.length === 0 ? `<p class="empty-note">No reminders set.</p>` : sorted.map(reminderRowHtml).join("")}
    </div>`;
 
  $main.querySelectorAll("[data-remove-reminder]").forEach(el => {
    el.addEventListener("click", async () => {
      await api(`/api/reminders/${el.dataset.removeReminder}`, { method: "DELETE" });
      await loadState();
      renderReminders();
    });
  });
 
  const addReminder = async () => {
    const titleEl = document.getElementById("reminder-title");
    const title = titleEl.value.trim();
    if (!title) return;
    const date = document.getElementById("reminder-date").value;
    const time = document.getElementById("reminder-time").value || "09:00";
    await api("/api/reminders", { method: "POST", body: JSON.stringify({ title, date, time }) });
    await loadState();
    renderReminders();
  };
  document.getElementById("reminder-add").addEventListener("click", addReminder);
}
 
function reminderRowHtml(r) {
  return `
    <div class="reminder-row">
      <div class="reminder-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      </div>
      <div class="body">
        <p>${escapeHtml(r.title)}</p>
        <p class="meta">${new Date(r.date + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${r.time}</p>
      </div>
      <button class="icon-ghost" data-remove-reminder="${r.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>
      </button>
    </div>`;
}
 
//util
 
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
 
//init
 
loadState().then(render);
