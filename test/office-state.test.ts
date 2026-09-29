import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// @ts-expect-error plain browser module
import { initialOffice, reduce, replay } from '../ui/office-state.js';

let n = 0;
const ev = (type: string, extra: object = {}) => ({ type, ts: new Date(1_700_000_000_000 + n++ * 1000).toISOString(), ...extra });

describe('office state reducer (real events only)', () => {
  it('nothing happens without events: everyone is idle, no engineers exist', () => {
    const s = initialOffice();
    assert.deepEqual(Object.keys(s.agents).sort(), ['manager', 'qa-reviewer']);
    assert.ok(Object.values(s.agents).every((a: any) => a.state === 'idle'));
  });

  it('follows a full successful task and clears the engineer afterwards', () => {
    const trail = [
      ev('task.created', { taskId: 1, payload: { title: 'Add hello' } }),
      ev('task.assigned', { taskId: 1, agentId: 'engineer-1' }),
      ev('agent.spawned', { taskId: 1, agentId: 'engineer-1' }),
      ev('agent.coding', { taskId: 1, agentId: 'engineer-1' }),
    ];
    let s = replay(trail);
    assert.equal(s.agents['engineer-1'].state, 'coding');
    s = replay([...trail, ev('agent.completed', { taskId: 1, agentId: 'engineer-1' }), ev('verification.started', { taskId: 1, payload: { phase: 'pre-merge' } })]);
    assert.equal(s.agents['engineer-1'].state, 'idle');
    assert.equal(s.agents['qa-reviewer'].state, 'testing');
    s = replay([...trail, ev('review.started', { taskId: 1 })]);
    assert.equal(s.agents['qa-reviewer'].state, 'reviewing');
    s = replay([...trail, ev('git.backup_created', { taskId: 1 }), ev('git.merge_started', { taskId: 1 })]);
    assert.equal(s.server.merging, true);
    assert.ok(s.server.backupAt);
    s = replay([...trail, ev('git.merge_started', { taskId: 1 }), ev('git.merge_completed', { taskId: 1 }), ev('merge.success', { taskId: 1 }), ev('git.worktree_removed', { taskId: 1 })]);
    assert.equal(s.server.result, 'success');
    assert.equal(s.server.mergeCount, 1);
    assert.equal(s.agents['engineer-1'], undefined);
  });

  it('failures stay visible until the task is retried', () => {
    const s = replay([
      ev('task.assigned', { taskId: 2, agentId: 'engineer-2' }),
      ev('agent.coding', { taskId: 2, agentId: 'engineer-2' }),
      ev('task.failed', { taskId: 2, payload: { reason: 'Pre-merge verification failed' } }),
      ev('git.worktree_removed', { taskId: 2 }),
    ]);
    assert.equal(s.agents['engineer-2'].state, 'failed');
    assert.match(s.bubbles['engineer-2'].text, /verification failed/);
  });

  it('post-merge failure and rollback are shown on the server room', () => {
    let s = replay([ev('git.merge_started', { taskId: 3 }), ev('git.merge_completed', { taskId: 3 }), ev('verification.started', { taskId: 3, payload: { phase: 'post-merge' } })]);
    assert.equal(s.server.verifying, true);
    s = reduce(s, ev('verification.failed', { taskId: 3, payload: { phase: 'post-merge' } }));
    s = reduce(s, ev('merge.verification_failed', { taskId: 3 }));
    assert.equal(s.server.result, 'verification_failed');
    s = reduce(s, ev('git.rollback_completed', { taskId: 3 }));
    assert.equal(s.server.result, 'rolled_back');
  });

  it('QA stays busy while any task is still being tested or reviewed', () => {
    let s = replay([ev('review.started', { taskId: 1 }), ev('verification.started', { taskId: 2, payload: { phase: 'pre-merge' } })]);
    assert.equal(s.agents['qa-reviewer'].state, 'testing');
    s = reduce(s, ev('review.completed', { taskId: 1, payload: { approved: true } }));
    assert.equal(s.agents['qa-reviewer'].state, 'testing', 'task 2 is still being tested');
    s = reduce(s, ev('verification.passed', { taskId: 2, payload: { phase: 'pre-merge' } }));
    assert.equal(s.agents['qa-reviewer'].state, 'idle');
  });

  it('manager reacts to plan.created', () => {
    const s = replay([ev('plan.created', { agentId: 'manager', payload: { tasks: 3 } })]);
    assert.equal(s.agents.manager.state, 'planning');
    assert.match(s.bubbles.manager.text, /3 tasks/);
  });
});
