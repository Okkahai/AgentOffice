import type { Orchestrator } from '../core/orchestrator.ts';
import type { Task } from '../core/store.ts';

// The Manager agent PROPOSES a plan as JSON. This module is the deterministic gate: nothing from the
// model reaches the task engine unless it validates (bounded size, unique keys, known deps, no cycles).

export interface PlannedTask { key: string; title: string; description: string; dependsOn: string[]; prompt: string }
export interface TaskPlan { summary: string; tasks: PlannedTask[] }

export class PlanError extends Error {}

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function validatePlan(input: unknown, opts: { maxTasks?: number } = {}): TaskPlan {
  const maxTasks = opts.maxTasks ?? 6;
  const o = input as { summary?: unknown; tasks?: unknown };
  if (!o || typeof o !== 'object' || !Array.isArray(o.tasks)) throw new PlanError('Plan must be an object with a tasks array');
  if (o.tasks.length === 0) throw new PlanError('Plan has no tasks');
  if (o.tasks.length > maxTasks) throw new PlanError(`Plan has ${o.tasks.length} tasks; the smallest useful team is preferred (max ${maxTasks})`);

  const tasks: PlannedTask[] = o.tasks.map((raw: any, i: number) => {
    const str = (v: unknown, f: string) => {
      if (typeof v !== 'string' || !v.trim()) throw new PlanError(`Task ${i + 1}: "${f}" must be a non-empty string`);
      return v.trim();
    };
    const key = str(raw?.key, 'key');
    if (!KEY_RE.test(key)) throw new PlanError(`Task ${i + 1}: key "${key}" must be lowercase letters, digits or dashes`);
    const dependsOn = raw.dependsOn ?? [];
    if (!Array.isArray(dependsOn) || dependsOn.some((d: unknown) => typeof d !== 'string')) throw new PlanError(`Task "${key}": dependsOn must be an array of keys`);
    return { key, title: str(raw.title, 'title').slice(0, 120), description: typeof raw.description === 'string' ? raw.description : '', dependsOn, prompt: str(raw.prompt, 'prompt') };
  });

  const keys = new Set<string>();
  for (const t of tasks) {
    if (keys.has(t.key)) throw new PlanError(`Duplicate task key "${t.key}"`);
    keys.add(t.key);
  }
  for (const t of tasks) {
    for (const d of t.dependsOn) {
      if (!keys.has(d)) throw new PlanError(`Task "${t.key}" depends on unknown task "${d}"`);
      if (d === t.key) throw new PlanError(`Task "${t.key}" depends on itself`);
    }
  }
  topoOrder(tasks); // throws on cycles
  return { summary: typeof o.summary === 'string' ? o.summary : '', tasks };
}

/** Kahn's algorithm; throws PlanError on a cycle. */
export function topoOrder(tasks: PlannedTask[]): PlannedTask[] {
  const remaining = new Map(tasks.map((t) => [t.key, new Set(t.dependsOn)]));
  const out: PlannedTask[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter(([, d]) => d.size === 0).map(([k]) => k);
    if (!ready.length) throw new PlanError(`Dependency cycle among: ${[...remaining.keys()].join(', ')}`);
    for (const k of ready) {
      remaining.delete(k);
      out.push(tasks.find((t) => t.key === k)!);
      for (const d of remaining.values()) d.delete(k);
    }
  }
  return out;
}

/** Pull the first JSON object out of noisy agent output (fenced or bare). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const candidates = [fenced, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)].filter((c): c is string => !!c);
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
  }
  throw new PlanError('No valid JSON found in planner output');
}

export function buildPlanPrompt(goal: string): string {
  return [
    'You are the Manager of a small software team. Read the repository if needed, but do NOT edit any files.',
    `Goal: ${goal}`,
    'Reply with ONLY a JSON object: {"summary": string, "tasks": [{"key": "kebab-case", "title": string, "description": string, "dependsOn": [keys], "prompt": string}]}.',
    'Rules: use the smallest useful number of tasks (usually 1 to 4); independent tasks may run in parallel, dependent ones must list dependsOn; each "prompt" is the full instruction for one engineer working alone in its own git worktree.',
  ].join('\n');
}

export interface Planner { plan(goal: string): Promise<unknown> }

/** Validate a proposal and register it with the orchestrator. `buildArgv` turns a task prompt into the engineer's argv. */
export function applyPlan(orch: Orchestrator, plan: TaskPlan, buildArgv: (prompt: string) => string[]): Map<string, Task> {
  const created = new Map<string, Task>();
  for (const t of topoOrder(plan.tasks)) {
    created.set(t.key, orch.createTask({
      title: t.title, description: t.description,
      dependsOn: t.dependsOn.map((d) => created.get(d)!.id),
      spec: { argv: buildArgv(t.prompt), key: t.key },
    }));
  }
  return created;
}

export async function planAndApply(orch: Orchestrator, planner: Planner, goal: string, buildArgv: (prompt: string) => string[]) {
  const plan = validatePlan(await planner.plan(goal));
  const tasks = applyPlan(orch, plan, buildArgv);
  orch.bus.emit('plan.created', { agentId: 'manager', payload: { goal, summary: plan.summary, tasks: plan.tasks.length } });
  return { plan, tasks };
}
