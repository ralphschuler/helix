import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@helix/contracts';
import {
  workflowResponseSchema,
  workflowRunListResponseSchema,
  workflowRunResponseSchema,
  workflowRunStartedEventPayloadSchema,
  workflowApprovalResponseSchema,
  workflowSignalResponseSchema,
  workflowVersionResponseSchema,
} from '@helix/contracts';

import {
  InMemoryWorkflowRepository,
  WorkflowService,
} from './features/workflows/workflow-service.js';
import { InMemoryJobRepository, JobService } from './features/jobs/job-service.js';
import { createApp, type ApiAuthProvider } from './server/app.js';
import type { SecurityAuditEvent, SecurityAuditSink } from './features/iam/security-audit.js';

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

class RecordingAuditSink implements SecurityAuditSink {
  readonly events: SecurityAuditEvent[] = [];

  async record(event: SecurityAuditEvent): Promise<void> {
    this.events.push(event);
  }
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

  it('persists workflow step state and enqueues each initially ready job step exactly once', async () => {
    const workflowRepository = new InMemoryWorkflowRepository();
    const jobRepository = new InMemoryJobRepository();
    const jobService = new JobService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d11',
      ]),
      now: () => new Date('2026-05-15T13:00:00.000Z'),
      repository: jobRepository,
    });
    const service = new WorkflowService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d11',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d12',
      ]),
      jobActivator: async ({ idempotencyKey, request, scope }) => jobService.createJob(
        { ...workflowAuth, permissions: [...workflowAuth.permissions, 'jobs:create'] },
        { ...scope, idempotencyKey, request },
      ),
      now: () => new Date('2026-05-15T13:00:00.000Z'),
      repository: workflowRepository,
    });
    const workflow = await service.createWorkflow(workflowAuth, {
      tenantId,
      projectId,
      request: {
        slug: 'step-activation',
        name: 'Step Activation',
        draftGraph: {
          nodes: [{ id: 'extract', type: 'job' }, { id: 'transform', type: 'job' }],
          edges: [{ from: 'extract', to: 'transform' }],
        },
      },
    });
    await service.publishWorkflow(workflowAuth, { tenantId, projectId, workflowId: workflow.id });

    const first = await service.startRun(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      idempotencyKey: 'workflow-run:steps-1',
      request: {},
    });
    const second = await service.startRun(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      idempotencyKey: 'workflow-run:steps-1',
      request: {},
    });

    expect(first?.created).toBe(true);
    expect(second?.created).toBe(false);
    expect(workflowRepository.steps).toEqual([
      expect.objectContaining({
        runId: first?.run.id,
        stepId: 'extract',
        type: 'job',
        state: 'running',
        jobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
      }),
      expect.objectContaining({ runId: first?.run.id, stepId: 'transform', type: 'job', state: 'pending', jobId: null }),
    ]);
    expect(jobRepository.jobs).toHaveLength(1);
    expect(jobRepository.jobs[0]).toMatchObject({
      state: 'queued',
      idempotencyKey: `workflow-step:${first?.run.id}:extract`,
      metadata: {
        workflowId: workflow.id,
        workflowRunId: first?.run.id,
        workflowStepId: 'extract',
      },
    });

    await expect(service.completeStep(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      runId: first?.run.id ?? '',
      stepId: 'extract',
      completedJobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d11',
    })).rejects.toThrow(/not bound to the completed job/);

    await service.completeStep(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      runId: first?.run.id ?? '',
      stepId: 'extract',
      completedJobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
    });
    await service.completeStep(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      runId: first?.run.id ?? '',
      stepId: 'extract',
      completedJobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
    });

    expect(workflowRepository.steps).toEqual([
      expect.objectContaining({ stepId: 'extract', state: 'completed', jobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d10' }),
      expect.objectContaining({ stepId: 'transform', state: 'running', jobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d11' }),
    ]);
    expect(jobRepository.jobs.map((job) => job.idempotencyKey)).toEqual([
      `workflow-step:${first?.run.id}:extract`,
      `workflow-step:${first?.run.id}:transform`,
    ]);
  });

  it('pauses and resumes workflow runs through the public API with audit and delayed step activation', async () => {
    const workflowRepository = new InMemoryWorkflowRepository();
    const jobRepository = new InMemoryJobRepository();
    const auditSink = new RecordingAuditSink();
    const jobService = new JobService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d11',
      ]),
      now: () => new Date('2026-05-15T13:00:00.000Z'),
      repository: jobRepository,
    });
    const service = new WorkflowService({
      auditSink,
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d11',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d12',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d13',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d14',
      ]),
      jobActivator: async ({ idempotencyKey, request, scope }) => jobService.createJob(
        { ...workflowAuth, permissions: [...workflowAuth.permissions, 'jobs:create'] },
        { ...scope, idempotencyKey, request },
      ),
      now: () => new Date('2026-05-15T13:00:00.000Z'),
      repository: workflowRepository,
    });
    const app = createApp({ apiAuthProvider: createFixedApiAuthProvider(workflowAuth), workflowService: service });
    const unauthorizedApp = createApp({
      apiAuthProvider: createFixedApiAuthProvider({
        ...workflowAuth,
        permissions: workflowAuth.permissions.filter((permission) => permission !== 'workflows:start'),
      }),
      workflowService: service,
    });
    const workflow = await service.createWorkflow(workflowAuth, {
      tenantId,
      projectId,
      request: {
        slug: 'pause-resume',
        name: 'Pause Resume',
        draftGraph: {
          nodes: [{ id: 'extract', type: 'job' }, { id: 'transform', type: 'job' }],
          edges: [{ from: 'extract', to: 'transform' }],
        },
      },
    });
    await service.publishWorkflow(workflowAuth, { tenantId, projectId, workflowId: workflow.id });
    const started = await service.startRun(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      idempotencyKey: 'workflow-run:pause-1',
      request: {},
    });
    const runId = started?.run.id ?? '';

    const unauthorizedPauseResponse = await unauthorizedApp.request(`/api/v1/workflows/${workflow.id}/runs/${runId}/pause`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    const unauthorizedResumeResponse = await unauthorizedApp.request(`/api/v1/workflows/${workflow.id}/runs/${runId}/resume`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    const pauseResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs/${runId}/pause`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    const paused = workflowRunResponseSchema.parse(await pauseResponse.json());

    await service.completeStep(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      runId,
      stepId: 'extract',
      completedJobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
    });

    expect(unauthorizedPauseResponse.status).toBe(403);
    expect(unauthorizedResumeResponse.status).toBe(403);
    expect(pauseResponse.status).toBe(200);
    expect(paused.run).toMatchObject({ id: runId, state: 'paused' });
    expect(workflowRepository.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: 'extract', state: 'completed', jobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d10' }),
      expect.objectContaining({ stepId: 'transform', state: 'pending', jobId: null }),
    ]));
    expect(jobRepository.jobs.map((job) => job.idempotencyKey)).toEqual([`workflow-step:${runId}:extract`]);

    const resumeResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs/${runId}/resume`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    const resumed = workflowRunResponseSchema.parse(await resumeResponse.json());

    expect(resumeResponse.status).toBe(200);
    expect(resumed.run).toMatchObject({ id: runId, state: 'running' });
    expect(workflowRepository.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: 'transform', state: 'running', jobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d11' }),
    ]));
    expect(jobRepository.jobs.map((job) => job.idempotencyKey)).toEqual([
      `workflow-step:${runId}:extract`,
      `workflow-step:${runId}:transform`,
    ]);
    expect(auditSink.events).toEqual([
      expect.objectContaining({ action: 'workflow.run.paused', resourceType: 'workflow_run', resourceId: runId }),
      expect.objectContaining({ action: 'workflow.run.resumed', resourceType: 'workflow_run', resourceId: runId }),
    ]);
  });

  it('checks latest run state before activating newly ready steps after completion', async () => {
    class PausingWorkflowRepository extends InMemoryWorkflowRepository {
      override async updateStep(input: Parameters<InMemoryWorkflowRepository['updateStep']>[0]) {
        const updated = await super.updateStep(input);

        if (updated?.stepId === 'extract' && updated.state === 'completed') {
          const run = this.runs.find((candidate) => candidate.id === updated.runId);
          if (run !== undefined) {
            await this.updateRunState({
              tenantId: run.tenantId,
              projectId: run.projectId,
              workflowId: run.workflowId,
              runId: run.id,
              state: 'paused',
              updatedAt: input.updatedAt,
            });
          }
        }

        return updated;
      }
    }

    const workflowRepository = new PausingWorkflowRepository();
    const jobRepository = new InMemoryJobRepository();
    const jobService = new JobService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d11',
      ]),
      now: () => new Date('2026-05-15T13:00:00.000Z'),
      repository: jobRepository,
    });
    const service = new WorkflowService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d11',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d12',
      ]),
      jobActivator: async ({ idempotencyKey, request, scope }) => jobService.createJob(
        { ...workflowAuth, permissions: [...workflowAuth.permissions, 'jobs:create'] },
        { ...scope, idempotencyKey, request },
      ),
      now: () => new Date('2026-05-15T13:00:00.000Z'),
      repository: workflowRepository,
    });
    const workflow = await service.createWorkflow(workflowAuth, {
      tenantId,
      projectId,
      request: {
        slug: 'pause-race',
        name: 'Pause Race',
        draftGraph: {
          nodes: [{ id: 'extract', type: 'job' }, { id: 'transform', type: 'job' }],
          edges: [{ from: 'extract', to: 'transform' }],
        },
      },
    });
    await service.publishWorkflow(workflowAuth, { tenantId, projectId, workflowId: workflow.id });
    const started = await service.startRun(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      idempotencyKey: 'workflow-run:pause-race-1',
      request: {},
    });
    const runId = started?.run.id ?? '';

    await service.completeStep(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      runId,
      stepId: 'extract',
      completedJobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
    });

    expect(workflowRepository.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: runId, state: 'paused' }),
    ]));
    expect(workflowRepository.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: 'transform', state: 'pending', jobId: null }),
    ]));
    expect(jobRepository.jobs.map((job) => job.idempotencyKey)).toEqual([`workflow-step:${runId}:extract`]);
  });

  it('does not reactivate terminal workflow runs through pause and resume controls', async () => {
    const { app, repository, service } = createWorkflowsApp();
    const workflow = await service.createWorkflow(workflowAuth, {
      tenantId,
      projectId,
      request: {
        slug: 'terminal-pause',
        name: 'Terminal Pause',
        draftGraph: { nodes: [{ id: 'done', type: 'job' }], edges: [] },
      },
    });
    await service.publishWorkflow(workflowAuth, { tenantId, projectId, workflowId: workflow.id });
    const started = await service.startRun(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      idempotencyKey: 'workflow-run:terminal-pause-1',
      request: {},
    });
    const runId = started?.run.id ?? '';
    await repository.updateRunState({
      tenantId,
      projectId,
      workflowId: workflow.id,
      runId,
      state: 'completed',
      updatedAt: '2026-05-15T13:00:00.000Z',
    });

    const pauseResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs/${runId}/pause`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    const paused = workflowRunResponseSchema.parse(await pauseResponse.json());
    const resumeResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs/${runId}/resume`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    const resumed = workflowRunResponseSchema.parse(await resumeResponse.json());

    expect(pauseResponse.status).toBe(200);
    expect(resumeResponse.status).toBe(200);
    expect(paused.run.state).toBe('completed');
    expect(resumed.run.state).toBe('completed');
  });

  it('puts ready wait_signal steps into waiting_for_signal and resumes them once through the public signal API', async () => {
    const workflowRepository = new InMemoryWorkflowRepository();
    const jobRepository = new InMemoryJobRepository();
    const jobService = new JobService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d11',
      ]),
      now: () => new Date('2026-05-15T13:00:00.000Z'),
      repository: jobRepository,
    });
    const service = new WorkflowService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d11',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d12',
      ]),
      jobActivator: async ({ idempotencyKey, request, scope }) => jobService.createJob(
        { ...workflowAuth, permissions: [...workflowAuth.permissions, 'jobs:create'] },
        { ...scope, idempotencyKey, request },
      ),
      now: () => new Date('2026-05-15T13:00:00.000Z'),
      repository: workflowRepository,
    });
    const app = createApp({ apiAuthProvider: createFixedApiAuthProvider(workflowAuth), workflowService: service });
    const workflow = await service.createWorkflow(workflowAuth, {
      tenantId,
      projectId,
      request: {
        slug: 'signal-resume',
        name: 'Signal Resume',
        draftGraph: {
          nodes: [
            { id: 'collect', type: 'job' },
            { id: 'approval', type: 'wait_signal' },
            { id: 'ship', type: 'job' },
          ],
          edges: [
            { from: 'collect', to: 'approval' },
            { from: 'approval', to: 'ship' },
          ],
        },
      },
    });
    await service.publishWorkflow(workflowAuth, { tenantId, projectId, workflowId: workflow.id });
    const started = await service.startRun(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      idempotencyKey: 'workflow-run:signal-1',
      request: {},
    });
    const runId = started?.run.id ?? '';

    const earlySignalResponse = await app.request(`/api/v1/signals/${workflow.id}`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ runId, stepId: 'approval', payload: { decision: 'too-early' } }),
    });

    expect(earlySignalResponse.status).toBe(404);
    expect(workflowRepository.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: 'approval', type: 'wait_signal', state: 'pending', jobId: null }),
      expect.objectContaining({ stepId: 'ship', type: 'job', state: 'pending', jobId: null }),
    ]));

    await service.completeStep(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      runId,
      stepId: 'collect',
      completedJobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
    });

    expect(workflowRepository.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: 'approval', type: 'wait_signal', state: 'waiting_for_signal', jobId: null }),
      expect.objectContaining({ stepId: 'ship', type: 'job', state: 'pending', jobId: null }),
    ]));

    const signalResponse = await app.request(`/api/v1/signals/${workflow.id}`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ runId, stepId: 'approval', payload: { decision: 'approved' } }),
    });
    const duplicateSignalResponse = await app.request(`/api/v1/signals/${workflow.id}`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ runId, stepId: 'approval', payload: { decision: 'approved' } }),
    });
    const wrongTenantApp = createApp({
      apiAuthProvider: createFixedApiAuthProvider({
        ...workflowAuth,
        tenantId: '01890f42-98c4-7cc3-8a5e-0c567f1d3a79',
        projectId: '01890f42-98c4-7cc3-9a5e-0c567f1d3a80',
      }),
      workflowService: service,
    });
    const wrongTenantResponse = await wrongTenantApp.request(`/api/v1/signals/${workflow.id}`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ runId, stepId: 'approval' }),
    });

    expect(signalResponse.status).toBe(202);
    expect(workflowSignalResponseSchema.parse(await signalResponse.json())).toMatchObject({
      duplicate: false,
      step: { stepId: 'approval', state: 'completed', metadata: { signalPayload: { decision: 'approved' } } },
    });
    expect(duplicateSignalResponse.status).toBe(200);
    expect(workflowSignalResponseSchema.parse(await duplicateSignalResponse.json())).toMatchObject({
      duplicate: true,
      step: { stepId: 'approval', state: 'completed', metadata: { signalPayload: { decision: 'approved' } } },
    });
    expect(wrongTenantResponse.status).toBe(404);
    expect(workflowRepository.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: 'approval', state: 'completed', jobId: null }),
      expect.objectContaining({ stepId: 'ship', state: 'running', jobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d11' }),
    ]));
    expect(jobRepository.jobs.map((job) => job.idempotencyKey)).toEqual([
      `workflow-step:${runId}:collect`,
      `workflow-step:${runId}:ship`,
    ]);
  });

  it('puts ready approval steps into waiting_for_approval and completes them once through the public approval API with audit', async () => {
    const workflowRepository = new InMemoryWorkflowRepository();
    const jobRepository = new InMemoryJobRepository();
    const auditSink = new RecordingAuditSink();
    const jobService = new JobService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d11',
      ]),
      now: () => new Date('2026-05-15T13:00:00.000Z'),
      repository: jobRepository,
    });
    const service = new WorkflowService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d11',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d12',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d13',
      ]),
      auditSink,
      jobActivator: async ({ idempotencyKey, request, scope }) => jobService.createJob(
        { ...workflowAuth, permissions: [...workflowAuth.permissions, 'jobs:create'] },
        { ...scope, idempotencyKey, request },
      ),
      now: () => new Date('2026-05-15T13:00:00.000Z'),
      repository: workflowRepository,
    });
    const app = createApp({ apiAuthProvider: createFixedApiAuthProvider(workflowAuth), workflowService: service });
    const workflow = await service.createWorkflow(workflowAuth, {
      tenantId,
      projectId,
      request: {
        slug: 'approval-resume',
        name: 'Approval Resume',
        draftGraph: {
          nodes: [
            { id: 'collect', type: 'job' },
            { id: 'manager-approval', type: 'approval' },
            { id: 'ship', type: 'job' },
          ],
          edges: [
            { from: 'collect', to: 'manager-approval' },
            { from: 'manager-approval', to: 'ship' },
          ],
        },
      },
    });
    await service.publishWorkflow(workflowAuth, { tenantId, projectId, workflowId: workflow.id });
    const started = await service.startRun(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      idempotencyKey: 'workflow-run:approval-1',
      request: {},
    });
    const runId = started?.run.id ?? '';

    const earlyApprovalResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs/${runId}/approvals/manager-approval`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ decision: 'approved', payload: { reason: 'too-early' } }),
    });

    expect(earlyApprovalResponse.status).toBe(404);

    await service.completeStep(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      runId,
      stepId: 'collect',
      completedJobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
    });

    expect(workflowRepository.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: 'manager-approval', type: 'approval', state: 'waiting_for_approval', jobId: null }),
      expect.objectContaining({ stepId: 'ship', type: 'job', state: 'pending', jobId: null }),
    ]));

    const approvalResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs/${runId}/approvals/manager-approval`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ decision: 'approved', payload: { approverNote: 'ok' } }),
    });
    const duplicateApprovalResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs/${runId}/approvals/manager-approval`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ decision: 'approved', payload: { approverNote: 'ok' } }),
    });
    const unauthorizedApp = createApp({
      apiAuthProvider: createFixedApiAuthProvider({ ...workflowAuth, permissions: workflowAuth.permissions.filter((permission) => permission !== 'workflows:start') }),
      workflowService: service,
    });
    const unauthorizedResponse = await unauthorizedApp.request(`/api/v1/workflows/${workflow.id}/runs/${runId}/approvals/manager-approval`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ decision: 'approved' }),
    });

    expect(approvalResponse.status).toBe(202);
    expect(workflowApprovalResponseSchema.parse(await approvalResponse.json())).toMatchObject({
      duplicate: false,
      step: {
        stepId: 'manager-approval',
        state: 'completed',
        metadata: { approvalDecision: 'approved', approvalPayload: { approverNote: 'ok' } },
      },
    });
    expect(duplicateApprovalResponse.status).toBe(200);
    expect(workflowApprovalResponseSchema.parse(await duplicateApprovalResponse.json())).toMatchObject({ duplicate: true });
    expect(unauthorizedResponse.status).toBe(403);
    expect(workflowRepository.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: 'manager-approval', state: 'completed', jobId: null }),
      expect.objectContaining({ stepId: 'ship', state: 'running', jobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d11' }),
    ]));
    expect(auditSink.events).toEqual([
      expect.objectContaining({
        action: 'workflow.approval.completed',
        resourceType: 'workflow_step',
        resourceId: 'manager-approval',
        metadata: expect.objectContaining({ workflowId: workflow.id, runId, decision: 'approved' }),
      }),
    ]);
  });

  it('preserves signal and approval waits across service restart with idempotent external actions', async () => {
    const workflowRepository = new InMemoryWorkflowRepository();
    const jobRepository = new InMemoryJobRepository();
    const jobService = new JobService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d11',
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d12',
      ]),
      now: () => new Date('2026-05-15T13:00:00.000Z'),
      repository: jobRepository,
    });
    const createWorkflowService = () => new WorkflowService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d11',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d12',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d13',
      ]),
      jobActivator: async ({ idempotencyKey, request, scope }) => jobService.createJob(
        { ...workflowAuth, permissions: [...workflowAuth.permissions, 'jobs:create'] },
        { ...scope, idempotencyKey, request },
      ),
      now: () => new Date('2026-05-15T13:00:00.000Z'),
      repository: workflowRepository,
    });
    const firstRuntime = createWorkflowService();
    const workflow = await firstRuntime.createWorkflow(workflowAuth, {
      tenantId,
      projectId,
      request: {
        slug: 'restart-waits',
        name: 'Restart Waits',
        draftGraph: {
          nodes: [
            { id: 'collect', type: 'job' },
            { id: 'customer-signal', type: 'wait_signal' },
            { id: 'manager-approval', type: 'approval' },
            { id: 'ship', type: 'job' },
          ],
          edges: [
            { from: 'collect', to: 'customer-signal' },
            { from: 'customer-signal', to: 'manager-approval' },
            { from: 'manager-approval', to: 'ship' },
          ],
        },
      },
    });
    await firstRuntime.publishWorkflow(workflowAuth, { tenantId, projectId, workflowId: workflow.id });
    const started = await firstRuntime.startRun(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      idempotencyKey: 'workflow-run:restart-waits-1',
      request: {},
    });
    const runId = started?.run.id ?? '';

    await firstRuntime.completeStep(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      runId,
      stepId: 'collect',
      completedJobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
    });

    const restartedRuntime = createWorkflowService();
    const restartedApp = createApp({ apiAuthProvider: createFixedApiAuthProvider(workflowAuth), workflowService: restartedRuntime });
    const signalResponse = await restartedApp.request(`/api/v1/signals/${workflow.id}`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ runId, stepId: 'customer-signal', payload: { received: true } }),
    });
    const duplicateSignalResponse = await restartedApp.request(`/api/v1/signals/${workflow.id}`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ runId, stepId: 'customer-signal', payload: { received: true } }),
    });
    const wrongTenantApp = createApp({
      apiAuthProvider: createFixedApiAuthProvider({
        ...workflowAuth,
        tenantId: '01890f42-98c4-7cc3-8a5e-0c567f1d3a79',
        projectId: '01890f42-98c4-7cc3-9a5e-0c567f1d3a80',
      }),
      workflowService: restartedRuntime,
    });
    const wrongTenantApprovalResponse = await wrongTenantApp.request(`/api/v1/workflows/${workflow.id}/runs/${runId}/approvals/manager-approval`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ decision: 'approved' }),
    });
    const approvalResponse = await restartedApp.request(`/api/v1/workflows/${workflow.id}/runs/${runId}/approvals/manager-approval`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ decision: 'approved', payload: { restarted: true } }),
    });
    const duplicateApprovalResponse = await restartedApp.request(`/api/v1/workflows/${workflow.id}/runs/${runId}/approvals/manager-approval`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ decision: 'approved', payload: { restarted: true } }),
    });

    expect(signalResponse.status).toBe(202);
    expect(duplicateSignalResponse.status).toBe(200);
    expect(wrongTenantApprovalResponse.status).toBe(404);
    expect(approvalResponse.status).toBe(202);
    expect(duplicateApprovalResponse.status).toBe(200);
    expect(workflowRepository.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: 'customer-signal', state: 'completed' }),
      expect.objectContaining({ stepId: 'manager-approval', state: 'completed' }),
      expect.objectContaining({ stepId: 'ship', state: 'running', jobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d11' }),
    ]));
    expect(jobRepository.jobs.map((job) => job.idempotencyKey)).toEqual([
      `workflow-step:${runId}:collect`,
      `workflow-step:${runId}:ship`,
    ]);
  });

  it('persists timer wake-up timestamps and resumes due timers after restart exactly once', async () => {
    const workflowRepository = new InMemoryWorkflowRepository();
    const jobRepository = new InMemoryJobRepository();
    const jobService = new JobService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
      ]),
      now: () => new Date('2026-05-15T13:05:00.000Z'),
      repository: jobRepository,
    });
    let now = new Date('2026-05-15T13:00:00.000Z');
    const createWorkflowService = () => new WorkflowService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d11',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d12',
      ]),
      jobActivator: async ({ idempotencyKey, request, scope }) => jobService.createJob(
        { ...workflowAuth, permissions: [...workflowAuth.permissions, 'jobs:create'] },
        { ...scope, idempotencyKey, request },
      ),
      now: () => now,
      repository: workflowRepository,
    });
    const firstRuntime = createWorkflowService();
    const workflow = await firstRuntime.createWorkflow(workflowAuth, {
      tenantId,
      projectId,
      request: {
        slug: 'timer-wakeup',
        name: 'Timer Wakeup',
        draftGraph: {
          nodes: [
            { id: 'sleep', type: 'timer', wakeAt: '2026-05-15T13:05:00.000Z' },
            { id: 'ship', type: 'job' },
          ],
          edges: [{ from: 'sleep', to: 'ship' }],
        },
      },
    });
    await firstRuntime.publishWorkflow(workflowAuth, { tenantId, projectId, workflowId: workflow.id });
    const started = await firstRuntime.startRun(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      idempotencyKey: 'workflow-run:timer-1',
      request: {},
    });
    const runId = started?.run.id ?? '';

    expect(workflowRepository.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stepId: 'sleep',
        type: 'timer',
        state: 'waiting_for_timer',
        metadata: { timerWakeAt: '2026-05-15T13:05:00.000Z' },
      }),
      expect.objectContaining({ stepId: 'ship', type: 'job', state: 'pending', jobId: null }),
    ]));
    expect(jobRepository.jobs).toHaveLength(0);

    now = new Date('2026-05-15T13:04:59.000Z');
    await expect(firstRuntime.wakeDueTimers(workflowAuth, { tenantId, projectId })).resolves.toEqual({ completed: 0 });

    now = new Date('2026-05-15T13:05:00.000Z');
    const restartedRuntime = createWorkflowService();
    await expect(restartedRuntime.wakeDueTimers(workflowAuth, { tenantId, projectId })).resolves.toEqual({ completed: 1 });
    await expect(restartedRuntime.wakeDueTimers(workflowAuth, { tenantId, projectId })).resolves.toEqual({ completed: 0 });

    expect(workflowRepository.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stepId: 'sleep',
        state: 'completed',
        metadata: { timerWakeAt: '2026-05-15T13:05:00.000Z', timerWokenAt: '2026-05-15T13:05:00.000Z' },
      }),
      expect.objectContaining({ stepId: 'ship', state: 'running', jobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d10' }),
    ]));
    expect(jobRepository.jobs.map((job) => job.idempotencyKey)).toEqual([`workflow-step:${runId}:ship`]);
  });

  it('activates fan-out branches and advances a fan-in join only after all dependencies complete', async () => {
    const workflowRepository = new InMemoryWorkflowRepository();
    const jobRepository = new InMemoryJobRepository();
    const jobService = new JobService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d11',
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d12',
        '01890f42-98c4-7cc3-bb5e-0c567f1d3d13',
      ]),
      now: () => new Date('2026-05-15T13:00:00.000Z'),
      repository: jobRepository,
    });
    const service = new WorkflowService({
      generateId: createIdGenerator([
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d11',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3d12',
      ]),
      jobActivator: async ({ idempotencyKey, request, scope }) => jobService.createJob(
        { ...workflowAuth, permissions: [...workflowAuth.permissions, 'jobs:create'] },
        { ...scope, idempotencyKey, request },
      ),
      now: () => new Date('2026-05-15T13:00:00.000Z'),
      repository: workflowRepository,
    });
    const workflow = await service.createWorkflow(workflowAuth, {
      tenantId,
      projectId,
      request: {
        slug: 'fan-out-fan-in-runtime',
        name: 'Fan Out Fan In Runtime',
        draftGraph: {
          nodes: [
            { id: 'start', type: 'job' },
            { id: 'branch-a', type: 'job' },
            { id: 'branch-b', type: 'job' },
            { id: 'join', type: 'join' },
            { id: 'done', type: 'job' },
          ],
          edges: [
            { from: 'start', to: 'branch-a' },
            { from: 'start', to: 'branch-b' },
            { from: 'branch-a', to: 'join' },
            { from: 'branch-b', to: 'join' },
            { from: 'join', to: 'done' },
          ],
        },
      },
    });
    await service.publishWorkflow(workflowAuth, { tenantId, projectId, workflowId: workflow.id });

    const started = await service.startRun(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      idempotencyKey: 'workflow-run:fan-in-1',
      request: {},
    });
    const runId = started?.run.id ?? '';

    expect(jobRepository.jobs.map((job) => job.metadata.workflowStepId)).toEqual(['start']);

    await service.completeStep(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      runId,
      stepId: 'start',
      completedJobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d10',
    });

    expect(jobRepository.jobs.map((job) => job.metadata.workflowStepId)).toEqual(['start', 'branch-a', 'branch-b']);

    await service.completeStep(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      runId,
      stepId: 'branch-a',
      completedJobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d11',
    });

    expect(workflowRepository.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: 'join', state: 'pending', jobId: null }),
      expect.objectContaining({ stepId: 'done', state: 'pending', jobId: null }),
    ]));

    await service.completeStep(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      runId,
      stepId: 'branch-b',
      completedJobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d12',
    });
    await service.completeStep(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      runId,
      stepId: 'branch-b',
      completedJobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d12',
    });

    expect(workflowRepository.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: 'join', state: 'completed', jobId: null }),
      expect.objectContaining({ stepId: 'done', state: 'running', jobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d13' }),
    ]));
    expect(jobRepository.jobs.map((job) => job.idempotencyKey)).toEqual([
      `workflow-step:${runId}:start`,
      `workflow-step:${runId}:branch-a`,
      `workflow-step:${runId}:branch-b`,
      `workflow-step:${runId}:done`,
    ]);
  });

  it('publishes a valid static fan-out fan-in workflow DAG', async () => {
    const { app } = createWorkflowsApp();
    const graph = {
      nodes: [
        { id: 'start', type: 'job' },
        { id: 'branch-a', type: 'job' },
        { id: 'branch-b', type: 'timer', wakeAt: '2026-05-15T13:05:00.000Z' },
        { id: 'join', type: 'join' },
        { id: 'done', type: 'completion' },
      ],
      edges: [
        { from: 'start', to: 'branch-a' },
        { from: 'start', to: 'branch-b' },
        { from: 'branch-a', to: 'join' },
        { from: 'branch-b', to: 'join' },
        { from: 'join', to: 'done' },
      ],
    };
    const createdResponse = await app.request('/api/v1/workflows', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ slug: 'fan-in-valid', name: 'Fan In Valid', draftGraph: graph }),
    });
    const workflow = workflowResponseSchema.parse(await createdResponse.json()).workflow;

    const publishedResponse = await app.request(`/api/v1/workflows/${workflow.id}/publish`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });

    expect(publishedResponse.status).toBe(201);
    expect(workflowVersionResponseSchema.parse(await publishedResponse.json()).version.graph).toEqual(graph);
  });

  it('rejects invalid static workflow DAGs before publishing a version', async () => {
    const invalidGraphs = [
      {
        name: 'cycles',
        graph: {
          nodes: [{ id: 'review' }, { id: 'approve' }],
          edges: [{ from: 'review', to: 'approve' }, { from: 'approve', to: 'review' }],
        },
        issue: 'cycle',
      },
      {
        name: 'missing dependencies',
        graph: {
          nodes: [{ id: 'review' }],
          edges: [{ from: 'review', to: 'approve' }],
        },
        issue: 'missing node',
      },
      {
        name: 'unsupported step types',
        graph: {
          nodes: [{ id: 'review', type: 'dynamic_runtime_step' }],
          edges: [],
        },
        issue: 'unsupported step type',
      },
      {
        name: 'invalid joins',
        graph: {
          nodes: [{ id: 'review' }, { id: 'join', type: 'join' }],
          edges: [{ from: 'review', to: 'join' }],
        },
        issue: 'join step',
      },
      {
        name: 'timer without wakeAt',
        graph: {
          nodes: [{ id: 'sleep', type: 'timer' }],
          edges: [],
        },
        issue: 'ISO wakeAt timestamp',
      },
    ] as const;

    for (const { name, graph, issue } of invalidGraphs) {
      const { app, repository } = createWorkflowsApp();
      const createdResponse = await app.request('/api/v1/workflows', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ slug: `invalid-${name.replaceAll(' ', '-')}`, name: `Invalid ${name}`, draftGraph: graph }),
      });
      const workflow = workflowResponseSchema.parse(await createdResponse.json()).workflow;

      const publishResponse = await app.request(`/api/v1/workflows/${workflow.id}/publish`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      });

      expect(publishResponse.status).toBe(400);
      await expect(publishResponse.json()).resolves.toMatchObject({
        error: 'invalid_workflow_graph',
        details: expect.arrayContaining([expect.stringContaining(issue)]),
      });
      expect(repository.versions).toHaveLength(0);
    }
  });

  it('rejects persisted invalid workflow version graphs before starting a run', async () => {
    const { app, repository } = createWorkflowsApp();
    const createdResponse = await app.request('/api/v1/workflows', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ slug: 'legacy-invalid-version', name: 'Legacy Invalid Version', draftGraph: { nodes: [{ id: 'start' }], edges: [] } }),
    });
    const workflow = workflowResponseSchema.parse(await createdResponse.json()).workflow;
    repository.versions.push({
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d90',
      tenantId,
      projectId,
      workflowId: workflow.id,
      versionNumber: 1,
      graph: { nodes: [{ id: 'start' }, { id: 'later' }], edges: [{ from: 'later', to: 'start' }, { from: 'start', to: 'later' }] },
      metadata: {},
      publishedAt: '2026-05-15T13:00:00.000Z',
      createdAt: '2026-05-15T13:00:00.000Z',
    });

    const runResponse = await app.request(`/api/v1/workflows/${workflow.id}/runs`, {
      method: 'POST',
      headers: { ...jsonHeaders, 'idempotency-key': 'workflow-run:invalid-version' },
      body: JSON.stringify({}),
    });

    expect(runResponse.status).toBe(400);
    await expect(runResponse.json()).resolves.toMatchObject({
      error: 'invalid_workflow_graph',
      details: expect.arrayContaining([expect.stringContaining('cycle')]),
    });
    expect(repository.runs).toHaveLength(0);
    expect(repository.runtimeEvents).toHaveLength(0);
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
