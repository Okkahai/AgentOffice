import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CommandProvider, scrubbedEnv } from '../src/agents/provider.ts';
import { FAKE_AGENT } from './helpers.ts';

const node = process.execPath;

describe('agent provider (real processes)', () => {
  it('streams output and reports exit', async () => {
    const h = new CommandProvider().spawn({ agentId: 'a', argv: [node, FAKE_AGENT, '{"echo":"hello"}'], cwd: process.cwd() });
    let out = '';
    h.subscribeOutput((c) => { out += c; });
    const exit = await h.exited;
    assert.equal(exit.code, 0);
    assert.equal(exit.status, 'exited');
    assert.match(out, /hello/);
  });

  it('terminates a long-running agent (and its process group)', async () => {
    const h = new CommandProvider().spawn({ agentId: 'a', argv: [node, FAKE_AGENT, '{"sleepMs":60000}'], cwd: process.cwd() });
    assert.equal(h.getStatus(), 'running');
    await h.terminate(500);
    const exit = await h.exited;
    assert.equal(exit.status, 'terminated');
    assert.equal(h.getStatus(), 'terminated');
    assert.throws(() => process.kill(h.pid!, 0), 'process must be gone');
  });

  it('does not leak API keys into agent processes', async () => {
    process.env.FAKE_API_KEY = 'secret';
    try {
      assert.equal(scrubbedEnv(process.env).FAKE_API_KEY, undefined);
      const h = new CommandProvider().spawn({ agentId: 'a', argv: [node, FAKE_AGENT, '{"printEnvKey":"FAKE_API_KEY"}'], cwd: process.cwd() });
      let out = '';
      h.subscribeOutput((c) => { out += c; });
      await h.exited;
      assert.match(out, /ENV:FAKE_API_KEY=\n/);
    } finally { delete process.env.FAKE_API_KEY; }
  });
});
