// Pure derivations from real state and events. Runs in the browser and in node tests. Nothing here invents activity.

const STAGES = [
  ['Queued', ['QUEUED'], ''], ['Working', ['ASSIGNED', 'WORKING'], ''], ['Verify', ['VERIFYING'], ''], ['Review', ['REVIEWING'], ''],
  ['Merge', ['READY_TO_MERGE', 'MERGING'], ''], ['Done', ['COMPLETED'], 'good'], ['Stopped', ['FAILED', 'CONFLICT', 'BLOCKED', 'CANCELLED'], 'bad'],
];
export function pipeline(tasks) {
  return STAGES.map(([label, states, tone]) => ({ label, tone, n: tasks.filter((t) => states.includes(t.status)).length }));
}

/** Agent process lifecycle from the agent.* events of one task. */
export function agentState(events, taskId) {
  let last = null;
  for (const e of events) if (e.taskId === taskId && e.type.startsWith('agent.')) last = e;
  if (!last) return { label: 'NOT STARTED', tone: 'mute' };
  if (last.type === 'agent.spawned' || last.type === 'agent.coding') return { label: 'RUNNING', tone: 'info' };
  if (last.type === 'agent.waiting') return { label: 'WAITING FOR INPUT', tone: 'warn' };
  if (last.type === 'agent.completed') return { label: 'EXITED 0', tone: 'ok' };
  const p = last.payload ?? {};
  return { label: p.reason === 'timeout' ? 'TIMED OUT' : `FAILED${p.code != null ? ` ${p.code}` : ''}`, tone: 'err' };
}

/** Latest goal and Manager planning state. */
export function goalState(events) {
  let goal = null, planning = false, failed = null;
  for (const e of events) {
    if (e.type === 'plan.started') { goal = e.payload?.goal ?? goal; planning = true; failed = null; }
    else if (e.type === 'plan.created') { goal = e.payload?.goal ?? goal; planning = false; }
    else if (e.type === 'plan.failed') { planning = false; failed = e.payload?.reason ?? 'planning failed'; }
  }
  return { goal, planning, failed };
}

