// Agent Office on one of YOUR repositories, with real CLI agents (their own logins, no API keys).
//   npm start -- <repo-path> [<repo-path> ...] [--agent claude|codex|opencode] [--branch main] [--port 4174]
// Each repository is its own project. State and worktrees live in ~/.agent-office/<repo-name>, outside the repository.
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
import { OutputHub, startUiServer, type ProjectHandle } from '../src/server/server.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { agent: { type: 'string', default: 'claude' }, branch: { type: 'string', default: 'main' }, port: { type: 'string', default: '4174' } } });
const repos = (positionals.length ? positionals : ['.']).map((r) => path.resolve(r));
const kind = values.agent as CliKind;
const clis = detectClis();
console.log('detected CLIs:', clis);
if (!clis[kind]) { console.error(`${kind} CLI not found on PATH`); process.exit(1); }
if (!clis.claude) console.warn('claude CLI missing: only deterministic review gates will run, and goal planning is unavailable');

let provider: AgentProvider = new CommandProvider();
try { provider = new (await import('../src/agents/ptyProvider.ts')).PtyProvider(); }
catch (e) { console.warn('node-pty unavailable, using pipes:', (e as Error).message.split('\n')[0]); }

/** One Orchestrator per repository: its own state.db, worktrees and merge lock. */
async function openProject(repo: string): Promise<ProjectHandle & { dataDir: string }> {
  if (!existsSync(path.join(repo, '.git'))) throw new Error(`Not a git repository: ${repo}`);
  const dataDir = path.join(homedir(), '.agent-office', path.basename(repo));
  mkdirSync(dataDir, { recursive: true });
  const hub = new OutputHub();
  const git = new GitService({ repoRoot: repo, worktreesDir: path.join(dataDir, 'worktrees') });
  if (!(await git.tryResolve(`refs/heads/${values.branch}`))) throw new Error(`${repo} has no branch ${values.branch} (use --branch)`);
  const orch = new Orchestrator({
    store: new Store(path.join(dataDir, 'state.db')), git,
    provider, onAgentOutput: hub.push, targetBranch: values.branch, agentTimeoutMs: 30 * 60_000,
    reviewer: clis.claude ? new ClaudeReviewer() : undefined,
  });
  await orch.recover();

  // One runner at a time; tasks created while it runs are picked up by its loop, later ones re-kick it.
  let running: Promise<void> | null = null;
  const kick = () => {
    running ??= orch.runAll().catch((e) => console.error(`run failed (${repo}):`, e)).finally(() => {
      running = null;
      const ready = orch.store.listTasks().some((t) => t.status === 'QUEUED' && orch.store.deps(t.id).every((d) => orch.store.getTask(d)?.status === 'COMPLETED'));
      if (ready) setTimeout(kick, 0);
    });
  };
  kick();
  const planner = clis.claude ? new ClaudePlanner(repo) : null;
  return {
    orch, hub, dataDir, kick,
    onGoal: planner ? async (goal) => { await planAndApply(orch, planner, goal, (p) => buildAgentArgv(kind, p)); kick(); } : undefined,
  };
}

const names = repos.map((r) => path.basename(r));
const dup = names.find((n, i) => names.indexOf(n) !== i);
if (dup) { console.error(`Two repositories are named ${dup}; their data directories would collide in ~/.agent-office`); process.exit(1); }
let projects;
try { projects = await Promise.all(repos.map(openProject)); }
catch (e) { console.error((e as Error).message); process.exit(1); }

const srv = await startUiServer({ projects, uiDir: path.resolve(import.meta.dirname, '../ui'), port: Number(values.port) });
console.log(`Agent Office: ${srv.url}\n  agents: ${kind}, target branch: ${values.branch}`);
for (const p of projects) console.log(`  ${p.orch.git.root}  (data: ${p.dataDir})`);
