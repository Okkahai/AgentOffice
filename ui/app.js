// Agent Office UI. Everything shown comes from /api/state, /api/tasks/:id/* and the SSE event stream.
// Nothing here is authoritative: actions go to the server, which routes them through the Orchestrator.
import { attention, agentState, describe, goalState, graphLayout, highlight, parseDiff, pipeline, severity } from './model.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const time = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : '');
const short = (sha) => (sha ? sha.slice(0, 8) : '');
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(`ao.${k}`)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(`ao.${k}`, JSON.stringify(v)); } catch { /* storage unavailable */ } };

// One server can host several repositories; the project is part of the URL so each tab is pinned to one.
const PROJECT = new URLSearchParams(location.search).get('project');
const api = (p) => (PROJECT ? `${p}?project=${encodeURIComponent(PROJECT)}` : p);

const STATUS_TONE = { COMPLETED: 'ok', FAILED: 'err', CONFLICT: 'err', BLOCKED: 'warn', CANCELLED: 'mute', QUEUED: 'mute', WORKING: 'info', ASSIGNED: 'info', VERIFYING: 'info', REVIEWING: 'info', READY_TO_MERGE: 'info', MERGING: 'info' };
const tag = (text, tone = '') => `<span class="tag ${tone}">${esc(text)}</span>`;
const statusTag = (s) => tag(s.replace(/_/g, ' '), STATUS_TONE[s]);

const app = {
  data: { tasks: [], backups: [], merges: [], reviews: [], output: {}, token: '', targetBranch: '', repo: '', goalEntry: false },
  events: [], view: load('view', 'overview'), taskView: load('taskView', 'graph'), selected: null, tab: load('tab', 'terminal'),
  detail: null, diff: null, connected: false, diffMode: load('diffMode', 'unified'), diffQuery: '', diffHit: 0,
};

// ---------- data ----------
async function refresh() {
  app.data = await (await fetch(api('/api/state'))).json();
  render();
  notifyAttention();
  if (app.selected != null) loadDetail(false);
}
let refreshTimer;

// Desktop notifications for new attention items, opt-in from Ctrl+K. Items present at page load are not announced.
let seenAttention = null, replayed = false;
function notifyAttention() {
  if (!replayed) return; // the baseline is taken after the stored event trail has been replayed
  const items = attention(app.data, app.events), keys = items.map((i) => `${i.kind}:${i.taskId}`);
  const fresh = seenAttention ? items.filter((_, n) => !seenAttention.has(keys[n])) : [];
  seenAttention = new Set(keys);
  if (!fresh.length || typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.hasFocus()) return;
  for (const i of fresh.slice(0, 3)) {
    const n = new Notification(`${app.data.repo}: ${i.title}`, { body: i.why, tag: `ao-${app.data.project}-${i.kind}-${i.taskId}` });
    n.onclick = () => { window.focus(); if (i.taskId != null) select(i.taskId); n.close(); };
  }
}
const es = new EventSource(api('/api/events'));
es.addEventListener('ready', () => { app.connected = true; replayed = true; renderTop(); refresh(); }); // this refresh sets the notification baseline
es.onerror = () => { app.connected = false; renderTop(); };
es.addEventListener('event', (m) => {
  const ev = JSON.parse(m.data);
  app.events.push(ev);
  if (app.events.length > 5000) app.events.splice(0, 1000);    // bounded; the full trail stays in SQLite
  scheduleActivity();
  clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 120);
});
es.addEventListener('output', (m) => {
  const { taskId, chunk } = JSON.parse(m.data);
  app.data.output[taskId] = ((app.data.output[taskId] ?? '') + chunk).slice(-64000);
  if (taskId === app.selected && app.tab === 'terminal') term?.write(chunk.replace(/\n/g, '\r\n'));
});

