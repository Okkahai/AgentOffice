// Pure reducer: real system events in, office scene state out. Runs in Node (tests) and the browser.
// Rule: nothing here invents activity. If no event says an agent is working, it is idle.

export function initialOffice() {
  return {
    agents: {
      manager: { id: 'manager', role: 'MANAGER', room: 'manager', state: 'idle', taskId: null },
      'qa-reviewer': { id: 'qa-reviewer', role: 'QA', room: 'qa', state: 'idle', taskId: null, jobs: {} },
    },
    server: { backupAt: null, merging: false, result: null, verifying: false, mergeCount: 0 },
    tasks: {},
    bubbles: {},      // agentId -> { text, ts }
    lastEventTs: null,
  };
}

const engineerId = (ev) => ev.agentId ?? `engineer-${ev.taskId}`;

function ensureEngineer(s, ev) {
  const id = engineerId(ev);
  if (!s.agents[id]) s.agents[id] = { id, role: 'ENGINEER', room: 'engineering', state: 'idle', taskId: ev.taskId ?? null };
  return s.agents[id];
}

// QA can be busy with several tasks at once; state is derived from the set of open jobs, never from the last event.
function qaJob(qa, key, on, taskId) {
  if (on) { qa.jobs[key] = taskId; qa.taskId = taskId; } else delete qa.jobs[key];
  const keys = Object.keys(qa.jobs);
  qa.state = keys.some((k) => k.startsWith('test:')) ? 'testing' : keys.length ? 'reviewing' : 'idle';
}

function say(s, id, text, ev) { s.bubbles[id] = { text, ts: ev.ts }; }

export function reduce(state, ev) {
  const s = state;
  s.lastEventTs = ev.ts;
  const p = ev.payload ?? {};
  const qa = s.agents['qa-reviewer'];
  const task = ev.taskId != null ? (s.tasks[ev.taskId] ??= { id: ev.taskId, title: `task ${ev.taskId}`, status: 'QUEUED' }) : null;

  switch (ev.type) {
    case 'plan.created':
      s.agents.manager.state = 'planning';
      say(s, 'manager', `Plan ready: ${p.tasks} task${p.tasks === 1 ? '' : 's'}`, ev);
      break;
    case 'task.created':
      if (task) task.title = p.title ?? task.title;
      if (s.agents.manager.state === 'planning') s.agents.manager.state = 'idle';
      break;
    case 'task.transition':
      if (task) task.status = p.to;
      break;
    case 'task.assigned': {
      const a = ensureEngineer(s, ev); a.taskId = ev.taskId; a.state = 'idle'; a.assignedAt = ev.ts;
      say(s, a.id, `Assigned: ${task?.title ?? ''}`, ev);
      break;
    }
    case 'agent.spawned': { const a = ensureEngineer(s, ev); a.state = 'idle'; break; }
    case 'agent.coding': { const a = ensureEngineer(s, ev); a.state = 'coding'; break; }
    case 'agent.completed': { const a = ensureEngineer(s, ev); a.state = 'idle'; say(s, a.id, 'Done coding', ev); break; }
    case 'agent.failed': { const a = ensureEngineer(s, ev); a.state = 'failed'; say(s, a.id, 'Agent failed', ev); break; }
    case 'task.failed': {
      const a = s.agents[engineerId(ev)];
      if (a) { a.state = 'failed'; say(s, a.id, p.reason ?? 'Task failed', ev); }
      for (const k of Object.keys(qa.jobs)) if (k.endsWith(`:${ev.taskId}`)) qaJob(qa, k, false);
      break;
    }
    case 'verification.started':
      if (p.phase === 'post-merge') s.server.verifying = true;
      else qaJob(qa, `test:${ev.taskId}`, true, ev.taskId);
      break;
    case 'verification.passed':
    case 'verification.failed':
      if (p.phase === 'post-merge') s.server.verifying = false;
      else { qaJob(qa, `test:${ev.taskId}`, false); if (ev.type === 'verification.failed') say(s, 'qa-reviewer', 'Checks failed', ev); }
      break;
    case 'review.started': qaJob(qa, `review:${ev.taskId}`, true, ev.taskId); break;
    case 'review.completed':
      qaJob(qa, `review:${ev.taskId}`, false);
      say(s, 'qa-reviewer', p.approved ? 'Approved' : `Blocked (${p.blocking})`, ev);
      break;
    case 'git.backup_created': s.server.backupAt = ev.ts; break;
    case 'git.merge_started': s.server.merging = true; s.server.result = null; break;
    case 'git.merge_completed': s.server.merging = false; break;
    case 'git.merge_conflict': s.server.merging = false; s.server.result = 'conflict'; break;
    case 'merge.success': s.server.result = 'success'; s.server.mergeCount += 1; break;
    case 'merge.verification_failed': s.server.result = 'verification_failed'; break;
    case 'git.rollback_completed': s.server.result = 'rolled_back'; break;
    case 'git.worktree_removed': {
      const a = s.agents[engineerId(ev)];
      if (a && a.state !== 'failed') delete s.agents[a.id];
      break;
    }
    case 'system.recovered': say(s, 'manager', `Recovered task ${ev.taskId}`, ev); break;
    default: break;
  }
  return s;
}

export function replay(events) {
  return events.reduce((s, e) => reduce(s, e), initialOffice());
}
