import { initialOffice, reduce } from './office-state.js';
import { Office } from './office.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const office = new Office($('#office'));
let scene = initialOffice(); office.setState(scene); office.start();

const app = { data: { tasks: [], backups: [], merges: [], reviews: [], output: {}, token: '', targetBranch: '' }, events: [], tab: 'tasks', selected: null };

async function refresh() {
  app.data = await (await fetch('/api/state')).json();
  $('#meta').textContent = `target: ${app.data.targetBranch} · ${app.data.tasks.length} tasks · ${app.data.backups.length} backups`;
  if (app.selected == null && app.data.tasks.length) app.selected = app.data.tasks[0].id;
  render();
}

const es = new EventSource('/api/events');
let refreshTimer;
es.addEventListener('ready', () => { $('#live').className = 'live on'; $('#live span').textContent = 'live'; });
es.onerror = () => { $('#live').className = 'live'; $('#live span').textContent = 'reconnecting'; };
es.addEventListener('event', (m) => {
  const ev = JSON.parse(m.data);
  app.events.push(ev); reduce(scene, ev); office.setState(scene);
  clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 150);
});
es.addEventListener('output', (m) => {
  const { taskId, chunk } = JSON.parse(m.data);
  app.data.output[taskId] = ((app.data.output[taskId] ?? '') + chunk).slice(-64000);
  if (app.tab === 'terminal') renderTerminal(false);
});

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  app.tab = b.dataset.tab;
  for (const x of document.querySelectorAll('#tabs button')) x.setAttribute('aria-selected', String(x === b));
  render();
});

async function post(path) {
  const r = await fetch(path, { method: 'POST', headers: { 'x-ao-token': app.data.token } });
  if (!r.ok) alert((await r.json().catch(() => ({}))).error ?? `Request failed (${r.status})`);
  refresh();
}
window.ao = { cancel: (id) => confirm(`Cancel task ${id}? The agent process will be terminated.`) && post(`/api/tasks/${id}/cancel`),
  rollback: (id) => confirm(`Roll back the merge of task ${id} to its recorded pre-merge commit?`) && post(`/api/tasks/${id}/rollback`),
  select: (id) => { app.selected = id; render(); } };

const ACTIVE = ['ASSIGNED', 'WORKING', 'VERIFYING', 'REVIEWING'];
function render() {
  const v = $('#view');
  if (app.tab === 'terminal') return renderTerminal(true);
  const fns = { tasks: tasksView, events: eventsView, merges: mergesView, backups: backupsView };
  v.innerHTML = fns[app.tab]();
}
function tasksView() {
  const t = app.data.tasks;
  if (!t.length) return '<p class="empty">No tasks yet.</p>';
  return `<table><tr><th>#</th><th>Task</th><th>Status</th><th>Needs</th><th></th></tr>${t.map((x) => `
    <tr class="${x.id === app.selected ? 'sel' : ''}"><td>${x.id}</td>
    <td><a href="#" onclick="ao.select(${x.id});return false" style="color:inherit">${esc(x.title)}</a>${x.failure_reason ? `<div class="s-FAILED">${esc(x.failure_reason)}</div>` : ''}<div style="color:var(--dim)">${esc(x.branch ?? '')}</div></td>
    <td><span class="pill s-${x.status}">${x.status}</span><div style="color:var(--dim)">verify: ${x.verification_status} · review: ${x.review_status}</div></td>
    <td>${x.dependsOn.length ? x.dependsOn.map((d) => '#' + d).join(' ') : '—'}</td>
    <td>${ACTIVE.includes(x.status) ? `<button class="act danger" onclick="ao.cancel(${x.id})">Cancel</button>` : ''}</td></tr>`).join('')}</table>`;
}
let termScroll = true;
function renderTerminal(full) {
  const v = $('#view');
  if (full) {
    const opts = app.data.tasks.map((t) => `<option value="${t.id}" ${t.id === app.selected ? 'selected' : ''}>#${t.id} ${esc(t.title)}</option>`).join('');
    v.innerHTML = `<p><select id="tsel">${opts}</select> <span style="color:var(--dim)">live agent output (read-only)</span></p><pre class="term" id="term"></pre>`;
    $('#tsel')?.addEventListener('change', (e) => { app.selected = Number(e.target.value); renderTerminal(false); });
  }
  const pre = $('#term'); if (!pre) return;
  const text = app.data.output[app.selected] ?? '';
  pre.textContent = text || (app.selected == null ? 'No task selected.' : 'No output captured for this task.');
  if (termScroll) pre.scrollTop = pre.scrollHeight;
}
function eventsView() {
  const rows = [...app.events].reverse().slice(0, 300).map((e) => {
    const cls = /failed|conflict|denied/.test(e.type) ? 'bad' : /success|passed|completed/.test(e.type) ? 'good' : '';
    return `<div class="ev"><time>${e.ts.slice(11, 23)}</time><span class="t ${cls}">${e.type}</span><span>${e.taskId != null ? '#' + e.taskId : ''} ${e.payload && Object.keys(e.payload).length ? esc(JSON.stringify(e.payload).slice(0, 120)) : ''}</span></div>`;
  });
  return rows.join('') || '<p class="empty">No events yet.</p>';
}
function mergesView() {
  const m = app.data.merges;
  if (!m.length) return '<p class="empty">No merges yet.</p>';
  return `<table><tr><th>Task</th><th>Status</th><th>Merged commit</th><th></th></tr>${m.map((x) => `<tr><td>#${x.task_id}</td>
    <td><span class="pill s-${x.status === 'success' ? 'COMPLETED' : x.status === 'merging' ? 'MERGING' : 'FAILED'}">${x.status}</span></td>
    <td><code>${(x.merged_sha ?? '').slice(0, 10)}</code></td>
    <td>${['success', 'verification_failed'].includes(x.status) ? `<button class="act danger" onclick="ao.rollback(${x.task_id})">Roll back</button>` : ''}</td></tr>`).join('')}</table>`;
}
function backupsView() {
  const b = app.data.backups;
  if (!b.length) return '<p class="empty">No backups yet. One is created immediately before every merge.</p>';
  return `<table><tr><th>Task</th><th>Backup ref</th><th>Target</th><th>Source</th></tr>${b.map((x) => `<tr><td>#${x.task_id}</td>
    <td><code>${esc(x.ref.replace('refs/heads/', ''))}</code></td><td><code>${x.target_branch}@${x.target_sha.slice(0, 8)}</code></td><td><code>${x.source_sha.slice(0, 8)}</code></td></tr>`).join('')}</table>`;
}
refresh();
