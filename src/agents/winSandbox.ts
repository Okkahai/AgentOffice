import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveShim } from './cliAgents.ts';
import type { AgentHandle, AgentProvider, SpawnRequest } from './provider.ts';

// Windows OS isolation for agents: a small AppContainer launcher (native/win-sandbox/ao-sandbox.cs), compiled on first
// use with the C# compiler every Windows 10/11 ships in .NET Framework 4. Claude Code has no sandbox on native Windows;
// inside the container an agent reaches only its worktree, its temp dir, its own git metadata and its CLI's files.

const SOURCE = path.resolve(import.meta.dirname, '../../native/win-sandbox/ao-sandbox.cs');

/** Build (once per source version) and return the helper's path, or null when this machine cannot build it. */
export function ensureWinSandbox(binDir = path.join(homedir(), '.agent-office', 'bin')): string | null {
  const src = readFileSync(SOURCE);
  const exe = path.join(binDir, `ao-sandbox-${createHash('sha256').update(src).digest('hex').slice(0, 12)}.exe`);
  if (existsSync(exe)) return exe;
  const csc = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!existsSync(csc)) return null;
  mkdirSync(binDir, { recursive: true });
  try { execFileSync(csc, ['/nologo', '/optimize', '/platform:x64', `/out:${exe}`, SOURCE], { stdio: 'pipe', windowsHide: true }); }
  catch (e) { console.warn('Windows sandbox helper did not build:', String((e as { stdout?: Buffer }).stdout ?? e).slice(0, 2000)); return null; }
  return existsSync(exe) ? exe : null;
}

/** AppContainer names: up to 64 characters of letters, digits, '.', '_' and '-'. */
export function containerName(project: string): string {
  return `AgentOffice.${project.replace(/[^A-Za-z0-9._-]/g, '_')}`.slice(0, 64);
}

/** The worktree's own git dir and the repository's common dir, from the `.git` file git writes into a linked worktree. */
export function worktreeGitDirs(cwd: string): { gitDir: string; commonDir: string } | null {
  const dotGit = path.join(cwd, '.git');
  if (!existsSync(dotGit)) return null;
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'));
  if (!m) return null;
  const gitDir = path.resolve(cwd, m[1]!);
  const common = path.join(gitDir, 'commondir');
  const commonDir = existsSync(common) ? path.resolve(gitDir, readFileSync(common, 'utf8').trim()) : gitDir;
  return { gitDir, commonDir };
}

export interface SandboxPlan { argv: string[]; env: Record<string, string>; tmp: string }

/**
 * Wrap an agent command line in the helper. Read-write: the worktree, a per-task temp dir, the worktree's git dir
 * (index, HEAD) and the CLI's config dir. Read-only: the repository's git objects/refs and the CLI's install dirs.
 * Agents cannot commit or move refs: the orchestrator commits outside the sandbox.
 */
export function sandboxPlan(helper: string, name: string, req: SpawnRequest, configDir: string): SandboxPlan {
  const inner = resolveShim(req.argv);
  const tmp = `${req.cwd}.tmp`;
  const rw = [req.cwd, tmp, configDir], ro: string[] = [];
  const git = worktreeGitDirs(req.cwd);
  if (git) { rw.push(git.gitDir); ro.push(git.commonDir); }
  // The executable's dir and, for `node cli.js` style entries, the script's dir.
  for (const a of inner.slice(0, 2)) if (path.isAbsolute(a) && existsSync(a)) ro.push(path.dirname(a));
  const argv = [helper, '--name', name, ...rw.flatMap((p) => ['--rw', p]), ...[...new Set(ro)].flatMap((p) => ['--ro', p]), '--net', '--', ...inner];
  const gitconfig = path.join(tmp, 'gitconfig');
  // No access to ~/.gitconfig in the container, and git treats an unreadable global config as fatal.
  return { argv, tmp, env: { TEMP: tmp, TMP: tmp, GIT_CONFIG_GLOBAL: gitconfig, CLAUDE_CONFIG_DIR: configDir } };
}

/** Runs every agent of the wrapped provider inside the AppContainer. */
export class WinSandboxProvider implements AgentProvider {
  readonly name: string;
  private inner: AgentProvider; private helper: string; private container: string; private configDir: string;
  constructor(inner: AgentProvider, helper: string, container: string, configDir = path.join(homedir(), '.claude')) {
    this.inner = inner; this.helper = helper; this.container = container; this.configDir = configDir;
    this.name = `${inner.name}+appcontainer`;
  }
  spawn(req: SpawnRequest): AgentHandle {
    const plan = sandboxPlan(this.helper, this.container, req, this.configDir);
    // shortcut: the temp dir sits next to the worktree and is not removed with it; clean up with the worktree when this grows.
    mkdirSync(plan.tmp, { recursive: true });
    mkdirSync(this.configDir, { recursive: true });
    writeFileSync(path.join(plan.tmp, 'gitconfig'), '');
    return this.inner.spawn({ ...req, argv: plan.argv, env: { ...req.env, ...plan.env } });
  }
}
