import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { assertInside, assertSafeId, slugify } from './paths.ts';

// Deterministic Git control plane. All Git access goes through `run`, which uses execFile with an
// argument array (never a shell), a fixed cwd, and a scrubbed environment. Agents never call this
// directly with free-form input; the orchestrator does, after policy checks.

export class GitError extends Error {
  args: string[];
  stderr: string;
  code: number | null;
  constructor(message: string, args: string[], stderr: string, code: number | null) {
    super(message);
    this.args = args;
    this.stderr = stderr;
    this.code = code;
  }
}

export interface RunResult { stdout: string; stderr: string; code: number }

const FORBIDDEN_PATH_PREFIXES = ['.git/', '.agent-office/'];

export interface BackupInfo { ref: string; sha: string; targetBranch: string; createdAt: string }
export interface DiffInfo { files: { status: string; path: string }[]; patch: string; stat: string }

export interface GitServiceOptions {
  repoRoot: string;
  /** Where worktrees live. Must be outside the repository working tree. */
  worktreesDir: string;
  protectedBranches?: string[];
}

export class GitService {
  readonly root: string;
  readonly worktreesDir: string;
  readonly protectedBranches: string[];

  constructor(opts: GitServiceOptions) {
    this.root = path.resolve(opts.repoRoot);
    this.worktreesDir = path.resolve(opts.worktreesDir);
    if (!path.relative(this.root, this.worktreesDir).startsWith('..')) {
      throw new Error('worktreesDir must be outside the repository working tree');
    }
    this.protectedBranches = opts.protectedBranches ?? ['main', 'master'];
  }

