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

// ---------------------------------------------------------------- routing

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

function render() {
  if (state.view === "today") renderToday();
  else if (state.view === "calendar") renderCalendar();
  else if (state.view === "tasks") renderTasks();
  else if (state.view === "reminders") renderReminders();
}

// ------------------------------------------------------------------ today

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
      await api(`/api/today-notes/${el.dataset.removeNote}`, { method:
