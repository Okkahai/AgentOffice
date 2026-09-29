// Slice entry: transport + reducer (unchanged architecture) feeding the world, plus contextual drawers.
import { initialOffice, reduce } from './office-state.js';
import { Game } from './world/game.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const scene = initialOffice();
const app = { data: { tasks: [], output: {}, token: '', targetBranch: '' }, events: [], selected: null, term: null, termTask: null };

const game = new Game($('#world'), { onClick: (h, dbl) => onWorldClick(h, dbl) });
await game.load();
game.sync(scene);

async function refresh() {
  app.data = await (await fetch('/api/state')).json();
  $('#repo').textContent = `${app.data.targetBranch} branch`;
  $('#tasks').textContent = `${app.data.tasks.length} tasks`;
  renderInspector();
}
const es = new EventSource('/api/events');
let timer;
es.addEventListener('ready', () => { $('#live').classList.add('on'); $('#live').textContent = 'live'; });
es.onerror = () => { $('#live').classList.remove('on'); $('#live').textContent = 'reconnecting'; };
es.addEventListener('event', (m) => {
  const ev = JSON.parse(m.data); app.events.push(ev); reduce(scene, ev);
  $('#agents').textContent = `${Object.values(scene.agents).filter((a) => a.role === 'ENGINEER').length} engineers`;
  clearTimeout(timer); timer = setTimeout(refresh, 150);
});
es.addEventListener('output', (m) => {
  const { taskId, chunk } = JSON.parse(m.data);
  app.data.output[taskId] = ((app.data.output[taskId] ?? '') + chunk).slice(-64000);
  if (app.termTask === taskId) app.term?.write(chunk.replace(/\r?\n/g, '\r\n'));
});
refresh();

// ---- world -> overlay ----
function onWorldClick(h, dbl) {
  if (!h) { closeInspector(); return; }
  if (h.kind === 'agent' || ((h.kind === 'desk' || h.kind === 'monitor') && h.id)) {
    selectAgent(h.id, true);
    if (h.kind === 'monitor' || dbl) openTerminal(agentTask(h.id)?.id);
  }
}
function agentTask(id) { const a = scene.agents[id]; return a && app.data.tasks.find((t) => t.id === a.taskId); }
function selectAgent(id, focus) { app.selected = id; game.select(id); if (focus) game.focus(id); renderInspector(); }
function closeInspector() { app.selected = null; game.select(null); $('#inspector').hidden = true; }
let showTask = false;
function lastActivity(taskId) {
  const ev = [...app.events].reverse().find((e) => e.taskId === taskId);
  if (!ev) return 'no activity yet';
  const p = ev.payload ?? {}, extra = p.file ?? p.reason ?? p.to ?? '';
  return `${ev.type}${extra ? ` (${esc(String(extra).slice(0, 60))})` : ''} at ${ev.ts.slice(11, 19)}`;
}
function renderInspector() {
  const box = $('#inspector'), a = scene.agents[app.selected];
  if (!a) { box.hidden = true; return; }
  const t = agentTask(a.id), state = a.state === 'idle' && a.done ? 'done' : a.state;
  const name = a.role === 'ENGINEER' ? `Engineer ${a.taskId ?? ''}` : a.id;
  box.hidden = false;
  box.innerHTML = `
    <h2>${esc(name)}</h2><div class="role">${esc(a.role)}</div>
    <span class="pill ${esc(state)}">${esc(state.toUpperCase())}</span>
    <div class="task"><b>${esc(t?.title ?? 'No task')}</b>
      <dl><dt>Branch</dt><dd>${esc(t?.branch ?? '-')}</dd><dt>Worktree</dt><dd>${esc(t?.worktree_path ?? '-')}</dd>
      <dt>Status</dt><dd>${esc(t?.status ?? '-')}</dd><dt>Activity</dt><dd>${lastActivity(t?.id)}</dd></dl>
      ${t?.failure_reason ? `<p style="color:var(--red)">${esc(t.failure_reason)}</p>` : ''}
    </div>
    <div class="actions">
      <button id="a-term" ${t ? '' : 'disabled'}>Terminal</button>
      <button id="a-task" ${t ? '' : 'disabled'}>${showTask ? 'Hide task' : 'View task'}</button>
      <button id="a-kill" class="danger" ${t && ['ASSIGNED', 'WORKING', 'VERIFYING', 'REVIEWING'].includes(t.status) ? '' : 'disabled'}>Terminate</button>
    </div>
    ${showTask && t ? `<dl class="more"><dt>Task</dt><dd>#${t.id}</dd><dt>Needs</dt><dd>${t.dependsOn.length ? t.dependsOn.map((d) => '#' + d).join(' ') : '-'}</dd>
      <dt>Verify</dt><dd>${esc(t.verification_status)}</dd><dt>Review</dt><dd>${esc(t.review_status)}</dd><dt>Commit</dt><dd>${esc((t.commit_sha ?? '-').slice(0, 10))}</dd>
      <dt>About</dt><dd>${esc(t.description || '-')}</dd></dl>` : ''}`;
  $('#a-term')?.addEventListener('click', () => openTerminal(t.id));
  $('#a-task')?.addEventListener('click', () => { showTask = !showTask; renderInspector(); });
  $('#a-kill')?.addEventListener('click', async () => {
    if (!confirm(`Terminate task ${t.id}? The agent process will be stopped.`)) return;
    const r = await fetch(`/api/tasks/${t.id}/cancel`, { method: 'POST', headers: { 'x-ao-token': app.data.token } });
    if (!r.ok) alert('Request failed'); refresh();
  });
}

// ---- terminal (xterm.js, live PTY/process output stream) ----
function openTerminal(taskId) {
  if (taskId == null) return;
  const box = $('#terminal'); box.hidden = false; app.termTask = taskId;
  $('#term-title').textContent = `Task ${taskId} terminal (live output)`;
  if (!app.term) {
    app.term = new Terminal({ convertEol: true, fontSize: 13, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', cursorBlink: false, disableStdin: true, theme: { background: '#0d0b0a', foreground: '#d9ccb0' } });
    app.term.open($('#term'));
  }
  app.term.reset();
  const cols = Math.floor(($('#term').clientWidth - 16) / 7.8), rows = Math.floor(($("#term").clientHeight - 12) / 15);
  app.term.resize(Math.max(20, cols), Math.max(5, rows));
  app.term.write((app.data.output[taskId] ?? 'No output captured for this task yet.').replace(/\r?\n/g, '\r\n'));
}
$('#term-close').addEventListener('click', () => { $('#terminal').hidden = true; app.termTask = null; });

// ---- controls ----
$('#fit').addEventListener('click', () => game.fit());
$('#zin').addEventListener('click', () => game.setZoom(game.z + 1));
$('#zout').addEventListener('click', () => game.setZoom(game.z - 1));
addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeInspector(); $('#terminal').hidden = true; app.termTask = null; } });
window.__ao = { game, scene, app };
