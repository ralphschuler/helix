import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@helix/contracts';
import { jobListResponseSchema, jobResponseSchema } from '@helix/contracts';

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
) {
  const service = new JobService({
    generateId: createIdGenerator([
      '01890f42-98c4-7cc3-aa5e-0c567f1d3c01',
      '01890f42-98c4-7cc3-aa5e-0c567f1d3c02',
      '01890f42-98c4-7cc3-aa5e-0c567f1d3c03',
      '01890f42-98c4-7cc3-aa5e-0c567f1d3c04',
      '01890f42-98c4-7cc3-aa5e-0c567f1d3c05',
      '01890f42-98c4-7cc3-aa5e-0c567f1d3c06',
      '01890f42-98c4-7cc3-aa5e-0c567f1d3c07',
    ]),
    now: () => new Date('2026-05-15T13:00:00.000Z'),
    repository,
  });
  const app = createApp({
    apiAuthProvider: createFixedApiAuthProvider(authContext),
    jobService: service,
  });

  return { app, repository };
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
});
