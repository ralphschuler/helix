import { describe, expect, it } from 'vitest';

import type { ScheduleRecord } from '@helix/contracts';

import { InMemoryScheduleEvaluationStore, ScheduleEvaluator } from './index.js';

const now = new Date('2026-05-16T12:00:00.000Z');

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
  mode: { type: 'delayed', runAt: '2026-05-16T11:59:00.000Z' },
  misfirePolicy: 'skip',
  fireIdempotencyKeyPrefix: 'schedule:nightly-import',
  metadata: { owner: 'ops' },
  createdAt: '2026-05-16T11:00:00.000Z',
  updatedAt: '2026-05-16T11:00:00.000Z',
};

describe('ScheduleEvaluator', () => {
  it('enqueues one tenant/project scoped fire per durable idempotency key across repeated passes', async () => {
    const store = new InMemoryScheduleEvaluationStore([baseSchedule]);
    const evaluator = new ScheduleEvaluator({ store, now: () => now });

    expect(await evaluator.evaluateDueSchedules()).toEqual({ evaluated: 1, enqueued: 1, skipped: 0 });
    expect(await evaluator.evaluateDueSchedules()).toEqual({ evaluated: 1, enqueued: 0, skipped: 1 });

    expect(store.enqueuedWork).toHaveLength(1);
    expect(store.enqueuedWork[0]).toMatchObject({
      tenantId: baseSchedule.tenantId,
      projectId: baseSchedule.projectId,
      scheduleId: baseSchedule.id,
      idempotencyKey: 'schedule:nightly-import:2026-05-16T11:59:00.000Z',
      target: baseSchedule.target,
    });
    expect(store.events.map((event) => event.type)).toEqual(['schedule.fire.enqueued', 'schedule.fire.skipped_duplicate']);
  });

  it('does not enqueue disabled schedules', async () => {
    const store = new InMemoryScheduleEvaluationStore([{ ...baseSchedule, state: 'disabled' }]);
    const evaluator = new ScheduleEvaluator({ store, now: () => now });

    expect(await evaluator.evaluateDueSchedules()).toEqual({ evaluated: 0, enqueued: 0, skipped: 0 });
    expect(store.enqueuedWork).toEqual([]);
    expect(store.events).toEqual([]);
  });
});
