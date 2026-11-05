import assert from 'node:assert/strict';
import { it } from 'node:test';
// @ts-expect-error plain browser module without types
import { agentState, attention, goalState, graphLayout, highlight, parseDiff, pipeline } from '../ui/model.js';

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

it('diff parsing numbers lines, pairs changes for split view and keeps removed lines that look like headers', () => {
  const patch = ['diff --git a/q.sql b/q.sql', 'index 1..2 100644', '--- a/q.sql', '+++ b/q.sql', '@@ -3,3 +3,3 @@ select',
    ' keep', '--- old comment', '+-- new comment', '+added', ' tail', ''].join('\n');
  const rows = parseDiff(patch);
  assert.deepEqual(rows.map((r: { t: string }) => r.t), ['file', 'hunk', 'ctx', 'change', 'ctx']);
  assert.equal(rows[0].text, 'q.sql');
  assert.deepEqual(rows[2], { t: 'ctx', l: 3, r: 3, text: 'keep' });
  assert.deepEqual(rows[3].dels, [{ n: 4, text: '-- old comment' }]);
  assert.deepEqual(rows[3].adds, [{ n: 4, text: '-- new comment' }, { n: 5, text: 'added' }]);
  assert.deepEqual(rows[4], { t: 'ctx', l: 5, r: 6, text: 'tail' });
});

it('highlights code safely and leaves unknown file types as escaped text', () => {
  assert.equal(highlight('const x = "<b>"; // hi', 'a.ts'),
    '<span class="sy-k">const</span> x = <span class="sy-s">&quot;&lt;b&gt;&quot;</span>; <span class="sy-c">// hi</span>');
  assert.equal(highlight('x = 1  # note', 'a.py'), 'x = <span class="sy-n">1</span>  <span class="sy-c"># note</span>');
  assert.equal(highlight('<script>alert(1)</script>', 'notes.txt'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.doesNotMatch(highlight('"<img onerror=x>', 'a.js'), /<img/);
});
