import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Orchestrator } from '../src/core/orchestrator.ts';
import { agentSpec, git, makeOrchestrator, makeSandbox } from './helpers.ts';

let sb: ReturnType<typeof makeSandbox>;
beforeEach(() => { sb = makeSandbox(); });
afterEach(() => sb.cleanup());

const types = (h: ReturnType<typeof makeOrchestrator>, id?: number) => h.store.events(id).map((e) => e.type as string);
const mainSha = () => git(sb.repo, 'rev-parse', 'main');

describe('core loop', () => {
  it('worktree -> agent -> diff -> verify -> review -> backup -> merge -> post-verify (audited)', async () => {
    const h = makeOrchestrator(sb);
    const before = mainSha();
    const t = h.orch.createTask({ title: 'Add hello', spec: agentSpec({ write: { 'hello.txt': 'hi\n' } }) });
    await h.orch.runAll();

    const done = h.store.getTask(t.id)!;
    assert.equal(done.status, 'COMPLETED');
    assert.equal(readFileSync(path.join(sb.repo, 'hello.txt'), 'utf8'), 'hi\n');
    assert.equal(existsSync(done.worktree_path!), false, 'worktree cleaned up after merge');

    // backup: recorded, verified, points at pre-merge target
    const [backup] = h.store.backups(t.id);
    assert.equal(backup!.target_sha, before);
    assert.equal(git(sb.repo, 'rev-parse', backup!.ref.replace('refs/heads/', '')), before);
    assert.equal(backup!.source_sha, done.commit_sha);
    assert.equal(git(sb.repo, 'rev-parse', 'main^1'), before);

    // evidence
    assert.deepEqual(h.store.verifications(t.id).map((v) => [v.phase, v.passed]), [['pre-merge', 1], ['post-merge', 1]]);
    assert.equal(h.store.reviews(t.id).length, 1);
    assert.equal(h.store.latestMerge(t.id)!.status, 'success');

    // audit order: backup strictly before merge; post-merge verification after merge
    const ev = types(h, t.id);
    const at = (x: string) => ev.indexOf(x);
    assert.ok(at('git.worktree_created') < at('agent.spawned'));
    assert.ok(at('git.commit_created') < at('verification.started'));
    assert.ok(at('review.completed') < at('git.backup_created'));
    assert.ok(at('git.backup_created') < at('git.merge_started'));
    assert.ok(at('git.merge_completed') < ev.lastIndexOf('verification.passed'));
    assert.ok(at('merge.success') < at('task.completed'));
  });

  it('runs independent tasks in parallel worktrees and respects dependencies', async () => {
    const h = makeOrchestrator(sb, { maxParallel: 2 });
    const started: Record<number, string> = {};
    h.bus.subscribe((e) => { if (e.type === 'git.worktree_created') started[e.taskId!] = e.payload!.path as string; });
    const a = h.orch.createTask({ title: 'Backend', spec: agentSpec({ write: { 'backend.txt': 'b' }, sleepMs: 300 }) });
    const b = h.orch.createTask({ title: 'Frontend', spec: agentSpec({ write: { 'frontend.txt': 'f' }, sleepMs: 300 }) });
    const c = h.orch.createTask({ title: 'Integration', dependsOn: [a.id, b.id], spec: agentSpec({ write: { 'integration.txt': 'i' } }) });

    let overlapped = false;
    h.bus.subscribe(() => {
      const s = h.store.listTasks().map((t) => t.status);
      if (s[0] === 'WORKING' && s[1] === 'WORKING' && s[2] === 'QUEUED') overlapped = true;
    });
    await h.orch.runAll();
    assert.ok(overlapped, 'independent tasks ran concurrently');
    assert.equal(h.store.listTasks().every((t) => t.status === 'COMPLETED'), true);
    assert.notEqual(started[a.id], started[b.id]);
    // dependent task's worktree was cut from a main that already contained both dependencies
    const cBase = h.store.getTask(c.id)!.base_sha!;
    for (const f of ['backend.txt', 'frontend.txt']) assert.equal(git(sb.repo, 'show', `${cBase}:${f}`).length > 0, true);
    for (const f of ['backend.txt', 'frontend.txt', 'integration.txt']) assert.ok(existsSync(path.join(sb.repo, f)));
  });

  it('blocks dependents when a dependency fails', async () => {
    const h = makeOrchestrator(sb);
    const a = h.orch.createTask({ title: 'Broken', spec: agentSpec({ exit: 3 }) });
    const b = h.orch.createTask({ title: 'Needs A', dependsOn: [a.id], spec: agentSpec({ write: { 'x.txt': 'x' } }) });
    await h.orch.runAll();
    assert.equal(h.store.getTask(a.id)!.status, 'FAILED');
    assert.equal(h.store.getTask(b.id)!.status, 'BLOCKED');
    assert.equal(existsSync(path.join(sb.repo, 'x.txt')), false);
  });
});

