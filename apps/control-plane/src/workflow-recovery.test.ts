import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@helix/contracts';

import { InMemoryJobRepository, JobService } from './features/jobs/job-service.js';
import {
  InMemoryWorkflowRepository,
  WorkflowService,
} from './features/workflows/workflow-service.js';

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

describe('workflow recovery', () => {
  it('resumes persisted ready steps after restart without duplicating completed work or run events', async () => {
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
        slug: 'workflow-recovery',
        name: 'Workflow Recovery',
        draftGraph: {
          nodes: [
            { id: 'start', type: 'job' },
            { id: 'branch-a', type: 'job' },
            { id: 'branch-b', type: 'job' },
          ],
          edges: [
            { from: 'start', to: 'branch-a' },
            { from: 'start', to: 'branch-b' },
          ],
        },
      },
    });
    await firstRuntime.publishWorkflow(workflowAuth, { tenantId, projectId, workflowId: workflow.id });
    const started = await firstRuntime.startRun(workflowAuth, {
      tenantId,
      projectId,
      workflowId: workflow.id,
      idempotencyKey: 'workflow-run:recovery-1',
      request: {},
    });
    const runId = started?.run.id ?? '';

    await workflowRepository.updateStep({
      tenantId,
      projectId,
      runId,
      stepId: 'start',
      state: 'completed',
      updatedAt: '2026-05-15T13:01:00.000Z',
    });
    const runEventCountBeforeRecovery = workflowRepository.runtimeEvents.length;

    const restartedRuntime = createWorkflowService();
    await restartedRuntime.resumeRun(workflowAuth, { tenantId, projectId, workflowId: workflow.id, runId });
    await restartedRuntime.resumeRun(workflowAuth, { tenantId, projectId, workflowId: workflow.id, runId });

    expect(workflowRepository.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepId: 'start', state: 'completed', jobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d10' }),
      expect.objectContaining({ stepId: 'branch-a', state: 'running', jobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d11' }),
      expect.objectContaining({ stepId: 'branch-b', state: 'running', jobId: '01890f42-98c4-7cc3-bb5e-0c567f1d3d12' }),
    ]));
    expect(jobRepository.jobs.map((job) => job.idempotencyKey)).toEqual([
      `workflow-step:${runId}:start`,
      `workflow-step:${runId}:branch-a`,
      `workflow-step:${runId}:branch-b`,
    ]);
    expect(jobRepository.runtimeEvents.map((event) => event.eventType)).toEqual([
      'job.created',
      'job.ready',
      'job.created',
      'job.ready',
      'job.created',
      'job.ready',
    ]);
    expect(workflowRepository.runtimeEvents).toHaveLength(runEventCountBeforeRecovery);
  });
});
