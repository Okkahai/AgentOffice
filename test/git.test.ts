import assert from 'node:assert/strict';
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { GitService } from '../src/git/gitService.ts';
import { assertInside, assertSafeId } from '../src/git/paths.ts';
import { evaluateGitRequest } from '../src/git/policy.ts';
import { git, makeSandbox } from './helpers.ts';

describe('git control plane', () => {
  const sb = makeSandbox();
  after(sb.cleanup);
  const svc = new GitService({ repoRoot: sb.repo, worktreesDir: sb.worktrees });

  it('inspects the repository', async () => {
    const r = await svc.inspectRepository();
    assert.equal(r.branch, 'main');
    assert.equal(r.clean, true);
  });

  it('creates isolated, parallel worktrees on distinct branches', async () => {
    const a = await svc.createWorktree({ taskId: 101, title: 'Auth backend', baseRef: 'refs/heads/main' });
    const b = await svc.createWorktree({ taskId: 102, title: 'Login UI', baseRef: 'refs/heads/main' });
    assert.equal(a.branch, 'agent/task-101-auth-backend');
    assert.notEqual(a.path, b.path);
    writeFileSync(path.join(a.path, 'only-in-a.txt'), 'x');
    assert.equal(existsSync(path.join(b.path, 'only-in-a.txt')), false, 'worktree B must not see A changes');
    assert.equal(existsSync(path.join(sb.repo, 'only-in-a.txt')), false, 'main tree must not see A changes');
    assert.equal((await svc.verifyCleanState()).clean, true);
    await svc.removeWorktree(a.path);
    await svc.removeWorktree(b.path);
    assert.equal(existsSync(a.path), false);
  });

  it('validates ids and paths (traversal, symlinks, foreign removals)', async () => {
    assert.throws(() => assertSafeId('../evil'));
    assert.throws(() => assertSafeId('a b; rm -rf /'));
    assert.throws(() => assertInside(sb.worktrees, path.join(sb.worktrees, '..', 'repo')));
    try {
      symlinkSync(sb.repo, path.join(sb.base, 'link'), 'junction');
      assert.throws(() => assertInside(sb.worktrees, path.join(sb.base, 'link')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e; // symlinks need privileges on some Windows setups
    }
    await assert.rejects(svc.removeWorktree(sb.repo), /outside allowed root/);
    await assert.rejects(svc.createWorktree({ taskId: -1, title: 'x', baseRef: 'main' }));
    assert.throws(() => new GitService({ repoRoot: sb.repo, worktreesDir: path.join(sb.repo, 'wt') }), /outside the repository/);
  });

  it('refuses to commit protected paths and empty commits', async () => {
    const w = await svc.createWorktree({ taskId: 110, title: 'bad', baseRef: 'refs/heads/main' });
    await assert.rejects(svc.commit(w.path, 'empty'), /Nothing to commit/);
    writeFileSync(path.join(w.path, 'ok.txt'), 'ok');
    git(w.path, 'add', '-A');
    await svc.run(['reset', '-q'], w.path);
    // .agent-office/ is a protected path
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.join(w.path, '.agent-office'));
    writeFileSync(path.join(w.path, '.agent-office', 'x'), 'x');
    await assert.rejects(svc.commit(w.path, 'sneaky'), /protected paths/);
    await svc.removeWorktree(w.path);
  });

  it('creates a verified backup at the exact target commit and never overwrites', async () => {
    const head = git(sb.repo, 'rev-parse', 'main');
    const b1 = await svc.createBackup({ taskId: 7, targetBranch: 'main' });
    const b2 = await svc.createBackup({ taskId: 7, targetBranch: 'main' });
    assert.equal(git(sb.repo, 'rev-parse', b1.ref), head);
    assert.notEqual(b1.ref, b2.ref);
    assert.match(b1.ref, /^refs\/heads\/backup\/pre-merge-\d{8}-\d{6}-task-7/);
  });

  it('merges only when target and backup match expectations; conflicts leave the tree clean', async () => {
    const w = await svc.createWorktree({ taskId: 120, title: 'edit shared', baseRef: 'refs/heads/main' });
    writeFileSync(path.join(w.path, 'shared.txt'), 'from agent\n');
    const sha = await svc.commit(w.path, 'agent edit');
    const target = git(sb.repo, 'rev-parse', 'main');
    const backup = await svc.createBackup({ taskId: 120, targetBranch: 'main' });

    // stale expectation -> refuse
    await assert.rejects(svc.merge({ targetBranch: 'main', expectedTargetSha: sha, sourceSha: sha, backup, message: 'm' }), /Target moved/);
    // backup pointing elsewhere -> refuse
    await assert.rejects(svc.merge({ targetBranch: 'main', expectedTargetSha: target, sourceSha: sha, backup: { ...backup, sha }, message: 'm' }), /Backup does not point/);
    // dirty main tree -> refuse
    writeFileSync(path.join(sb.repo, 'dirty.txt'), 'x');
    await assert.rejects(svc.merge({ targetBranch: 'main', expectedTargetSha: target, sourceSha: sha, backup, message: 'm' }), /not clean/);
    git(sb.repo, 'clean', '-fdq');

    // conflicting change lands on main first
    writeFileSync(path.join(sb.repo, 'shared.txt'), 'from main\n');
    git(sb.repo, 'commit', '-qam', 'main edit');
    const moved = git(sb.repo, 'rev-parse', 'main');
    const backup2 = await svc.createBackup({ taskId: 120, targetBranch: 'main' });
    const res = await svc.merge({ targetBranch: 'main', expectedTargetSha: moved, sourceSha: sha, backup: backup2, message: 'm' });
    assert.equal(res.status, 'conflict');
    assert.equal(git(sb.repo, 'rev-parse', 'main'), moved);
    assert.equal((await svc.verifyCleanState()).clean, true, 'no half-merged state');
    await svc.removeWorktree(w.path);
  });

  it('merges with --no-ff and rolls back to the backup deterministically', async () => {
    const w = await svc.createWorktree({ taskId: 130, title: 'add file', baseRef: 'refs/heads/main' });
    writeFileSync(path.join(w.path, 'new.txt'), 'new\n');
    const sha = await svc.commit(w.path, 'add');
    const target = git(sb.repo, 'rev-parse', 'main');
    const backup = await svc.createBackup({ taskId: 130, targetBranch: 'main' });
    const res = await svc.merge({ targetBranch: 'main', expectedTargetSha: target, sourceSha: sha, backup, message: 'merge 130' });
    assert.equal(res.status, 'merged');
    assert.equal(readFileSync(path.join(sb.repo, 'new.txt'), 'utf8'), 'new\n');
    if (res.status !== 'merged') return;

    // rollback refuses if the target moved since the merge
    await assert.rejects(svc.rollback({ targetBranch: 'main', mergedSha: target, restoreSha: target, backupRef: backup.ref }), /moved/);
    await svc.rollback({ targetBranch: 'main', mergedSha: res.mergedSha, restoreSha: target, backupRef: backup.ref });
    assert.equal(git(sb.repo, 'rev-parse', 'main'), target);
    assert.equal(existsSync(path.join(sb.repo, 'new.txt')), false);
    assert.equal(git(sb.repo, 'rev-parse', backup.ref), target, 'backup survives rollback');
    await svc.removeWorktree(w.path);
  });

  it('never deletes protected branches or backups; policy denies dangerous requests', async () => {
    await assert.rejects(svc.deleteAgentBranch('main'), /non-agent/);
    await assert.rejects(svc.deleteAgentBranch('backup/pre-merge-x'), /non-agent/);
    assert.equal(evaluateGitRequest({ op: 'push', force: true, branch: 'main' }).allowed, false);
    assert.equal(evaluateGitRequest({ op: 'delete-branch', branch: 'backup/pre-merge-1' }).allowed, false);
    assert.equal(evaluateGitRequest({ op: 'reset-hard' }).allowed, false);
    assert.equal(evaluateGitRequest({ op: 'rebase' }).allowed, false);
    assert.equal(evaluateGitRequest({ op: 'diff' }).allowed, true);
  });
});
