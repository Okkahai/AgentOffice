import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildAgentArgv, detectClis, parseProfile, resolveShim } from '../src/agents/cliAgents.ts';
import { FAKE_AGENT } from './helpers.ts';

const node = process.execPath;

// node-pty is a native module; skip (don't hang) when it isn't built here or never reports exit (some Windows ConPTY setups).
let PtyProvider: typeof import('../src/agents/ptyProvider.ts').PtyProvider | undefined;
try {
  const mod = await import('../src/agents/ptyProvider.ts');
  PtyProvider = (await mod.ptyWorks()) ? mod.PtyProvider : undefined;
} catch { PtyProvider = undefined; }


describe('PTY provider (real pseudo-terminal)', { skip: !PtyProvider && 'node-pty not available' }, () => {
  it('streams output, accepts input, reports exit', async () => {
    const h = new PtyProvider!().spawn({ agentId: 'p', argv: [node, '-e', "process.stdin.once('data',d=>{console.log('got:'+d.toString().trim());process.exit(0)});console.log('ready')"], cwd: process.cwd() });
    let out = '', sent = false;
    h.subscribeOutput((c) => { out += c; if (!sent && out.includes('ready')) { sent = true; h.sendInput('ping\n'); } });
    const exit = await h.exited;
    assert.equal(exit.code, 0);
    assert.match(out, /got:ping/);
  });

  it('terminates a running session', async () => {
    const h = new PtyProvider!().spawn({ agentId: 'p', argv: [node, FAKE_AGENT, '{"sleepMs":60000}'], cwd: process.cwd() });
    await h.terminate(500);
    assert.equal((await h.exited).status, 'terminated');
  });

  it('does not leak API keys', async () => {
    process.env.FAKE_API_KEY = 'secret';
    try {
      const h = new PtyProvider!().spawn({ agentId: 'p', argv: [node, FAKE_AGENT, '{"printEnvKey":"FAKE_API_KEY"}'], cwd: process.cwd() });
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
      assert.deepEqual(buildAgentArgv('codex', 'go', dir, 'gpt-x'), [path.join(dir, 'codex'), 'exec', '--full-auto', '--model', 'gpt-x', 'go']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('agent profiles', () => {
  const d = { agent: 'claude' as const, branch: 'main' };
  it('accepts only agent, model and branch, with plain values', () => {
    assert.deepEqual(parseProfile(undefined, d), d);
    assert.deepEqual(parseProfile({ agent: 'codex', model: 'o4-mini', branch: 'master' }, d), { agent: 'codex', model: 'o4-mini', branch: 'master' });
    assert.throws(() => parseProfile({ args: ['--dangerously-skip-permissions'] }, d), /unsupported keys args/);
    assert.throws(() => parseProfile({ model: '--dangerously-skip-permissions' }, d), /plain model/);
    assert.throws(() => parseProfile({ agent: 'bash' }, d), /agent must be/);
    assert.throws(() => parseProfile({ branch: '../main' }, d), /plain branch/);
    assert.throws(() => parseProfile([], d), /object/);
  });
});

describe('Windows npm shims', () => {
  it('runs the shim target directly, never through a shell', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ao-shim-'));
    try {
      const js = path.join(dir, 'claude.cmd'), exe = path.join(dir, 'codex.cmd'), odd = path.join(dir, 'odd.cmd');
      writeFileSync(js, '@ECHO off\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\nendLocal & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n');
      writeFileSync(exe, '@ECHO off\r\n"%~dp0\\node_modules\\@openai\\codex\\bin\\codex.exe"   %*\r\n');
      writeFileSync(odd, '@ECHO off\r\ncall something-else %*\r\n');
      assert.deepEqual(resolveShim([js, '-p', 'a & b'], 'win32'), [process.execPath, path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'), '-p', 'a & b']);
      assert.deepEqual(resolveShim([exe, 'exec', 'x'], 'win32'), [path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.exe'), 'exec', 'x']);
      assert.throws(() => resolveShim([odd], 'win32'), /without a shell/);
      assert.deepEqual(resolveShim([js, 'x'], 'linux'), [js, 'x'], 'only Windows is affected');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

