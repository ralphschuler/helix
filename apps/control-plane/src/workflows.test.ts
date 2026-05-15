import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@helix/contracts';
import {
  workflowResponseSchema,
  workflowRunListResponseSchema,
  workflowRunResponseSchema,
  workflowRunStartedEventPayloadSchema,
  workflowVersionResponseSchema,
} from '@helix/contracts';

import {
  InMemoryWorkflowRepository,
  WorkflowService,
} from './features/workflows/workflow-service.js';
import { createApp, type ApiAuthProvider } from './server/app.js';

const tenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const projectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';

const workflowAuth: AuthContext = {
  tenantId,
  projectId,
  principal: { type: 'api_key', id: 'project-api-key-1' },
  permissions: [
    'workflows:create',
    'workflows:read',
    'workflows:update',
    'workflows:publish',
    'workflows:start',
  ],
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

function createWorkflowsApp(
  authContext: AuthContext | null = workflowAuth,
  repository = new InMemoryWorkflowRepository(),
) {
  const service = new WorkflowService({
    generateId: createIdGenerator([
      '01890f42-98c4-7cc3-aa5e-0c567f1d3d10',
      '01890f42-98c4-7cc3-aa5e-0c567f1d3d11',
      '01890f42-98c4-7cc3-aa5e-0c567f1d3d12',
      '01890f42-98c4-7cc3-aa5e-0c567f1d3d13',
      '01890f42-98c4-7cc3-aa5e-0c567f1d3d14',
      '01890f42-98c4-7cc3-aa5e-0c567f1d3d15',
      '01890f42-98c4-7cc3-aa5e-0c567f1d3d16',
      '01890f42-98c4-7cc3-aa5e-0c567f1d3d17',
    ]),
    now: () => new Date('2026-05-15T13:00:00.000Z'),
    repository,
  });
  const app = createApp({
    apiAuthProvider: createFixedApiAuthProvider(authContext),
    workflowService: service,
  });

  return { app, repository, service };
}

const jsonHeaders = {
  authorization: 'Bearer valid-project-token',
  'content-type': 'application/json',
};

describe('workflow API', () => {
  it('creates and updates a draft, publishes an immutable version, and starts runs pinned to that version', async () => {
    const { app, repository } = createWorkflowsApp();

    const createdResponse = await app.request('/api/v1/workflows', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        slug: 'invoice-approval',
        name: 'Invoice Approval',
        description: 'Approves invoices',
        draftGraph: { nodes: [{ id: 'review' }], edges: [] },
        metadata: { owner: 'ops' },
      }),
    });
    const created = workflowResponseSchema.parse(await createdResponse.json());

    const updatedResponse = await app.request(`/api/v1/workflows/${created.workflow.id}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({
        draftGraph: { nodes: [{ id: 'review' }, { id: 'approve' }], edges: [{ from: 'review', to: 'approve' }] },
      }),
    });
    const updated = workflowResponseSchema.parse(await updatedResponse.json());

    const publishedResponse = await app.request(`/api/v1/workflows/${created.workflow.id}/publish`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    const published = workflowVersionResponseSchema.parse(await publishedResponse.json());

    const mutatedDraftResponse = await app.request(`/api/v1/workflows/${created.workflow.id}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ draftGraph: { nodes: [{ id: 'changed-later' }], edges: [] } }),
    });
    const runResponse = await app.request(`/api/v1/workflows/${created.workflow.id}/runs`, {
      method: 'POST',
      headers: {
        ...jsonHeaders,
        'idempotency-key': 'workflow-run:invoice-1',
      },
      body: JSON.stringify({}),
    });
    const run = workflowRunResponseSchema.parse(await runResponse.json());

    expect(createdResponse.status).toBe(201);
    expect(updatedResponse.status).toBe(200);
    expect(publishedResponse.status).toBe(201);
    expect(mutatedDraftResponse.status).toBe(200);
    expect(runResponse.status).toBe(201);
    expect(updated.workflow.draftGraph).toEqual({
      nodes: [{ id: 'review' }, { id: 'approve' }],
      edges: [{ from: 'review', to: 'approve' }],
    });
    expect(published.version).toMatchObject({
      workflowId: created.workflow.id,
      versionNumber: 1,
      graph: updated.workflow.draftGraph,
    });
    expect(repository.versions[0]?.graph).toEqual(updated.workflow.draftGraph);
    expect(repository.versions[0]?.graph).not.toEqual({ nodes: [{ id: 'changed-later' }], edges: [] });
    expect(run.run).toMatchObject({
      workflowId: created.workflow.id,
      workflowVersionId: published.version.id,
      state: 'queued',
      idempotencyKey: 'workflow-run:invoice-1',
    });
  });

  it('returns workflow run status and lists only runs in the authorized project/workflow scope', async () => {
    const { app, repository } = createWorkflowsApp();
    const createdResponse = await app.request('/api/v1/workflows', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ slug: 'status-workflow', name: 'Status Workflow', draftGraph: { nodes: [{ id: 'start' }], edges: [] } }),
    });
    const workflow = workflowResponseSchema.parse(await createdResponse.json()).workflow;
    await app.request(`/api/v1/workflows/${workflow.id}/publish`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    const runResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs`, {
      method: 'POST',
      headers: { ...jsonHeaders, 'idempotency-key': 'workflow-run:status-list' },
      body: JSON.stringify({}),
    });
    const run = workflowRunResponseSchema.parse(await runResponse.json()).run;
    const otherProjectApp = createWorkflowsApp({
      ...workflowAuth,
      tenantId: '01890f42-98c4-7cc3-8a5e-0c567f1d3a79',
      projectId: '01890f42-98c4-7cc3-9a5e-0c567f1d3a80',
    }, repository).app;

    const statusResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs/${run.id}`, { headers: jsonHeaders });
    const listResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs`, { headers: jsonHeaders });
    const wrongWorkflowResponse = await app.request(`/api/v1/workflows/01890f42-98c4-7cc3-aa5e-0c567f1d3d99/runs/${run.id}`, { headers: jsonHeaders });
    const wrongScopeListResponse = await otherProjectApp.request(`/api/v1/workflows/${workflow.id}/runs`, { headers: jsonHeaders });

    expect(statusResponse.status).toBe(200);
    expect(workflowRunResponseSchema.parse(await statusResponse.json())).toEqual({ run });
    expect(listResponse.status).toBe(200);
    expect(workflowRunListResponseSchema.parse(await listResponse.json())).toEqual({ runs: [run] });
    expect(wrongWorkflowResponse.status).toBe(404);
    expect(wrongScopeListResponse.status).toBe(200);
    expect(workflowRunListResponseSchema.parse(await wrongScopeListResponse.json())).toEqual({ runs: [] });
  });

  it('emits one workflow run started lifecycle event for an idempotent run start', async () => {
    const { app, repository } = createWorkflowsApp();
    const createdResponse = await app.request('/api/v1/workflows', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ slug: 'event-workflow', name: 'Event Workflow', draftGraph: { nodes: [{ id: 'start' }], edges: [] } }),
    });
    const workflow = workflowResponseSchema.parse(await createdResponse.json()).workflow;
    const publishedResponse = await app.request(`/api/v1/workflows/${workflow.id}/publish`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    const version = workflowVersionResponseSchema.parse(await publishedResponse.json()).version;
    const request = {
      method: 'POST',
      headers: { ...jsonHeaders, 'idempotency-key': 'workflow-run:event-once' },
      body: JSON.stringify({}),
    } as const;

    const firstRunResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs`, request);
    const duplicateRunResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs`, request);
    const run = workflowRunResponseSchema.parse(await firstRunResponse.json()).run;
    workflowRunResponseSchema.parse(await duplicateRunResponse.json());

    expect(firstRunResponse.status).toBe(201);
    expect(duplicateRunResponse.status).toBe(200);
    expect(repository.runtimeEvents).toHaveLength(1);
    expect(repository.runtimeOutbox).toHaveLength(1);
    expect(repository.runtimeEvents[0]?.eventType).toBe('workflow.run.started');
    expect(repository.runtimeEvents[0]?.orderingKey).toBe(`project:${projectId}:workflow:${workflow.id}:run:${run.id}`);
    expect(repository.runtimeOutbox[0]?.topic).toBe('helix.runtime.events');
    expect(workflowRunStartedEventPayloadSchema.parse(repository.runtimeEvents[0]?.payload)).toEqual({
      tenantId,
      projectId,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      runId: run.id,
      state: 'queued',
      idempotencyKey: 'workflow-run:event-once',
      startedAt: '2026-05-15T13:00:00.000Z',
    });
  });

  it('scopes workflow run idempotency to the requested workflow', async () => {
    const { app } = createWorkflowsApp();
    const createWorkflow = async (slug: string, name: string) => {
      const response = await app.request('/api/v1/workflows', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ slug, name, draftGraph: { nodes: [{ id: slug }], edges: [] } }),
      });
      const created = workflowResponseSchema.parse(await response.json());
      const publishResponse = await app.request(`/api/v1/workflows/${created.workflow.id}/publish`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      });
      workflowVersionResponseSchema.parse(await publishResponse.json());
      return created.workflow;
    };
    const first = await createWorkflow('first-workflow', 'First Workflow');
    const second = await createWorkflow('second-workflow', 'Second Workflow');
    const request = {
      method: 'POST',
      headers: { ...jsonHeaders, 'idempotency-key': 'workflow-run:same-client-request' },
      body: JSON.stringify({}),
    } as const;

    const firstRunResponse = await app.request(`/api/v1/workflows/${first.id}/runs`, request);
    const secondRunResponse = await app.request(`/api/v1/workflows/${second.id}/runs`, request);
    const duplicateFirstRunResponse = await app.request(`/api/v1/workflows/${first.id}/runs`, request);

    const firstRun = workflowRunResponseSchema.parse(await firstRunResponse.json());
    const secondRun = workflowRunResponseSchema.parse(await secondRunResponse.json());
    const duplicateFirstRun = workflowRunResponseSchema.parse(await duplicateFirstRunResponse.json());

    expect(firstRunResponse.status).toBe(201);
    expect(secondRunResponse.status).toBe(201);
    expect(duplicateFirstRunResponse.status).toBe(200);
    expect(firstRun.run.workflowId).toBe(first.id);
    expect(secondRun.run.workflowId).toBe(second.id);
    expect(duplicateFirstRun).toEqual(firstRun);
  });

  it('rejects idempotent workflow run retries with a different explicit version', async () => {
    const { app } = createWorkflowsApp();
    const createdResponse = await app.request('/api/v1/workflows', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ slug: 'versioned-workflow', name: 'Versioned Workflow', draftGraph: { nodes: [{ id: 'v1' }], edges: [] } }),
    });
    const workflow = workflowResponseSchema.parse(await createdResponse.json()).workflow;
    const firstPublishResponse = await app.request(`/api/v1/workflows/${workflow.id}/publish`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    const firstVersion = workflowVersionResponseSchema.parse(await firstPublishResponse.json()).version;
    await app.request(`/api/v1/workflows/${workflow.id}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ draftGraph: { nodes: [{ id: 'v2' }], edges: [] } }),
    });
    const secondPublishResponse = await app.request(`/api/v1/workflows/${workflow.id}/publish`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    const secondVersion = workflowVersionResponseSchema.parse(await secondPublishResponse.json()).version;
    const headers = { ...jsonHeaders, 'idempotency-key': 'workflow-run:version-conflict' };

    const firstRunResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflowVersionId: firstVersion.id }),
    });
    const conflictResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflowVersionId: secondVersion.id }),
    });

    expect(firstRunResponse.status).toBe(201);
    expect(conflictResponse.status).toBe(409);
    expect(await conflictResponse.json()).toEqual({ error: 'idempotency_conflict' });
  });

  it('enforces workflow permissions, project scope, request validation, and publish prerequisites', async () => {
    const denied = createWorkflowsApp({ ...workflowAuth, permissions: ['workflows:read'] }).app;
    const deniedCreate = await denied.request('/api/v1/workflows', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ slug: 'x', name: 'X', draftGraph: {} }),
    });
    expect(deniedCreate.status).toBe(403);

    const { app, repository } = createWorkflowsApp();
    const invalid = await app.request('/api/v1/workflows', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ slug: 'x', name: 'X', draftGraph: [] }),
    });
    const missingWorkflow = await app.request('/api/v1/workflows/01890f42-98c4-7cc3-aa5e-0c567f1d3d99/publish', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    const otherProjectApp = createWorkflowsApp({
      ...workflowAuth,
      tenantId: '01890f42-98c4-7cc3-8a5e-0c567f1d3a79',
      projectId: '01890f42-98c4-7cc3-9a5e-0c567f1d3a80',
    }, repository).app;
    const wrongScopeList = await otherProjectApp.request('/api/v1/workflows', { headers: jsonHeaders });

    expect(invalid.status).toBe(400);
    expect(missingWorkflow.status).toBe(404);
    expect(wrongScopeList.status).toBe(200);
    expect(await wrongScopeList.json()).toEqual({ workflows: [] });
  });
});
