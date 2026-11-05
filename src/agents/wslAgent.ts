import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { claudeAgentSettings } from './cliAgents.ts';
import type { AgentHandle, AgentProvider, SpawnRequest } from './provider.ts';

// Windows: Claude Code engineers run inside a WSL2 distro, where Claude Code's own Linux sandbox (bubblewrap) applies.
// The control plane stays on Windows; the agent sees its worktree through /mnt/<drive>.

/** C:\Users\me\x -> /mnt/c/Users/me/x (WSL's default automount). */
export function wslPath(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) throw new Error(`not a drive path: ${p}`);
  return `/mnt/${m[1]!.toLowerCase()}/${m[2]!.replace(/\\/g, '/')}`;
}

/** Windows secrets are visible under /mnt/c inside WSL, so the deny rules name them too. */
export const WSL_DENY = ['.ssh', '.aws', '.config/gh', '.claude', 'AppData'].map((d) => `Read(//mnt/*/Users/*/${d}/**)`)
  .concat('Read(//mnt/*/Users/*/.claude.json)');

/** The argv stored on a task. argv[0] is a marker: WslProvider runs the distro's own Claude Code. */
export function wslClaudeArgv(prompt: string, model?: string): string[] {
  return ['claude', '-p', prompt, '--permission-mode', 'acceptEdits', '--settings', JSON.stringify(claudeAgentSettings(true, WSL_DENY)), ...(model ? ['--model', model] : [])];
}

/**
 * The arguments go to WSL as a NUL-separated file read by xargs, so no Windows or Linux shell ever re-parses the prompt;
 * the only things on the wsl.exe command line are paths.
 */
export function wslPlan(distro: string, req: SpawnRequest): { argv: string[]; files: Record<string, string> } {
  const tmp = `${req.cwd}.tmp`;
  const files = {
    [path.join(tmp, 'args')]: req.argv.slice(1).join('\0'),
    // -x: fail instead of silently splitting a very long prompt over two runs.
    [path.join(tmp, 'run.sh')]: 'exec xargs -0 -x -a "$(dirname "$0")/args" "$HOME/.local/bin/claude"\n',
  };
  return { files, argv: ['wsl.exe', '-d', distro, '--cd', wslPath(req.cwd), '-e', 'sh', wslPath(path.join(tmp, 'run.sh'))] };
}

export class WslProvider implements AgentProvider {
  readonly name: string;
  private inner: AgentProvider; private distro: string;
  constructor(inner: AgentProvider, distro: string) { this.inner = inner; this.distro = distro; this.name = `${inner.name}+wsl`; }
  spawn(req: SpawnRequest): AgentHandle {
    if (req.argv[0] !== 'claude') throw new Error('WSL runner only runs tasks planned for WSL Claude Code');
    const plan = wslPlan(this.distro, req);
    // shortcut: the .tmp dir next to the worktree is not removed with it; fold into worktree cleanup if it accumulates.
    for (const [f, body] of Object.entries(plan.files)) { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, body); }
    return this.inner.spawn({ ...req, argv: plan.argv });
  }
}
