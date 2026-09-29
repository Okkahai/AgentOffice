import { spawn, type ChildProcess } from 'node:child_process';

// Provider abstraction: the orchestrator only knows this interface. Provider-specific argv
// (claude / codex / opencode) lives in provider modules. A PTY-backed provider (node-pty) will
// implement the same interface; the slice uses pipes so it has zero native dependencies.

export interface SpawnRequest {
  agentId: string;
  argv: string[];          // argv[0] is the executable; never passed through a shell
  cwd: string;             // must be the task worktree (checked by the orchestrator)
  env?: Record<string, string>;
}
export type AgentStatus = 'running' | 'exited' | 'terminated';
export interface AgentExit { code: number | null; signal: string | null; status: AgentStatus }

export interface AgentHandle {
  readonly agentId: string;
  readonly pid: number | undefined;
  getStatus(): AgentStatus;
  sendInput(text: string): void;
  interrupt(): void;
  terminate(graceMs?: number): Promise<void>;
  subscribeOutput(cb: (chunk: string) => void): () => void;
  readonly exited: Promise<AgentExit>;
}

export interface AgentProvider {
  readonly name: string;
  spawn(req: SpawnRequest): AgentHandle;
}

// Never leak inference credentials to agent processes unless the user opted in explicitly.
const SCRUB = /(_API_KEY|_TOKEN|_SECRET|PASSWORD)$/i;
export function scrubbedEnv(base: NodeJS.ProcessEnv, extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !SCRUB.test(k)) out[k] = v;
  return { ...out, ...extra };
}

/** Runs an arbitrary command as an agent. Claude Code / Codex / OpenCode providers will build argv and delegate here. */
export class CommandProvider implements AgentProvider {
  readonly name = 'command';
  spawn(req: SpawnRequest): AgentHandle {
    const [cmd, ...args] = req.argv;
    if (!cmd) throw new Error('empty argv');
    const child: ChildProcess = spawn(cmd, args, {
      cwd: req.cwd, env: scrubbedEnv(process.env, req.env), stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: true,
    });
    let status: AgentStatus = 'running';
    let terminating = false;
    const subs = new Set<(c: string) => void>();
    const push = (b: Buffer) => { const s = b.toString('utf8'); for (const f of subs) f(s); };
    child.stdout!.on('data', push);
    child.stderr!.on('data', push);
    child.stdin!.on('error', () => {});

    const exited = new Promise<AgentExit>((resolve) => {
      const done = (code: number | null, signal: string | null) => {
        if (status === 'running') status = terminating ? 'terminated' : 'exited';
        resolve({ code, signal, status });
      };
      child.on('exit', done);
      child.on('error', () => done(null, null));
    });
    const killGroup = (sig: NodeJS.Signals) => {
      try { process.kill(-child.pid!, sig); } catch { try { child.kill(sig); } catch { /* already gone */ } }
    };
    return {
      agentId: req.agentId,
      pid: child.pid,
      getStatus: () => status,
      sendInput: (t) => { child.stdin!.write(t); },
      interrupt: () => killGroup('SIGINT'),
      subscribeOutput: (cb) => { subs.add(cb); return () => subs.delete(cb); },
      exited,
      async terminate(graceMs = 2000) {
        if (status !== 'running') return;
        terminating = true;
        killGroup('SIGTERM');
        const t = setTimeout(() => killGroup('SIGKILL'), graceMs);
        await exited;
        clearTimeout(t);
      },
    };
  }
}
