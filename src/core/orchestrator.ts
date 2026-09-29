import { existsSync } from 'node:fs';
import type { AgentHandle, AgentProvider, SpawnRequest } from '../agents/provider.ts';
import type { GitService } from '../git/gitService.ts';
import { EventBus, type EventType } from './events.ts';
import { composeReviewers, deterministicReviewer, type Reviewer } from './review.ts';
import type { Store, Task } from './store.ts';
import type { TaskStatus } from './taskMachine.ts';
import { discoverChecks, runCheck, type Check } from './verify.ts';

export interface OrchestratorConfig {
  store: Store;
  git: GitService;
  bus?: EventBus;
  provider: AgentProvider;
  /** Independent reviewer; its id must differ from every engineer agent id. */
  reviewer?: Reviewer;
  targetBranch?: string;
  maxParallel?: number;
  agentTimeoutMs?: number;
  /** Explicit checks; otherwise discovered from the repository (package.json scripts). */
  checks?: Check[];
  /** Live agent output (terminal stream), for UIs and logs. Never used for decisions. */
  onAgentOutput?: (taskId: number, chunk: string) => void;
  /** How to start the agent for a task. Default: JSON `spec.argv`. */
  launch?: (task: Task) => Pick<SpawnRequest, 'argv' | 'env'>;
}

class Mutex {
  #tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(fn, fn);
    this.#tail = next.catch(() => {});
    return next;
  }
}

class Cancelled extends Error {}

export class Orchestrator {
  readonly store: Store;
  readonly git: GitService;
  readonly bus: EventBus;
  readonly targetBranch: string;
  #cfg: OrchestratorConfig;
  #reviewer: Reviewer;
  #mergeLock = new Mutex();
  #agents = new Map<number, AgentHandle>();
  #cancelled = new Set<number>();

  constructor(cfg: OrchestratorConfig) {
    this.#cfg = cfg;
    this.store = cfg.store;
    this.git = cfg.git;
    this.bus = cfg.bus ?? new EventBus();
    this.targetBranch = cfg.targetBranch ?? 'main';
    this.#reviewer = composeReviewers(cfg.reviewer?.id ?? 'qa-reviewer', [deterministicReviewer, ...(cfg.reviewer ? [cfg.reviewer] : [])]);
    this.bus.subscribe((e) => this.store.persistEvent(e));
  }

  // ---------- public API ----------
  createTask(t: Parameters<Store['createTask']>[0]): Task {
    const task = this.store.createTask(t);
    this.#emit('task.created', task.id, { title: task.title, dependsOn: t.dependsOn ?? [] });
    return task;
  }

