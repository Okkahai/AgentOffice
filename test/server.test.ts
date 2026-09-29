import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { OutputHub, startUiServer } from '../src/server/server.ts';
import { agentSpec, makeOrchestrator, makeSandbox } from './helpers.ts';

const get = (url: string, headers: Record<string, string> = {}, method = 'GET') =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const u = new URL(url);
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method, headers }, (res) => {
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

  it('rollback through the UI uses the deterministic control plane', async () => {
    const r = await get(srv.url + '/api/tasks/1/rollback', { 'x-ao-token': srv.token }, 'POST');
    assert.equal(r.status, 200);
    assert.equal(h.store.latestMerge(1)!.status, 'rolled_back');
  });
});
