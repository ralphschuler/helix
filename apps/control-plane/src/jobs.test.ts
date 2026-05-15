import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@helix/contracts';
import {
  claimJobResponseSchema,
  completeJobAttemptResponseSchema,
  failJobAttemptResponseSchema,
  heartbeatLeaseResponseSchema,
  jobHistoryResponseSchema,
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

function cloneJobRepository(repository: InMemoryJobRepository): InMemoryJobRepository {
  const clone = new InMemoryJobRepository();

  clone.jobs.push(...repository.jobs.map((job) => ({ ...job })));
  clone.attempts.push(...repository.attempts.map((attempt) => ({ ...attempt })));
  clone.leases.push(...repository.leases.map((lease) => ({ ...lease })));
  clone.runtimeEvents.push(...repository.runtimeEvents.map((event) => ({ ...event })));
  clone.runtimeOutbox.push(...repository.runtimeOutbox.map((outbox) => ({ ...outbox })));

  return clone;
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

  it('completes a claimed job once and treats duplicate completion as idempotent', async () => {
    const repository = new InMemoryJobRepository();
    const producerApp = createJobsApp(projectAuth, repository).app;
    await producerApp.request('/api/v1/jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
        'idempotency-key': 'create-job:completion-test',
      },
      body: JSON.stringify({ metadata: { source: 'completion-test' } }),
    });
    const claimApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d51',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d52',
      ],
      now: () => new Date('2026-05-15T13:00:00.000Z'),
    }).app;
    const claimResponse = await claimApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 600 }),
    });
    const claimBody = claimJobResponseSchema.parse(await claimResponse.json());

    if (claimBody.claim === null) {
      throw new Error('Expected a claimed job.');
    }

    const completeApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d53',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d54',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d55',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d56',
      ],
      now: () => new Date('2026-05-15T13:04:00.000Z'),
    }).app;
    const completionPath = `/api/v1/jobs/${claimBody.claim.job.id}/attempts/${claimBody.claim.attempt.id}/leases/${claimBody.claim.lease.id}/complete`;
    const completionRequest = {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    };

    const completedResponse = await completeApp.request(completionPath, completionRequest);
    const duplicateResponse = await completeApp.request(completionPath, completionRequest);

    expect(completedResponse.status).toBe(200);
    expect(duplicateResponse.status).toBe(200);
    expect(completeJobAttemptResponseSchema.parse(await completedResponse.json())).toMatchObject({
      duplicate: false,
      transition: {
        job: { id: claimBody.claim.job.id, state: 'completed', finishedAt: '2026-05-15T13:04:00.000Z' },
        attempt: { id: claimBody.claim.attempt.id, state: 'completed', finishedAt: '2026-05-15T13:04:00.000Z' },
        lease: { id: claimBody.claim.lease.id, state: 'released', releasedAt: '2026-05-15T13:04:00.000Z' },
      },
    });
    expect(completeJobAttemptResponseSchema.parse(await duplicateResponse.json())).toMatchObject({
      duplicate: true,
      transition: {
        job: { id: claimBody.claim.job.id, state: 'completed' },
        attempt: { id: claimBody.claim.attempt.id, state: 'completed' },
        lease: { id: claimBody.claim.lease.id, state: 'released' },
      },
    });
    expect(repository.runtimeEvents.map((event) => event.eventType)).toEqual([
      'job.created',
      'job.ready',
      'job.completed',
    ]);
    expect(repository.runtimeEvents[2]?.payload).toEqual({
      tenantId,
      projectId,
      jobId: claimBody.claim.job.id,
      attemptId: claimBody.claim.attempt.id,
      leaseId: claimBody.claim.lease.id,
      agentId,
      completedAt: '2026-05-15T13:04:00.000Z',
    });
    expect(repository.runtimeOutbox.map((outbox) => outbox.eventId)).toEqual(
      repository.runtimeEvents.map((event) => event.id),
    );
  });

  it('fails a claimed attempt once and makes the job retryable without duplicate events', async () => {
    const repository = new InMemoryJobRepository();
    const producerApp = createJobsApp(projectAuth, repository).app;
    await producerApp.request('/api/v1/jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
        'idempotency-key': 'create-job:fail-test',
      },
      body: JSON.stringify({ maxAttempts: 2, metadata: { source: 'fail-test' } }),
    });
    const claimApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d61',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d62',
      ],
    }).app;
    const claimResponse = await claimApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 600 }),
    });
    const claimBody = claimJobResponseSchema.parse(await claimResponse.json());

    if (claimBody.claim === null) {
      throw new Error('Expected a claimed job.');
    }

    const failApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d63',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d64',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d65',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d66',
      ],
      now: () => new Date('2026-05-15T13:04:00.000Z'),
    }).app;
    const failPath = `/api/v1/jobs/${claimBody.claim.job.id}/attempts/${claimBody.claim.attempt.id}/leases/${claimBody.claim.lease.id}/fail`;
    const failRequest = {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        failureCode: 'processor_error',
        failureMessage: 'GPU unavailable',
      }),
    };

    const failedResponse = await failApp.request(failPath, failRequest);
    const duplicateResponse = await failApp.request(failPath, failRequest);

    expect(failedResponse.status).toBe(200);
    expect(duplicateResponse.status).toBe(200);
    expect(failJobAttemptResponseSchema.parse(await failedResponse.json())).toMatchObject({
      duplicate: false,
      transition: {
        job: {
          id: claimBody.claim.job.id,
          state: 'retrying',
          readyAt: '2026-05-15T13:04:00.000Z',
          finishedAt: null,
        },
        attempt: {
          id: claimBody.claim.attempt.id,
          state: 'failed',
          finishedAt: '2026-05-15T13:04:00.000Z',
          failureCode: 'processor_error',
          failureMessage: 'GPU unavailable',
        },
        lease: { id: claimBody.claim.lease.id, state: 'released', releasedAt: '2026-05-15T13:04:00.000Z' },
      },
    });
    expect(failJobAttemptResponseSchema.parse(await duplicateResponse.json())).toMatchObject({
      duplicate: true,
      transition: {
        job: { id: claimBody.claim.job.id, state: 'retrying' },
        attempt: { id: claimBody.claim.attempt.id, state: 'failed' },
        lease: { id: claimBody.claim.lease.id, state: 'released' },
      },
    });
    expect(repository.runtimeEvents.map((event) => event.eventType)).toEqual([
      'job.created',
      'job.ready',
      'job.attempt.failed',
    ]);
    expect(repository.runtimeEvents[2]?.payload).toEqual({
      tenantId,
      projectId,
      jobId: claimBody.claim.job.id,
      attemptId: claimBody.claim.attempt.id,
      leaseId: claimBody.claim.lease.id,
      agentId,
      failureCode: 'processor_error',
      failureMessage: 'GPU unavailable',
      failedAt: '2026-05-15T13:04:00.000Z',
    });
    expect(repository.runtimeOutbox.map((outbox) => outbox.eventId)).toEqual(
      repository.runtimeEvents.map((event) => event.id),
    );
  });

  it('dead-letters a job after failed attempts exhaust maxAttempts and keeps retry history', async () => {
    const repository = new InMemoryJobRepository();
    const producerApp = createJobsApp(projectAuth, repository).app;
    await producerApp.request('/api/v1/jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
        'idempotency-key': 'create-job:dlq-fail-test',
      },
      body: JSON.stringify({ maxAttempts: 2, metadata: { source: 'dlq-fail-test' } }),
    });
    const firstClaimApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d81',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d82',
      ],
      now: () => new Date('2026-05-15T13:00:00.000Z'),
    }).app;
    const firstClaimResponse = await firstClaimApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 600 }),
    });
    const firstClaimBody = claimJobResponseSchema.parse(await firstClaimResponse.json());

    if (firstClaimBody.claim === null) {
      throw new Error('Expected first claim.');
    }

    const firstFailApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d83',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d84',
      ],
      now: () => new Date('2026-05-15T13:01:00.000Z'),
    }).app;
    const firstFailResponse = await firstFailApp.request(
      `/api/v1/jobs/${firstClaimBody.claim.job.id}/attempts/${firstClaimBody.claim.attempt.id}/leases/${firstClaimBody.claim.lease.id}/fail`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-project-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ failureCode: 'processor_error' }),
      },
    );

    expect(failJobAttemptResponseSchema.parse(await firstFailResponse.json())).toMatchObject({
      duplicate: false,
      transition: {
        job: {
          id: firstClaimBody.claim.job.id,
          state: 'retrying',
          attemptCount: 1,
          finishedAt: null,
        },
      },
    });

    const secondClaimApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d85',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d86',
      ],
      now: () => new Date('2026-05-15T13:02:00.000Z'),
    }).app;
    const secondClaimResponse = await secondClaimApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 600 }),
    });
    const secondClaimBody = claimJobResponseSchema.parse(await secondClaimResponse.json());

    if (secondClaimBody.claim === null) {
      throw new Error('Expected second claim.');
    }

    const secondFailApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d87',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d88',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d89',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d90',
      ],
      now: () => new Date('2026-05-15T13:03:00.000Z'),
    }).app;
    const finalFailPath = `/api/v1/jobs/${secondClaimBody.claim.job.id}/attempts/${secondClaimBody.claim.attempt.id}/leases/${secondClaimBody.claim.lease.id}/fail`;
    const finalFailRequest = {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ failureCode: 'processor_error', failureMessage: 'GPU unavailable' }),
    };

    const finalFailResponse = await secondFailApp.request(finalFailPath, finalFailRequest);
    const duplicateFinalFailResponse = await secondFailApp.request(finalFailPath, finalFailRequest);
    const exhaustedClaimApp = createJobsApp(otherAgentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d91',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d92',
      ],
      now: () => new Date('2026-05-15T13:04:00.000Z'),
    }).app;
    const exhaustedClaimResponse = await exhaustedClaimApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 600 }),
    });

    expect(finalFailResponse.status).toBe(200);
    expect(duplicateFinalFailResponse.status).toBe(200);
    expect(failJobAttemptResponseSchema.parse(await finalFailResponse.json())).toMatchObject({
      duplicate: false,
      transition: {
        job: {
          id: firstClaimBody.claim.job.id,
          state: 'dead_lettered',
          attemptCount: 2,
          finishedAt: '2026-05-15T13:03:00.000Z',
        },
        attempt: {
          id: secondClaimBody.claim.attempt.id,
          attemptNumber: 2,
          state: 'failed',
          finishedAt: '2026-05-15T13:03:00.000Z',
          failureCode: 'processor_error',
          failureMessage: 'GPU unavailable',
        },
        lease: {
          id: secondClaimBody.claim.lease.id,
          state: 'released',
          releasedAt: '2026-05-15T13:03:00.000Z',
        },
      },
    });
    expect(failJobAttemptResponseSchema.parse(await duplicateFinalFailResponse.json())).toMatchObject({
      duplicate: true,
      transition: {
        job: { id: firstClaimBody.claim.job.id, state: 'dead_lettered' },
        attempt: { id: secondClaimBody.claim.attempt.id, state: 'failed' },
        lease: { id: secondClaimBody.claim.lease.id, state: 'released' },
      },
    });
    expect(claimJobResponseSchema.parse(await exhaustedClaimResponse.json())).toEqual({ claim: null });
    expect(repository.attempts).toEqual([
      expect.objectContaining({ id: firstClaimBody.claim.attempt.id, attemptNumber: 1, state: 'failed' }),
      expect.objectContaining({ id: secondClaimBody.claim.attempt.id, attemptNumber: 2, state: 'failed' }),
    ]);
    expect(repository.leases).toEqual([
      expect.objectContaining({ id: firstClaimBody.claim.lease.id, state: 'released' }),
      expect.objectContaining({ id: secondClaimBody.claim.lease.id, state: 'released' }),
    ]);
    expect(repository.runtimeEvents.map((event) => event.eventType)).toEqual([
      'job.created',
      'job.ready',
      'job.attempt.failed',
      'job.attempt.failed',
    ]);

    const historyResponse = await producerApp.request(
      `/api/v1/jobs/${firstClaimBody.claim.job.id}/history`,
      { headers: { authorization: 'Bearer valid-project-token' } },
    );

    expect(historyResponse.status).toBe(200);
    expect(jobHistoryResponseSchema.parse(await historyResponse.json())).toMatchObject({
      job: {
        id: firstClaimBody.claim.job.id,
        state: 'dead_lettered',
        attemptCount: 2,
      },
      attempts: [
        {
          id: firstClaimBody.claim.attempt.id,
          attemptNumber: 1,
          state: 'failed',
          finishedAt: '2026-05-15T13:01:00.000Z',
          failureCode: 'processor_error',
        },
        {
          id: secondClaimBody.claim.attempt.id,
          attemptNumber: 2,
          state: 'failed',
          finishedAt: '2026-05-15T13:03:00.000Z',
          failureCode: 'processor_error',
        },
      ],
      leases: [
        {
          id: firstClaimBody.claim.lease.id,
          attemptId: firstClaimBody.claim.attempt.id,
          state: 'released',
          releasedAt: '2026-05-15T13:01:00.000Z',
        },
        {
          id: secondClaimBody.claim.lease.id,
          attemptId: secondClaimBody.claim.attempt.id,
          state: 'released',
          releasedAt: '2026-05-15T13:03:00.000Z',
        },
      ],
    });
  });

  it('keeps duplicate failure idempotency for existing terminal failed jobs', async () => {
    const repository = new InMemoryJobRepository();
    const failedAt = '2026-05-15T13:01:00.000Z';
    const jobId = '01890f42-98c4-7cc3-aa5e-0c567f1d3e91';
    const attemptId = '01890f42-98c4-7cc3-aa5e-0c567f1d3e92';
    const leaseId = '01890f42-98c4-7cc3-aa5e-0c567f1d3e93';
    repository.jobs.push({
      id: jobId,
      tenantId,
      projectId,
      state: 'failed',
      priority: 0,
      maxAttempts: 1,
      attemptCount: 1,
      readyAt: failedAt,
      idempotencyKey: 'create-job:preexisting-failed-duplicate-test',
      constraints: {},
      metadata: { source: 'preexisting-failed-duplicate-test' },
      createdAt: '2026-05-15T13:00:00.000Z',
      updatedAt: failedAt,
      finishedAt: failedAt,
    });
    repository.attempts.push({
      id: attemptId,
      tenantId,
      projectId,
      jobId,
      attemptNumber: 1,
      state: 'failed',
      agentId,
      startedAt: '2026-05-15T13:00:00.000Z',
      finishedAt: failedAt,
      failureCode: 'processor_error',
      failureMessage: null,
    });
    repository.leases.push({
      id: leaseId,
      tenantId,
      projectId,
      jobId,
      attemptId,
      agentId,
      state: 'released',
      acquiredAt: '2026-05-15T13:00:00.000Z',
      expiresAt: '2026-05-15T13:10:00.000Z',
      lastHeartbeatAt: '2026-05-15T13:00:00.000Z',
      releasedAt: failedAt,
      expiredAt: null,
      canceledAt: null,
    });
    const app = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3e94',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3e95',
      ],
      now: () => new Date('2026-05-15T13:02:00.000Z'),
    }).app;

    const response = await app.request(
      `/api/v1/jobs/${jobId}/attempts/${attemptId}/leases/${leaseId}/fail`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-project-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ failureCode: 'processor_error' }),
      },
    );

    expect(response.status).toBe(200);
    expect(failJobAttemptResponseSchema.parse(await response.json())).toMatchObject({
      duplicate: true,
      transition: {
        job: { id: jobId, state: 'failed' },
        attempt: { id: attemptId, state: 'failed' },
        lease: { id: leaseId, state: 'released' },
      },
    });
    expect(repository.runtimeEvents).toHaveLength(0);
    expect(repository.runtimeOutbox).toHaveLength(0);
  });

  it('rejects an old failed attempt after a newer retry claim owns the job', async () => {
    const repository = new InMemoryJobRepository();
    const producerApp = createJobsApp(projectAuth, repository).app;
    await producerApp.request('/api/v1/jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
        'idempotency-key': 'create-job:stale-failed-attempt-test',
      },
      body: JSON.stringify({ maxAttempts: 2, metadata: { source: 'stale-failed-attempt-test' } }),
    });
    const firstClaimApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3e01',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3e02',
      ],
      now: () => new Date('2026-05-15T13:00:00.000Z'),
    }).app;
    const firstClaimResponse = await firstClaimApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 600 }),
    });
    const firstClaimBody = claimJobResponseSchema.parse(await firstClaimResponse.json());

    if (firstClaimBody.claim === null) {
      throw new Error('Expected first claim.');
    }

    const firstFailApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3e03',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3e04',
      ],
      now: () => new Date('2026-05-15T13:01:00.000Z'),
    }).app;
    const firstFailPath = `/api/v1/jobs/${firstClaimBody.claim.job.id}/attempts/${firstClaimBody.claim.attempt.id}/leases/${firstClaimBody.claim.lease.id}/fail`;
    await firstFailApp.request(firstFailPath, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ failureCode: 'processor_error' }),
    });

    const secondClaimApp = createJobsApp(otherAgentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3e05',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3e06',
      ],
      now: () => new Date('2026-05-15T13:02:00.000Z'),
    }).app;
    const secondClaimResponse = await secondClaimApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 600 }),
    });
    const secondClaimBody = claimJobResponseSchema.parse(await secondClaimResponse.json());

    if (secondClaimBody.claim === null) {
      throw new Error('Expected second claim.');
    }

    const staleFailApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3e07',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3e08',
      ],
      now: () => new Date('2026-05-15T13:03:00.000Z'),
    }).app;
    const staleFailResponse = await staleFailApp.request(firstFailPath, {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ failureCode: 'processor_error' }),
    });

    expect(staleFailResponse.status).toBe(409);
    expect(await staleFailResponse.json()).toEqual({ error: 'stale_attempt' });
    expect(repository.jobs[0]).toMatchObject({
      id: firstClaimBody.claim.job.id,
      state: 'running',
      attemptCount: 2,
      finishedAt: null,
    });
    expect(repository.attempts).toEqual([
      expect.objectContaining({ id: firstClaimBody.claim.attempt.id, state: 'failed' }),
      expect.objectContaining({ id: secondClaimBody.claim.attempt.id, state: 'running' }),
    ]);
    expect(repository.runtimeEvents.map((event) => event.eventType)).toEqual([
      'job.created',
      'job.ready',
      'job.attempt.failed',
    ]);
  });

  it('rejects stale completion and failure after lease expiry and reclaim without mutating the newer attempt', async () => {
    const repository = new InMemoryJobRepository();
    const producerApp = createJobsApp(projectAuth, repository).app;
    await producerApp.request('/api/v1/jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
        'idempotency-key': 'create-job:stale-complete-test',
      },
      body: JSON.stringify({ maxAttempts: 2, metadata: { source: 'stale-complete-test' } }),
    });
    const firstClaimApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d71',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d72',
      ],
      now: () => new Date('2026-05-15T13:00:00.000Z'),
    }).app;
    const firstClaimResponse = await firstClaimApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 60 }),
    });
    const firstClaimBody = claimJobResponseSchema.parse(await firstClaimResponse.json());

    if (firstClaimBody.claim === null) {
      throw new Error('Expected a claimed job.');
    }

    const expiryService = createJobsApp(agentAuth, repository, {
      ids: [],
      now: () => new Date('2026-05-15T13:02:00.000Z'),
    }).service;
    await expiryService.expireLeases({ tenantId, projectId });

    const secondClaimApp = createJobsApp(otherAgentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d73',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d74',
      ],
      now: () => new Date('2026-05-15T13:03:00.000Z'),
    }).app;
    const secondClaimResponse = await secondClaimApp.request('/api/v1/jobs/claim', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ leaseTtlSeconds: 600 }),
    });
    const secondClaimBody = claimJobResponseSchema.parse(await secondClaimResponse.json());

    if (secondClaimBody.claim === null) {
      throw new Error('Expected a reclaimed job.');
    }

    const staleCompleteApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d75',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d76',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d77',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d78',
      ],
      now: () => new Date('2026-05-15T13:04:00.000Z'),
    }).app;
    const staleResponse = await staleCompleteApp.request(
      `/api/v1/jobs/${firstClaimBody.claim.job.id}/attempts/${firstClaimBody.claim.attempt.id}/leases/${firstClaimBody.claim.lease.id}/complete`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-project-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );

    const staleFailResponse = await staleCompleteApp.request(
      `/api/v1/jobs/${firstClaimBody.claim.job.id}/attempts/${firstClaimBody.claim.attempt.id}/leases/${firstClaimBody.claim.lease.id}/fail`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-project-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ failureCode: 'late_result' }),
      },
    );

    expect(staleResponse.status).toBe(409);
    expect(await staleResponse.json()).toEqual({ error: 'stale_attempt' });
    expect(staleFailResponse.status).toBe(409);
    expect(await staleFailResponse.json()).toEqual({ error: 'stale_attempt' });
    expect(repository.jobs[0]).toMatchObject({
      id: firstClaimBody.claim.job.id,
      state: 'running',
      attemptCount: 2,
      finishedAt: null,
    });
    expect(repository.attempts).toEqual([
      expect.objectContaining({ id: firstClaimBody.claim.attempt.id, state: 'expired' }),
      expect.objectContaining({ id: secondClaimBody.claim.attempt.id, state: 'running' }),
    ]);
    expect(repository.leases).toEqual([
      expect.objectContaining({ id: firstClaimBody.claim.lease.id, state: 'expired' }),
      expect.objectContaining({ id: secondClaimBody.claim.lease.id, state: 'active' }),
    ]);
    expect(repository.runtimeEvents.map((event) => event.eventType)).toEqual([
      'job.created',
      'job.ready',
    ]);
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

  it('requeues a heartbeated claim after broker restart observes stopped heartbeat expiry', async () => {
    const repository = new InMemoryJobRepository();
    const producerApp = createJobsApp(projectAuth, repository).app;
    await producerApp.request('/api/v1/jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-project-token',
        'content-type': 'application/json',
        'idempotency-key': 'create-job:stopped-heartbeat-expiry-test',
      },
      body: JSON.stringify({
        maxAttempts: 2,
        metadata: { source: 'stopped-heartbeat-expiry-test' },
      }),
    });
    const claimApp = createJobsApp(agentAuth, repository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d81',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d82',
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

    const heartbeatApp = createJobsApp(agentAuth, repository, {
      ids: [],
      now: () => new Date('2026-05-15T13:00:30.000Z'),
    }).app;
    const heartbeatResponse = await heartbeatApp.request(
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

    expect(heartbeatLeaseResponseSchema.parse(await heartbeatResponse.json())).toMatchObject({
      lease: {
        id: claimBody.claim.lease.id,
        state: 'active',
        expiresAt: '2026-05-15T13:01:30.000Z',
        lastHeartbeatAt: '2026-05-15T13:00:30.000Z',
      },
    });

    const reloadedRepository = cloneJobRepository(repository);
    const restartedBrokerService = createJobsApp(agentAuth, reloadedRepository, {
      ids: [],
      now: () => new Date('2026-05-15T13:02:00.000Z'),
    }).service;
    const expired = await restartedBrokerService.expireLeases({ tenantId, projectId, limit: 10 });

    expect(repository.leases[0]).toMatchObject({ state: 'active' });
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
        lastHeartbeatAt: '2026-05-15T13:00:30.000Z',
        expiredAt: '2026-05-15T13:02:00.000Z',
      },
    });

    const reclaimApp = createJobsApp(otherAgentAuth, reloadedRepository, {
      ids: [
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d83',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d84',
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
      throw new Error('Expected heartbeated expired job to be claimable again.');
    }

    const historyApp = createJobsApp(projectAuth, reloadedRepository).app;
    const historyResponse = await historyApp.request(
      `/api/v1/jobs/${claimBody.claim.job.id}/history`,
      {
        headers: { authorization: 'Bearer valid-project-token' },
      },
    );
    const history = jobHistoryResponseSchema.parse(await historyResponse.json());

    expect(reclaimBody.claim).toMatchObject({
      job: { id: claimBody.claim.job.id, state: 'running', attemptCount: 2 },
      attempt: {
        id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d83',
        attemptNumber: 2,
        state: 'running',
      },
      lease: { id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d84', state: 'active' },
    });
    expect(history.attempts).toEqual([
      expect.objectContaining({ id: claimBody.claim.attempt.id, state: 'expired' }),
      expect.objectContaining({ id: reclaimBody.claim.attempt.id, state: 'running' }),
    ]);
    expect(history.leases).toEqual([
      expect.objectContaining({ id: claimBody.claim.lease.id, state: 'expired' }),
      expect.objectContaining({ id: reclaimBody.claim.lease.id, state: 'active' }),
    ]);
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

  it('dead-letters an expired lease after maxAttempts instead of advertising an exhausted retry', async () => {
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
        state: 'dead_lettered',
        attemptCount: 1,
        finishedAt: '2026-05-15T13:02:00.000Z',
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
    expect(claimJobResponseSchema.parse(await reclaimResponse.json())).toEqual({ claim: null });
  });
});
