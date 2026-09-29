// Runs the full core loop on a disposable repo and prints the audit trail.  `npm run demo`
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CommandProvider } from '../src/agents/provider.ts';
import { Orchestrator } from '../src/core/orchestrator.ts';
import { Store } from '../src/core/store.ts';
import { GitService } from '../src/git/gitService.ts';

const base = mkdtempSync(path.join(tmpdir(), 'agent-office-demo-'));
const repo = path.join(base, 'repo');
const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=d@d', ...a], { cwd: repo, encoding: 'utf8' }).trim();
execFileSync('git', ['init', '-q', '-b', 'main', repo]);
writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
g('add', '-A'); g('commit', '-q', '-m', 'init');

const agent = (files: Record<string, string>) => ({ argv: [process.execPath, '-e', `for (const [f,c] of Object.entries(${JSON.stringify(files)})) require('fs').writeFileSync(f,c)`] });
const store = new Store(path.join(base, 'state.db'));
const orch = new Orchestrator({
  store, git: new GitService({ repoRoot: repo, worktreesDir: path.join(base, 'worktrees') }), provider: new CommandProvider(),
  reviewer: { id: 'qa-1', review: async () => ({ approved: true, blockingIssues: [], warnings: [], summary: 'demo reviewer approves' }) },
});
orch.bus.subscribe((e) => console.log(`${e.ts.slice(11, 23)}  ${e.type.padEnd(26)} ${e.taskId ? `task=${e.taskId}` : ''}`));
const a = orch.createTask({ title: 'Add greeting', spec: agent({ 'greeting.txt': 'hello\n' }) });
orch.createTask({ title: 'Add docs', dependsOn: [a.id], spec: agent({ 'DOCS.md': '# docs\n' }) });
await orch.runAll();
console.log('\ntasks:', store.listTasks().map((t) => `#${t.id} ${t.title}: ${t.status}`).join(' | '));
console.log('backups:', store.backups().map((b) => b.ref).join(', '));
console.log('log:\n' + g('log', '--oneline', '--graph', 'main'));
store.close();
rmSync(base, { recursive: true, force: true });
