// One real coding-agent task through the full pipeline on a DISPOSABLE repo.
//   node scripts/real-agent.ts [claude|codex|opencode] ["prompt"]
// Uses the CLI's own login (no API keys). Set AGENT_OFFICE_FAKE=1 to use a stub agent instead.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildAgentArgv, detectClis, type CliKind } from '../src/agents/cliAgents.ts';
import { PtyProvider } from '../src/agents/ptyProvider.ts';
import { CommandProvider } from '../src/agents/provider.ts';
import { Orchestrator } from '../src/core/orchestrator.ts';
import { Store } from '../src/core/store.ts';
import { GitService } from '../src/git/gitService.ts';

const kind = (process.argv[2] ?? 'claude') as CliKind;
const prompt = process.argv[3] ?? 'Create a file named hello.txt containing exactly the text: hi. Do nothing else.';
const fake = process.env.AGENT_OFFICE_FAKE === '1';
console.log('detected CLIs:', detectClis());

const base = mkdtempSync(path.join(tmpdir(), 'agent-office-real-'));
const repo = path.join(base, 'repo');
const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=ao', '-c', 'user.email=ao@x', ...a], { cwd: repo, encoding: 'utf8' }).trim();
execFileSync('git', ['init', '-q', '-b', 'main', repo]);
writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
g('add', '-A'); g('commit', '-q', '-m', 'init');

const argv = fake
  ? [process.execPath, '-e', "require('fs').writeFileSync('hello.txt','hi')"]
  : buildAgentArgv(kind, prompt);
const store = new Store(path.join(base, 'state.db'));
const orch = new Orchestrator({
  store, git: new GitService({ repoRoot: repo, worktreesDir: path.join(base, 'worktrees') }),
  provider: fake ? new CommandProvider() : new PtyProvider(), agentTimeoutMs: 10 * 60_000,
  reviewer: { id: 'qa-1', review: async () => ({ approved: true, blockingIssues: [], warnings: [], summary: 'auto-approved for demo' }) },
});
orch.bus.subscribe((e) => console.log(e.ts.slice(11, 23), e.type, e.taskId ?? ''));
const t = orch.createTask({ title: 'Real agent task', spec: { argv } });
await orch.runAll();
const done = store.getTask(t.id)!;
console.log('\nstatus:', done.status, done.failure_reason ?? '');
console.log('backups:', store.backups().map((b) => b.ref).join(', ') || 'none');
console.log('git log:\n' + g('log', '--oneline', '--graph', 'main'));
console.log('temp repo (delete when done):', base);
store.close();
if (done.status === 'COMPLETED') rmSync(base, { recursive: true, force: true });
