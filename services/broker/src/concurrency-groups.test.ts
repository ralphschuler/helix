import { describe, expect, it } from 'vitest';

import { InMemoryConcurrencyGroupCounterStore, createConcurrencyGroupPolicy } from './concurrency-groups.js';

const scope = {
  tenantId: '018f2f8f-8f8f-7000-8000-000000000010',
  projectId: '018f2f8f-8f8f-7000-8000-000000000020',
};

describe('concurrency group counters', () => {
  it('atomically reserves up to the group limit and rejects excess concurrent claims', async () => {
    const store = new InMemoryConcurrencyGroupCounterStore();
    const policy = createConcurrencyGroupPolicy({ store });

    expect(await Promise.all([
      policy.reserve({ ...scope, groupKey: 'tenant:import', limit: 2, claimId: 'claim-1' }),
      policy.reserve({ ...scope, groupKey: 'tenant:import', limit: 2, claimId: 'claim-2' }),
      policy.reserve({ ...scope, groupKey: 'tenant:import', limit: 2, claimId: 'claim-3' }),
    ])).toEqual([
      { reserved: true, activeCount: 1, limit: 2 },
      { reserved: true, activeCount: 2, limit: 2 },
      { reserved: false, activeCount: 2, limit: 2 },
    ]);
  });

  it('releases counters once and ignores duplicate stale releases', async () => {
    const store = new InMemoryConcurrencyGroupCounterStore();
    const policy = createConcurrencyGroupPolicy({ store });

    await policy.reserve({ ...scope, groupKey: 'tenant:import', limit: 1, claimId: 'claim-1' });
    expect(await policy.reserve({ ...scope, groupKey: 'tenant:import', limit: 1, claimId: 'claim-2' })).toEqual({
      reserved: false,
      activeCount: 1,
      limit: 1,
    });

    expect(await policy.release({ ...scope, groupKey: 'tenant:import', claimId: 'claim-1' })).toEqual({ released: true, activeCount: 0 });
    expect(await policy.release({ ...scope, groupKey: 'tenant:import', claimId: 'claim-1' })).toEqual({ released: false, activeCount: 0 });
    expect(await policy.reserve({ ...scope, groupKey: 'tenant:import', limit: 1, claimId: 'claim-2' })).toEqual({
      reserved: true,
      activeCount: 1,
      limit: 1,
    });
  });

  it('scopes counters by tenant and project', async () => {
    const store = new InMemoryConcurrencyGroupCounterStore();
    const policy = createConcurrencyGroupPolicy({ store });

    expect(await policy.reserve({ ...scope, groupKey: 'shared', limit: 1, claimId: 'claim-1' })).toMatchObject({ reserved: true });
    expect(await policy.reserve({ tenantId: scope.tenantId, projectId: '018f2f8f-8f8f-7000-8000-000000000021', groupKey: 'shared', limit: 1, claimId: 'claim-2' })).toMatchObject({ reserved: true });
  });
});
