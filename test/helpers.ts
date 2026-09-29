import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CommandProvider } from '../src/agents/provider.ts';
import { EventBus } from '../src/core/events.ts';
import { Orchestrator, type OrchestratorConfig } from '../src/core/orchestrator.ts';
import { Store } from '../src/core/store.ts';
import { GitService } from '../src/git/gitService.ts';

export const FAKE_AGENT = path.resolve(import.meta.dirname, 'fixtures/fake-agent.mjs');

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
}

/** Disposable repo in the OS temp dir. NEVER point tests at a real repository. */
export function makeSandbox() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'agent-office-test-')));
  const repo = path.join(base, 'repo');
  const worktrees = path.join(base, 'worktrees');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'sandbox', scripts: { test: 'node check.js' } }));
  // Passing by default. "a.txt + b.txt" together is a semantic conflict that only post-merge verification sees.
  writeFileSync(path.join(repo, 'check.js'), `
const fs = require('fs');
if (fs.existsSync('BROKEN')) { console.error('BROKEN present'); process.exit(1); }
if (fs.existsSync('a.txt') && fs.existsSync('b.txt')) { console.error('a and b are incompatible'); process.exit(1); }
console.log('ok');
`);
  writeFileSync(path.join(repo, 'shared.txt'), 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  return { base, repo, worktrees, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

export function makeOrchestrator(sb: ReturnType<typeof makeSandbox>, over: Partial<OrchestratorConfig> = {}, dbFile = ':memory:') {
  const store = new Store(dbFile);
  const gitSvc = new GitService({ repoRoot: sb.repo, worktreesDir: sb.worktrees });
  const bus = new EventBus();
  const orch = new Orchestrator({ store, git: gitSvc, bus, provider: new CommandProvider(), reviewer: { id: 'qa-1', review: async () => ({ approved: true, blockingIssues: [], warnings: [], summary: 'lgtm' }) }, ...over });
  return { store, git: gitSvc, orch, bus };
}

/** Task spec whose agent is the scripted fake process. */
export const agentSpec = (script: object) => ({ argv: [process.execPath, FAKE_AGENT, JSON.stringify(script)] });
