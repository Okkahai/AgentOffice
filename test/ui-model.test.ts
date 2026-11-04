import assert from 'node:assert/strict';
import { it } from 'node:test';
// @ts-expect-error plain browser module without types
import { agentState, attention, goalState, graphLayout, pipeline } from '../ui/model.js';

const ev = (type: string, taskId?: number, payload = {}) => ({ type, ts: '2026-01-01T00:00:00Z', taskId, payload });
const task = (id: number, status: string, dependsOn: number[] = [], extra = {}) => ({ id, title: `t${id}`, status, dependsOn, failure_reason: null, ...extra });

it('agent state follows the real process lifecycle, never guesses', () => {
  assert.equal(agentState([], 1).label, 'NOT STARTED');
  assert.equal(agentState([ev('agent.spawned', 1), ev('agent.coding', 1)], 1).label, 'RUNNING');
  assert.equal(agentState([ev('agent.coding', 1), ev('agent.completed', 1)], 1).label, 'EXITED 0');
  assert.equal(agentState([ev('agent.coding', 1), ev('agent.failed', 1, { code: 2 })], 1).label, 'FAILED 2');
  assert.equal(agentState([ev('agent.coding', 2)], 1).label, 'NOT STARTED');
});

it('attention lists failures, conflicts, blocked tasks, failed post-merge checks and plan failures once each', () => {
  const data = {
    targetBranch: 'main',
    tasks: [task(1, 'FAILED', [], { failure_reason: 'boom' }), task(2, 'BLOCKED', [1]), task(3, 'COMPLETED'), task(4, 'CONFLICT')],
    merges: [{ task_id: 3, status: 'verification_failed', merged_sha: 'abcdef1234' }, { task_id: 3, status: 'verification_failed', merged_sha: 'abcdef1234' }],
  };
  const items = attention(data, [ev('plan.started', undefined, { goal: 'g' }), ev('plan.failed', undefined, { reason: 'no json' })]);
  assert.deepEqual(items.map((i: any) => i.kind).sort(), ['BLOCKED', 'CONFLICT', 'FAILED', 'PLAN', 'POST-MERGE']);
  assert.equal(items.find((i: any) => i.kind === 'POST-MERGE').action, 'rollback');
  assert.equal(attention({ ...data, tasks: [task(3, 'COMPLETED')], merges: [] }, []).length, 0);
});

it('goal state clears a failure when a new plan starts', () => {
  assert.equal(goalState([ev('plan.started', undefined, { goal: 'a' }), ev('plan.failed', undefined, { reason: 'x' })]).failed, 'x');
  const g = goalState([ev('plan.failed', undefined, { reason: 'x' }), ev('plan.started', undefined, { goal: 'b' })]);
  assert.deepEqual([g.goal, g.planning, g.failed], ['b', true, null]);
});

it('pipeline counts every task exactly once and the graph puts dependents to the right', () => {
  const tasks = [task(1, 'COMPLETED'), task(2, 'WORKING'), task(3, 'QUEUED', [1, 2])];
  assert.equal(pipeline(tasks).reduce((n: number, s: any) => n + s.n, 0), 3);
  const g = graphLayout(tasks);
  const x = (id: number) => g.nodes.find((n: any) => n.t.id === id).x;
  assert.ok(x(3) > x(1) && x(1) === x(2));
  assert.equal(g.edges.length, 2);
});
