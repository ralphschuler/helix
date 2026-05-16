import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@helix/contracts';

import { InMemoryRuntimeEventStoreProjection } from './features/runtime/event-store.js';
import { InMemoryWorkflowRepository, WorkflowService } from './features/workflows/workflow-service.js';
import { createApp, type ApiAuthProvider } from './server/app.js';

const tenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const projectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';
const workflowId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d10';

function createFixedApiAuthProvider(auth: AuthContext | null): ApiAuthProvider {
  return {
    async authenticate(request) {
      return request.headers.get('authorization') === 'Bearer valid-project-token' ? auth : null;
    },
  };
}

function authContext(permissions: string[]): AuthContext {
  return {
    tenantId,
    projectId,
    principal: { type: 'api_key', id: 'project-api-key-1' },
    permissions,
  };
}

async function createWorkflowService(): Promise<WorkflowService> {
  const repository = new InMemoryWorkflowRepository();
  await repository.createWorkflow({
    workflow: {
      id: workflowId,
      tenantId,
      projectId,
      slug: 'invoice-approval',
      name: 'Invoice Approval',
      description: null,
      draftGraph: { nodes: [{ id: 'review' }], edges: [] },
      metadata: {},
      createdAt: '2026-05-15T13:00:00.000Z',
      updatedAt: '2026-05-15T13:00:00.000Z',
    },
  });

  return new WorkflowService({
    repository,
    generateId: () => { throw new Error('No test ID left.'); },
    now: () => new Date('2026-05-15T13:00:00.000Z'),
  });
}

function event(sequence: number) {
  return {
    tenantId,
    projectId,
    id: `01890f42-98c4-7cc3-aa5e-0c567f1d3d3${sequence}`,
    eventType: 'job.state.changed',
    eventVersion: 1,
    orderingKey: `workflow:${workflowId}`,
    payload: { workflowId, jobId: `01890f42-98c4-7cc3-aa5e-0c567f1d3d4${sequence}` },
    occurredAt: new Date(`2026-05-15T13:00:0${sequence}.000Z`),
    recordedAt: new Date(`2026-05-15T13:00:1${sequence}.000Z`),
  };
}

describe('stream auth and retention expiry', () => {
  it('enforces project stream permissions before replay', async () => {
    const eventStore = new InMemoryRuntimeEventStoreProjection();
    await eventStore.project(event(1));
    const app = createApp({
      apiAuthProvider: createFixedApiAuthProvider(authContext([])),
      workflowService: await createWorkflowService(),
      runtimeEventStore: eventStore,
    });

    const workflowResponse = await app.request(`/api/v1/workflows/${workflowId}/stream`, {
      headers: { authorization: 'Bearer valid-project-token' },
    });
    const jobsResponse = await app.request('/api/v1/jobs/stream', {
      headers: { authorization: 'Bearer valid-project-token' },
    });

    expect(workflowResponse.status).toBe(403);
    expect(jobsResponse.status).toBe(403);
  });

  it('returns explicit retention expiry for expired stream cursors', async () => {
    const eventStore = new InMemoryRuntimeEventStoreProjection({
      now: () => new Date('2026-05-17T13:00:00.000Z'),
      retainForDays: 1,
    });
    const expired = await eventStore.project({ ...event(1), occurredAt: new Date('2026-05-15T13:00:00.000Z') });
    await eventStore.project({ ...event(2), eventType: 'workflow.step.completed', occurredAt: new Date('2026-05-17T12:00:00.000Z') });
    const app = createApp({
      apiAuthProvider: createFixedApiAuthProvider(authContext(['workflows:read', 'jobs:read'])),
      workflowService: await createWorkflowService(),
      runtimeEventStore: eventStore,
    });

    const workflowResponse = await app.request(`/api/v1/workflows/${workflowId}/stream?cursor=${encodeURIComponent(expired.cursor)}`, {
      headers: { authorization: 'Bearer valid-project-token' },
    });
    const jobsResponse = await app.request(`/api/v1/jobs/stream?cursor=${encodeURIComponent(expired.cursor)}`, {
      headers: { authorization: 'Bearer valid-project-token' },
    });

    await expect(workflowResponse.json()).resolves.toEqual({ error: 'retention_expired' });
    await expect(jobsResponse.json()).resolves.toEqual({ error: 'retention_expired' });
    expect(workflowResponse.status).toBe(410);
    expect(jobsResponse.status).toBe(410);
  });
});
