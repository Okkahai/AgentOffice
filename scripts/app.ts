// Agent Office on one of YOUR repositories, with real CLI agents (their own logins, no API keys).
//   npm start -- <repo-path> [--agent claude|codex|opencode] [--branch main] [--port 4174]
// State and worktrees live in ~/.agent-office/<repo-name>, outside the repository.
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildAgentArgv, detectClis, type CliKind } from '../src/agents/cliAgents.ts';
import { CommandProvider, type AgentProvider } from '../src/agents/provider.ts';
import { Orchestrator } from '../src/core/orchestrator.ts';
import { Store } from '../src/core/store.ts';
import { GitService } from '../src/git/gitService.ts';
import { ClaudePlanner } from '../src/manager/claudePlanner.ts';
import { ClaudeReviewer } from '../src/manager/claudeReviewer.ts';
import { planAndApply } from '../src/manager/plan.ts';
import { OutputHub, startUiServer } from '../src/server/server.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { agent: { type: 'string', default: 'claude' }, branch: { type: 'string', default: 'main' }, port: { type: 'string', default: '4174' } } });
const repo = path.resolve(positionals[0] ?? '.');
if (!existsSync(path.join(repo, '.git'))) { console.error(`Not a git repository: ${repo}`); process.exit(1); }
const kind = values.agent as CliKind;
const clis = detectClis();
console.log('detected CLIs:', clis);
if (!clis[kind]) { console.error(`${kind} CLI not found on PATH`); process.exit(1); }

const dataDir = path.join(homedir(), '.agent-office', path.basename(repo));
mkdirSync(dataDir, { recursive: true });

let provider: AgentProvider = new CommandProvider();
try { provider = new (await import('../src/agents/ptyProvider.ts')).PtyProvider(); }
catch (e) { console.warn('node-pty unavailable, using pipes:', (e as Error).message.split('\n')[0]); }

const hub = new OutputHub();
const orch = new Orchestrator({
  store: new Store(path.join(dataDir, 'state.db')),
  git: new GitService({ repoRoot: repo, worktreesDir: path.join(dataDir, 'worktrees') }),
  provider, onAgentOutput: hub.push, targetBranch: values.branch, agentTimeoutMs: 30 * 60_000,
  reviewer: clis.claude ? new ClaudeReviewer() : undefined,
});
if (!clis.claude) console.warn('claude CLI missing: only deterministic review gates will run, and goal planning is unavailable');
await orch.recover();

// One runner at a time; tasks created while it runs are picked up by its loop, later ones re-kick it.
let running: Promise<void> | null = null;
const kick = () => {
  running ??= orch.runAll().catch((e) => console.error('run failed:', e)).finally(() => {
    running = null;
    const ready = orch.store.listTasks().some((t) => t.status === 'QUEUED' && orch.store.deps(t.id).every((d) => orch.store.getTask(d)?.status === 'COMPLETED'));
    if (ready) setTimeout(kick, 0);
  });
};

const planner = clis.claude ? new ClaudePlanner(repo) : null;
const srv = await startUiServer({
  orch, hub, uiDir: path.resolve(import.meta.dirname, '../ui'), port: Number(values.port),
  onGoal: planner ? async (goal) => { await planAndApply(orch, planner, goal, (p) => buildAgentArgv(kind, p)); kick(); } : undefined,
});
console.log(`Agent Office: ${srv.url}\n  repository: ${repo} (${values.branch})\n  agents: ${kind}\n  data: ${dataDir}`);
kick();
