import { serve } from '@hono/node-server';

import { createHelixDatabase } from '../db/client.js';
import {
  AgentAuthService,
  KyselyAgentRepository,
} from '../features/agents/agent-auth.js';
import {
  KyselyProjectApiKeyRepository,
  ProjectApiKeyService,
} from '../features/iam/project-api-keys.js';
import type { SecurityAuditSink } from '../features/iam/security-audit.js';
import { KyselyJobRepository, JobService } from '../features/jobs/job-service.js';
import {
  KyselyProcessorRegistryRepository,
  ProcessorRegistryService,
} from '../features/processors/processor-registry.js';
import { KyselyWorkflowRepository, WorkflowService } from '../features/workflows/workflow-service.js';
import {
  createApiAuthProvider,
  createApp,
  type CreateAppOptions,
} from './app.js';

export interface StartServerInput {
  readonly port?: number;
  readonly appOptions?: CreateAppOptions;
}

export function startServer(input: StartServerInput = {}) {
  const port = input.port ?? Number.parseInt(process.env.PORT ?? '3000', 10);

  return serve({
    fetch: createApp(input.appOptions ?? createDefaultAppOptions()).fetch,
    port,
  });
}

function createDefaultAppOptions(): CreateAppOptions {
  const db = createHelixDatabase();
  const auditSink = new NoopSecurityAuditSink();
  const projectApiKeyService = new ProjectApiKeyService({
    auditSink,
    repository: new KyselyProjectApiKeyRepository(db),
  });
  const agentAuthService = new AgentAuthService({
    auditSink,
    repository: new KyselyAgentRepository(db),
  });

  const processorRepository = new KyselyProcessorRegistryRepository(db);

  const runtimeServices: { jobService?: JobService } = {};
  const workflowService = new WorkflowService({
    jobActivator: async ({ idempotencyKey, request, scope }) => {
      if (runtimeServices.jobService === undefined) {
        throw new Error('Job service is not configured.');
      }

      return runtimeServices.jobService.createJob(
        {
          tenantId: scope.tenantId,
          projectId: scope.projectId,
          principal: { type: 'service', id: 'workflow-runtime' },
          permissions: ['jobs:create'],
        },
        { ...scope, idempotencyKey, request },
      );
    },
    repository: new KyselyWorkflowRepository(db),
  });
  const jobService = new JobService({
    onJobCompleted: async (job) => {
      const workflowId = typeof job.metadata.workflowId === 'string' ? job.metadata.workflowId : null;
      const workflowRunId = typeof job.metadata.workflowRunId === 'string' ? job.metadata.workflowRunId : null;
      const workflowStepId = typeof job.metadata.workflowStepId === 'string' ? job.metadata.workflowStepId : null;

      if (workflowId === null || workflowRunId === null || workflowStepId === null) {
        return;
      }

      await workflowService.completeStep(
        {
          tenantId: job.tenantId,
          projectId: job.projectId,
          principal: { type: 'service', id: 'workflow-runtime' },
          permissions: ['workflows:start'],
        },
        {
          tenantId: job.tenantId,
          projectId: job.projectId,
          workflowId,
          runId: workflowRunId,
          stepId: workflowStepId,
          completedJobId: job.id,
        },
      );
    },
    processorRepository,
    repository: new KyselyJobRepository(db),
  });
  runtimeServices.jobService = jobService;

  return {
    apiAuthProvider: createApiAuthProvider({
      projectApiKeyAuthenticator: projectApiKeyService,
      agentTokenAuthenticator: agentAuthService,
    }),
    jobService,
    processorRegistryService: new ProcessorRegistryService({
      auditSink,
      repository: processorRepository,
    }),
    workflowService,
  };
}

class NoopSecurityAuditSink implements SecurityAuditSink {
  async record(): Promise<void> {
    return;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
