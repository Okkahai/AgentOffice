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
  buildArgv(bin: string, prompt: string): string[];
}

export const CLI_SPECS: Record<CliKind, CliSpec> = {
  claude: {
    kind: 'claude', bin: 'claude',
    buildArgv: (bin, prompt) => [bin, '-p', prompt, '--permission-mode', 'acceptEdits'],
  },
  codex: {
    kind: 'codex', bin: 'codex',
    buildArgv: (bin, prompt) => [bin, 'exec', '--full-auto', prompt],
  },
  opencode: {
    kind: 'opencode', bin: 'opencode',
    buildArgv: (bin, prompt) => [bin, 'run', prompt],
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
export function buildAgentArgv(kind: CliKind, prompt: string, pathVar?: string): string[] {
  const bin = findOnPath(CLI_SPECS[kind].bin, pathVar);
  if (!bin) throw new Error(`${kind} CLI not found on PATH`);
  return CLI_SPECS[kind].buildArgv(bin, prompt);
}
