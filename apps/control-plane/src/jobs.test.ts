import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@helix/contracts';
import {
  claimJobResponseSchema,
  heartbeatLeaseResponseSchema,
  jobListResponseSchema,
  jobResponseSchema,
} from '@helix/contracts';

import {
  InMemoryJobRepository,
  JobService,
} from './features/jobs/job-service.js';
import { createApp, type ApiAuthProvider } from './server/app.js';

const tenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const projectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';

const projectAuth: AuthContext = {
  tenantId,
  projectId,
  principal: {
    type: 'api_key',
    id: 'project-api-key-1',
  },
  permissions: ['jobs:create', 'jobs:read'],
};

const agentId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d01';
const otherAgentId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d02';

const agentAuth: AuthContext = {
  tenantId,
  projectId,
  principal: {
    type: 'agent_token',
    id: agentId,
  },
  permissions: ['agents:claim'],
};

const otherAgentAuth: AuthContext = {
  tenantId,
  projectId,
  principal: {
    type: 'agent_token',
    id: otherAgentId,
  },
  permissions: ['agents:claim'],
};

function createFixedApiAuthProvider(authContext: AuthContext | null): ApiAuthProvider {
  return {
    async authenticate(request) {
      if (request.headers.get('authorization') !== 'Bearer valid-project-token') {
        return null;
      }

      return authContext;
    },
  };
}

function createIdGenerator(ids: readonly string[]): () => string {
  let index = 0;

  return () => {
    const id = ids[index];

    if (id === undefined) {
      throw new Error('No test ID left.');
    }

    index += 1;
    return id;
  };
}

function createJobsApp(
  authContext: AuthContext | null = projectAuth,
  repository = new InMemoryJobRepository(),
  options: {
    readonly ids?: readonly string[];
    readonly now?: () => Date;
  } = {},
) {
  const service = new JobService({
    generateId: createIdGenerator(
      options.ids ?? [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3c01',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3c02',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3c03',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3c04',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3c05',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3c06',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3c07',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3c08',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3c09',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3c10',
      ],
    ),
    now: options.now ?? (() => new Date('2026-05-15T13:00:00.000Z')),
    repository,
  });
  const app = createApp({
    apiAuthProvider: createFixedApiAuthProvider(authContext),
    jobService: service,
  });

  return { app, repository, service };
}

