import { CommandProvider } from '../agents/provider.ts';
import { findOnPath } from '../agents/cliAgents.ts';
import type { ReviewContext, ReviewResult, Reviewer } from '../core/review.ts';
import { extractJson } from './plan.ts';

/** Independent reviewer: a separate Claude Code process in read-only plan mode. It never sees the engineer's session. */
export class ClaudeReviewer implements Reviewer {
  readonly id = 'claude-reviewer';
  #timeoutMs: number;
  constructor(timeoutMs = 10 * 60_000) { this.#timeoutMs = timeoutMs; }

  async review({ task, diff, verificationPassed }: ReviewContext): Promise<ReviewResult> {
    const bin = findOnPath('claude');
    if (!bin) return { approved: false, blockingIssues: ['claude CLI not found on PATH; independent review could not run'], warnings: [], summary: 'review unavailable' };
    if (!task.worktree_path) return { approved: false, blockingIssues: ['task has no worktree to review'], warnings: [], summary: 'review unavailable' };
    const h = new CommandProvider().spawn({ agentId: this.id, argv: [bin, '-p', buildReviewPrompt(task.title, task.description, diff.patch, verificationPassed), '--permission-mode', 'plan'], cwd: task.worktree_path });
    let out = '';
    h.subscribeOutput((c) => { out += c; });
    const timer = setTimeout(() => { void h.terminate(500); }, this.#timeoutMs);
    const exit = await h.exited;
    clearTimeout(timer);
    if (exit.code !== 0) return { approved: false, blockingIssues: [`reviewer exited with ${exit.code}`], warnings: [], summary: out.slice(-300) };
    return parseReview(out);
  }
}

export function buildReviewPrompt(title: string, description: string, patch: string, verificationPassed: boolean): string {
  const shown = patch.length > 60_000 ? patch.slice(0, 60_000) + '\n[diff truncated]' : patch;
  return [
    'You are an independent code reviewer. Do NOT edit files. Review this change for: functional correctness, security, regressions, missing tests, requirement coverage, unrelated changes.',
    'Only correctness, security or requirement problems are blocking. Style preferences are warnings at most.',
    `Task: ${title}`, description && `Requirements: ${description}`, `Automated verification: ${verificationPassed ? 'passed' : 'FAILED'}`,
    'Reply with ONLY JSON: {"approved": boolean, "blockingIssues": [string], "warnings": [string], "summary": string}',
    '--- diff ---', shown,
  ].filter(Boolean).join('\n');
}

/** Strict parse: anything malformed is a blocking finding, never an approval. */
export function parseReview(text: string): ReviewResult {
  let o: any;
  try { o = extractJson(text); } catch { return { approved: false, blockingIssues: ['reviewer output was not valid JSON'], warnings: [], summary: text.slice(-300) }; }
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const blockingIssues = strs(o?.blockingIssues);
  return { approved: o?.approved === true && blockingIssues.length === 0, blockingIssues, warnings: strs(o?.warnings), summary: typeof o?.summary === 'string' ? o.summary : '' };
}
