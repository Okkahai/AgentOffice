import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { containerName, sandboxPlan, worktreeGitDirs } from '../src/agents/winSandbox.ts';

test('sandbox plan grants the worktree, its git dir and the CLI dir, and nothing writable in the repo', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-wsb-'));
  const common = path.join(root, 'repo', '.git'), gitDir = path.join(common, 'worktrees', 'task-1'), wt = path.join(root, 'wt', 'task-1');
  mkdirSync(gitDir, { recursive: true }); mkdirSync(wt, { recursive: true });
  writeFileSync(path.join(wt, '.git'), `gitdir: ${gitDir}\n`);
  writeFileSync(path.join(gitDir, 'commondir'), '../..\n');
  assert.deepEqual(worktreeGitDirs(wt), { gitDir, commonDir: common });

  const cli = path.join(root, 'bin', 'claude'); mkdirSync(path.dirname(cli)); writeFileSync(cli, '');
  const plan = sandboxPlan('ao-sandbox.exe', 'AgentOffice.repo', { agentId: 'a', argv: [cli, '-p', 'do "it"'], cwd: wt }, path.join(root, 'cfg'));
  const flags = (f: string) => plan.argv.flatMap((a, i) => (plan.argv[i - 1] === f ? [a] : []));
  assert.deepEqual(flags('--rw'), [wt, `${wt}.tmp`, path.join(root, 'cfg'), gitDir]);
  assert.deepEqual(flags('--ro'), [common, path.dirname(cli)]);
  assert.deepEqual(plan.argv.slice(plan.argv.indexOf('--') + 1), [cli, '-p', 'do "it"']);
  assert.equal(plan.env.TEMP, `${wt}.tmp`);
  assert.equal(containerName('my repo!'), 'AgentOffice.my_repo_');
});
