import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildAgentArgv, detectClis } from '../src/agents/cliAgents.ts';
import { PtyProvider } from '../src/agents/ptyProvider.ts';
import { FAKE_AGENT } from './helpers.ts';

const node = process.execPath;

describe('PTY provider (real pseudo-terminal)', () => {
  it('streams output, accepts input, reports exit', async () => {
    const h = new PtyProvider().spawn({ agentId: 'p', argv: [node, '-e', "process.stdin.once('data',d=>{console.log('got:'+d.toString().trim());process.exit(0)});console.log('ready')"], cwd: process.cwd() });
    let out = '';
    h.subscribeOutput((c) => { out += c; if (out.includes('ready')) h.sendInput('ping\n'); });
    const exit = await h.exited;
    assert.equal(exit.code, 0);
    assert.match(out, /got:ping/);
  });

  it('terminates a running session', async () => {
    const h = new PtyProvider().spawn({ agentId: 'p', argv: [node, FAKE_AGENT, '{"sleepMs":60000}'], cwd: process.cwd() });
    await h.terminate(500);
    assert.equal((await h.exited).status, 'terminated');
  });

  it('does not leak API keys', async () => {
    process.env.FAKE_API_KEY = 'secret';
    try {
      const h = new PtyProvider().spawn({ agentId: 'p', argv: [node, FAKE_AGENT, '{"printEnvKey":"FAKE_API_KEY"}'], cwd: process.cwd() });
      let out = '';
      h.subscribeOutput((c) => { out += c; });
      await h.exited;
      assert.match(out, /ENV:FAKE_API_KEY=\r?\n/);
    } finally { delete process.env.FAKE_API_KEY; }
  });
});

describe('CLI detection and argv building', () => {
  it('detects installed CLIs from PATH only and builds argv arrays', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ao-bin-'));
    try {
      writeFileSync(path.join(dir, 'codex'), '#!/bin/sh\n');
      chmodSync(path.join(dir, 'codex'), 0o755);
      const found = detectClis(dir);
      assert.equal(found.codex, path.join(dir, 'codex'));
      assert.equal(found.claude, null);
      assert.equal(found.opencode, null);
      const argv = buildAgentArgv('codex', 'fix; rm -rf /', dir);
      assert.deepEqual(argv, [path.join(dir, 'codex'), 'exec', '--full-auto', 'fix; rm -rf /']); // prompt is one argv element, never shell-parsed
      assert.throws(() => buildAgentArgv('claude', 'x', dir), /not found/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
