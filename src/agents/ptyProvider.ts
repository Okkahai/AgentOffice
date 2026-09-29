import * as pty from 'node-pty';
import type { AgentExit, AgentHandle, AgentProvider, AgentStatus, SpawnRequest } from './provider.ts';
import { scrubbedEnv } from './provider.ts';

/** Real PTY sessions (needed for interactive CLIs and xterm.js). Same contract as CommandProvider. */
export class PtyProvider implements AgentProvider {
  readonly name = 'pty';
  spawn(req: SpawnRequest): AgentHandle {
    const [cmd, ...args] = req.argv;
    if (!cmd) throw new Error('empty argv');
    const term = pty.spawn(cmd, args, {
      name: 'xterm-256color', cols: 120, rows: 30, cwd: req.cwd, env: scrubbedEnv(process.env, req.env),
    });
    let status: AgentStatus = 'running';
    let terminating = false;
    const exited = new Promise<AgentExit>((resolve) => {
      term.onExit(({ exitCode, signal }) => {
        if (status === 'running') status = terminating ? 'terminated' : 'exited';
        resolve({ code: exitCode, signal: signal ? String(signal) : null, status });
      });
    });
    return {
      agentId: req.agentId,
      pid: term.pid,
      getStatus: () => status,
      sendInput: (t) => term.write(t),
      interrupt: () => term.write('\x03'),
      subscribeOutput: (cb) => { const d = term.onData(cb); return () => d.dispose(); },
      exited,
      async terminate(graceMs = 2000) {
        if (status !== 'running') return;
        terminating = true;
        try { term.kill('SIGTERM'); } catch { /* gone */ }
        const t = setTimeout(() => { try { term.kill('SIGKILL'); } catch { /* gone */ } }, graceMs);
        await exited;
        clearTimeout(t);
      },
    };
  }
}