  /** Run every runnable task to a resting state, honouring dependencies and maxParallel. */
  async runAll(): Promise<void> {
    const running = new Map<number, Promise<void>>();
    for (;;) {
      this.#blockDependents();
      const ready = this.store.listTasks().filter((t) => t.status === 'QUEUED' && !running.has(t.id)
        && this.store.deps(t.id).every((d) => this.store.getTask(d)?.status === 'COMPLETED'));
      for (const t of ready) {
        if (running.size >= (this.#cfg.maxParallel ?? 2)) break;
        running.set(t.id, this.runTask(t.id).then(() => {}).finally(() => running.delete(t.id)));
      }
      if (running.size === 0) return;
      await Promise.race(running.values());
    }
  }

  async runTask(id: number): Promise<Task> {
    try {
      await this.#work(id);
      await this.#verify(id);
      await this.#review(id);
      await this.#mergeLock.run(() => this.#merge(id));
    } catch (e) {
      if (e instanceof Cancelled) return this.store.getTask(id)!;
      const t = this.store.getTask(id)!;
      if (t.status !== 'FAILED' && t.status !== 'CONFLICT' && t.status !== 'COMPLETED') this.#fail(id, (e as Error).message);
    } finally {
      this.#agents.delete(id);
    }
    return this.store.getTask(id)!;
  }

  async cancel(id: number): Promise<void> {
    this.#cancelled.add(id);
    await this.#agents.get(id)?.terminate(500);
    const t = this.store.getTask(id)!;
    if (t.status !== 'COMPLETED' && t.status !== 'CANCELLED') this.#move(id, 'CANCELLED', { failure_reason: 'cancelled by user' });
  }

  /** User/agent messages go through the persistent mailbox and never touch task state. */
  sendMessage(m: { taskId?: number; sender: string; recipient: string; body: string }) {
    this.store.sendMessage(m);
    this.bus.emit('message.sent', { taskId: m.taskId, agentId: m.sender, payload: { to: m.recipient } });
  }

  /** Deterministic rollback from persisted state only. */
  async rollback(taskId: number): Promise<void> {
    const merge = this.store.latestMerge(taskId);
    if (!merge || !merge.merged_sha || !['success', 'verification_failed'].includes(merge.status)) {
      throw new Error(`Task ${taskId} has no rollbackable merge`);
    }
    const backup = this.store.backups(taskId).find((b) => b.id === merge.backup_id)!;
    await this.#mergeLock.run(() => this.git.rollback({
      targetBranch: backup.target_branch, mergedSha: merge.merged_sha!, restoreSha: backup.target_sha, backupRef: backup.ref,
    }));
    this.store.updateMerge(merge.id, 'rolled_back');
    this.#emit('git.rollback_completed', taskId, { restoredTo: backup.target_sha, backupRef: backup.ref });
  }

  /** Reconcile persisted state with reality after a crash/restart. Call once at startup. */
  async recover(): Promise<void> {
    for (const t of this.store.listTasks()) {
      if (['ASSIGNED', 'WORKING', 'VERIFYING', 'REVIEWING'].includes(t.status)) {
        await this.#discardWorktree(t);
        this.#move(t.id, 'QUEUED', { failure_reason: null, worktree_path: null, branch: null, commit_sha: null, verification_status: 'pending', review_status: 'pending' });
        this.#emit('system.recovered', t.id, { from: t.status, action: 'requeued' });
      } else if (t.status === 'READY_TO_MERGE') {
        this.#emit('system.recovered', t.id, { from: t.status, action: 'left ready to merge' });
      } else if (t.status === 'MERGING') {
        const merge = this.store.latestMerge(t.id);
        const backup = merge && this.store.backups(t.id).find((b) => b.id === merge.backup_id);
        const head = await this.git.tryResolve(`refs/heads/${this.targetBranch}`);
        const merged = backup && head && (await this.git.tryResolve(`${head}^1`)) === backup.target_sha
          && (await this.git.tryResolve(`${head}^2`)) === backup.source_sha;
        if (merge && backup && merged) {
          this.store.updateMerge(merge.id, 'merging', head!);
          await this.#mergeLock.run(() => this.#postMerge(t.id, merge.id, head!));
          this.#emit('system.recovered', t.id, { from: t.status, action: 'resumed post-merge verification' });
        } else {
          if (merge) this.store.updateMerge(merge.id, 'aborted');
          this.#move(t.id, 'READY_TO_MERGE');
          this.#emit('system.recovered', t.id, { from: t.status, action: 'merge had not happened; back to ready' });
        }
      }
    }
  }

  // ---------- pipeline stages ----------
  async #work(id: number) {
    let t = this.store.getTask(id)!;
    await this.#discardWorktree(t); // retries start clean
    const agentId = `engineer-${id}`;
    const wt = await this.git.createWorktree({ taskId: id, title: t.title, baseRef: `refs/heads/${this.targetBranch}` });
    this.#move(id, 'ASSIGNED', { assigned_agent: agentId, branch: wt.branch, worktree_path: wt.path, base_sha: wt.baseSha });
    this.#emit('git.worktree_created', id, { branch: wt.branch, path: wt.path, baseSha: wt.baseSha }, agentId);
    this.#emit('task.assigned', id, { agentId }, agentId);
    this.#guard(id);

    t = this.#move(id, 'WORKING');
    this.#emit('task.started', id, {}, agentId);
    const inv = (this.#cfg.launch ?? defaultLaunch)(t);
    const handle = this.#cfg.provider.spawn({ agentId, argv: inv.argv, env: { AGENT_OFFICE_TASK_ID: String(id), ...inv.env }, cwd: wt.path });
    this.#agents.set(id, handle);
    handle.subscribeOutput((chunk) => this.#cfg.onAgentOutput?.(id, chunk));
    this.#emit('agent.spawned', id, { pid: handle.pid }, agentId);
    this.#emit('agent.coding', id, {}, agentId);

    const timeout = this.#cfg.agentTimeoutMs ?? 10 * 60_000;
    const timer = setTimeout(() => { void handle.terminate(500); }, timeout);
    const exit = await handle.exited;
    clearTimeout(timer);
    this.#guard(id);
    if (exit.status === 'terminated') { this.#emit('agent.failed', id, { reason: 'timeout' }, agentId); throw new Error(`Agent timed out after ${timeout}ms`); }
    if (exit.code !== 0) { this.#emit('agent.failed', id, { code: exit.code }, agentId); throw new Error(`Agent exited with code ${exit.code}`); }
    this.#emit('agent.completed', id, {}, agentId);

    // The main tree is not the agent's workspace: any change there is an isolation breach.
    const dirty = await this.#mergeLock.run(() => this.git.verifyCleanState());
    if (!dirty.clean) throw new Error(`Isolation breach: main working tree modified (${dirty.entries.slice(0, 3).join(', ')})`);

    const sha = await this.git.commit(wt.path, `agent-office: task ${id}: ${t.title}`);
    this.store.update(id, { commit_sha: sha });
    this.#emit('git.commit_created', id, { sha }, agentId);
  }

  async #verify(id: number) {
    const t = this.#move(id, 'VERIFYING');
    const ok = await this.#runChecks(id, 'pre-merge', t.worktree_path!);
    this.store.update(id, { verification_status: ok ? 'passed' : 'failed' });
    if (!ok) throw new Error('Pre-merge verification failed');
  }

  async #review(id: number) {
    let t = this.#move(id, 'REVIEWING');
    if (this.#reviewer.id === t.assigned_agent) throw new Error('Reviewer must be independent of the implementing agent');
    this.#emit('review.started', id, { reviewer: this.#reviewer.id });
    const diff = await this.git.getDiff(t.worktree_path!, t.base_sha!);
    const res = await this.#reviewer.review({ task: t, diff, verificationPassed: t.verification_status === 'passed' });
    this.store.addReview({ taskId: id, reviewer: this.#reviewer.id, ...res });
    this.store.update(id, { review_status: res.approved ? 'approved' : 'rejected' });
    this.#emit('review.completed', id, { approved: res.approved, blocking: res.blockingIssues.length });
    this.#guard(id);
    if (!res.approved) throw new Error(`Review blocked: ${res.blockingIssues.join('; ')}`);
    t = this.#move(id, 'READY_TO_MERGE');
  }

  async #merge(id: number) {
    this.#guard(id);
    const t = this.#move(id, 'MERGING');
    // Deterministic pre-merge gate, re-derived from persisted evidence and live Git, not from agent claims.
    if (t.verification_status !== 'passed' || t.review_status !== 'approved') throw new Error('Merge gate: verification/review not passed');
    const liveHead = await this.git.resolve('HEAD', t.worktree_path!);
    if (liveHead !== t.commit_sha) throw new Error('Merge gate: worktree HEAD differs from verified commit');
    const targetSha = await this.git.resolve(`refs/heads/${this.targetBranch}`);

    if (await this.git.hasConflicts(targetSha, t.commit_sha!)) return this.#conflict(id);

    let backup;
    try {
      backup = await this.git.createBackup({ taskId: id, targetBranch: this.targetBranch });
    } catch (e) {
      throw new Error(`Backup failed, not merging: ${(e as Error).message}`); // hard stop: NO backup, NO merge
    }
    const row = this.store.addBackup({ task_id: id, ref: backup.ref, target_branch: this.targetBranch, target_sha: backup.sha, source_branch: t.branch!, source_sha: t.commit_sha! , created_at: backup.createdAt });
    this.#emit('git.backup_created', id, { ref: backup.ref, sha: backup.sha });
    const merge = this.store.createMerge(id, row.id);
    this.#emit('git.merge_started', id, { source: t.commit_sha, target: targetSha });

    const res = await this.git.merge({ targetBranch: this.targetBranch, expectedTargetSha: targetSha, sourceSha: t.commit_sha!, backup, message: `Merge task ${id}: ${t.title}` });
    if (res.status === 'conflict') { this.store.updateMerge(merge.id, 'conflict'); return this.#conflict(id); }
    this.store.updateMerge(merge.id, 'merging', res.mergedSha);
    this.#emit('git.merge_completed', id, { mergedSha: res.mergedSha });
    await this.#postMerge(id, merge.id, res.mergedSha);
  }

  async #postMerge(id: number, mergeId: number, mergedSha: string) {
    const ok = await this.#runChecks(id, 'post-merge', this.git.root);
    if (ok) {
      this.store.updateMerge(mergeId, 'success', mergedSha);
      this.#move(id, 'COMPLETED');
      this.#emit('merge.success', id, { mergedSha });
      this.#emit('task.completed', id, {});
      await this.#discardWorktree(this.store.getTask(id)!, false);
    } else {
      // Keep the merged state, logs, backup and diff. Rollback is available but never silent.
      this.store.updateMerge(mergeId, 'verification_failed', mergedSha);
      this.#emit('merge.verification_failed', id, { mergedSha, rollbackAvailable: true });
      this.#fail(id, 'MERGE_VERIFICATION_FAILED');
    }
  }

  // ---------- helpers ----------
  async #runChecks(id: number, phase: 'pre-merge' | 'post-merge', cwd: string): Promise<boolean> {
    const checks = this.#cfg.checks ?? await discoverChecks(cwd);
    this.#emit('verification.started', id, { phase, checks: checks.map((c) => c.name) });
    let ok = true;
    for (const c of checks) {
      const r = await runCheck(c, cwd);
      this.store.addVerification({ taskId: id, phase, name: c.name, argv: c.argv, exitCode: r.exitCode, passed: r.passed, durationMs: r.durationMs, outputTail: r.outputTail });
      if (!r.passed) { ok = false; break; }
    }
    this.#emit(ok ? 'verification.passed' : 'verification.failed', id, { phase });
    return ok;
  }

  #conflict(id: number) {
    this.#emit('git.merge_conflict', id, {});
    this.#move(id, 'CONFLICT', { failure_reason: 'merge conflict with target branch' });
  }

  #blockDependents() {
    for (const t of this.store.listTasks()) {
      if (t.status !== 'QUEUED') continue;
      const bad = this.store.deps(t.id).find((d) => ['FAILED', 'BLOCKED', 'CANCELLED', 'CONFLICT'].includes(this.store.getTask(d)!.status));
      if (bad) { this.#move(t.id, 'BLOCKED', { failure_reason: `dependency task ${bad} did not complete` }); this.#emit('task.blocked', t.id, { dependency: bad }); }
    }
  }

  async #discardWorktree(t: Task, deleteBranch = true) {
    if (t.worktree_path && existsSync(t.worktree_path)) await this.git.removeWorktree(t.worktree_path);
    if (t.worktree_path) this.#emit('git.worktree_removed', t.id, { path: t.worktree_path });
    if (deleteBranch && t.branch) await this.git.deleteAgentBranch(t.branch);
  }

  #guard(id: number) { if (this.#cancelled.has(id)) throw new Cancelled(); }

  #fail(id: number, reason: string) {
    this.#move(id, 'FAILED', { failure_reason: reason });
    this.#emit('task.failed', id, { reason });
  }

  #move(id: number, to: TaskStatus, patch: Partial<Task> = {}): Task {
    const from = this.store.getTask(id)!.status;
    const t = this.store.transition(id, to, patch);
    this.#emit('task.transition', id, { from, to });
    return t;
  }

  #emit(type: EventType, taskId: number, payload: Record<string, unknown> = {}, agentId?: string) {
    this.bus.emit(type, { taskId, agentId, payload });
  }
}

function defaultLaunch(t: Task): { argv: string[]; env?: Record<string, string> } {
  const spec = JSON.parse(t.spec) as { argv?: string[] };
  if (!spec.argv?.length) throw new Error(`Task ${t.id} has no agent argv`);
  return { argv: spec.argv };
}
