import { randomBytes } from 'node:crypto';
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

export interface UiServerOptions { orch: Orchestrator; hub: OutputHub; uiDir: string; port?: number }

export async function startUiServer(opts: UiServerOptions) {
  const { orch, hub, uiDir } = opts;
  const token = randomBytes(16).toString('hex');
  let port = 0;

  const server = http.createServer(async (req, res) => {
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(403).end('bad host'); return; }
    const url = new URL(req.url ?? '/', `http://${host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, state());
      if (req.method === 'GET' && url.pathname === '/api/events') return sse(req, res);
      if (req.method === 'POST' && url.pathname.startsWith('/api/tasks/')) return await action(req, res, url);
      if (req.method === 'GET') return await serveStatic(res, url.pathname);
      res.writeHead(405).end();
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }));
    }
  });

  function state() {
    const s = orch.store;
    return {
      token, targetBranch: orch.targetBranch,
      tasks: s.listTasks().map((t) => ({ ...t, dependsOn: s.deps(t.id) })),
      backups: s.backups(), merges: s.merges(),
      reviews: s.listTasks().flatMap((t) => s.reviews(t.id).map((r) => ({ ...r, task_id: t.id }))),
      output: hub.all(),
    };
  }

  function sse(req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const e of orch.store.events()) send('event', toEvent(e));
    send('ready', {});
    const unsub = orch.bus.subscribe((e) => send('event', e));
    const unsubOut = hub.subscribe((taskId, chunk) => send('output', { taskId, chunk }));
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => { unsub(); unsubOut(); clearInterval(ping); });
  }

  async function action(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    if (req.headers['x-ao-token'] !== token) return void res.writeHead(403).end('bad token');
    const m = /^\/api\/tasks\/(\d+)\/(cancel|rollback)$/.exec(url.pathname);
    if (!m) return void res.writeHead(404).end();
    const id = Number(m[1]);
    if (m[2] === 'cancel') await orch.cancel(id); else await orch.rollback(id);
    json(res, { ok: true });
  }

  const VENDOR: Record<string, [string, string]> = {
    '/vendor/xterm.js': ['@xterm/xterm/lib/xterm.js', 'text/javascript; charset=utf-8'],
    '/vendor/xterm.css': ['@xterm/xterm/css/xterm.css', 'text/css; charset=utf-8'],
  };

  async function serveStatic(res: http.ServerResponse, pathname: string) {
    const vendor = VENDOR[pathname];
    if (vendor) { // fixed allowlist, so no path traversal is possible
      try { return void res.writeHead(200, { 'content-type': vendor[1] }).end(await readFile(path.resolve(uiDir, '../node_modules', vendor[0]))); } catch { return void res.writeHead(404).end(); }
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