/** Everything that needs a human, deduplicated per task (most severe first). */
export function attention(data, events) {
  const items = [];
  for (const t of data.tasks) {
    if (t.status === 'FAILED') items.push({ kind: 'FAILED', tone: 'err', taskId: t.id, title: `#${t.id} ${t.title} failed`, why: t.failure_reason ?? 'no reason recorded', rank: 0 });
    else if (t.status === 'CONFLICT') items.push({ kind: 'CONFLICT', tone: 'err', taskId: t.id, title: `#${t.id} ${t.title} conflicts with ${data.targetBranch}`, why: 'Merge was refused; the target branch is unchanged. Resolve or retry the task.', rank: 0 });
    else if (t.status === 'BLOCKED') items.push({ kind: 'BLOCKED', tone: 'warn', taskId: t.id, title: `#${t.id} ${t.title} is blocked`, why: t.failure_reason ?? 'a dependency did not complete', rank: 2 });
  }
  for (const m of data.merges) {
    if (m.status === 'verification_failed') items.push({ kind: 'POST-MERGE', tone: 'err', taskId: m.task_id, title: `Post-merge verification failed after #${m.task_id}`, why: `${data.targetBranch} now contains ${String(m.merged_sha ?? '').slice(0, 8)}. Nothing was rolled back automatically; a verified backup is available.`, rank: 0, action: 'rollback' });
  }
  const g = goalState(events);
  if (g.failed) items.push({ kind: 'PLAN', tone: 'err', taskId: null, title: 'The Manager could not plan the goal', why: g.failed, rank: 1 });
  const seen = new Set();
  return items.sort((a, b) => a.rank - b.rank).filter((i) => { const k = `${i.kind}:${i.taskId}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

const SEV = {
  error: ['task.failed', 'agent.failed', 'verification.failed', 'git.merge_conflict', 'merge.verification_failed', 'git.op_denied', 'plan.failed'],
  warn: ['task.blocked', 'git.rollback_completed', 'system.recovered'],
  ok: ['verification.passed', 'merge.success', 'task.completed', 'git.backup_created', 'agent.completed', 'plan.created'],
};
export function severity(e) {
  if (e.type === 'review.completed') return e.payload?.approved ? 'ok' : 'warn';
  return Object.keys(SEV).find((k) => SEV[k].includes(e.type)) ?? 'info';
}

export function describe(e, title) {
  const p = e.payload ?? {}, sha = (s) => String(s ?? '').slice(0, 8), t = title ? ` ${title}` : '';
  switch (e.type) {
    case 'task.created': return `created${t}${p.dependsOn?.length ? `, after ${p.dependsOn.map((d) => `#${d}`).join(' ')}` : ''}`;
    case 'task.transition': return `${p.from} → ${p.to}`;
    case 'task.assigned': return `assigned to ${p.agentId}`;
    case 'task.completed': return `completed${t}`;
    case 'task.failed': return p.reason ?? 'failed';
    case 'task.blocked': return `blocked by #${p.dependency}`;
    case 'agent.spawned': return `process started${p.pid ? ` (pid ${p.pid})` : ''}`;
    case 'agent.coding': return 'agent working in its worktree';
    case 'agent.completed': return 'agent process exited 0';
    case 'agent.failed': return p.reason === 'timeout' ? 'agent timed out and was terminated' : `agent exited with code ${p.code}`;
    case 'git.worktree_created': return `worktree ${p.branch} from ${sha(p.baseSha)}`;
    case 'git.worktree_removed': return 'worktree removed';
    case 'git.commit_created': return `commit ${sha(p.sha)}`;
    case 'git.backup_created': return `backup ${p.ref} at ${sha(p.sha)}`;
    case 'git.merge_started': return `merging ${sha(p.source)} into ${sha(p.target)}`;
    case 'git.merge_completed': return `merged as ${sha(p.mergedSha)}`;
    case 'git.merge_conflict': return 'merge conflict, target unchanged';
    case 'git.rollback_completed': return `rolled back to ${sha(p.restoredTo)} from ${p.backupRef}`;
    case 'verification.started': return `${p.phase}: ${(p.checks ?? []).join(', ') || 'no checks found'}`;
    case 'verification.passed': return `${p.phase} checks passed`;
    case 'verification.failed': return `${p.phase} checks failed`;
    case 'review.started': return `review by ${p.reviewer}`;
    case 'review.completed': return p.approved ? 'approved' : `blocked (${p.blocking} issue${p.blocking === 1 ? '' : 's'})`;
    case 'merge.success': return `post-merge verification passed, ${sha(p.mergedSha)}`;
    case 'merge.verification_failed': return `post-merge verification failed on ${sha(p.mergedSha)}`;
    case 'plan.started': return `planning: ${p.goal}`;
    case 'plan.created': return `${p.tasks} task${p.tasks === 1 ? '' : 's'} planned: ${p.summary || p.goal}`;
    case 'plan.failed': return `planning failed: ${p.reason}`;
    case 'system.recovered': return `recovered from ${p.from}: ${p.action}`;
    default: return title ?? '';
  }
}

/** Layered layout: column = longest dependency chain to the node, rows in id order. */
export function graphLayout(tasks, NW = 216, NH = 46, GX = 64, GY = 14, PAD = 16) {
  const byId = new Map(tasks.map((t) => [t.id, t])), depth = new Map();
  const d = (t, seen = new Set()) => {
    if (depth.has(t.id)) return depth.get(t.id);
    if (seen.has(t.id)) return 0;
    seen.add(t.id);
    const v = Math.max(-1, ...t.dependsOn.map((x) => (byId.has(x) ? d(byId.get(x), seen) : -1))) + 1;
    depth.set(t.id, v); return v;
  };
  const cols = [];
  for (const t of tasks) (cols[d(t)] ??= []).push(t);
  const nodes = [], pos = new Map();
  cols.forEach((col, c) => col.forEach((t, r) => { const n = { t, x: PAD + c * (NW + GX), y: PAD + r * (NH + GY) }; nodes.push(n); pos.set(t.id, n); }));
  const edges = tasks.flatMap((t) => t.dependsOn.filter((x) => pos.has(x)).map((x) => ({ from: pos.get(x), to: pos.get(t.id) })));
  const rows = Math.max(...cols.map((c) => c?.length ?? 0));
  return { nodes, edges, w: PAD * 2 + cols.length * NW + (cols.length - 1) * GX, h: PAD * 2 + rows * NH + (rows - 1) * GY };
}
