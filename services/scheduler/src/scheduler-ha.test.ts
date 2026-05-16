import { describe, expect, it } from 'vitest';

import type { ScheduleRecord } from '@helix/contracts';

import { InMemoryScheduleEvaluationStore, ScheduleEvaluator } from './index.js';

const baseSchedule: ScheduleRecord = {
  id: '018f2f8f-8f8f-7000-8000-000000000001',
  tenantId: '018f2f8f-8f8f-7000-8000-000000000010',
  projectId: '018f2f8f-8f8f-7000-8000-000000000020',
  name: 'nightly import',
  description: null,
  state: 'enabled',
  target: {
    type: 'job',
    request: {
      priority: 10,
      metadata: { source: 'schedule' },
    },
  },
  mode: { type: 'delayed', runAt: '2026-05-16T12:00:00.000Z' },
  misfirePolicy: 'skip',
  fireIdempotencyKeyPrefix: 'schedule:nightly-import',
  metadata: { owner: 'ops' },
  createdAt: '2026-05-16T11:00:00.000Z',
  updatedAt: '2026-05-16T11:00:00.000Z',
};

describe('scheduler high availability', () => {
  it('keeps duplicate scheduler instances from enqueueing duplicate work and records lease attempts', async () => {
    const store = new InMemoryScheduleEvaluationStore([baseSchedule]);
    const first = new ScheduleEvaluator({ store, instanceId: 'scheduler-a', now: () => new Date('2026-05-16T12:00:00.000Z') });
    const second = new ScheduleEvaluator({ store, instanceId: 'scheduler-b', now: () => new Date('2026-05-16T12:00:00.000Z') });

    const results = await Promise.all([first.evaluateDueSchedules(), second.evaluateDueSchedules()]);

    expect(results).toContainEqual({ evaluated: 1, enqueued: 1, skipped: 0 });
    expect(results).toContainEqual({ evaluated: 0, enqueued: 0, skipped: 0 });
    expect(store.enqueuedWork).toHaveLength(1);
    expect(store.leaseEvents.map((event) => event.type)).toEqual([
      'scheduler.lease.acquired',
      'scheduler.lease.busy',
      'scheduler.lease.released',
    ]);
    expect(new Set(store.leaseEvents.map((event) => event.instanceId))).toEqual(new Set(['scheduler-a', 'scheduler-b']));
  });

  it('uses the documented clock skew tolerance when detecting due schedules', async () => {
    const store = new InMemoryScheduleEvaluationStore([baseSchedule]);
    const evaluator = new ScheduleEvaluator({
      store,
      instanceId: 'skewed-scheduler',
      now: () => new Date('2026-05-16T11:59:58.000Z'),
      clockSkewToleranceMs: 2_000,
    });

    expect(await evaluator.evaluateDueSchedules()).toEqual({ evaluated: 1, enqueued: 1, skipped: 0 });
    expect(store.enqueuedWork[0]?.fireTime).toBe('2026-05-16T12:00:00.000Z');
  });
});
