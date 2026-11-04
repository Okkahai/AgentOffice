import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { OutputHub, startUiServer } from '../src/server/server.ts';
import { agentSpec, makeOrchestrator, makeSandbox } from './helpers.ts';

const get = (url: string, headers: Record<string, string> = {}, method = 'GET') =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const u = new URL(url);
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let body = ''; res.on('data', (c) => (body += c)); res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    r.on('error', reject); r.end();
  });

describe('ui server', () => {
  const sb = makeSandbox();
  const hub = new OutputHub();
  const h = makeOrchestrator(sb, { onAgentOutput: hub.push });
  let srv: Awaited<ReturnType<typeof startUiServer>>;
  before(async () => {
    h.orch.createTask({ title: 'Say hi', spec: agentSpec({ write: { 'hi.txt': 'hi' }, echo: '\u001b[32mhello from agent\u001b[0m' }) });
    await h.orch.runAll();
    srv = await startUiServer({ orch: h.orch, hub, uiDir: path.resolve(import.meta.dirname, '../ui') });
  });
  after(async () => { await srv.close(); sb.cleanup(); });

  it('serves the UI and real state', async () => {
    assert.equal((await get(srv.url + '/')).status, 200);
    const st = JSON.parse((await get(srv.url + '/api/state')).body);
    assert.equal(st.tasks[0].status, 'COMPLETED');
    assert.equal(st.backups.length, 1);
    assert.match(st.output['1'], /hello from agent/);
    assert.doesNotMatch(st.output['1'], /\u001b/, 'ANSI stripped');
  });

  it('streams the persisted event trail over SSE', async () => {
    const body = await new Promise<string>((resolve) => {
      const u = new URL(srv.url + '/api/events');
      const r = http.get({ host: u.hostname, port: u.port, path: u.pathname }, (res) => {
        let b = ''; res.on('data', (c) => { b += c; if (b.includes('event: ready')) { r.destroy(); resolve(b); } });
      });
    });
    assert.match(body, /"type":"git.backup_created"/);
    assert.match(body, /"type":"merge.success"/);
  });

  it('rejects foreign Host headers, bad tokens and path traversal', async () => {
    assert.equal((await get(srv.url + '/api/state', { host: 'evil.example.com' })).status, 403);
    assert.equal((await get(srv.url + '/api/tasks/1/cancel', {}, 'POST')).status, 403);
    assert.equal((await get(srv.url + '/api/tasks/1/cancel', { 'x-ao-token': 'wrong' }, 'POST')).status, 403);
    assert.equal((await get(srv.url + '/..%2f..%2fpackage.json')).status, 404);
  });

  it('serves task detail and the committed diff from persisted evidence', async () => {
    const d = JSON.parse((await get(srv.url + '/api/tasks/1/detail')).body);
    assert.equal(d.task.id, 1);
    assert.ok(d.verifications.length > 0 && d.backups.length === 1);
    assert.ok(d.events.some((e: any) => e.type === 'merge.success'));
    const diff = JSON.parse((await get(srv.url + '/api/tasks/1/diff')).body);
    assert.equal(diff.source, 'commit');
    assert.deepEqual(diff.files.map((f: any) => f.path), ['hi.txt']);
  });

  it('goal entry needs the token and an explicit Manager', async () => {
    assert.equal((await get(srv.url + '/api/goal', {}, 'POST')).status, 403);
    assert.equal((await get(srv.url + '/api/goal', { 'x-ao-token': srv.token }, 'POST')).status, 501);
  });

  it('rollback through the UI uses the deterministic control plane', async () => {
    const r = await get(srv.url + '/api/tasks/1/rollback', { 'x-ao-token': srv.token }, 'POST');
    assert.equal(r.status, 200);
    assert.equal(h.store.latestMerge(1)!.status, 'rolled_back');
  });

  it('hosts several repositories, each with its own state and actions', async () => {
    const sb2 = makeSandbox();
    const h2 = makeOrchestrator(sb2);
    h2.orch.createTask({ title: 'Other repo task', spec: agentSpec({ write: { 'b.txt': 'b' } }) });
    await h2.orch.runAll();
    const multi = await startUiServer({ projects: [{ orch: h.orch, hub }, { orch: h2.orch, hub: new OutputHub() }], uiDir: path.resolve(import.meta.dirname, '../ui') });
    try {
      const a = JSON.parse((await get(multi.url + '/api/state')).body);
      assert.equal(a.projects.length, 2);
      const [pa, pb] = a.projects.map((p: any) => p.id);
      assert.notEqual(pa, pb, 'ids are unique even when repository names collide');
      assert.equal(a.project, pa);
      const b = JSON.parse((await get(`${multi.url}/api/state?project=${pb}`)).body);
      assert.equal(b.project, pb);
      assert.deepEqual(b.tasks.map((t: any) => t.title), ['Other repo task']);
      assert.equal((await get(`${multi.url}/api/state?project=nope`)).status, 404);
      const d = JSON.parse((await get(`${multi.url}/api/tasks/1/diff?project=${pb}`)).body);
      assert.deepEqual(d.files.map((f: any) => f.path), ['b.txt']);
      const before = h.store.latestMerge(1)!.status;
      assert.equal((await get(`${multi.url}/api/tasks/1/rollback?project=${pb}`, { 'x-ao-token': multi.token }, 'POST')).status, 200);
      assert.equal(h2.store.latestMerge(1)!.status, 'rolled_back');
      assert.equal(h.store.latestMerge(1)!.status, before, 'the other project is untouched');
    } finally { await multi.close(); sb2.cleanup(); }
  });
});
