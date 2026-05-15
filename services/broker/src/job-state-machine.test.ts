import { describe, expect, it } from 'vitest';

import {
  assertLegalAttemptStateTransition,
  assertLegalJobStateTransition,
  assertLegalLeaseStateTransition,
  assertLegalOrIdempotentJobStateTransition,
  isIdempotentLeaseStateTransition,
  isLegalJobStateTransition,
} from './job-state-machine.js';

describe('broker job state machine guards', () => {
  it('allows claim, retry, and terminal job transitions while rejecting skipped terminal recovery', () => {
    expect(isLegalJobStateTransition({ from: 'queued', to: 'running' })).toBe(true);
    expect(isLegalJobStateTransition({ from: 'running', to: 'retrying' })).toBe(true);
    expect(isLegalJobStateTransition({ from: 'retrying', to: 'queued' })).toBe(true);
    expect(isLegalJobStateTransition({ from: 'retrying', to: 'running' })).toBe(true);
    expect(isLegalJobStateTransition({ from: 'running', to: 'completed' })).toBe(true);
    expect(isLegalJobStateTransition({ from: 'completed', to: 'completed' })).toBe(false);
    expect(() =>
      assertLegalOrIdempotentJobStateTransition({ from: 'completed', to: 'completed' }),
    ).not.toThrow();

    expect(() =>
      assertLegalJobStateTransition({ from: 'queued', to: 'completed' }),
    ).toThrow(/Illegal job state transition: queued -> completed/u);
    expect(() =>
      assertLegalJobStateTransition({ from: 'completed', to: 'running' }),
    ).toThrow(/Illegal job state transition: completed -> running/u);
  });

  it('keeps attempt history terminal after completion, failure, expiry, or cancellation', () => {
    expect(() =>
      assertLegalAttemptStateTransition({ from: 'running', to: 'completed' }),
    ).not.toThrow();
    expect(() =>
      assertLegalAttemptStateTransition({ from: 'running', to: 'expired' }),
    ).not.toThrow();

    expect(() =>
      assertLegalAttemptStateTransition({ from: 'completed', to: 'failed' }),
    ).toThrow(/Illegal attempt state transition: completed -> failed/u);
    expect(() =>
      assertLegalAttemptStateTransition({ from: 'expired', to: 'running' }),
    ).toThrow(/Illegal attempt state transition: expired -> running/u);
  });

  it('allows active leases to end once and rejects stale lease mutation after expiry', () => {
    expect(() =>
      assertLegalLeaseStateTransition({ from: 'active', to: 'released' }),
    ).not.toThrow();
    expect(() =>
      assertLegalLeaseStateTransition({ from: 'active', to: 'expired' }),
    ).not.toThrow();
    expect(isIdempotentLeaseStateTransition({ from: 'expired', to: 'expired' })).toBe(true);

    expect(() =>
      assertLegalLeaseStateTransition({ from: 'expired', to: 'expired' }),
    ).toThrow(/Illegal lease state transition: expired -> expired/u);
    expect(() =>
      assertLegalLeaseStateTransition({ from: 'expired', to: 'released' }),
    ).toThrow(/Illegal lease state transition: expired -> released/u);
    expect(() =>
      assertLegalLeaseStateTransition({ from: 'released', to: 'active' }),
    ).toThrow(/Illegal lease state transition: released -> active/u);
  });
});