describe('safety gates', () => {
  it('failed pre-merge verification: no backup, no merge, main untouched', async () => {
    const h = makeOrchestrator(sb);
    const before = mainSha();
    const t = h.orch.createTask({ title: 'Breaks tests', spec: agentSpec({ write: { BROKEN: '1' } }) });
    await h.orch.runAll();
    const row = h.store.getTask(t.id)!;
    assert.equal(row.status, 'FAILED');
    assert.equal(row.verification_status, 'failed');
    assert.equal(mainSha(), before);
    assert.equal(h.store.backups().length, 0);
    assert.ok(!types(h).includes('git.merge_started'));
    assert.equal(h.store.verifications(t.id)[0]!.passed, 0);
  });

  it('blocking review prevents merge', async () => {
    const h = makeOrchestrator(sb, { reviewer: { id: 'qa-1', review: async () => ({ approved: false, blockingIssues: ['SQL injection'], warnings: [], summary: 'no' }) } });
    const before = mainSha();
    const t = h.orch.createTask({ title: 'Risky', spec: agentSpec({ write: { 'r.txt': 'r' } }) });
    await h.orch.runAll();
    assert.equal(h.store.getTask(t.id)!.status, 'FAILED');
    assert.match(h.store.getTask(t.id)!.failure_reason!, /SQL injection/);
    assert.equal(mainSha(), before);
    assert.equal(h.store.backups().length, 0);
  });

  it('empty diff is blocked by the deterministic reviewer', async () => {
    const h = makeOrchestrator(sb);
    const t = h.orch.createTask({ title: 'Noop', spec: agentSpec({}) });
    await h.orch.runAll();
    assert.equal(h.store.getTask(t.id)!.status, 'FAILED'); // "Nothing to commit"
    assert.equal(h.store.backups().length, 0);
  });

  it('reviewer must be independent of the implementing agent', async () => {
    const h = makeOrchestrator(sb, { reviewer: { id: 'engineer-1', review: async () => ({ approved: true, blockingIssues: [], warnings: [], summary: '' }) } });
    const t = h.orch.createTask({ title: 'Self review', spec: agentSpec({ write: { 's.txt': 's' } }) });
    await h.orch.runAll();
    assert.equal(h.store.getTask(t.id)!.status, 'FAILED');
    assert.match(h.store.getTask(t.id)!.failure_reason!, /independent/);
    assert.equal(h.store.backups().length, 0);
  });

  it('agent that writes into the main working tree is an isolation breach', async () => {
    const h = makeOrchestrator(sb);
    const before = mainSha();
    const t = h.orch.createTask({ title: 'Escapee', spec: agentSpec({ write: { [path.join(sb.repo, 'escaped.txt')]: 'boo' } }) });
    await h.orch.runAll();
    assert.equal(h.store.getTask(t.id)!.status, 'FAILED');
    assert.match(h.store.getTask(t.id)!.failure_reason!, /Isolation breach/);
    assert.equal(mainSha(), before);
  });

  it('kills an agent that exceeds its timeout', async () => {
    const h = makeOrchestrator(sb, { agentTimeoutMs: 300 });
    const t = h.orch.createTask({ title: 'Hangs', spec: agentSpec({ sleepMs: 60_000 }) });
    const started = Date.now();
    await h.orch.runAll();
    assert.ok(Date.now() - started < 10_000);
    assert.equal(h.store.getTask(t.id)!.status, 'FAILED');
    assert.match(h.store.getTask(t.id)!.failure_reason!, /timed out/);
  });

  it('cancel terminates the running agent', async () => {
    const h = makeOrchestrator(sb);
    const t = h.orch.createTask({ title: 'Long', spec: agentSpec({ sleepMs: 60_000 }) });
    const run = h.orch.runAll();
    await new Promise((r) => setTimeout(r, 500));
    await h.orch.cancel(t.id);
    await run;
    assert.equal(h.store.getTask(t.id)!.status, 'CANCELLED');
    assert.equal(h.store.backups().length, 0);
  });

  it('merge conflict -> CONFLICT, main untouched, no half-merge', async () => {
    const h = makeOrchestrator(sb, { maxParallel: 1 });
    const a = h.orch.createTask({ title: 'Edit shared A', spec: agentSpec({ write: { 'shared.txt': 'A\n' } }) });
    const b = h.orch.createTask({ title: 'Edit shared B', spec: agentSpec({ write: { 'shared.txt': 'B\n' } }) });
    // Force both to branch from the same base: run B's work before A merges by running tasks directly in parallel.
    await Promise.all([h.orch.runTask(a.id), h.orch.runTask(b.id)]);
    const statuses = [a, b].map((t) => h.store.getTask(t.id)!.status).sort();
    assert.deepEqual(statuses, ['COMPLETED', 'CONFLICT']);
    assert.equal(git(sb.repo, 'status', '--porcelain'), '');
    assert.equal(h.store.backups().length, 1, 'only the merge that actually happened created a backup');
  });

  it('failed post-merge verification preserves merged state and offers deterministic rollback', async () => {
    const h = makeOrchestrator(sb);
    const before = mainSha();
    // Individually valid, jointly invalid: only visible after the second merge.
    const a = h.orch.createTask({ title: 'Adds a', spec: agentSpec({ write: { 'a.txt': 'a' } }) });
    const b = h.orch.createTask({ title: 'Adds b', spec: agentSpec({ write: { 'b.txt': 'b' } }) });
    await Promise.all([h.orch.runTask(a.id), h.orch.runTask(b.id)]);
    const failed = [a, b].map((t) => h.store.getTask(t.id)!).find((t) => t.status === 'FAILED')!;
    const ok = [a, b].map((t) => h.store.getTask(t.id)!).find((t) => t.status === 'COMPLETED')!;
    assert.ok(failed && ok);
    assert.equal(failed.failure_reason, 'MERGE_VERIFICATION_FAILED');
    const merge = h.store.latestMerge(failed.id)!;
    assert.equal(merge.status, 'verification_failed');
    assert.equal(mainSha(), merge.merged_sha, 'merged state is not silently erased');
    assert.ok(types(h, failed.id).includes('merge.verification_failed'));
    assert.equal(h.store.verifications(failed.id, 'post-merge')[0]!.passed, 0);

    await h.orch.rollback(failed.id);
    const backup = h.store.backups(failed.id)[0]!;
    assert.equal(mainSha(), backup.target_sha, 'main restored to the recorded pre-merge commit');
    assert.equal(h.store.latestMerge(failed.id)!.status, 'rolled_back');
    assert.ok(mainSha() !== before, 'the first task stays merged');
    assert.ok(types(h).includes('git.rollback_completed'));
    assert.equal(git(sb.repo, 'rev-parse', backup.ref.replace('refs/heads/', '')), backup.target_sha, 'backup retained');
  });

  it('a failed backup blocks the merge', async () => {
    const h = makeOrchestrator(sb);
    h.git.createBackup = async () => { throw new Error('disk full'); };
    const before = mainSha();
    const t = h.orch.createTask({ title: 'No backup', spec: agentSpec({ write: { 'n.txt': 'n' } }) });
    await h.orch.runAll();
    assert.equal(h.store.getTask(t.id)!.status, 'FAILED');
    assert.match(h.store.getTask(t.id)!.failure_reason!, /Backup failed/);
    assert.equal(mainSha(), before);
  });

  it('mailbox messages persist and do not touch task state', async () => {
    const h = makeOrchestrator(sb);
    const t = h.orch.createTask({ title: 'Chatty', spec: agentSpec({ write: { 'c.txt': 'c' } }) });
    h.orch.sendMessage({ taskId: t.id, sender: 'engineer-1', recipient: 'qa-1', body: 'endpoint ready' });
    assert.equal(h.store.getTask(t.id)!.status, 'QUEUED');
    assert.equal(h.store.messages('qa-1')[0]!.body, 'endpoint ready');
  });
});

