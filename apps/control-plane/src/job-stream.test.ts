import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@helix/contracts';

import { InMemoryRuntimeEventStoreProjection } from './features/runtime/event-store.js';
import { createApp, type ApiAuthProvider } from './server/app.js';

const tenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const projectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';
const workflowId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d10';
const jobId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d20';

const authContext: AuthContext = {
  tenantId,
  projectId,
  principal: { type: 'api_key', id: 'project-api-key-1' },
  permissions: ['jobs:read'],
};

function createFixedApiAuthProvider(auth: AuthContext | null): ApiAuthProvider {
  return {
    async authenticate(request) {
      return request.headers.get('authorization') === 'Bearer valid-project-token' ? auth : null;
    },
  };
}

function event(sequence: number, payload: Record<string, unknown>) {
  return {
    tenantId,
    projectId,
    id: `01890f42-98c4-7cc3-aa5e-0c567f1d3d3${sequence}`,
    eventType: 'job.state.changed',
    eventVersion: 1,
    orderingKey: `job:${payload.jobId ?? jobId}`,
    payload,
    occurredAt: new Date(`2026-05-15T13:00:0${sequence}.000Z`),
    recordedAt: new Date(`2026-05-15T13:00:1${sequence}.000Z`),
  };
}

describe('job event stream API', () => {
  it('multiplexes matching job events as SSE and resumes after an opaque cursor', async () => {
    const eventStore = new InMemoryRuntimeEventStoreProjection();
    await eventStore.project(event(1, { jobId, workflowId, metadata: { queue: 'render' } }));
    await eventStore.project(event(2, { jobId: '01890f42-98c4-7cc3-aa5e-0c567f1d3d21', workflowId, metadata: { queue: 'render' } }));
    await eventStore.project(event(3, { jobId: '01890f42-98c4-7cc3-aa5e-0c567f1d3d22', workflowId: '01890f42-98c4-7cc3-aa5e-0c567f1d3d99', metadata: { queue: 'render' } }));
    await eventStore.project(event(4, { jobId: '01890f42-98c4-7cc3-aa5e-0c567f1d3d23', workflowId, metadata: { queue: 'export' } }));
    const app = createApp({ apiAuthProvider: createFixedApiAuthProvider(authContext), runtimeEventStore: eventStore });

    const firstResponse = await app.request(`/api/v1/jobs/stream?workflowId=${workflowId}&metadata.queue=render&limit=1`, {
      headers: { authorization: 'Bearer valid-project-token' },
    });
    const firstBody = await firstResponse.text();
    const cursor = firstBody.match(/^id: (.+)$/m)?.[1];

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('content-type')).toContain('text/event-stream');
    expect(firstBody).toContain('event: job.state.changed');
    expect(firstBody).toContain(jobId);
    expect(firstBody).not.toContain('0c567f1d3d21');
    expect(cursor).toBeDefined();

    const resumedResponse = await app.request(`/api/v1/jobs/stream?workflowId=${workflowId}&metadata.queue=render&cursor=${encodeURIComponent(cursor ?? '')}`, {
      headers: { authorization: 'Bearer valid-project-token' },
    });
    const resumedBody = await resumedResponse.text();

    expect(resumedResponse.status).toBe(200);
    expect(resumedBody).toContain('0c567f1d3d21');
    expect(resumedBody).not.toContain(jobId);
    expect(resumedBody).not.toContain('0c567f1d3d22');
    expect(resumedBody).not.toContain('0c567f1d3d23');
  });

  it('rejects unauthorized and invalid filtered job stream access', async () => {
    const eventStore = new InMemoryRuntimeEventStoreProjection();
    const unauthorized = createApp({
      apiAuthProvider: createFixedApiAuthProvider({ ...authContext, permissions: [] }),
      runtimeEventStore: eventStore,
    });
    const invalid = createApp({ apiAuthProvider: createFixedApiAuthProvider(authContext), runtimeEventStore: eventStore });

    const unauthorizedResponse = await unauthorized.request('/api/v1/jobs/stream', {
      headers: { authorization: 'Bearer valid-project-token' },
    });
    const invalidResponse = await invalid.request('/api/v1/jobs/stream?metadata.=bad', {
      headers: { authorization: 'Bearer valid-project-token' },
    });

    expect(unauthorizedResponse.status).toBe(403);
    expect(invalidResponse.status).toBe(400);
  });
});
