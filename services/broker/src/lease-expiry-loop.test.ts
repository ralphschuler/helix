import { describe, expect, it } from 'vitest';

import { runBrokerServiceLoop } from './lease-expiry-loop.js';

const scope = {
  tenantId: '01890f42-98c4-7cc3-aa5e-0c567f1d3a01',
  projectId: '01890f42-98c4-7cc3-aa5e-0c567f1d3a02',
};

describe('broker lease expiry loop', () => {
  it('counts AbortError-like expiry failures unless shutdown signal is already aborted', async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    const errors: unknown[] = [];
    const timeoutError = new Error('driver timeout');
    timeoutError.name = 'AbortError';

    const result = await runBrokerServiceLoop({
      ...scope,
      errorBackoffMs: 23,
      signal: controller.signal,
      async expireLeases() {
        throw timeoutError;
      },
      async sleep(durationMs) {
        sleeps.push(durationMs);
        controller.abort();
      },
      onError(error) {
        errors.push(error);
      },
    });

    expect(errors).toEqual([timeoutError]);
    expect(sleeps).toEqual([23]);
    expect(result).toEqual({ ticks: 1, expiredLeases: 0, errors: 1, stopped: 'aborted' });
  });

  it('polls after expired lease work, backs off when idle, caps batch size, and sleeps after errors', async () => {
    const controller = new AbortController();
    const calls: Array<{
      readonly tenantId: string;
      readonly projectId: string;
      readonly limit: number;
    }> = [];
    const sleeps: number[] = [];
    const errors: unknown[] = [];

    const result = await runBrokerServiceLoop({
      ...scope,
      leaseBatchLimit: 10_000,
      pollIntervalMs: 7,
      idleBackoffMs: 600_000,
      errorBackoffMs: -5,
      signal: controller.signal,
      async expireLeases(input) {
        calls.push(input);

        if (calls.length === 1) return [{ leaseId: 'expired-lease-1' }];
        if (calls.length === 2) return [];

        throw new Error('database unavailable');
      },
      async sleep(durationMs) {
        sleeps.push(durationMs);

        if (sleeps.length === 3) {
          controller.abort();
        }
      },
      onError(error) {
        errors.push(error);
      },
    });

    expect(calls).toEqual([
      { ...scope, limit: 500 },
      { ...scope, limit: 500 },
      { ...scope, limit: 500 },
    ]);
    expect(sleeps).toEqual([7, 300_000, 10_000]);
    expect(errors).toHaveLength(1);
    expect(result).toEqual({ ticks: 3, expiredLeases: 1, errors: 1, stopped: 'aborted' });
  });
});