async function post(path, body) {
  const r = await fetch(api(path), { method: 'POST', headers: { 'x-ao-token': app.data.token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function loadDetail(resetTab = true) {
  const id = app.selected;
  if (id == null) return;
  const [detail, diff] = await Promise.all([fetch(api(`/api/tasks/${id}/detail`)).then((r) => r.json()), fetch(api(`/api/tasks/${id}/diff`)).then((r) => r.json()).catch(() => null)]);
  if (id !== app.selected) return;
  app.detail = detail; app.diff = diff;
  renderInspector(resetTab);
}

// ---------- render ----------
function render() { renderTop(); renderNav(); renderMain(); }

function renderTop() {
  const t = app.data.tasks, working = t.filter((x) => ['ASSIGNED', 'WORKING'].includes(x.status)).length;
  const active = t.filter((x) => !['COMPLETED', 'CANCELLED', 'FAILED', 'CONFLICT', 'BLOCKED', 'QUEUED'].includes(x.status)).length;
  const lastVer = [...app.events].reverse().find((e) => e.type === 'verification.passed' || e.type === 'verification.failed');
  const attn = attention(app.data, app.events).length;
  $('#crumb').innerHTML = `<b>${esc(app.data.repo || 'repository')}</b> / ${esc(app.data.targetBranch)}`;
  $('#facts').innerHTML = [
    `<span>agents <b>${working}</b></span>`, `<span>running <b>${active}</b></span>`,
    lastVer ? `<span class="${lastVer.type.endsWith('failed') ? 'bad' : ''}">verify <b>${lastVer.type.endsWith('failed') ? 'failed' : 'passed'}</b> #${lastVer.taskId}</span>` : '<span>verify <b>-</b></span>',
    `<span class="${attn ? 'attn' : ''}">attention <b>${attn}</b></span>`,
  ].join('');
  $('#conn').className = `conn ${app.connected ? 'on' : ''}`; $('#conn').textContent = app.connected ? 'live' : 'offline';
  $('#inbox-count').textContent = attn || '';
}

function renderNav() {
  const list = app.data.projects ?? [];
  const ISO = { 'os-sandbox': ['sandboxed', ''], 'permission-rules': ['rules only, no OS sandbox', 'warn'], none: ['no isolation', 'err'] };
  const who = (pr) => {
    if (!pr) return '';
    const [label, tone] = ISO[pr.isolation] ?? ['', ''];
    return ` · ${esc(pr.agent)}${pr.model ? ` ${esc(pr.model)}` : ''}${label ? `<span class="iso ${tone}" title="How agent processes are isolated on this machine">${esc(label)}</span>` : ''}`;
  };
  $('#project').innerHTML = list.length > 1
    ? list.map((p) => `<a class="proj ${p.id === app.data.project ? 'on' : ''}" href="?project=${encodeURIComponent(p.id)}" title="${esc(p.repo)} → ${esc(p.targetBranch)}">${esc(p.repo)}${p.attention ? `<span class="count">${p.attention}</span>` : ''}<span class="dim">target ${esc(p.targetBranch)}${who(p.profile)}</span></a>`).join('')
    : `${esc(app.data.repo)}<span class="dim">target ${esc(app.data.targetBranch)}${who(app.data.profile)}</span>`;
  if (window.agentOffice) $('#project').insertAdjacentHTML('beforeend', '<button class="add-repo" data-cmd="add-repo">+ Add repository</button>');
  for (const b of document.querySelectorAll('.nav button[data-view]')) b.classList.toggle('on', b.dataset.view === app.view);
}

const VIEWS = { overview: viewOverview, inbox: viewInbox, sessions: viewSessions, tasks: viewTasks, reviews: viewReviews, git: viewGit, activity: viewActivity };
function renderMain() {
  const main = $('#main'), focusGoal = document.activeElement?.id === 'goal-input', draft = $('#goal-input')?.value;
  main.innerHTML = VIEWS[app.view]();
  if (draft != null && $('#goal-input')) $('#goal-input').value = draft;
  if (focusGoal) $('#goal-input')?.focus();
  if (app.view === 'activity') renderActivityInto($('#act-full'), 2000);
}

function taskTable(tasks, cols = ['id', 'title', 'status', 'agent', 'deps', 'verify', 'review']) {
  if (!tasks.length) return '<div class="empty">No tasks yet.</div>';
  const H = { id: '#', title: 'Task', status: 'Status', agent: 'Agent', deps: 'Depends on', verify: 'Verify', review: 'Review', branch: 'Branch' };
  const C = {
    id: (t) => `<td class="num muted">${t.id}</td>`, title: (t) => `<td class="title">${esc(t.title)}</td>`,
    status: (t) => `<td>${statusTag(t.status)}</td>`, agent: (t) => `<td class="mono dim">${esc(t.assigned_agent ?? '-')}</td>`,
    deps: (t) => `<td class="mono dim">${t.dependsOn.map((d) => `#${d}`).join(' ') || '-'}</td>`,
    verify: (t) => `<td>${tag(t.verification_status, t.verification_status === 'passed' ? 'ok' : t.verification_status === 'failed' ? 'err' : 'mute')}</td>`,
    review: (t) => `<td>${tag(t.review_status, t.review_status === 'approved' ? 'ok' : t.review_status === 'rejected' ? 'err' : 'mute')}</td>`,
    branch: (t) => `<td class="mono dim">${esc(t.branch ?? '-')}</td>`,
  };
  return `<table><thead><tr>${cols.map((c) => `<th>${H[c]}</th>`).join('')}</tr></thead><tbody>${tasks.map((t) =>
    `<tr class="row ${t.id === app.selected ? 'sel' : ''}" data-task="${t.id}">${cols.map((c) => C[c](t)).join('')}</tr>`).join('')}</tbody></table>`;
}

function goalBox() {
  const g = goalState(app.events);
  const status = g.planning ? `${tag('PLANNING', 'info')} ${esc(g.goal)}` : g.failed ? `${tag('PLAN FAILED', 'err')} ${esc(g.failed)}` : g.goal ? `${tag('GOAL')} ${esc(g.goal)}` : '<span class="muted">No goal yet.</span>';
  const disabled = !app.data.goalEntry;
  return `<form class="goal" id="goal-form"><span class="prompt">&gt;</span>
    <textarea id="goal-input" rows="1" placeholder="${disabled ? 'Goal entry needs the Manager (claude CLI). Start with npm start -- <repo>.' : 'Describe a goal, e.g. Implement authentication and login'}" ${disabled ? 'disabled' : ''}></textarea>
    <button class="btn" ${disabled || g.planning ? 'disabled' : ''}>Plan and run</button></form>
    <div class="current-goal">${status}</div>`;
}

function viewOverview() {
  const tasks = app.data.tasks, p = pipeline(tasks), attn = attention(app.data, app.events).slice(0, 5);
  const sessions = tasks.filter((t) => t.assigned_agent && !['COMPLETED', 'CANCELLED'].includes(t.status));
  const vers = app.events.filter((e) => e.type === 'verification.passed' || e.type === 'verification.failed').slice(-6).reverse();
  return `<div class="view-head"><h1>Overview</h1></div>
    <section class="block">${goalBox()}</section>
    <h2>Pipeline</h2><div class="pipeline">${p.map((s) => `<div class="stage ${s.n ? '' : 'zero'} ${s.tone}"><div class="n">${s.n}</div><div class="l">${s.label}</div></div>`).join('')}</div>
    <h2>Needs attention</h2>${attn.length ? attn.map(inboxItem).join('') : '<div class="empty">Nothing needs you right now.</div>'}
    <h2>Active sessions</h2>${sessionsTable(sessions)}
    <h2>Task graph</h2>${graph(tasks)}
    <h2>Recent verification</h2>${vers.length ? `<table><tbody>${vers.map((e) => `<tr class="row" data-task="${e.taskId}"><td class="mono muted" style="width:86px">${time(e.ts)}</td><td>${tag(e.type.endsWith('passed') ? 'PASSED' : 'FAILED', e.type.endsWith('passed') ? 'ok' : 'err')}</td><td class="mono dim">${esc(e.payload?.phase ?? '')}</td><td>#${e.taskId} ${esc(taskTitle(e.taskId))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No verification has run.</div>'}`;
}

function inboxItem(a) {
  const acts = [`<button class="btn" data-open="${a.taskId ?? ''}" ${a.taskId == null ? 'disabled' : ''}>Open</button>`];
  if (a.action === 'rollback') acts.push(`<button class="btn danger" data-act="rollback" data-id="${a.taskId}">Roll back</button>`);
  return `<div class="inbox-item"><div>${tag(a.kind, a.tone)}</div><div><div class="what">${esc(a.title)}</div><div class="why">${esc(a.why)}</div></div><div class="acts">${acts.join('')}</div></div>`;
}
function viewInbox() {
  const items = attention(app.data, app.events);
  return `<div class="view-head"><h1>Inbox</h1><span class="muted mono">${items.length} item${items.length === 1 ? '' : 's'}</span></div>
    ${items.length ? items.map(inboxItem).join('') : '<div class="empty">Nothing needs your attention. Failures, conflicts, blocked tasks, blocking reviews and failed post-merge checks appear here.</div>'}`;
}

function sessionsTable(tasks) {
  if (!tasks.length) return '<div class="empty">No agent sessions.</div>';
  return `<table><thead><tr><th>Agent</th><th>Process</th><th>Task</th><th>Stage</th><th>Branch</th><th>Started</th></tr></thead><tbody>${tasks.map((t) => {
    const s = agentState(app.events, t.id);
    return `<tr class="row ${t.id === app.selected ? 'sel' : ''}" data-task="${t.id}"><td class="mono">${esc(t.assigned_agent)}</td><td>${tag(s.label, s.tone)}</td><td class="title">#${t.id} ${esc(t.title)}</td><td>${statusTag(t.status)}</td><td class="mono dim">${esc(t.branch ?? '-')}</td><td class="mono muted">${time(t.started_at)}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function viewSessions() {
  const tasks = app.data.tasks.filter((t) => t.assigned_agent);
  return `<div class="view-head"><h1>Sessions</h1><span class="muted mono">one agent process per task worktree</span></div>${sessionsTable(tasks)}`;
}

function viewTasks() {
  const seg = `<div class="seg"><button data-taskview="graph" class="${app.taskView === 'graph' ? 'on' : ''}">Graph</button><button data-taskview="table" class="${app.taskView === 'table' ? 'on' : ''}">Table</button></div>`;
  return `<div class="view-head"><h1>Tasks</h1>${seg}</div>${app.taskView === 'graph' ? graph(app.data.tasks) : taskTable(app.data.tasks, ['id', 'title', 'status', 'agent', 'deps', 'branch', 'verify', 'review'])}`;
}

function graph(tasks) {
  if (!tasks.length) return '<div class="empty">No tasks yet.</div>';
  const { nodes, edges, w, h } = graphLayout(tasks), NW = 216, NH = 46;
  const edge = (e) => { const x1 = e.from.x + NW, y1 = e.from.y + NH / 2, x2 = e.to.x, y2 = e.to.y + NH / 2, mx = (x1 + x2) / 2; return `<path class="gedge" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"/>`; };
  const tone = (s) => ({ ok: 'var(--ok)', err: 'var(--err)', warn: 'var(--warn)', info: 'var(--info)' }[STATUS_TONE[s]] ?? 'var(--text-3)');
  const node = (n) => `<g class="gnode ${n.t.id === app.selected ? 'sel' : ''}" data-task="${n.t.id}" transform="translate(${n.x},${n.y})"><rect width="${NW}" height="${NH}" rx="3"/>
    <rect width="2" height="${NH}" style="fill:${tone(n.t.status)};stroke:none"/>
    <text x="12" y="19">${esc(n.t.title.length > 28 ? n.t.title.slice(0, 27) + '…' : n.t.title)}</text>
    <text class="meta" x="12" y="36">#${n.t.id} ${n.t.status.replace(/_/g, ' ').toLowerCase()}${n.t.assigned_agent ? ' · ' + esc(n.t.assigned_agent) : ''}</text></g>`;
  return `<div class="graph-wrap"><svg width="${w}" height="${h}">${edges.map(edge).join('')}${nodes.map(node).join('')}</svg></div>`;
}

function viewReviews() {
  const rs = [...app.data.reviews].reverse();
  if (!rs.length) return '<div class="view-head"><h1>Reviews</h1></div><div class="empty">No reviews yet.</div>';
  return `<div class="view-head"><h1>Reviews</h1></div><table><thead><tr><th>Task</th><th>Reviewer</th><th>Result</th><th>Blocking</th><th>Summary</th><th>Time</th></tr></thead><tbody>${rs.map((r) => {
    const blocking = JSON.parse(r.blocking_issues);
    return `<tr class="row" data-task="${r.task_id}" data-tab="review"><td class="title">#${r.task_id} ${esc(taskTitle(r.task_id))}</td><td class="mono dim">${esc(r.reviewer)}</td><td>${tag(r.approved ? 'APPROVED' : 'BLOCKED', r.approved ? 'ok' : 'err')}</td><td class="num">${blocking.length}</td><td class="dim">${esc(r.summary)}</td><td class="mono muted">${time(r.created_at)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function viewGit() {
  const { backups, merges } = app.data;
  const merge = (m) => `<tr class="row" data-task="${m.task_id}"><td class="title">#${m.task_id} ${esc(taskTitle(m.task_id))}</td><td>${tag(m.status.replace(/_/g, ' '), m.status === 'success' ? 'ok' : m.status === 'merging' ? 'info' : m.status === 'rolled_back' ? 'warn' : 'err')}</td><td class="mono dim">${short(m.merged_sha) || '-'}</td><td class="mono muted">${time(m.created_at)}</td><td>${['success', 'verification_failed'].includes(m.status) ? `<button class="btn danger" data-act="rollback" data-id="${m.task_id}">Roll back</button>` : ''}</td></tr>`;
  return `<div class="view-head"><h1>Git</h1><span class="muted mono">target ${esc(app.data.targetBranch)}</span></div>
    <h2>Merges</h2>${merges.length ? `<table><thead><tr><th>Task</th><th>Status</th><th>Merged</th><th>Time</th><th></th></tr></thead><tbody>${[...merges].reverse().map(merge).join('')}</tbody></table>` : '<div class="empty">No merges yet.</div>'}
    <h2>Pre-merge backups</h2>${backups.length ? `<table><thead><tr><th>Ref</th><th>Task</th><th>Target at backup</th><th>Source</th><th>Time</th></tr></thead><tbody>${[...backups].reverse().map((b) => `<tr class="row" data-task="${b.task_id}"><td class="mono">${esc(b.ref)}</td><td>#${b.task_id}</td><td class="mono dim">${esc(b.target_branch)} ${short(b.target_sha)}</td><td class="mono dim">${esc(b.source_branch)} ${short(b.source_sha)}</td><td class="mono muted">${time(b.created_at)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No backups yet. One is created and verified before every merge.</div>'}`;
}

function viewActivity() { return '<div class="view-head"><h1>Activity</h1><span class="muted mono">persisted event trail</span></div><div class="act-list" id="act-full"></div>'; }

const taskTitle = (id) => app.data.tasks.find((t) => t.id === id)?.title ?? '';

// ---------- activity panel ----------
let actTimer;
function scheduleActivity() { clearTimeout(actTimer); actTimer = setTimeout(() => { renderActivityInto($('#act-list'), 400); if (app.view === 'activity') renderActivityInto($('#act-full'), 2000); }, 60); }
function renderActivityInto(el, limit) {
  if (!el) return;
  const q = $('#act-filter').value.trim().toLowerCase(), sev = $('#act-sev').value;
  const rows = [];
  for (let i = app.events.length - 1; i >= 0 && rows.length < limit; i--) {
    const e = app.events[i], s = severity(e), d = describe(e, taskTitle(e.taskId));
    if (sev && s !== sev) continue;
    const src = e.agentId ?? (e.taskId != null ? `task #${e.taskId}` : 'system');
    if (q && !`${e.type} ${src} ${d}`.toLowerCase().includes(q)) continue;
    rows.push(`<div class="ev ${s} ${e.taskId != null ? 'link' : ''}" ${e.taskId != null ? `data-task="${e.taskId}"` : ''}><span class="ts">${time(e.ts)}</span><span class="ty">${esc(e.type)}</span><span class="dim">${esc(src)}</span><span>${esc(d)}</span></div>`);
  }
  el.innerHTML = rows.join('') || '<div class="empty" style="padding:8px 12px">No events.</div>';
  $('#act-count').textContent = `${app.events.length} events`;
}

// ---------- inspector ----------
let term = null, termTask = null;
function ensureTerm() {
  if (term || !window.Terminal) return;
  term = new window.Terminal({ disableStdin: true, convertEol: false, fontFamily: getComputedStyle(document.body).getPropertyValue('--mono'), fontSize: 12, scrollback: 5000,
    theme: { background: '#07090a', foreground: '#c9cdd1', cursor: '#07090a', selectionBackground: '#293038' } });
  term.open($('#term'));
}
function fitTerm() {
  if (!term) return;
  const el = $('#term-wrap'), cw = 7.3, ch = 17;
  term.resize(Math.max(20, Math.floor((el.clientWidth - 16) / cw)), Math.max(5, Math.floor((el.clientHeight - 30) / ch)));
}

function renderInspector(resetTab) {
  const d = app.detail, t = d?.task;
  $('#inspector').hidden = !t;
  if (!t) return;
  const merge = d.merge, canCancel = !['COMPLETED', 'CANCELLED', 'FAILED', 'CONFLICT'].includes(t.status), canRollback = merge && ['success', 'verification_failed'].includes(merge.status);
  const canRetry = ['FAILED', 'CONFLICT', 'BLOCKED'].includes(t.status) && !canRollback;
  const s = agentState(app.events, t.id);
  $('#insp-head').innerHTML = `<div class="t"><b>#${t.id} ${esc(t.title)}</b>${statusTag(t.status)}</div>
    <dl class="kv"><dt>agent</dt><dd>${esc(t.assigned_agent ?? '-')} ${t.assigned_agent ? tag(s.label, s.tone) : ''}</dd>
    <dt>branch</dt><dd title="${esc(t.branch)}">${esc(t.branch ?? '-')}</dd><dt>worktree</dt><dd title="${esc(t.worktree_path)}">${esc(t.worktree_path ?? '-')}</dd>
    <dt>commits</dt><dd>${short(t.base_sha) || '-'} → ${short(t.commit_sha) || '-'}</dd><dt>depends on</dt><dd>${d.dependsOn.map((x) => `#${x}`).join(' ') || '-'}</dd>
    ${t.failure_reason ? `<dt>reason</dt><dd style="color:var(--err)" title="${esc(t.failure_reason)}">${esc(t.failure_reason)}</dd>` : ''}</dl>
    <div class="insp-actions">${canRetry ? '<button class="btn" data-act="retry">Retry</button>' : ''}${canCancel ? '<button class="btn danger" data-act="cancel">Cancel task</button>' : ''}${canRollback ? '<button class="btn danger" data-act="rollback">Roll back merge</button>' : ''}<button class="btn" data-cmd="close-inspector">Close</button></div>`;
  for (const b of document.querySelectorAll('#insp-tabs button')) b.classList.toggle('on', b.dataset.tab === app.tab);
  const showTerm = app.tab === 'terminal';
  $('#term-wrap').hidden = !showTerm; $('#insp-pane').hidden = showTerm;
  if (showTerm) {
    ensureTerm(); fitTerm();
    if (term && (termTask !== t.id || resetTab)) { term.reset(); term.write((app.data.output[t.id] ?? '').replace(/\n/g, '\r\n')); termTask = t.id; }
    if (!$('#term-note')) $('#term-wrap').insertAdjacentHTML('beforeend', '<div class="note" id="term-note"></div>');
    $('#term-note').textContent = `read-only: agents run non-interactively in their worktree · ${app.data.output[t.id] ? 'live PTY output' : 'no output captured in this server session'}`;
  } else {
    // Live refreshes re-render the pane; keep the reader's place and the search box focus.
    const pane = $('#insp-pane'), top = resetTab ? 0 : pane.scrollTop, typing = document.activeElement?.id === 'diff-q';
    pane.innerHTML = { diff: paneDiff, review: paneReview, events: paneEvents }[app.tab](d);
    pane.scrollTop = top;
    if (app.tab === 'diff' && app.diffQuery) findInDiff('keep');
    if (typing) { const q = $('#diff-q'); q?.focus(); q?.setSelectionRange(q.value.length, q.value.length); }
  }
}

function paneDiff() {
  const df = app.diff;
  if (!df || !df.files.length) return `<div class="empty">${df?.source === 'none' ? 'No commits for this task yet.' : 'No changes.'}</div>`;
  const files = `<div class="files">${df.files.map((f, i) => `<button data-file="${i}"><span class="fs-${f.status[0]}">${esc(f.status)}</span>${esc(f.path)}</button>`).join('')}</div>`;
  const mode = app.diffMode;
  const bar = `<div class="diff-bar"><span class="muted mono">${df.source === 'worktree' ? 'live worktree vs base' : 'committed change'} · ${df.files.length} file${df.files.length === 1 ? '' : 's'}</span>
    <input id="diff-q" placeholder="Find in diff" aria-label="Find in diff" value="${esc(app.diffQuery)}"><span class="muted mono" id="diff-hits"></span>
    <span class="seg">${['unified', 'split'].map((m) => `<button data-diffmode="${m}" class="${m === mode ? 'on' : ''}">${m}</button>`).join('')}</span></div>`;
  return `${bar}${files}<div class="diff ${mode}" id="diff-body">${renderDiffRows(parseDiff(df.patch), mode)}</div>`;
}
function renderDiffRows(rows, mode) {
  let fi = -1, file = '';
  const num = (n) => `<span class="ln">${n ?? ''}</span>`;
  const uni = (k, l, r, text, mark) => `<div class="dl ${k}">${num(l)}${num(r)}<span class="tx">${mark}${highlight(text, file) || ' '}</span></div>`;
  const half = (k, n, text) => (n == null ? '<div class="dl empty-half"><span class="ln"></span><span class="tx"> </span></div>' : `<div class="dl ${k}">${num(n)}<span class="tx">${highlight(text, file) || ' '}</span></div>`);
  return rows.map((r) => {
    if (r.t === 'file') { fi++; file = r.text; return `<div class="fh" id="df-${fi}">${esc(r.text)}</div>`; }
    if (r.t === 'hunk') return `<div class="dl hk"><span class="tx">${esc(r.text)}</span></div>`;
    if (mode === 'unified') {
      if (r.t === 'ctx') return uni('cx', r.l, r.r, r.text, ' ');
      return r.dels.map((d) => uni('de', d.n, null, d.text, '-')).join('') + r.adds.map((a) => uni('ad', null, a.n, a.text, '+')).join('');
    }
    if (r.t === 'ctx') return `<div class="pair">${half('cx', r.l, r.text)}${half('cx', r.r, r.text)}</div>`;
    return Array.from({ length: Math.max(r.dels.length, r.adds.length) }, (_, i) => `<div class="pair">${half('de', r.dels[i]?.n, r.dels[i]?.text)}${half('ad', r.adds[i]?.n, r.adds[i]?.text)}</div>`).join('');
  }).join('');
}
/** Highlights lines containing the query (case-insensitive). step: 'first' jumps to the first hit, 'next' cycles, 'keep' only repaints. */
function findInDiff(step = 'first') {
  const q = app.diffQuery.toLowerCase();
  for (const el of document.querySelectorAll('#diff-body .dl:not(.hk)')) {
    el.classList.toggle('hit', !!q && el.querySelector('.tx').textContent.toLowerCase().includes(q)); el.classList.remove('cur');
  }
  const all = [...document.querySelectorAll('#diff-body .hit')];
  app.diffHit = step === 'first' || !all.length ? 0 : step === 'next' ? (app.diffHit + 1) % all.length : Math.min(app.diffHit, all.length - 1);
  if (all.length) { all[app.diffHit].classList.add('cur'); if (step !== 'keep') all[app.diffHit].scrollIntoView({ block: 'center' }); }
  if ($('#diff-hits')) $('#diff-hits').textContent = q ? `${all.length ? app.diffHit + 1 : 0}/${all.length}` : '';
}
function paneReview(d) {
  const vs = d.verifications.map((v) => `<div class="finding">${tag(v.passed ? 'PASS' : 'FAIL', v.passed ? 'ok' : 'err')} <span class="mono">${esc(v.phase)} · ${esc(v.name)}</span><div class="muted mono">${esc(JSON.parse(v.argv).join(' '))} · exit ${v.exit_code ?? '-'} · ${v.duration_ms} ms</div>${v.output_tail ? `<pre class="out">${esc(v.output_tail)}</pre>` : ''}</div>`).join('');
  const rs = d.reviews.map((r) => {
    const b = JSON.parse(r.blocking_issues), w = JSON.parse(r.warnings);
    return `<div class="finding">${tag(r.approved ? 'APPROVED' : 'BLOCKED', r.approved ? 'ok' : 'err')} <span class="mono">${esc(r.reviewer)}</span><div class="dim" style="margin-top:4px">${esc(r.summary)}</div>${b.map((x) => `<div style="color:var(--err)">✕ ${esc(x)}</div>`).join('')}${w.map((x) => `<div style="color:var(--warn)">! ${esc(x)}</div>`).join('')}</div>`;
  }).join('');
  const bk = d.backups.map((b) => `<div class="finding mono">${tag('BACKUP', 'ok')} ${esc(b.ref)} <span class="muted">${esc(b.target_branch)} @ ${short(b.target_sha)}</span></div>`).join('');
  return `<h2 style="margin-top:0">Verification</h2>${vs || `<div class="empty">${d.task.verification_status === 'pending' ? 'Not run yet.' : 'No checks were found in this repository.'}</div>`}<h2>Review</h2>${rs || '<div class="empty">Not reviewed yet.</div>'}<h2>Merge safety</h2>${bk || '<div class="empty">No backup yet.</div>'}${d.merge ? `<div class="finding mono">${tag(`MERGE ${d.merge.status.replace(/_/g, ' ')}`, d.merge.status === 'success' ? 'ok' : 'warn')} ${short(d.merge.merged_sha)}</div>` : ''}`;
}
function paneEvents(d) {
  return d.events.length ? d.events.map((e) => `<div class="ev ${severity(e)}" style="grid-template-columns:70px 170px 1fr;padding:2px 0"><span class="ts">${time(e.ts)}</span><span class="ty">${esc(e.type)}</span><span>${esc(describe(e, ''))}</span></div>`).join('') : '<div class="empty">No events.</div>';
}

function select(id, tab) {
  if (id == null || Number.isNaN(id)) return;
  const changed = app.selected !== id;
  app.selected = id; if (tab) { app.tab = tab; save('tab', tab); }
  if (changed) { app.detail = null; app.diff = null; app.diffQuery = ''; }
  renderMain(); loadDetail(true);
}

// ---------- palette ----------
function commands() {
  const views = Object.keys(VIEWS).map((v, i) => ({ label: `Go to ${v[0].toUpperCase() + v.slice(1)}`, key: `Alt+${i + 1}`, run: () => setView(v) }));
  const tasks = app.data.tasks.map((t) => ({ label: `Open task #${t.id} ${t.title}`, key: t.status.toLowerCase(), run: () => select(t.id) }));
  const extra = [
    { label: 'New goal', key: 'manager', run: () => { setView('overview'); setTimeout(() => $('#goal-input')?.focus(), 0); } },
    ...(window.agentOffice ? [{ label: 'Add repository…', key: 'desktop', run: () => window.agentOffice.addRepository() }] : []),
    ...(typeof Notification !== 'undefined' && Notification.permission === 'default' ? [{ label: 'Enable desktop notifications', key: 'attention', run: () => Notification.requestPermission() }] : []),
    { label: 'Toggle activity panel', key: 'Alt+A', run: () => toggle('act-collapsed') },
    { label: 'Toggle sidebar', key: 'Alt+B', run: () => toggle('nav-collapsed') },
    ...(app.selected != null ? ['terminal', 'diff', 'review', 'events'].map((tab) => ({ label: `Show ${tab} for #${app.selected}`, key: 'inspector', run: () => select(app.selected, tab) })) : []),
  ];
  const projects = (app.data.projects ?? []).filter((p) => p.id !== app.data.project).map((p) => ({ label: `Switch to project ${p.repo}`, key: p.targetBranch, run: () => { location.search = `?project=${encodeURIComponent(p.id)}`; } }));
  return [...extra, ...projects, ...views, ...tasks];
}
let palItems = [], palIdx = 0;
function openPalette() { $('#palette').hidden = false; $('#palette-input').value = ''; renderPalette(); $('#palette-input').focus(); }
function closePalette() { $('#palette').hidden = true; }
function renderPalette() {
  const q = $('#palette-input').value.toLowerCase().split(/\s+/).filter(Boolean);
  palItems = commands().filter((c) => q.every((w) => `${c.label} ${c.key}`.toLowerCase().includes(w))).slice(0, 40);
  palIdx = Math.min(palIdx, Math.max(0, palItems.length - 1));
  $('#palette-list').innerHTML = palItems.map((c, i) => `<button class="${i === palIdx ? 'on' : ''}" data-pal="${i}" role="option"><span>${esc(c.label)}</span><span class="k">${esc(c.key)}</span></button>`).join('') || '<div class="empty" style="padding:8px 12px">No matches.</div>';
}

// ---------- interactions ----------
function setView(v) { app.view = v; save('view', v); renderNav(); renderMain(); $('#main').focus({ preventScroll: true }); }
function toggle(cls) { document.body.classList.toggle(cls); save(cls, document.body.classList.contains(cls)); requestAnimationFrame(fitTerm); }
for (const cls of ['act-collapsed', 'nav-collapsed']) if (load(cls, false)) document.body.classList.add(cls);

async function act(kind, id) {
  const t = app.data.tasks.find((x) => x.id === id);
  if (kind === 'retry') { // not destructive: the task starts again in a fresh worktree
    try { await post(`/api/tasks/${id}/retry`); } catch (e) { alert(`Retry failed: ${e.message}`); }
    return refresh();
  }
  const msg = kind === 'rollback' ? `Roll back the merge of #${id} "${t?.title}"? The target branch is restored from the verified pre-merge backup.` : `Cancel task #${id} "${t?.title}"? Its agent process is terminated.`;
  if (!confirm(msg)) return;
  try { await post(`/api/tasks/${id}/${kind}`); } catch (e) { alert(`${kind} failed: ${e.message}`); }
  refresh();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-view],[data-task],[data-open],[data-act],[data-cmd],[data-tab],[data-taskview],[data-file],[data-pal],[data-diffmode]');
  if (!el) { if (e.target.id === 'palette') closePalette(); return; }
  if (el.dataset.pal != null) { const c = palItems[+el.dataset.pal]; closePalette(); c?.run(); return; }
  if (el.dataset.act) return void act(el.dataset.act, el.dataset.id ? +el.dataset.id : app.selected);
  if (el.dataset.view) return setView(el.dataset.view);
  if (el.dataset.taskview) { app.taskView = el.dataset.taskview; save('taskView', app.taskView); return renderMain(); }
  if (el.dataset.open) return select(+el.dataset.open);
  if (el.dataset.task) return select(+el.dataset.task, el.dataset.tab);
  if (el.dataset.diffmode) { app.diffMode = el.dataset.diffmode; save('diffMode', app.diffMode); return renderInspector(false); }
  if (el.dataset.file) return document.getElementById(`df-${el.dataset.file}`)?.scrollIntoView({ block: 'start' });
  if (el.dataset.tab && el.closest('#insp-tabs')) { app.tab = el.dataset.tab; save('tab', app.tab); return renderInspector(false); }
  const c = el.dataset.cmd;
  if (c === 'palette') openPalette();
  else if (c === 'toggle-nav') toggle('nav-collapsed');
  else if (c === 'add-repo') window.agentOffice?.addRepository();
  else if (c === 'toggle-activity') toggle('act-collapsed');
  else if (c === 'close-inspector') { app.selected = null; app.detail = null; $('#inspector').hidden = true; renderMain(); }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'goal-form') return;
  e.preventDefault();
  const goal = $('#goal-input').value.trim();
  if (!goal) return;
  try { await post('/api/goal', { goal }); $('#goal-input').value = ''; } catch (err) { alert(`Goal not accepted: ${err.message}`); }
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'goal-input' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#goal-form').requestSubmit(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#palette').hidden ? openPalette() : closePalette(); return; }
  if (!$('#palette').hidden) {
    if (e.key === 'Escape') closePalette();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); palIdx = (palIdx + (e.key === 'ArrowDown' ? 1 : -1) + palItems.length) % Math.max(1, palItems.length); renderPalette(); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = palItems[palIdx]; closePalette(); c?.run(); }
    return;
  }
  if (e.target.closest('input,textarea,select,.xterm')) return;
  if (e.key === 'Escape' && app.selected != null) { app.selected = null; $('#inspector').hidden = true; renderMain(); }
  if (e.altKey && /^[1-7]$/.test(e.key)) { e.preventDefault(); setView(Object.keys(VIEWS)[+e.key - 1]); }
  if (e.altKey && e.key.toLowerCase() === 'a') { e.preventDefault(); toggle('act-collapsed'); }
  if (e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); toggle('nav-collapsed'); }
});
$('#palette-input').addEventListener('input', () => { palIdx = 0; renderPalette(); });
$('#act-filter').addEventListener('input', scheduleActivity);
$('#insp-pane').addEventListener('input', (e) => { if (e.target.id === 'diff-q') { app.diffQuery = e.target.value; findInDiff(); } });
$('#insp-pane').addEventListener('keydown', (e) => { if (e.target.id === 'diff-q' && e.key === 'Enter') { e.preventDefault(); findInDiff('next'); } });
$('#act-sev').addEventListener('change', scheduleActivity);

// resizable inspector and activity panel; sizes persist per browser
function dragResize(handle, cssVar, axis, min, max) {
  const v = load(cssVar, null); if (v) document.documentElement.style.setProperty(`--${cssVar}`, `${v}px`);
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const px = Math.min(max, Math.max(min, axis === 'x' ? innerWidth - ev.clientX : innerHeight - ev.clientY));
      document.documentElement.style.setProperty(`--${cssVar}`, `${px}px`); save(cssVar, px); fitTerm();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', () => handle.removeEventListener('pointermove', move), { once: true });
  });
}
dragResize($('#resize-inspector'), 'insp-w', 'x', 340, 1100);
dragResize($('#resize-activity'), 'act-h', 'y', 90, 600);
addEventListener('resize', fitTerm);

window.__ao = { app, select, setView };
refresh();