describe('restart recovery', () => {
  it('requeues interrupted work and reruns it from a clean worktree', async () => {
    const dbFile = path.join(sb.base, 'state.db');
    const h1 = makeOrchestrator(sb, {}, dbFile);
    const t = h1.orch.createTask({ title: 'Interrupted', spec: agentSpec({ write: { 'i.txt': 'i' } }) });
    // Simulate a crash mid-WORKING: worktree exists, task persisted as WORKING, no process survives.
    const wt = await h1.git.createWorktree({ taskId: t.id, title: t.title, baseRef: 'refs/heads/main' });
    h1.store.transition(t.id, 'ASSIGNED', { branch: wt.branch, worktree_path: wt.path, base_sha: wt.baseSha });
    h1.store.transition(t.id, 'WORKING');
    h1.store.close();

    const h2 = makeOrchestrator(sb, {}, dbFile);
    await h2.orch.recover();
    assert.equal(h2.store.getTask(t.id)!.status, 'QUEUED');
    assert.equal(existsSync(wt.path), false);
    assert.ok(h2.store.events().some((e) => e.type === 'system.recovered'));
    await h2.orch.runAll();
    assert.equal(h2.store.getTask(t.id)!.status, 'COMPLETED');
  });

  it('resumes post-merge verification when the crash happened after the merge', async () => {
    const dbFile = path.join(sb.base, 'state.db');
    const h1 = makeOrchestrator(sb, {}, dbFile);
    const t = h1.orch.createTask({ title: 'Crash after merge', spec: agentSpec({ write: { 'm.txt': 'm' } }) });
    // Drive the pipeline by hand up to "merged in git, DB still says MERGING".
    const wt = await h1.git.createWorktree({ taskId: t.id, title: t.title, baseRef: 'refs/heads/main' });
    writeFileSync(path.join(wt.path, 'm.txt'), 'm');
    const sha = await h1.git.commit(wt.path, 'work');
    for (const [s, p] of [['ASSIGNED', { branch: wt.branch, worktree_path: wt.path, base_sha: wt.baseSha }], ['WORKING', {}], ['VERIFYING', { commit_sha: sha }], ['REVIEWING', { verification_status: 'passed' }], ['READY_TO_MERGE', { review_status: 'approved' }], ['MERGING', {}]] as const) {
      h1.store.transition(t.id, s, p as any);
    }
    const target = await h1.git.resolve('refs/heads/main');
    const backup = await h1.git.createBackup({ taskId: t.id, targetBranch: 'main' });
    const row = h1.store.addBackup({ task_id: t.id, ref: backup.ref, target_branch: 'main', target_sha: backup.sha, source_branch: wt.branch, source_sha: sha });
    h1.store.createMerge(t.id, row.id);
    await h1.git.merge({ targetBranch: 'main', expectedTargetSha: target, sourceSha: sha, backup, message: 'm' });
    h1.store.close();

    const h2 = makeOrchestrator(sb, {}, dbFile);
    await h2.orch.recover();
    assert.equal(h2.store.getTask(t.id)!.status, 'COMPLETED');
    assert.equal(h2.store.latestMerge(t.id)!.status, 'success');
    assert.equal(h2.store.latestMerge(t.id)!.merged_sha, mainSha());
  });

  it('a merge that never happened goes back to READY_TO_MERGE', async () => {
    const dbFile = path.join(sb.base, 'state.db');
    const h1 = makeOrchestrator(sb, {}, dbFile);
    const t = h1.orch.createTask({ title: 'Crash before merge', spec: agentSpec({}) });
    const wt = await h1.git.createWorktree({ taskId: t.id, title: t.title, baseRef: 'refs/heads/main' });
    writeFileSync(path.join(wt.path, 'z.txt'), 'z');
    const sha = await h1.git.commit(wt.path, 'work');
    for (const [s, p] of [['ASSIGNED', { branch: wt.branch, worktree_path: wt.path, base_sha: wt.baseSha }], ['WORKING', {}], ['VERIFYING', { commit_sha: sha }], ['REVIEWING', {}], ['READY_TO_MERGE', {}], ['MERGING', {}]] as const) {
      h1.store.transition(t.id, s, p as any);
    }
    const backup = await h1.git.createBackup({ taskId: t.id, targetBranch: 'main' });
    const row = h1.store.addBackup({ task_id: t.id, ref: backup.ref, target_branch: 'main', target_sha: backup.sha, source_branch: wt.branch, source_sha: sha });
    h1.store.createMerge(t.id, row.id);
    h1.store.close();

    const h2 = makeOrchestrator(sb, {}, dbFile);
    await h2.orch.recover();
    assert.equal(h2.store.getTask(t.id)!.status, 'READY_TO_MERGE');
    assert.equal(h2.store.latestMerge(t.id)!.status, 'aborted');
  });
});
