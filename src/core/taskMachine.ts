// Explicit task state machine. Illegal transitions throw; nothing else mutates task status.

export const TASK_STATES = [
  'QUEUED', 'ASSIGNED', 'WORKING', 'VERIFYING', 'REVIEWING', 'READY_TO_MERGE', 'MERGING', 'COMPLETED',
  'BLOCKED', 'FAILED', 'CONFLICT', 'CANCELLED',
] as const;
export type TaskStatus = (typeof TASK_STATES)[number];

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  QUEUED: ['ASSIGNED', 'BLOCKED', 'CANCELLED'],
  ASSIGNED: ['WORKING', 'FAILED', 'CANCELLED', 'QUEUED'],
  WORKING: ['VERIFYING', 'FAILED', 'CANCELLED', 'QUEUED'],
  VERIFYING: ['REVIEWING', 'FAILED', 'CANCELLED', 'QUEUED'],
  REVIEWING: ['READY_TO_MERGE', 'FAILED', 'CANCELLED', 'QUEUED'],
  READY_TO_MERGE: ['MERGING', 'FAILED', 'CANCELLED'],
  MERGING: ['COMPLETED', 'CONFLICT', 'FAILED', 'READY_TO_MERGE'],
  COMPLETED: [],
  BLOCKED: ['QUEUED', 'CANCELLED'],
  FAILED: ['QUEUED'], // explicit retry
  CONFLICT: ['QUEUED', 'CANCELLED'],
  CANCELLED: [],
};

export const TERMINAL: ReadonlySet<TaskStatus> = new Set(['COMPLETED', 'CANCELLED']);

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) throw new Error(`Illegal task transition ${from} -> ${to}`);
}
