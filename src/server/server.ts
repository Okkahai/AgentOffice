import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { AgentOfficeEvent } from '../core/events.ts';
import type { Orchestrator } from '../core/orchestrator.ts';
import { assertInside } from '../git/paths.ts';

// Local UI server. Read-only views plus a few token-protected user actions. The UI never touches Git or
// the OS: every action goes through Orchestrator methods, so it cannot bypass the state machine.
// Security: binds 127.0.0.1 only, rejects foreign Host headers (DNS rebinding), no CORS, per-run token for POSTs.

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

/** Keeps the tail of each task's terminal output (in memory only). */
export class OutputHub {
  #buf = new Map<number, string>();
  #subs = new Set<(taskId: number, chunk: string) => void>();
  push = (taskId: number, chunk: string) => {
    const clean = chunk.replace(ANSI, '').replace(/\r(?!\n)/g, '');
    this.#buf.set(taskId, (this.#buf.get(taskId) ?? '') + clean);
    const b = this.#buf.get(taskId)!;
    if (b.length > 64_000) this.#buf.set(taskId, b.slice(-64_000));
    for (const s of this.#subs) s(taskId, clean);
  };
  tail(taskId: number) { return this.#buf.get(taskId) ?? ''; }
  all() { return Object.fromEntries(this.#buf); }
  subscribe(cb: (taskId: number, chunk: string) => void) { this.#subs.add(cb); return () => this.#subs.delete(cb); }
}

export interface ProjectHandle {
  orch: Orchestrator; hub: OutputHub;
  /** Manager entry point. Absent means goal entry is unavailable (the UI says so instead of faking it). */
  onGoal?: (goal: string) => Promise<unknown>;
  /** Starts the project's runner after a retry re-queued tasks. */
  kick?: () => void;
  /** Which CLI (and model) engineers run as, shown in the UI. */
  profile?: { agent: string; model?: string };
}

export interface UiServerOptions extends Partial<ProjectHandle> {
  /** One entry per repository. Each has its own store, worktrees and merge lock. Defaults to the single orch/hub/onGoal. */
  projects?: ProjectHandle[];
  uiDir: string; port?: number;
}

type Project = ProjectHandle & { id: string };

export async function startUiServer(opts: UiServerOptions) {
  const { uiDir } = opts;
  const projects: Project[] = [];
  for (const h of opts.projects ?? [{ orch: opts.orch!, hub: opts.hub!, onGoal: opts.onGoal, kick: opts.kick }]) {
    const base = path.basename(h.orch.git.root).toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'repo';
    let id = base;
    for (let n = 2; projects.some((p) => p.id === id); n++) id = `${base}-${n}`;
    projects.push({ ...h, id });
  }
  const token = randomBytes(16).toString('hex');
  let port = 0;

  const server = http.createServer(async (req, res) => {
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(403).end('bad host'); return; }
    const url = new URL(req.url ?? '/', `http://${host}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        const pid = url.searchParams.get('project');
        const p = pid ? projects.find((q) => q.id === pid) : projects[0];
        if (!p) return void res.writeHead(404).end('no such project');
        if (req.method === 'GET' && url.pathname === '/api/state') return json(res, state(p));
        if (req.method === 'GET' && url.pathname === '/api/events') return sse(p, req, res);
        const detail = /^\/api\/tasks\/(\d+)\/(detail|diff)$/.exec(url.pathname);
        if (req.method === 'GET' && detail) return json(res, detail[2] === 'detail' ? taskDetail(p, Number(detail[1])) : await taskDiff(p, Number(detail[1])));
        if (req.method === 'POST' && url.pathname === '/api/goal') return await goal(p, req, res);
        if (req.method === 'POST' && url.pathname.startsWith('/api/tasks/')) return await action(p, req, res, url);
        return void res.writeHead(404).end();
      }
      if (req.method === 'GET') return await serveStatic(res, url.pathname);
      res.writeHead(405).end();
    } catch (e) {
      if (res.headersSent) { console.error('ui server:', (e as Error).message); res.end(); return; }
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }));
    }
  });

  /** Tasks and merges that need a human, per project, for the project switcher. */
  const needsAttention = (o: Orchestrator) => o.store.listTasks().filter((t) => ['FAILED', 'CONFLICT', 'BLOCKED'].includes(t.status)).length
    + o.store.merges().filter((m) => m.status === 'verification_failed').length;

  function state({ id, orch, hub, onGoal, profile }: Project) {
    const s = orch.store;
    return {
      token, project: id, targetBranch: orch.targetBranch, repo: path.basename(orch.git.root), goalEntry: !!onGoal, profile: profile ?? null,
      projects: projects.map((q) => ({ id: q.id, repo: path.basename(q.orch.git.root), targetBranch: q.orch.targetBranch, attention: needsAttention(q.orch), profile: q.profile ?? null })),
      tasks: s.listTasks().map((t) => ({ ...t, dependsOn: s.deps(t.id) })),
      backups: s.backups(), merges: s.merges(),
      reviews: s.listTasks().flatMap((t) => s.reviews(t.id).map((r) => ({ ...r, task_id: t.id }))),
      output: hub.all(),
    };
  }

  function sse({ orch, hub }: Project, req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const e of orch.store.events()) send('event', toEvent(e));
    send('ready', {});
    const unsub = orch.bus.subscribe((e) => send('event', e));
    const unsubOut = hub.subscribe((taskId, chunk) => send('output', { taskId, chunk }));
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => { unsub(); unsubOut(); clearInterval(ping); });
  }

  function taskDetail({ orch }: Project, id: number) {
    const s = orch.store, task = s.getTask(id);
    if (!task) return { error: 'no such task' };
    return {
      task, dependsOn: s.deps(id), verifications: s.verifications(id), reviews: s.reviews(id),
      backups: s.backups(id), merge: s.latestMerge(id) ?? null, events: s.events(id).map(toEvent),
    };
  }

  /** Live worktree diff while the task runs, otherwise the committed range; never fabricated. */
  async function taskDiff({ orch }: Project, id: number) {
    const t = orch.store.getTask(id);
    if (!t?.base_sha) return { files: [], patch: '', stat: '', source: 'none' };
    if (t.worktree_path && existsSync(t.worktree_path)) return { ...(await orch.git.getDiff(t.worktree_path, t.base_sha)), source: 'worktree' };
    if (t.commit_sha) return { ...(await orch.git.diffCommits(t.base_sha, t.commit_sha)), source: 'commit' };
    return { files: [], patch: '', stat: '', source: 'none' };
  }

  async function goal({ orch, onGoal }: Project, req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.headers['x-ao-token'] !== token) return void res.writeHead(403).end('bad token');
    if (!onGoal) return void res.writeHead(501).end('goal entry not configured');
    let body = '';
    for await (const c of req) { body += c; if (body.length > 8_000) return void res.writeHead(413).end(); }
    const text = String(JSON.parse(body || '{}').goal ?? '').trim();
    if (!text) return void res.writeHead(400).end('empty goal');
    orch.bus.emit('plan.started', { agentId: 'manager', payload: { goal: text } });
    onGoal(text).catch((e) => orch.bus.emit('plan.failed', { agentId: 'manager', payload: { goal: text, reason: (e as Error).message } }));
    json(res, { ok: true });
  }

  async function action({ orch, kick }: Project, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    if (req.headers['x-ao-token'] !== token) return void res.writeHead(403).end('bad token');
    const m = /^\/api\/tasks\/(\d+)\/(cancel|rollback|retry)$/.exec(url.pathname);
    if (!m) return void res.writeHead(404).end();
    const id = Number(m[1]);
    if (m[2] === 'cancel') await orch.cancel(id);
    else if (m[2] === 'rollback') await orch.rollback(id);
    else { try { orch.retry(id); } catch (e) { return void res.writeHead(409).end((e as Error).message); } kick?.(); }
    json(res, { ok: true });
  }

  const VENDOR: Record<string, [string, string]> = {
    '/vendor/xterm.js': ['@xterm/xterm/lib/xterm.js', 'text/javascript; charset=utf-8'],
    '/vendor/xterm.css': ['@xterm/xterm/css/xterm.css', 'text/css; charset=utf-8'],
  };

  async function serveStatic(res: http.ServerResponse, pathname: string) {
    const vendor = VENDOR[pathname];
    if (vendor) { // fixed allowlist, so no path traversal is possible
      try { const body = await readFile(path.resolve(uiDir, '../node_modules', vendor[0])); return void res.writeHead(200, { 'content-type': vendor[1] }).end(body); } catch { return void res.writeHead(404).end(); }
    }
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    let file: string;
    try { file = assertInside(uiDir, path.join(uiDir, rel)); } catch { return void res.writeHead(404).end(); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  }

  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`, token,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

function json(res: http.ServerResponse, body: unknown) {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function toEvent(row: Record<string, any>): AgentOfficeEvent {
  return { type: row.type, ts: row.ts, taskId: row.task_id ?? undefined, agentId: row.agent_id ?? undefined, payload: JSON.parse(row.payload) };
}
