import { DatabaseSync } from 'node:sqlite';
import type { AgentOfficeEvent } from './events.ts';
import { assertTransition, type TaskStatus } from './taskMachine.ts';

// SQLite persistence. Everything needed for recovery and rollback lives here, not in agent memory.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_task_id INTEGER REFERENCES tasks(id),
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'QUEUED',
  assigned_agent TEXT, branch TEXT, worktree_path TEXT, base_sha TEXT, commit_sha TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  review_status TEXT NOT NULL DEFAULT 'pending',
  failure_reason TEXT,
  spec TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS task_deps (
  task_id INTEGER NOT NULL REFERENCES tasks(id), depends_on INTEGER NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on)
);
CREATE TABLE IF NOT EXISTS verification_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, phase TEXT NOT NULL,
  name TEXT NOT NULL, argv TEXT NOT NULL, exit_code INTEGER, passed INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL, output_tail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, reviewer TEXT NOT NULL,
  approved INTEGER NOT NULL, blocking_issues TEXT NOT NULL, warnings TEXT NOT NULL,
  summary TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, ref TEXT NOT NULL UNIQUE,
  target_branch TEXT NOT NULL, target_sha TEXT NOT NULL,
  source_branch TEXT NOT NULL, source_sha TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS merges (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, backup_id INTEGER NOT NULL REFERENCES backups(id),
  merged_sha TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, sender TEXT NOT NULL, recipient TEXT NOT NULL,
  body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, type TEXT NOT NULL,
  task_id INTEGER, agent_id TEXT, payload TEXT NOT NULL DEFAULT '{}'
);
`;

export type Row = Record<string, any>;

export interface Task {
  id: number; parent_task_id: number | null; title: string; description: string; status: TaskStatus;
  assigned_agent: string | null; branch: string | null; worktree_path: string | null;
  base_sha: string | null; commit_sha: string | null; verification_status: string; review_status: string;
  failure_reason: string | null; spec: string; created_at: string; started_at: string | null; completed_at: string | null;
}
export interface BackupRow {
  id: number; task_id: number; ref: string; target_branch: string; target_sha: string;
  source_branch: string; source_sha: string; created_at: string;
}
export interface MergeRow {
  id: number; task_id: number; backup_id: number; merged_sha: string | null;
  status: 'merging' | 'success' | 'verification_failed' | 'rolled_back' | 'conflict' | 'aborted'; created_at: string; completed_at: string | null;
}

export class Store {
  readonly db: DatabaseSync;
  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
  }
  close() { this.db.close(); }

  all<T = Row>(sql: string, ...p: any[]): T[] { return this.db.prepare(sql).all(...p) as T[]; }
  get<T = Row>(sql: string, ...p: any[]): T | undefined { return this.db.prepare(sql).get(...p) as T | undefined; }
  run(sql: string, ...p: any[]) { return this.db.prepare(sql).run(...p); }

  // --- tasks ---
  createTask(t: { title: string; description?: string; dependsOn?: number[]; parentTaskId?: number; spec?: unknown }): Task {
    const r = this.run(
      'INSERT INTO tasks (title, description, parent_task_id, spec, created_at) VALUES (?,?,?,?,?)',
      t.title, t.description ?? '', t.parentTaskId ?? null, JSON.stringify(t.spec ?? {}), new Date().toISOString(),
    );
    const id = Number(r.lastInsertRowid);
    for (const d of t.dependsOn ?? []) {
      if (!this.getTask(d)) throw new Error(`Unknown dependency task ${d}`);
      this.run('INSERT INTO task_deps (task_id, depends_on) VALUES (?,?)', id, d);
    }
    return this.getTask(id)!;
  }
  getTask(id: number): Task | undefined { return this.get<Task>('SELECT * FROM tasks WHERE id = ?', id); }
  listTasks(): Task[] { return this.all<Task>('SELECT * FROM tasks ORDER BY id'); }
  deps(id: number): number[] { return this.all('SELECT depends_on FROM task_deps WHERE task_id = ?', id).map((r) => r.depends_on); }

  /** The only place task status changes. Validates against the state machine. */
  transition(id: number, to: TaskStatus, patch: Partial<Task> = {}): Task {
    const t = this.getTask(id);
    if (!t) throw new Error(`No task ${id}`);
    assertTransition(t.status, to);
    const now = new Date().toISOString();
    const fields: Partial<Task> = { ...patch, status: to };
    if (to === 'WORKING' && !t.started_at) fields.started_at = now;
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'CONFLICT'].includes(to)) fields.completed_at = now;
    if (to === 'QUEUED') { fields.completed_at = null; fields.failure_reason = patch.failure_reason ?? null; }
    this.update(id, fields);
    return this.getTask(id)!;
  }
  update(id: number, fields: Partial<Task>) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    this.run(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => (fields as any)[k]), id);
  }

  // --- evidence ---
  addVerification(v: { taskId: number; phase: 'pre-merge' | 'post-merge'; name: string; argv: string[]; exitCode: number | null; passed: boolean; durationMs: number; outputTail: string }) {
    this.run('INSERT INTO verification_runs (task_id, phase, name, argv, exit_code, passed, duration_ms, output_tail, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      v.taskId, v.phase, v.name, JSON.stringify(v.argv), v.exitCode, v.passed ? 1 : 0, v.durationMs, v.outputTail, new Date().toISOString());
  }
  verifications(taskId: number, phase?: string): Row[] {
    return phase
      ? this.all('SELECT * FROM verification_runs WHERE task_id = ? AND phase = ? ORDER BY id', taskId, phase)
      : this.all('SELECT * FROM verification_runs WHERE task_id = ? ORDER BY id', taskId);
  }
  addReview(r: { taskId: number; reviewer: string; approved: boolean; blockingIssues: string[]; warnings: string[]; summary: string }) {
    this.run('INSERT INTO reviews (task_id, reviewer, approved, blocking_issues, warnings, summary, created_at) VALUES (?,?,?,?,?,?,?)',
      r.taskId, r.reviewer, r.approved ? 1 : 0, JSON.stringify(r.blockingIssues), JSON.stringify(r.warnings), r.summary, new Date().toISOString());
  }
  reviews(taskId: number): Row[] { return this.all('SELECT * FROM reviews WHERE task_id = ? ORDER BY id', taskId); }

  addBackup(b: Omit<BackupRow, 'id' | 'created_at'> & { created_at?: string }): BackupRow {
    const r = this.run('INSERT INTO backups (task_id, ref, target_branch, target_sha, source_branch, source_sha, created_at) VALUES (?,?,?,?,?,?,?)',
      b.task_id, b.ref, b.target_branch, b.target_sha, b.source_branch, b.source_sha, b.created_at ?? new Date().toISOString());
    return this.get<BackupRow>('SELECT * FROM backups WHERE id = ?', Number(r.lastInsertRowid))!;
  }
  backups(taskId?: number): BackupRow[] {
    return taskId ? this.all<BackupRow>('SELECT * FROM backups WHERE task_id = ? ORDER BY id', taskId) : this.all<BackupRow>('SELECT * FROM backups ORDER BY id');
  }
  createMerge(taskId: number, backupId: number): MergeRow {
    const r = this.run('INSERT INTO merges (task_id, backup_id, status, created_at) VALUES (?,?,?,?)', taskId, backupId, 'merging', new Date().toISOString());
    return this.get<MergeRow>('SELECT * FROM merges WHERE id = ?', Number(r.lastInsertRowid))!;
  }
  updateMerge(id: number, status: MergeRow['status'], mergedSha?: string) {
    this.run('UPDATE merges SET status = ?, merged_sha = COALESCE(?, merged_sha), completed_at = ? WHERE id = ?',
      status, mergedSha ?? null, status === 'merging' ? null : new Date().toISOString(), id);
  }
  latestMerge(taskId: number): MergeRow | undefined {
    return this.get<MergeRow>('SELECT * FROM merges WHERE task_id = ? ORDER BY id DESC LIMIT 1', taskId);
  }
  merges(): MergeRow[] { return this.all<MergeRow>('SELECT * FROM merges ORDER BY id'); }

  // --- mailbox ---
  sendMessage(m: { taskId?: number; sender: string; recipient: string; body: string }) {
    this.run('INSERT INTO messages (task_id, sender, recipient, body, created_at) VALUES (?,?,?,?,?)',
      m.taskId ?? null, m.sender, m.recipient, m.body, new Date().toISOString());
  }
  messages(recipient?: string): Row[] {
    return recipient ? this.all('SELECT * FROM messages WHERE recipient = ? ORDER BY id', recipient) : this.all('SELECT * FROM messages ORDER BY id');
  }

  // --- events / audit ---
  persistEvent(e: AgentOfficeEvent) {
    this.run('INSERT INTO events (ts, type, task_id, agent_id, payload) VALUES (?,?,?,?,?)',
      e.ts, e.type, e.taskId ?? null, e.agentId ?? null, JSON.stringify(e.payload ?? {}));
  }
  events(taskId?: number): Row[] {
    return taskId ? this.all('SELECT * FROM events WHERE task_id = ? ORDER BY id', taskId) : this.all('SELECT * FROM events ORDER BY id');
  }
}
