// Typed internal event bus. Every event is also persisted (audit trail) by the Store.
// Business logic never depends on subscribers; the UI is just another subscriber.

export type EventType =
  | 'agent.spawned' | 'agent.coding' | 'agent.waiting' | 'agent.failed' | 'agent.completed'
  | 'task.created' | 'task.assigned' | 'task.started' | 'task.blocked' | 'task.transition' | 'task.completed' | 'task.failed'
  | 'git.worktree_created' | 'git.worktree_removed' | 'git.commit_created' | 'git.backup_created'
  | 'git.merge_started' | 'git.merge_completed' | 'git.merge_conflict' | 'git.rollback_completed' | 'git.op_denied'
  | 'verification.started' | 'verification.passed' | 'verification.failed'
  | 'review.started' | 'review.completed'
  | 'merge.success' | 'merge.verification_failed'
  | 'message.sent' | 'system.recovered';

export interface AgentOfficeEvent {
  type: EventType;
  ts: string;
  taskId?: number;
  agentId?: string;
  payload?: Record<string, unknown>;
}

type Listener = (e: AgentOfficeEvent) => void;

export class EventBus {
  #listeners = new Set<Listener>();
  subscribe(l: Listener): () => void {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }
  emit(type: EventType, extra: Omit<AgentOfficeEvent, 'type' | 'ts'> = {}): AgentOfficeEvent {
    const e: AgentOfficeEvent = { type, ts: new Date().toISOString(), ...extra };
    for (const l of this.#listeners) {
      try { l(e); } catch { /* a broken subscriber must never affect the pipeline */ }
    }
    return e;
  }
}