  /** Low-level runner. Never throws on non-zero exit when `allowFail` is set. */
  async run(args: string[], cwd = this.root, allowFail = false): Promise<RunResult> {
    const full = [
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
      '-c', 'user.name=Agent Office', '-c', 'user.email=agent-office@localhost',
      ...args,
    ];
    return new Promise((resolve, reject) => {
      execFile('git', full, {
        cwd, maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
      }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
        if (err && !allowFail) {
          reject(new GitError(`git ${args.join(' ')} failed: ${stderr.trim() || err.message}`, args, stderr, code));
        } else resolve({ stdout, stderr, code });
      });
    });
  }

  async resolve(ref: string, cwd = this.root): Promise<string> {
    return (await this.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd)).stdout.trim();
  }

  async tryResolve(ref: string, cwd = this.root): Promise<string | null> {
    const r = await this.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd, true);
    return r.code === 0 ? r.stdout.trim() : null;
  }

  async inspectRepository() {
    const top = (await this.run(['rev-parse', '--show-toplevel'])).stdout.trim();
    const branch = (await this.run(['symbolic-ref', '--short', '-q', 'HEAD'], this.root, true)).stdout.trim() || null;
    const head = await this.tryResolve('HEAD');
    const state = await this.verifyCleanState();
    return { root: top, branch, head, clean: state.clean, dirtyEntries: state.entries };
  }

  /** Dirty entries of a tree, each with its file's mtime and size, so later edits to an already-dirty file show up too. */
  async treeFingerprint(cwd = this.root): Promise<string[]> {
    const { entries } = await this.verifyCleanState(cwd);
    return entries.map((e) => {
      const st = statSync(path.join(cwd, e.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '')), { throwIfNoEntry: false });
      return `${e}|${st ? `${st.mtimeMs}:${st.size}` : 'gone'}`;
    });
  }

  async verifyCleanState(cwd = this.root): Promise<{ clean: boolean; entries: string[] }> {
    const out = (await this.run(['status', '--porcelain', '--untracked-files=all'], cwd)).stdout;
    const entries = out.split('\n').filter(Boolean);
    return { clean: entries.length === 0, entries };
  }

  /** Create branch agent/task-<id>-<slug> and an isolated worktree at <worktreesDir>/task-<id>. */
  async createWorktree(opts: { taskId: number; title: string; baseRef: string }) {
    if (!Number.isInteger(opts.taskId) || opts.taskId < 1) throw new Error('taskId must be a positive integer');
    const branch = `agent/task-${opts.taskId}-${assertSafeId(slugify(opts.title), 'slug')}`;
    const wtPath = path.join(this.worktreesDir, `task-${opts.taskId}`);
    assertInside(this.worktreesDir, wtPath);
    const baseSha = await this.resolve(opts.baseRef);
    mkdirSync(this.worktreesDir, { recursive: true });
    await this.run(['worktree', 'add', '-b', branch, wtPath, baseSha]);
    return { branch, path: wtPath, baseSha };
  }

  /** Only worktrees under worktreesDir can be removed. The branch is kept for audit/rollback. */
  async removeWorktree(wtPath: string): Promise<void> {
    assertInside(this.worktreesDir, wtPath);
    await this.run(['worktree', 'remove', '--force', wtPath]);
    await this.run(['worktree', 'prune']);
  }

  /** Agent task branches only (agent/*). Protected branches and backups can never be deleted here. */
  async deleteAgentBranch(branch: string): Promise<void> {
    if (!/^agent\/task-\d+-[a-z0-9-]+$/.test(branch)) throw new Error(`Refusing to delete non-agent branch ${branch}`);
    await this.run(['branch', '-D', branch], this.root, true);
  }

  async getDiff(wtPath: string, baseSha: string, headRef = 'HEAD'): Promise<DiffInfo> {
    assertInside(this.worktreesDir, wtPath);
    const range = `${baseSha}...${headRef}`;
    const names = (await this.run(['diff', '--name-status', range], wtPath)).stdout;
    const files = names.split('\n').filter(Boolean).map((l) => {
      const [status, ...rest] = l.split('\t');
      return { status: status!, path: rest.join('\t') };
    });
    const patch = (await this.run(['diff', range], wtPath)).stdout;
    const stat = (await this.run(['diff', '--stat', range], wtPath)).stdout;
    return { files, patch, stat };
  }

  /** Diff between two commits in the main repository (worktree may already be gone). Read-only. */
  async diffCommits(baseSha: string, headSha: string): Promise<DiffInfo> {
    for (const sha of [baseSha, headSha]) if (!/^[0-9a-f]{7,64}$/.test(sha)) throw new GitError(`Not a commit sha: ${sha}`, [], '', null);
    const range = `${baseSha}..${headSha}`;
    const files = (await this.run(['diff', '--name-status', range])).stdout.split('\n').filter(Boolean).map((l) => {
      const [status, ...rest] = l.split('\t');
      return { status: status!, path: rest.join('\t') };
    });
    return { files, patch: (await this.run(['diff', range])).stdout, stat: (await this.run(['diff', '--stat', range])).stdout };
  }

  /** Stage everything in the task worktree and commit. Refuses empty commits and protected paths. */
  async commit(wtPath: string, message: string): Promise<string> {
    assertInside(this.worktreesDir, wtPath);
    await this.run(['add', '-A'], wtPath);
    const staged = (await this.run(['diff', '--cached', '--name-only', '-z'], wtPath)).stdout.split('\0').filter(Boolean);
    if (staged.length === 0) throw new Error('Nothing to commit');
    const bad = staged.filter((f) => FORBIDDEN_PATH_PREFIXES.some((p) => f.startsWith(p) || f === p.slice(0, -1)));
    if (bad.length) {
      await this.run(['reset', '-q'], wtPath);
      throw new Error(`Refusing to commit protected paths: ${bad.join(', ')}`);
    }
    await this.run(['commit', '-q', '-m', message], wtPath);
    return this.resolve('HEAD', wtPath);
  }

  /** Recoverable reference to the exact current target commit. Never overwrites an existing ref. */
  async createBackup(opts: { taskId: number; targetBranch: string }): Promise<BackupInfo> {
    const sha = await this.resolve(`refs/heads/${opts.targetBranch}`);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
    for (let n = 0; n < 50; n++) {
      const ref = `refs/heads/backup/pre-merge-${stamp}-task-${opts.taskId}${n ? `-${n + 1}` : ''}`;
      // update-ref with an all-zero old value only succeeds if the ref does not yet exist.
      const r = await this.run(['update-ref', ref, sha, '0000000000000000000000000000000000000000'], this.root, true);
      if (r.code !== 0) continue;
      const check = await this.tryResolve(ref);
      if (check !== sha) throw new Error(`Backup verification failed for ${ref}`);
      return { ref, sha, targetBranch: opts.targetBranch, createdAt: new Date().toISOString() };
    }
    throw new Error('Could not allocate a backup ref');
  }

  async hasConflicts(targetSha: string, sourceSha: string): Promise<boolean> {
    const r = await this.run(['merge-tree', '--write-tree', '--no-messages', targetSha, sourceSha], this.root, true);
    return r.code !== 0;
  }

  /** Path of the worktree that has `branch` checked out (main tree or a linked worktree), or null. */
  async checkedOutAt(branch: string): Promise<string | null> {
    const out = (await this.run(['worktree', 'list', '--porcelain'])).stdout;
    for (const block of out.split('\n\n')) {
      const wt = /^worktree (.+)$/m.exec(block)?.[1];
      if (wt && block.split('\n').includes(`branch refs/heads/${branch}`)) return wt;
    }
    return null;
  }

  /** Dedicated detached worktree for merges and post-merge checks, reset to exactly `sha`. Ignored files (deps) are kept. */
  async prepareMergeWorktree(sha: string): Promise<string> {
    const wt = path.join(this.worktreesDir, 'merge');
    assertInside(this.worktreesDir, wt);
    if (!existsSync(wt)) {
      mkdirSync(this.worktreesDir, { recursive: true });
      await this.run(['worktree', 'prune']);
      await this.run(['worktree', 'add', '--detach', wt, sha]);
    } else {
      const top = (await this.run(['rev-parse', '--show-toplevel'], wt, true)).stdout.trim();
      if (!top || path.resolve(top) !== path.resolve(wt)) throw new Error(`${wt} exists but is not a git worktree; refusing to use it`);
      await this.run(['merge', '--abort'], wt, true);
      await this.run(['checkout', '-q', '--detach', '-f', sha], wt);
      await this.run(['reset', '-q', '--hard', sha], wt);
      await this.run(['clean', '-fdq'], wt);
    }
    if ((await this.resolve('HEAD', wt)) !== sha) throw new Error('Merge worktree is not at the expected commit');
    return wt;
  }

  /**
   * Merge `sourceSha` into the target branch inside the dedicated merge worktree, then advance the branch:
   * fast-forward the worktree that has it checked out (must be clean and at the expected head), or a
   * compare-and-swap ref update when nothing has it checked out. The user's working tree is never merged into.
   */
  async merge(opts: {
    targetBranch: string; expectedTargetSha: string; sourceSha: string; backup: BackupInfo; message: string;
  }): Promise<{ status: 'merged'; mergedSha: string } | { status: 'conflict' }> {
    const ref = `refs/heads/${opts.targetBranch}`;
    const current = await this.tryResolve(ref);
    if (current !== opts.expectedTargetSha) throw new Error(`Target moved: expected ${opts.expectedTargetSha}, found ${current}`);
    if (opts.backup.sha !== opts.expectedTargetSha || (await this.tryResolve(opts.backup.ref)) !== opts.expectedTargetSha) {
      throw new Error('Backup does not point at the expected target commit; refusing to merge');
    }
    const holder = await this.checkedOutAt(opts.targetBranch);
    if (holder && !(await this.verifyCleanState(holder)).clean) {
      throw new Error(`${holder} has ${opts.targetBranch} checked out and is not clean; refusing to merge`);
    }
    if (!(await this.tryResolve(opts.sourceSha))) throw new Error('Source commit does not exist');
    if (await this.hasConflicts(opts.expectedTargetSha, opts.sourceSha)) return { status: 'conflict' };

    const mwt = await this.prepareMergeWorktree(opts.expectedTargetSha);
    const r = await this.run(['merge', '--no-ff', '-m', opts.message, opts.sourceSha], mwt, true);
    if (r.code !== 0) {
      await this.run(['merge', '--abort'], mwt, true);
      return { status: 'conflict' };
    }
    const mergedSha = await this.resolve('HEAD', mwt);
    if ((await this.tryResolve('HEAD^1', mwt)) !== opts.expectedTargetSha) throw new Error('Unexpected merge result (first parent mismatch)');
    await this.#moveBranch(opts.targetBranch, opts.expectedTargetSha, mergedSha, 'merge');
    return { status: 'merged', mergedSha };
  }

  /** Move `branch` from `from` to `to`: in the worktree that has it checked out, or by CAS ref update. */
  async #moveBranch(branch: string, from: string, to: string, what: 'merge' | 'rollback') {
    const holder = await this.checkedOutAt(branch);
    if (holder) {
      if (!(await this.verifyCleanState(holder)).clean) throw new Error(`${holder} is not clean; refusing to ${what}`);
      if ((await this.resolve('HEAD', holder)) !== from) throw new Error(`Target moved in ${holder}; refusing to ${what}`);
      if (what === 'merge') await this.run(['merge', '-q', '--ff-only', to], holder);
      else await this.run(['reset', '-q', '--hard', to], holder);
    } else {
      await this.run(['update-ref', `refs/heads/${branch}`, to, from]);
    }
    if ((await this.tryResolve(`refs/heads/${branch}`)) !== to) throw new Error(`${what} verification failed: ${branch} is not at ${to}`);
  }

  /** Restore the target branch to the recorded pre-merge commit. Only valid while it still points at the merge. */
  async rollback(opts: { targetBranch: string; mergedSha: string; restoreSha: string; backupRef: string }): Promise<void> {
    const head = await this.tryResolve(`refs/heads/${opts.targetBranch}`);
    if (head !== opts.mergedSha) throw new Error(`Target has moved since the merge (head ${head}); refusing automatic rollback`);
    if ((await this.tryResolve(opts.backupRef)) !== opts.restoreSha) throw new Error('Backup ref missing or changed; refusing rollback');
    await this.#moveBranch(opts.targetBranch, opts.mergedSha, opts.restoreSha, 'rollback');
  }

  async containsCommit(branchOrSha: string, sha: string): Promise<boolean> {
    const r = await this.run(['merge-base', '--is-ancestor', sha, branchOrSha], this.root, true);
    return r.code === 0;
  }
}
