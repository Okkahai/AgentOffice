import type { DiffInfo } from '../git/gitService.ts';
import type { Task } from './store.ts';

export interface ReviewResult { approved: boolean; blockingIssues: string[]; warnings: string[]; summary: string }
export interface ReviewContext { task: Task; diff: DiffInfo; verificationPassed: boolean }
export interface Reviewer { id: string; review(ctx: ReviewContext): Promise<ReviewResult> }

/** Cheap deterministic review gate that always runs. An agent-backed reviewer (QA role) is composed on top. */
export const deterministicReviewer: Reviewer = {
  id: 'deterministic-reviewer',
  async review({ diff, verificationPassed }) {
    const blocking: string[] = [];
    if (diff.files.length === 0) blocking.push('Empty diff: no changes to merge');
    if (!verificationPassed) blocking.push('Verification did not pass');
    return { approved: blocking.length === 0, blockingIssues: blocking, warnings: [], summary: blocking.length ? 'Blocked by deterministic checks' : `${diff.files.length} file(s) changed; deterministic checks passed` };
  },
};

/** Every reviewer must approve; blocking issues are unioned. */
export function composeReviewers(id: string, reviewers: Reviewer[]): Reviewer {
  return {
    id,
    async review(ctx) {
      const results = await Promise.all(reviewers.map((r) => r.review(ctx)));
      const blockingIssues = results.flatMap((r) => r.blockingIssues);
      return { approved: results.every((r) => r.approved) && blockingIssues.length === 0, blockingIssues, warnings: results.flatMap((r) => r.warnings), summary: results.map((r) => r.summary).join(' | ') };
    },
  };
}
