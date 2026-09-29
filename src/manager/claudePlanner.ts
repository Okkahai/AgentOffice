import { CommandProvider } from '../agents/provider.ts';
import { findOnPath } from '../agents/cliAgents.ts';
import { buildPlanPrompt, extractJson, type Planner } from './plan.ts';

/** Manager backed by the Claude Code CLI in read-only plan mode (user's own login, no API key). */
export class ClaudePlanner implements Planner {
  #repoRoot: string;
  #timeoutMs: number;
  constructor(repoRoot: string, timeoutMs = 5 * 60_000) { this.#repoRoot = repoRoot; this.#timeoutMs = timeoutMs; }

  async plan(goal: string): Promise<unknown> {
    const bin = findOnPath('claude');
    if (!bin) throw new Error('claude CLI not found on PATH');
    const h = new CommandProvider().spawn({ agentId: 'manager', argv: [bin, '-p', buildPlanPrompt(goal), '--permission-mode', 'plan'], cwd: this.#repoRoot });
    let out = '';
    h.subscribeOutput((c) => { out += c; });
    const timer = setTimeout(() => { void h.terminate(500); }, this.#timeoutMs);
    const exit = await h.exited;
    clearTimeout(timer);
    if (exit.code !== 0) throw new Error(`Manager exited with ${exit.code}: ${out.slice(-300)}`);
    return extractJson(out);
  }
}
