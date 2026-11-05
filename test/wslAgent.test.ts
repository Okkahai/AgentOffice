import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfile } from '../src/agents/cliAgents.ts';
import { wslClaudeArgv, wslPath, wslPlan } from '../src/agents/wslAgent.ts';

test('WSL runner passes the prompt as a file, never on a command line', () => {
  assert.equal(wslPath('C:\\Users\\me\\.agent-office\\r\\worktrees\\task-1'), '/mnt/c/Users/me/.agent-office/r/worktrees/task-1');
  assert.throws(() => wslPath('\\\\server\\share'));
  const argv = wslClaudeArgv('say "hi"; rm -rf / $(x)');
  const settings = JSON.parse(argv[argv.indexOf('--settings') + 1]);
  assert.equal(settings.sandbox.enabled, true);
  assert.ok(settings.permissions.deny.includes('Read(//mnt/*/Users/*/.ssh/**)'));
  const plan = wslPlan('kali-linux', { agentId: 'a', argv, cwd: 'C:\\w\\task-1' });
  assert.deepEqual(plan.argv, ['wsl.exe', '-d', 'kali-linux', '--cd', '/mnt/c/w/task-1', '-e', 'sh', '/mnt/c/w/task-1.tmp/run.sh']);
  const args = Object.entries(plan.files).find(([f]) => f.endsWith('args'))![1].split('\0');
  assert.deepEqual(args, argv.slice(1));
});

test('profile wsl key is validated and claude-only', () => {
  assert.equal(parseProfile({ wsl: 'kali-linux' }, { agent: 'claude' }).wsl, 'kali-linux');
  assert.throws(() => parseProfile({ wsl: 'bad distro;' }, { agent: 'claude' }));
  assert.throws(() => parseProfile({ agent: 'codex', wsl: 'kali-linux' }, { agent: 'claude' }));
});
