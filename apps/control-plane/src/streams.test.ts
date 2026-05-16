import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@helix/contracts';

import { InMemoryRuntimeEventStoreProjection } from './features/runtime/event-store.js';
import { InMemoryWorkflowRepository, WorkflowService } from './features/workflows/workflow-service.js';
import { createApp, type ApiAuthProvider } from './server/app.js';

const tenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const projectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';
const workflowId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d10';
const otherWorkflowId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d11';
const jobId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d20';

const authContext: AuthContext = {
  tenantId,
  projectId,
  principal: { type: 'api_key', id: 'project-api-key-1' },
  permissions: ['workflows:read', 'jobs:read'],
};

function createFixedApiAuthProvider(auth: AuthContext | null): ApiAuthProvider {
  return {
    async authenticate(request) {
      return request.headers.get('authorization') === 'Bearer valid-project-token' ? auth : null;
    },
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

function workflowEvent(sequence: number, suffix: string, targetWorkflowId = workflowId) {
  return {
    tenantId,
    projectId,
    id: `01890f42-98c4-7cc3-aa5e-0c567f1d3d${suffix}`,
    eventType: 'workflow.step.completed',
    eventVersion: 1,
    orderingKey: `workflow:${targetWorkflowId}`,
    payload: { workflowId: targetWorkflowId, stepId: `step-${sequence}` },
    occurredAt: new Date(`2026-05-15T13:00:0${sequence}.000Z`),
    recordedAt: new Date(`2026-05-15T13:00:1${sequence}.000Z`),
  };
}

function jobEvent(sequence: number, payload: Record<string, unknown>, occurredAt = `2026-05-15T13:00:0${sequence}.000Z`) {
  return {
    tenantId,
    projectId,
    id: `01890f42-98c4-7cc3-aa5e-0c567f1d3e${sequence.toString().padStart(2, '0')}`,
    eventType: 'job.state.changed',
    eventVersion: 1,
    orderingKey: `job:${payload.jobId ?? jobId}`,
    payload,
    occurredAt: new Date(occurredAt),
    recordedAt: new Date(`2026-05-15T13:00:1${sequence}.000Z`),
  };
}

function cursorFrom(body: string): string {
  const cursor = body.match(/^id: (.+)$/m)?.[1];
  if (cursor === undefined) throw new Error(`Missing SSE cursor in ${body}`);
  return cursor;
}

describe('stream reconnect behavior', () => {
  it('recovers missed workflow events after a client disconnects and reconnects with the last cursor', async () => {
    const eventStore = new InMemoryRuntimeEventStoreProjection();
    await eventStore.project(workflowEvent(1, '31'));
    await eventStore.project(workflowEvent(2, '32'));
    const app = createApp({
      apiAuthProvider: createFixedApiAuthProvider(authContext),
      workflowService: await createWorkflowService(),
      runtimeEventStore: eventStore,
    });

    const disconnectedResponse = await app.request(`/api/v1/workflows/${workflowId}/stream?limit=1`, {
      headers: { authorization: 'Bearer valid-project-token' },
    });
    const disconnectedBody = await disconnectedResponse.text();
    const cursor = cursorFrom(disconnectedBody);
    await eventStore.project(workflowEvent(3, '33'));

    const reconnectedResponse = await app.request(`/api/v1/workflows/${workflowId}/stream?cursor=${encodeURIComponent(cursor)}`, {
      headers: { authorization: 'Bearer valid-project-token' },
    });
    const reconnectedBody = await reconnectedResponse.text();

    expect(disconnectedResponse.status).toBe(200);
    expect(disconnectedBody).toContain('"stepId":"step-1"');
    expect(reconnectedResponse.status).toBe(200);
    expect(reconnectedBody).toContain('"stepId":"step-2"');
    expect(reconnectedBody).toContain('"stepId":"step-3"');
    expect(reconnectedBody).not.toContain('"stepId":"step-1"');
  });

  it('preserves job stream filters when reconnecting from a cursor', async () => {
    const eventStore = new InMemoryRuntimeEventStoreProjection();
    await eventStore.project(jobEvent(1, { jobId, workflowId, metadata: { queue: 'render', region: 'iad' } }));
    await eventStore.project(jobEvent(2, { jobId: '01890f42-98c4-7cc3-aa5e-0c567f1d3d21', workflowId, metadata: { queue: 'export', region: 'iad' } }));
    await eventStore.project(jobEvent(3, { jobId: '01890f42-98c4-7cc3-aa5e-0c567f1d3d22', workflowId: otherWorkflowId, metadata: { queue: 'render', region: 'iad' } }));
    await eventStore.project(jobEvent(4, { jobId: '01890f42-98c4-7cc3-aa5e-0c567f1d3d23', workflowId, metadata: { queue: 'render', region: 'iad' } }));
    const app = createApp({ apiAuthProvider: createFixedApiAuthProvider(authContext), runtimeEventStore: eventStore });

    const firstResponse = await app.request(`/api/v1/jobs/stream?workflowId=${workflowId}&metadata.queue=render&limit=1`, {
      headers: { authorization: 'Bearer valid-project-token' },
    });
    const cursor = cursorFrom(await firstResponse.text());

    const reconnectedResponse = await app.request(`/api/v1/jobs/stream?workflowId=${workflowId}&metadata.queue=render&cursor=${encodeURIComponent(cursor)}`, {
      headers: { authorization: 'Bearer valid-project-token' },
    });
    const reconnectedBody = await reconnectedResponse.text();

    expect(reconnectedResponse.status).toBe(200);
    expect(reconnectedBody).toContain('0c567f1d3d23');
    expect(reconnectedBody).not.toContain('0c567f1d3d21');
    expect(reconnectedBody).not.toContain('0c567f1d3d22');
  });

  it('returns retention expiry when reconnecting a job stream from an expired cursor', async () => {
    const eventStore = new InMemoryRuntimeEventStoreProjection({
      now: () => new Date('2026-05-17T13:00:00.000Z'),
      retainForDays: 1,
    });
    const expired = await eventStore.project(jobEvent(1, { jobId, workflowId, metadata: { queue: 'render' } }, '2026-05-15T13:00:00.000Z'));
    await eventStore.project(jobEvent(2, { jobId: '01890f42-98c4-7cc3-aa5e-0c567f1d3d21', workflowId, metadata: { queue: 'render' } }, '2026-05-17T12:00:00.000Z'));
    const app = createApp({ apiAuthProvider: createFixedApiAuthProvider(authContext), runtimeEventStore: eventStore });

    const response = await app.request(`/api/v1/jobs/stream?metadata.queue=render&cursor=${encodeURIComponent(expired.cursor)}`, {
      headers: { authorization: 'Bearer valid-project-token' },
    });

    await expect(response.json()).resolves.toEqual({ error: 'retention_expired' });
    expect(response.status).toBe(410);
  });
});
