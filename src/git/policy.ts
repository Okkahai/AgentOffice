// Agents may *request* Git operations; this policy decides. Deny-by-default allowlist.

export type GitRequest =
  | { op: 'status' | 'diff' | 'log'; }
  | { op: 'commit' }
  | { op: 'push'; force?: boolean; branch: string }
  | { op: 'delete-branch'; branch: string }
  | { op: 'reset-hard' | 'rebase' | 'filter-branch' | 'gc-prune' }
  | { op: string; branch?: string };

export interface Decision { allowed: boolean; reason: string }

export function evaluateGitRequest(req: GitRequest, protectedBranches: string[] = ['main', 'master']): Decision {
  switch (req.op) {
    case 'status':
    case 'diff':
    case 'log':
    case 'commit':
      return { allowed: true, reason: 'allowed within task worktree' };
    case 'push': {
      const r = req as { force?: boolean; branch: string };
      if (r.force && protectedBranches.includes(r.branch)) return { allowed: false, reason: 'force push to protected branch' };
      return { allowed: false, reason: 'push is not enabled in the MVP' };
    }
    case 'delete-branch': {
      const b = (req as { branch: string }).branch;
      if (protectedBranches.includes(b)) return { allowed: false, reason: 'deleting a protected branch' };
      if (b.startsWith('backup/')) return { allowed: false, reason: 'deleting a backup' };
      return { allowed: false, reason: 'branch deletion is owned by the control plane' };
    }
    default:
      return { allowed: false, reason: `operation "${req.op}" is not on the allowlist` };
  }
}