describe('job API', () => {
  it('creates a ready job once per idempotency key through the public API', async () => {
    const { app, repository } = createJobsApp();
    const request = {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
        'idempotency-key': 'create-job:client-request-1',
      },
      body: JSON.stringify({
        priority: 7,
        constraints: { capability: 'thumbnail' },
        metadata: { source: 'sdk' },
      }),
    };

    const createdResponse = await app.request('/api/v1/jobs', request);
    const duplicateResponse = await app.request('/api/v1/jobs', request);

    expect(createdResponse.status).toBe(201);
    expect(duplicateResponse.status).toBe(200);

    const createdBody = jobResponseSchema.parse(await createdResponse.json());
    const duplicateBody = jobResponseSchema.parse(await duplicateResponse.json());

    expect(createdBody).toEqual(duplicateBody);
    expect(createdBody).toMatchObject({
      ready: true,
      job: {
        id: '01890f42-98c4-7cc3-aa5e-0c567f1d3c01',
        tenantId,
        projectId,
        state: 'queued',
        priority: 7,
        maxAttempts: 3,
        attemptCount: 0,
        idempotencyKey: 'create-job:client-request-1',
        constraints: { capability: 'thumbnail' },
        metadata: { source: 'sdk' },
        readyAt: '2026-05-15T13:00:00.000Z',
      },
    });
    expect(repository.jobs).toHaveLength(1);
    expect(repository.runtimeEvents.map((event) => event.eventType)).toEqual([
      'job.created',
      'job.ready',
    ]);
    expect(repository.runtimeOutbox.map((outbox) => outbox.eventId)).toEqual(
      repository.runtimeEvents.map((event) => event.id),
    );
  });

  it('rejects unauthenticated, unauthorized, and non-idempotent job creation', async () => {
    const { app, repository } = createJobsApp({
      ...projectAuth,
      permissions: ['jobs:read'],
    });
    const body = JSON.stringify({ metadata: { source: 'security-test' } });

    const unauthenticated = await app.request('/api/v1/jobs', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-token', 'idempotency-key': 'create-job:denied' },
      body,
    });
    const unauthorized = await app.request('/api/v1/jobs', {
      method: 'POST',
      headers: { authorization: 'Bearer valid-project-token', 'idempotency-key': 'create-job:denied' },
      body,
    });
    const missingIdempotency = await app.request('/api/v1/jobs', {
      method: 'POST',
      headers: { authorization: 'Bearer valid-project-token' },
      body,
    });
    const overlongIdempotency = await app.request('/api/v1/jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'idempotency-key': 'x'.repeat(256),
      },
      body,
    });

    expect(unauthenticated.status).toBe(401);
    expect(unauthorized.status).toBe(403);
    expect(missingIdempotency.status).toBe(400);
    expect(overlongIdempotency.status).toBe(400);
    expect(repository.jobs).toHaveLength(0);
    expect(repository.runtimeEvents).toHaveLength(0);
  });

  it('returns job status and list only inside the authenticated project scope', async () => {
    const { app, repository } = createJobsApp();
    const headers = {
      authorization: 'Bearer valid-project-token',
      'content-type': 'application/json',
      'idempotency-key': 'create-job:client-request-2',
    };
    const createdResponse = await app.request('/api/v1/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ metadata: { source: 'status-test' } }),
    });
    const created = jobResponseSchema.parse(await createdResponse.json());

    const statusResponse = await app.request(`/api/v1/jobs/${created.job.id}`, {
      headers,
    });
    const listResponse = await app.request('/api/v1/jobs', { headers });

    expect(statusResponse.status).toBe(200);
    expect(jobResponseSchema.parse(await statusResponse.json())).toEqual(created);
    expect(listResponse.status).toBe(200);
    expect(jobListResponseSchema.parse(await listResponse.json())).toEqual({
      jobs: [created.job],
    });

    const otherProjectAuth: AuthContext = {
      tenantId: '01890f42-98c4-7cc3-8a5e-0c567f1d3a79',
      projectId: '01890f42-98c4-7cc3-9a5e-0c567f1d3a80',
      principal: { type: 'api_key', id: 'other-project-api-key' },
      permissions: ['jobs:read'],
    };
    const otherProjectApp = createJobsApp(otherProjectAuth, repository).app;

    const wrongScopeStatus = await otherProjectApp.request(`/api/v1/jobs/${created.job.id}`, {
      headers,
    });
    const wrongScopeList = await otherProjectApp.request('/api/v1/jobs', { headers });
    const malformedStatus = await app.request('/api/v1/jobs/not-a-uuid', { headers });

    expect(wrongScopeStatus.status).toBe(404);
    expect(jobListResponseSchema.parse(await wrongScopeList.json())).toEqual({ jobs: [] });
    expect(malformedStatus.status).toBe(400);
  });

  it('lets exactly one authorized agent claim a ready job through the public API', async () => {
    const repository = new InMemoryJobRepository();
    const producerApp = createJobsApp(projectAuth, repository).app;
    await producerApp.request('/api/v1/jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
        'idempotency-key': 'create-job:claim-test',
      },
      body: JSON.stringify({ metadata: { source: 'claim-test' } }),
    });
    const agentApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d11',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d12',
      ],
    }).app;
    const otherAgentApp = createJobsApp(otherAgentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d13',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d14',
      ],
    }).app;

    const claimResponse = await agentApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 600 }),
    });
    const duplicateClaimResponse = await otherAgentApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 600 }),
    });

    expect(claimResponse.status).toBe(200);
    expect(duplicateClaimResponse.status).toBe(200);
    const claimBody = claimJobResponseSchema.parse(await claimResponse.json());
    const duplicateClaimBody = claimJobResponseSchema.parse(await duplicateClaimResponse.json());

    if (claimBody.claim === null) {
      throw new Error('Expected a claimed job.');
    }

    expect(claimBody.claim).toMatchObject({
      job: {
        state: 'running',
        attemptCount: 1,
      },
      attempt: {
        id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d11',
        attemptNumber: 1,
        state: 'running',
        agentId,
      },
      lease: {
        id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d12',
        state: 'active',
        agentId,
        acquiredAt: '2026-05-15T13:00:00.000Z',
        expiresAt: '2026-05-15T13:10:00.000Z',
        lastHeartbeatAt: '2026-05-15T13:00:00.000Z',
      },
    });
    expect(duplicateClaimBody).toEqual({ claim: null });
    expect(repository.jobs).toHaveLength(1);
    expect(repository.attempts).toHaveLength(1);
    expect(repository.leases).toHaveLength(1);
  });

  it('extends only the active lease held by the authenticated agent', async () => {
    const repository = new InMemoryJobRepository();
    const producerApp = createJobsApp(projectAuth, repository).app;
    await producerApp.request('/api/v1/jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
        'idempotency-key': 'create-job:heartbeat-test',
      },
      body: JSON.stringify({ metadata: { source: 'heartbeat-test' } }),
    });
    const claimApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d21',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d22',
      ],
      now: () => new Date('2026-05-15T13:00:00.000Z'),
    }).app;
    const claimResponse = await claimApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 300 }),
    });
    const claimBody = claimJobResponseSchema.parse(await claimResponse.json());

    if (claimBody.claim === null) {
      throw new Error('Expected a claimed job.');
    }

    const heartbeatApp = createJobsApp(agentAuth, repository, {
      ids: [],
      now: () => new Date('2026-05-15T13:02:00.000Z'),
    }).app;
    const wrongAgentApp = createJobsApp(otherAgentAuth, repository, {
      ids: [],
      now: () => new Date('2026-05-15T13:03:00.000Z'),
    }).app;
    const heartbeatResponse = await heartbeatApp.request(
      `/api/v1/jobs/${claimBody.claim.job.id}/leases/${claimBody.claim.lease.id}/heartbeat`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-project-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ leaseTtlSeconds: 300 }),
      },
    );
    const wrongAgentHeartbeatResponse = await wrongAgentApp.request(
      `/api/v1/jobs/${claimBody.claim.job.id}/leases/${claimBody.claim.lease.id}/heartbeat`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-project-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ leaseTtlSeconds: 300 }),
      },
    );

    expect(heartbeatResponse.status).toBe(200);
    expect(wrongAgentHeartbeatResponse.status).toBe(404);
    expect(heartbeatLeaseResponseSchema.parse(await heartbeatResponse.json())).toMatchObject({
      lease: {
        id: claimBody.claim.lease.id,
        state: 'active',
        agentId,
        expiresAt: '2026-05-15T13:07:00.000Z',
        lastHeartbeatAt: '2026-05-15T13:02:00.000Z',
      },
    });

    const shorterHeartbeatApp = createJobsApp(agentAuth, repository, {
      ids: [],
      now: () => new Date('2026-05-15T13:03:00.000Z'),
    }).app;
    const shorterHeartbeatResponse = await shorterHeartbeatApp.request(
      `/api/v1/jobs/${claimBody.claim.job.id}/leases/${claimBody.claim.lease.id}/heartbeat`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-project-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ leaseTtlSeconds: 60 }),
      },
    );

    expect(heartbeatLeaseResponseSchema.parse(await shorterHeartbeatResponse.json())).toMatchObject({
      lease: {
        expiresAt: '2026-05-15T13:07:00.000Z',
        lastHeartbeatAt: '2026-05-15T13:03:00.000Z',
      },
    });
  });

  it('expires active leases into retryable persisted state without in-memory ownership', async () => {
    const repository = new InMemoryJobRepository();
    const producerApp = createJobsApp(projectAuth, repository).app;
    await producerApp.request('/api/v1/jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
        'idempotency-key': 'create-job:expiry-test',
      },
      body: JSON.stringify({ maxAttempts: 2, metadata: { source: 'expiry-test' } }),
    });
    const claimApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d31',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d32',
      ],
      now: () => new Date('2026-05-15T13:00:00.000Z'),
    }).app;
    const claimResponse = await claimApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 60 }),
    });
    const claimBody = claimJobResponseSchema.parse(await claimResponse.json());

    if (claimBody.claim === null) {
      throw new Error('Expected a claimed job.');
    }

    const expiryService = createJobsApp(agentAuth, repository, {
      ids: [],
      now: () => new Date('2026-05-15T13:02:00.000Z'),
    }).service;
    const expired = await expiryService.expireLeases({ tenantId, projectId });

    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({
      job: {
        id: claimBody.claim.job.id,
        state: 'retrying',
        attemptCount: 1,
        readyAt: '2026-05-15T13:02:00.000Z',
      },
      attempt: {
        id: claimBody.claim.attempt.id,
        state: 'expired',
        finishedAt: '2026-05-15T13:02:00.000Z',
      },
      lease: {
        id: claimBody.claim.lease.id,
        state: 'expired',
        expiredAt: '2026-05-15T13:02:00.000Z',
      },
    });

    const reclaimApp = createJobsApp(otherAgentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d33',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d34',
      ],
      now: () => new Date('2026-05-15T13:03:00.000Z'),
    }).app;
    const reclaimResponse = await reclaimApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 300 }),
    });
    const reclaimBody = claimJobResponseSchema.parse(await reclaimResponse.json());

    if (reclaimBody.claim === null) {
      throw new Error('Expected expired job to be claimable again.');
    }

    expect(reclaimBody.claim).toMatchObject({
      job: {
        id: claimBody.claim.job.id,
        state: 'running',
        attemptCount: 2,
      },
      attempt: {
        id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d33',
        attemptNumber: 2,
        state: 'running',
        agentId: otherAgentId,
      },
      lease: {
        id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d34',
        state: 'active',
        agentId: otherAgentId,
      },
    });
  });

  it('terminates an expired lease instead of advertising an exhausted retry', async () => {
    const repository = new InMemoryJobRepository();
    const producerApp = createJobsApp(projectAuth, repository).app;
    await producerApp.request('/api/v1/jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
        'idempotency-key': 'create-job:exhausted-expiry-test',
      },
      body: JSON.stringify({ maxAttempts: 1, metadata: { source: 'exhausted-expiry-test' } }),
    });
    const claimApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d41',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d42',
      ],
    }).app;
    const claimResponse = await claimApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 60 }),
    });
    const claimBody = claimJobResponseSchema.parse(await claimResponse.json());

    if (claimBody.claim === null) {
      throw new Error('Expected a claimed job.');
    }

    const expiryService = createJobsApp(agentAuth, repository, {
      ids: [],
      now: () => new Date('2026-05-15T13:02:00.000Z'),
    }).service;
    const expired = await expiryService.expireLeases({ tenantId, projectId });
    const reclaimApp = createJobsApp(otherAgentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d43',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d44',
      ],
      now: () => new Date('2026-05-15T13:03:00.000Z'),
    }).app;
    const reclaimResponse = await reclaimApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 300 }),
    });

    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({
      job: {
        id: claimBody.claim.job.id,
        state: 'failed',
        attemptCount: 1,
        finishedAt: '2026-05-15T13:02:00.000Z',
      },
    });
    expect(claimJobResponseSchema.parse(await reclaimResponse.json())).toEqual({ claim: null });
  });
});
