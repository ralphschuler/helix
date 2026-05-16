import { describe, expect, it } from 'vitest';

import { createBrokerPolicyEngine, jobPriorityLevelSchema } from './policy-engine.js';

const engine = createBrokerPolicyEngine();

describe('broker policy engine', () => {
  it('orders claim candidates by formal priority level before readiness time', () => {
    const ordered = engine.orderClaimCandidates([
      { id: 'normal-old', priority: 'normal', readyAt: '2026-05-16T10:00:00.000Z', createdAt: '2026-05-16T09:00:00.000Z' },
      { id: 'critical-new', priority: 'critical', readyAt: '2026-05-16T10:10:00.000Z', createdAt: '2026-05-16T09:10:00.000Z' },
      { id: 'background-old', priority: 'background', readyAt: '2026-05-16T09:00:00.000Z', createdAt: '2026-05-16T08:00:00.000Z' },
      { id: 'high', priority: 'high', readyAt: '2026-05-16T10:05:00.000Z', createdAt: '2026-05-16T09:05:00.000Z' },
    ]);

    expect(ordered.map((job) => job.id)).toEqual(['critical-new', 'high', 'normal-old', 'background-old']);
  });

  it('rejects invalid priority levels at the policy boundary', () => {
    expect(jobPriorityLevelSchema.parse('critical')).toBe('critical');
    expect(() => jobPriorityLevelSchema.parse('urgent')).toThrow();
    expect(() => engine.orderClaimCandidates([
      { id: 'invalid', priority: 'urgent', readyAt: '2026-05-16T10:00:00.000Z', createdAt: '2026-05-16T09:00:00.000Z' },
    ] as never)).toThrow();
  });
});
