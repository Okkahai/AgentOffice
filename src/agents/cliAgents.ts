import { accessSync, constants } from 'node:fs';
import path from 'node:path';

// Provider-specific knowledge lives only here: how to find each CLI and build its non-interactive argv.
// Uses the user's existing CLI login; never an API key. Flags target the installed versions and are
// re-checked by `detectCli` output in Settings; unknown flags fail loudly in the agent process, not silently.

export type CliKind = 'claude' | 'codex' | 'opencode';

export interface CliSpec {
  kind: CliKind;
  bin: string;
  /** argv for a one-shot autonomous task inside the worktree cwd. */
  buildArgv(bin: string, prompt: string, model?: string): string[];
}

export const CLI_SPECS: Record<CliKind, CliSpec> = {
  claude: {
    kind: 'claude', bin: 'claude',
    buildArgv: (bin, prompt, model) => [bin, '-p', prompt, '--permission-mode', 'acceptEdits', ...(model ? ['--model', model] : [])],
  },
  codex: {
    kind: 'codex', bin: 'codex',
    buildArgv: (bin, prompt, model) => [bin, 'exec', '--full-auto', ...(model ? ['--model', model] : []), prompt],
  },
  opencode: {
    kind: 'opencode', bin: 'opencode',
    buildArgv: (bin, prompt, model) => [bin, 'run', ...(model ? ['--model', model] : []), prompt],
  },
};

/** PATH lookup without spawning a shell. */
export function findOnPath(bin: string, pathVar = process.env.PATH ?? ''): string | null {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD').split(';').concat('') : [''];
  for (const dir of pathVar.split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = path.join(dir, bin + ext);
      try { accessSync(p, constants.X_OK); return p; } catch { /* next */ }
    }
  }
  return null;
}

export function detectClis(pathVar?: string): Record<CliKind, string | null> {
  return Object.fromEntries((Object.keys(CLI_SPECS) as CliKind[]).map((k) => [k, findOnPath(CLI_SPECS[k].bin, pathVar)])) as Record<CliKind, string | null>;
}

/** Build the spawn argv for a task prompt; throws if the CLI is not installed. */
export function buildAgentArgv(kind: CliKind, prompt: string, pathVar?: string, model?: string): string[] {
  const bin = findOnPath(CLI_SPECS[kind].bin, pathVar);
  if (!bin) throw new Error(`${kind} CLI not found on PATH`);
  return CLI_SPECS[kind].buildArgv(bin, prompt, model);
}

/**
 * Per-project agent profile. Deliberately an allowlist (CLI, model, target branch), not free-form flags:
 * no profile can add a permission-bypass or sandbox-disabling flag.
 */
export interface AgentProfile { agent: CliKind; model?: string; branch?: string }

export function parseProfile(raw: unknown, defaults: AgentProfile): AgentProfile {
  if (raw == null) return defaults;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('profile must be a JSON object');
  const o = raw as Record<string, unknown>;
  const unknown = Object.keys(o).filter((k) => !['agent', 'model', 'branch'].includes(k));
  if (unknown.length) throw new Error(`profile: unsupported keys ${unknown.join(', ')} (allowed: agent, model, branch)`);
  const agent = o.agent ?? defaults.agent;
  if (typeof agent !== 'string' || !(agent in CLI_SPECS)) throw new Error(`profile: agent must be one of ${Object.keys(CLI_SPECS).join(', ')}`);
  const model = o.model ?? defaults.model;
  if (model != null && (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/.test(model))) throw new Error('profile: model must be a plain model name');
  const branch = o.branch ?? defaults.branch;
  if (branch != null && (typeof branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(branch) || branch.includes('..'))) throw new Error('profile: branch must be a plain branch name');
  return { agent: agent as CliKind, model: model as string | undefined, branch: branch as string | undefined };
}
