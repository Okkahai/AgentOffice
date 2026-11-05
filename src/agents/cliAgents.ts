import { accessSync, constants, readFileSync } from 'node:fs';
import path from 'node:path';

// Provider-specific knowledge lives only here: how to find each CLI and build its non-interactive argv.
// Uses the user's existing CLI login; never an API key. Flags target the installed versions and are
// re-checked by `detectCli` output in Settings; unknown flags fail loudly in the agent process, not silently.

export type CliKind = 'claude' | 'codex' | 'opencode';

/** Which isolation layers an agent CLI gets on this machine, for the UI. Codex uses its own workspace-write sandbox; under WSL Claude Code's own Linux sandbox applies. */
export function agentIsolation(kind: CliKind, platform: string = process.platform, wsl = false): 'os-sandbox' | 'permission-rules' | 'none' {
  if (kind === 'claude') return wsl || claudeOsSandbox(platform) ? 'os-sandbox' : 'permission-rules';
  if (kind === 'codex') return 'os-sandbox'; // --full-auto = workspace-write sandbox (experimental on native Windows)
  return 'none';
}

export interface CliSpec {
  kind: CliKind;
  bin: string;
  /** argv for a one-shot autonomous task inside the worktree cwd. */
  buildArgv(bin: string, prompt: string, model?: string): string[];
}

/**
 * Claude Code engineers always run with these settings; there is no profile that removes them.
 * Deny rules stop the usual forms of push, network and secret reads (Claude Code enforces them, the model can't
 * override them), and bypass mode is disabled. They match command text, so they are not a boundary on their own:
 * where Claude Code's OS sandbox exists (macOS; Linux/WSL2 with bubblewrap) it is enabled with no unsandboxed escape.
 * Native Windows has no Claude Code sandbox, so there the rules are the only layer and the UI says so.
 */
export function claudeAgentSettings(osSandbox: boolean, extraDeny: string[] = []): Record<string, unknown> {
  return {
    permissions: {
      deny: [
        'Bash(git push *)', 'Bash(git remote *)', 'Bash(git config *)', 'Bash(curl *)', 'Bash(wget *)', 'Bash(ssh *)', 'Bash(scp *)',
        'WebFetch', 'WebSearch', 'Read(~/.ssh/**)', 'Read(~/.aws/**)', 'Read(~/.config/gh/**)', 'Read(//**/.env)', ...extraDeny,
      ],
      disableBypassPermissionsMode: 'disable',
    },
    ...(osSandbox ? { sandbox: { enabled: true, allowUnsandboxedCommands: false } } : {}),
  };
}

/** Whether Claude Code's OS sandbox can run here: macOS, or Linux (incl. WSL2) with bubblewrap installed. */
export function claudeOsSandbox(platform: string = process.platform, pathVar?: string): boolean {
  return platform === 'darwin' || (platform === 'linux' && !!findOnPath('bwrap', pathVar));
}

export const CLI_SPECS: Record<CliKind, CliSpec> = {
  claude: {
    kind: 'claude', bin: 'claude',
    buildArgv: (bin, prompt, model) => [bin, '-p', prompt, '--permission-mode', 'acceptEdits',
      '--settings', JSON.stringify(claudeAgentSettings(claudeOsSandbox())), ...(model ? ['--model', model] : [])],
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
export interface AgentProfile { agent: CliKind; model?: string; branch?: string; /** Windows: run Claude Code engineers in this WSL distro. */ wsl?: string }

export function parseProfile(raw: unknown, defaults: AgentProfile): AgentProfile {
  if (raw == null) return defaults;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('profile must be a JSON object');
  const o = raw as Record<string, unknown>;
  const unknown = Object.keys(o).filter((k) => !['agent', 'model', 'branch', 'wsl'].includes(k));
  if (unknown.length) throw new Error(`profile: unsupported keys ${unknown.join(', ')} (allowed: agent, model, branch, wsl)`);
  const agent = o.agent ?? defaults.agent;
  if (typeof agent !== 'string' || !(agent in CLI_SPECS)) throw new Error(`profile: agent must be one of ${Object.keys(CLI_SPECS).join(', ')}`);
  const model = o.model ?? defaults.model;
  if (model != null && (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/.test(model))) throw new Error('profile: model must be a plain model name');
  const branch = o.branch ?? defaults.branch;
  if (branch != null && (typeof branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(branch) || branch.includes('..'))) throw new Error('profile: branch must be a plain branch name');
  const wsl = o.wsl ?? defaults.wsl;
  if (wsl != null && (typeof wsl !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(wsl))) throw new Error('profile: wsl must be a WSL distro name');
  if (wsl != null && agent !== 'claude') throw new Error('profile: wsl is only supported for the claude agent');
  return { agent: agent as CliKind, model: model as string | undefined, branch: branch as string | undefined, ...(wsl ? { wsl: wsl as string } : {}) };
}

/**
 * Windows: npm installs CLIs as .cmd shims, which Node refuses to spawn without a shell (and a shell would
 * re-parse the prompt). Read the shim and run its real target directly: a .js entry under this Node, or an .exe.
 */
export function resolveShim(argv: string[], platform: string = process.platform): string[] {
  const [cmd, ...rest] = argv;
  if (platform !== 'win32' || !cmd || !/\.(cmd|bat)$/i.test(cmd)) return argv;
  const text = readFileSync(cmd, 'utf8');
  const targets = [...text.matchAll(/"%~?dp0%?\\([^"%]+)"/gi)].map((m) => m[1]!).filter((t) => !/(^|\\)node(\.exe)?$/i.test(t));
  const target = targets.at(-1);
  if (!target) throw new Error(`${cmd} is not an npm shim Agent Office can run without a shell; put the CLI's .exe on PATH instead`);
  const full = path.join(path.dirname(cmd), ...target.split(/[\\/]/));
  if (/\.[cm]?js$/i.test(full)) return [process.execPath, full, ...rest];
  if (/\.exe$/i.test(full)) return [full, ...rest];
  throw new Error(`${cmd} points at ${full}, which is neither a .js entry nor an .exe`);
}
