import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { extractJson, PlanError, planAndApply, topoOrder, validatePlan } from '../src/manager/plan.ts';
import { agentSpec, makeOrchestrator, makeSandbox } from './helpers.ts';

const t = (key: string, dependsOn: string[] = []) => ({ key, title: key, description: '', dependsOn, prompt: `do ${key}` });

describe('plan validation (deterministic gate for Manager output)', () => {
  it('accepts a valid plan and orders by dependency', () => {
    const plan = validatePlan({ summary: 's', tasks: [t('integration', ['backend', 'frontend']), t('backend'), t('frontend')] });
    const order = topoOrder(plan.tasks).map((x) => x.key);
    assert.ok(order.indexOf('integration') > order.indexOf('backend') && order.indexOf('integration') > order.indexOf('frontend'));
  });
  it('rejects cycles, unknown deps, duplicates, self deps, bad keys, oversize and empty plans', () => {
    assert.throws(() => validatePlan({ tasks: [t('a', ['b']), t('b', ['a'])] }), /cycle/i);
    assert.throws(() => validatePlan({ tasks: [t('a', ['zzz'])] }), /unknown task/);
    assert.throws(() => validatePlan({ tasks: [t('a'), t('a')] }), /Duplicate/);
    assert.throws(() => validatePlan({ tasks: [t('a', ['a'])] }), /itself/);
    assert.throws(() => validatePlan({ tasks: [t('../evil')] }), /key/);
    assert.throws(() => validatePlan({ tasks: Array.from({ length: 7 }, (_, i) => t(`t${i}`)) }), /smallest useful team/);
    assert.throws(() => validatePlan({ tasks: [] }), PlanError);
    assert.throws(() => validatePlan('nope'), PlanError);
    assert.throws(() => validatePlan({ tasks: [{ ...t('a'), prompt: '' }] }), /prompt/);
  });
  it('extracts JSON from fenced and noisy output', () => {
    assert.deepEqual(extractJson('sure!\n```json\n{"a":1}\n```\nbye'), { a: 1 });
    assert.deepEqual(extractJson('noise {"a":2} trailing'), { a: 2 });
    assert.throws(() => extractJson('no json here'), PlanError);
  });
});

describe('plan to merged code', () => {
  let sb: ReturnType<typeof makeSandbox>;
  beforeEach(() => { sb = makeSandbox(); });
  afterEach(() => sb.cleanup());

  it('a Manager proposal becomes tasks that run in dependency order and all merge', async () => {
    const h = makeOrchestrator(sb);
    const planner = { plan: async () => ({ summary: 'auth', tasks: [t('backend'), t('frontend'), t('integration', ['backend', 'frontend'])] }) };
    const { tasks } = await planAndApply(h.orch, planner, 'Add auth', (prompt) => agentSpec({ write: { [`${prompt.replace('do ', '')}.txt`]: 'x' } }).argv);
    assert.deepEqual(h.store.deps(tasks.get('integration')!.id).sort(), [tasks.get('backend')!.id, tasks.get('frontend')!.id].sort());
    await h.orch.runAll();
    assert.ok(h.store.listTasks().every((x) => x.status === 'COMPLETED'));
    for (const f of ['backend', 'frontend', 'integration']) assert.ok(existsSync(path.join(sb.repo, `${f}.txt`)));
  });

  it('an invalid proposal creates no tasks', async () => {
    const h = makeOrchestrator(sb);
    await assert.rejects(planAndApply(h.orch, { plan: async () => ({ tasks: [t('a', ['b']), t('b', ['a'])] }) }, 'x', () => []), /cycle/i);
    assert.equal(h.store.listTasks().length, 0);
  });
});
