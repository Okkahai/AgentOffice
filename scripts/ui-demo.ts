// Live office on a disposable repo with scripted (stub) agents so the scene has real events to show.
//   node scripts/ui-demo.ts [port]      then open the printed URL
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CommandProvider } from '../src/agents/provider.ts';
import { Orchestrator } from '../src/core/orchestrator.ts';
import { Store } from '../src/core/store.ts';
import { GitService } from '../src/git/gitService.ts';
import { planAndApply } from '../src/manager/plan.ts';
import { OutputHub, startUiServer } from '../src/server/server.ts';

const base = mkdtempSync(path.join(tmpdir(), 'agent-office-ui-'));
const repo = path.join(base, 'repo');
const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=d@d', ...a], { cwd: repo });
execFileSync('git', ['init', '-q', '-b', 'main', repo]);
writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "setTimeout(()=>process.exit(0),1500)"' } }));
g('add', '-A'); g('commit', '-q', '-m', 'init');

// Scripted stand-in agent: prints progress, writes a file, takes a few seconds.
const agent = (file: string, secs: number) => [process.execPath, '-e', `
  const fs=require('fs'); let i=0;
  console.log('reading repository…');
  const t=setInterval(()=>{ console.log('working '+(++i)+'/${secs}'); if(i>=${secs}){clearInterval(t);fs.writeFileSync('${file}','done\\n');console.log('wrote ${file}');} },1000);`];

const hub = new OutputHub();
const orch = new Orchestrator({
  store: new Store(path.join(base, 'state.db')),
  git: new GitService({ repoRoot: repo, worktreesDir: path.join(base, 'worktrees') }),
  provider: new CommandProvider(), onAgentOutput: hub.push, maxParallel: 2,
  reviewer: { id: 'qa-reviewer', review: async () => { await new Promise((r) => setTimeout(r, 2000)); return { approved: true, blockingIssues: [], warnings: [], summary: 'scripted reviewer approves' }; } },
});
const srv = await startUiServer({ orch, hub, uiDir: path.resolve(import.meta.dirname, '../ui'), port: Number(process.argv[2] ?? 0) });
console.log(`Agent Office UI: ${srv.url}   (demo repo: ${repo})`);

const planner = { plan: async () => ({ summary: 'Add auth', tasks: [
  { key: 'backend', title: 'Auth backend', description: '', dependsOn: [], prompt: 'backend.txt|7' },
  { key: 'frontend', title: 'Login UI', description: '', dependsOn: [], prompt: 'frontend.txt|9' },
  { key: 'integration', title: 'Integration', description: '', dependsOn: ['backend', 'frontend'], prompt: 'integration.txt|4' },
] }) };
await new Promise((r) => setTimeout(r, Number(process.env.UI_DEMO_DELAY ?? 4000))); // time to open the page
await planAndApply(orch, planner, 'Add authentication', (p) => { const [f, s] = p.split('|'); return agent(f!, Number(s)); });
await orch.runAll();
console.log('all tasks finished; server stays up. Ctrl+C to stop.');
