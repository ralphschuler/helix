import { describe, expect, it } from 'vitest';

import { InMemoryRateLimitBucketStore, createRateLimitBucketPolicy } from './rate-limits.js';

const scope = {
  tenantId: '018f2f8f-8f8f-7000-8000-000000000010',
  projectId: '018f2f8f-8f8f-7000-8000-000000000020',
};

const fixedPolicy = {
  algorithm: 'fixed-window' as const,
  limit: 2,
  intervalMs: 1_000,
};

const slidingPolicy = {
  algorithm: 'sliding-window' as const,
  limit: 2,
  intervalMs: 1_000,
};

describe('rate limit buckets', () => {
  it('allows fixed-window claims up to the bucket limit and rejects excess claims', async () => {
    let now = 10_000;
    const policy = createRateLimitBucketPolicy({
      store: new InMemoryRateLimitBucketStore({ now: () => now }),
    });

    expect(await policy.check({ ...scope, bucketType: 'external-service', bucketKey: 'stripe', policy: fixedPolicy })).toEqual({
      allowed: true,
      remaining: 1,
      limit: 2,
      resetAt: 11_000,
      retryAfterMs: 0,
    });
    expect(await policy.check({ ...scope, bucketType: 'external-service', bucketKey: 'stripe', policy: fixedPolicy })).toMatchObject({ allowed: true, remaining: 0 });
    expect(await policy.check({ ...scope, bucketType: 'external-service', bucketKey: 'stripe', policy: fixedPolicy })).toEqual({
      allowed: false,
      remaining: 0,
      limit: 2,
      resetAt: 11_000,
      retryAfterMs: 1_000,
    });

    now = 11_000;
    expect(await policy.check({ ...scope, bucketType: 'external-service', bucketKey: 'stripe', policy: fixedPolicy })).toMatchObject({ allowed: true, remaining: 1, retryAfterMs: 0 });
  });

  it('uses sliding-window claims to reject bursts until the oldest claim expires', async () => {
    let now = 1_000;
    const policy = createRateLimitBucketPolicy({
      store: new InMemoryRateLimitBucketStore({ now: () => now }),
    });

    expect(await policy.check({ ...scope, bucketType: 'capability', bucketKey: 'gpu', policy: slidingPolicy })).toMatchObject({ allowed: true, remaining: 1 });
    now = 1_400;
    expect(await policy.check({ ...scope, bucketType: 'capability', bucketKey: 'gpu', policy: slidingPolicy })).toMatchObject({ allowed: true, remaining: 0 });
    now = 1_999;
    expect(await policy.check({ ...scope, bucketType: 'capability', bucketKey: 'gpu', policy: slidingPolicy })).toEqual({
      allowed: false,
      remaining: 0,
      limit: 2,
      resetAt: 2_000,
      retryAfterMs: 1,
    });
    now = 2_000;
    expect(await policy.check({ ...scope, bucketType: 'capability', bucketKey: 'gpu', policy: slidingPolicy })).toMatchObject({ allowed: true, remaining: 0, retryAfterMs: 0 });
  });

  it('scopes bucket decisions by tenant, project, bucket type, and bucket key', async () => {
    const policy = createRateLimitBucketPolicy({ store: new InMemoryRateLimitBucketStore({ now: () => 5_000 }) });
    const base = { ...scope, bucketType: 'tenant' as const, bucketKey: 'default', policy: { ...fixedPolicy, limit: 1 } };

    expect(await policy.check(base)).toMatchObject({ allowed: true });
    expect(await policy.check(base)).toMatchObject({ allowed: false });
    expect(await policy.check({ ...base, projectId: '018f2f8f-8f8f-7000-8000-000000000021' })).toMatchObject({ allowed: true });
    expect(await policy.check({ ...base, bucketType: 'project' })).toMatchObject({ allowed: true });
    expect(await policy.check({ ...base, bucketKey: 'other' })).toMatchObject({ allowed: true });
  });
});
