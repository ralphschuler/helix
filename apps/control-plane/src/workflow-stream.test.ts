import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@helix/contracts';

import { InMemoryRuntimeEventStoreProjection } from './features/runtime/event-store.js';
import { InMemoryWorkflowRepository, WorkflowService } from './features/workflows/workflow-service.js';
import { createApp, type ApiAuthProvider } from './server/app.js';

const tenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const projectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';
const workflowId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d10';

const authContext: AuthContext = {
  tenantId,
  projectId,
  principal: { type: 'api_key', id: 'project-api-key-1' },
  permissions: ['workflows:read'],
};

function createFixedApiAuthProvider(auth: AuthContext | null): ApiAuthProvider {
  return {
    async authenticate(request) {
      return request.headers.get('authorization') === 'Bearer valid-project-token' ? auth : null;
    },
  };
}

function createIdGenerator(ids: readonly string[]): () => string {
  let index = 0;
  return () => {
    const id = ids[index];
    if (id === undefined) throw new Error('No test ID left.');
    index += 1;
    return id;
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
    generateId: createIdGenerator([]),
    now: () => new Date('2026-05-15T13:00:00.000Z'),
  });
}

function event(sequence: number, idSuffix: string, targetWorkflowId = workflowId) {
  return {
    tenantId,
    projectId,
    id: `01890f42-98c4-7cc3-aa5e-0c567f1d3d${idSuffix}`,
    eventType: 'workflow.step.completed',
    eventVersion: 1,
    orderingKey: `workflow:${targetWorkflowId}`,
    payload: { workflowId: targetWorkflowId, stepId: `step-${sequence}` },
    occurredAt: new Date(`2026-05-15T13:00:0${sequence}.000Z`),
    recordedAt: new Date(`2026-05-15T13:00:1${sequence}.000Z`),
  };
}

describe('workflow event stream API', () => {
  it('emits retained workflow events as SSE and resumes after an opaque cursor', async () => {
    const eventStore = new InMemoryRuntimeEventStoreProjection();
    await eventStore.project(event(1, '21'));
    await eventStore.project(event(2, '22'));
    await eventStore.project(event(3, '23', '01890f42-98c4-7cc3-aa5e-0c567f1d3d99'));
    const workflowService = await createWorkflowService();
    const app = createApp({
      apiAuthProvider: createFixedApiAuthProvider(authContext),
      workflowService,
      runtimeEventStore: eventStore,
    });

    const firstResponse = await app.request(`/api/v1/workflows/${workflowId}/stream?limit=1`, {
      headers: { authorization: 'Bearer valid-project-token' },
    });
    const firstBody = await firstResponse.text();
    const cursor = firstBody.match(/^id: (.+)$/m)?.[1];

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('content-type')).toContain('text/event-stream');
    expect(firstBody).toContain('event: workflow.step.completed');
    expect(firstBody).toContain('"stepId":"step-1"');
    expect(firstBody).not.toContain('step-2');
    expect(cursor).toBeDefined();

    const resumedResponse = await app.request(`/api/v1/workflows/${workflowId}/stream?cursor=${encodeURIComponent(cursor ?? '')}`, {
      headers: { authorization: 'Bearer valid-project-token' },
    });
    const resumedBody = await resumedResponse.text();

    expect(resumedResponse.status).toBe(200);
    expect(resumedBody).toContain('"stepId":"step-2"');
    expect(resumedBody).not.toContain('step-1');
    expect(resumedBody).not.toContain('step-3');
  });

  it('rejects unauthorized workflow stream access', async () => {
    const workflowService = await createWorkflowService();
    const app = createApp({
      apiAuthProvider: createFixedApiAuthProvider({ ...authContext, permissions: [] }),
      workflowService,
      runtimeEventStore: new InMemoryRuntimeEventStoreProjection(),
    });

    const response = await app.request(`/api/v1/workflows/${workflowId}/stream`, {
      headers: { authorization: 'Bearer valid-project-token' },
    });

    expect(response.status).toBe(403);
  });
});
