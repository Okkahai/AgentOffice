import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertTransition, canTransition, TASK_STATES } from '../src/core/taskMachine.ts';

describe('task state machine', () => {
  it('allows the happy path in order', () => {
    const path = ['QUEUED', 'ASSIGNED', 'WORKING', 'VERIFYING', 'REVIEWING', 'READY_TO_MERGE', 'MERGING', 'COMPLETED'] as const;
    for (let i = 0; i < path.length - 1; i++) assert.ok(canTransition(path[i]!, path[i + 1]!), `${path[i]} -> ${path[i + 1]}`);
  });
  it('forbids skipping the pipeline', () => {
    assert.throws(() => assertTransition('WORKING', 'MERGING'));
    assert.throws(() => assertTransition('QUEUED', 'MERGING'));
    assert.throws(() => assertTransition('REVIEWING', 'MERGING'));
    assert.throws(() => assertTransition('VERIFYING', 'READY_TO_MERGE'));
  });
  it('COMPLETED and CANCELLED are terminal', () => {
    for (const s of TASK_STATES) { assert.equal(canTransition('COMPLETED', s), false); assert.equal(canTransition('CANCELLED', s), false); }
  });
});
