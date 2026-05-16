import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import {
  claimJobRequestSchema,
  completeJobAttemptRequestSchema,
  createJobRequestSchema,
  createWorkflowRequestSchema,
  completeWorkflowApprovalRequestSchema,
  createScheduleRequestSchema,
  deliverWorkflowSignalRequestSchema,
  failJobAttemptRequestSchema,
  heartbeatLeaseRequestSchema,
  idempotencyKeySchema,
  pauseWorkflowRunRequestSchema,
  processorHeartbeatRequestSchema,
  reportJobProgressRequestSchema,
  publishWorkflowRequestSchema,
  registerProcessorRequestSchema,
  startWorkflowRunRequestSchema,
  resumeWorkflowRunRequestSchema,
  updateProcessorCapabilitiesRequestSchema,
  updateScheduleRequestSchema,
  updateWorkflowDraftRequestSchema,
  uuidV7Schema,
  type AuthContext,
  type Permission,
} from '@helix/contracts';

import { renderAdminDocumentStream } from '../entry-server.js';
import { UnmappedStripeCustomerError } from '../features/billing/billing-service.js';
import {
  StripeWebhookPayloadError,
  StripeWebhookSignatureError,
} from '../features/billing/stripe-adapter.js';
import type { BillingWebhookHandler } from '../features/billing/stripe-webhook.js';
import type { RuntimeEventStoreProjection, RuntimeEventStoreRow } from '../features/runtime/event-store.js';
import {
  createDefaultBrowserAuthProvider,
  hasValidCsrfToken,
  type BrowserAuthContext,
  type BrowserAuthProvider,
} from '../features/auth/browser-auth.js';
import { AuthorizationError, assertProjectPermission } from '../features/iam/authorization.js';
import {
  CustomRoleNotFoundError,
  CustomRolePrivilegeEscalationError,
  CustomRoleService,
  CustomRoleValidationError,
  DuplicateCustomRoleSlugError,
  InMemoryCustomRoleRepository,
  type CustomRoleRecord,
} from '../features/iam/custom-roles.js';
import type { SecurityAuditSink } from '../features/iam/security-audit.js';
import {
  AgentClaimRequiredError,
  StaleJobAttemptError,
  type JobService,
} from '../features/jobs/job-service.js';
import {
  WorkflowGraphValidationError,
  WorkflowRunIdempotencyConflictError,
  WorkflowVersionNotFoundError,
  type WorkflowService,
} from '../features/workflows/workflow-service.js';
import type { ScheduleService } from '../features/schedules/schedule-service.js';
import {
  ProcessorAgentRequiredError,
  ProcessorRegistrationNotFoundError,
  type ProcessorRegistryService,
} from '../features/processors/processor-registry.js';

type AppEnvironment = {
  Variables: {
    apiAuth: AuthContext;
    browserAuth: BrowserAuthContext;
  };
};

export interface ApiAuthRequest {
  readonly headers: Headers;
  readonly method: string;
  readonly url: URL;
}

export interface ApiAuthProvider {
  authenticate(request: ApiAuthRequest): Promise<AuthContext | null>;
}

export interface ProjectApiKeyAuthenticator {
  authenticateProjectApiKey(token: string): Promise<AuthContext | null>;
}

export interface AgentTokenAuthenticator {
  authenticateAgentToken(token: string): Promise<AuthContext | null>;
}

export function createApiAuthProvider(input: {
  readonly projectApiKeyAuthenticator?: ProjectApiKeyAuthenticator;
  readonly agentTokenAuthenticator?: AgentTokenAuthenticator;
}): ApiAuthProvider {
  return {
    async authenticate(request) {
      const token = getBearerToken(request.headers);

      if (token === null) {
        return null;
      }

      const projectAuth =
        (await input.projectApiKeyAuthenticator?.authenticateProjectApiKey(token)) ?? null;

      if (projectAuth !== null) {
        return projectAuth;
      }

      return (await input.agentTokenAuthenticator?.authenticateAgentToken(token)) ?? null;
    },
  };
}

export function createProjectApiKeyApiAuthProvider(
  authenticator: ProjectApiKeyAuthenticator,
): ApiAuthProvider {
  return createApiAuthProvider({ projectApiKeyAuthenticator: authenticator });
}

export interface CreateAppOptions {
  readonly apiAuthProvider?: ApiAuthProvider;
  readonly browserAuthProvider?: BrowserAuthProvider;
  readonly allowedBrowserOrigins?: readonly string[];
  readonly stripeBillingWebhookHandler?: BillingWebhookHandler;
  readonly customRoleService?: CustomRoleService;
  readonly jobService?: JobService;
  readonly workflowService?: WorkflowService;
  readonly scheduleService?: ScheduleService;
  readonly processorRegistryService?: ProcessorRegistryService;
  readonly runtimeEventStore?: RuntimeEventStoreProjection;
}

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const adminReadPermission = 'admin:read';

export function createApp(options: CreateAppOptions = {}): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>();
  const browserAuthProvider =
    options.browserAuthProvider ?? createDefaultBrowserAuthProvider(process.env);
  const browserSecurity = createBrowserSecurityMiddleware({
    allowedOrigins: options.allowedBrowserOrigins ?? [],
    browserAuthProvider,
  });
  const customRoleService =
    options.customRoleService ??
    new CustomRoleService({
      auditSink: new NoopSecurityAuditSink(),
      repository: new InMemoryCustomRoleRepository(),
    });
  const jobService = options.jobService;
  const workflowService = options.workflowService;
  const scheduleService = options.scheduleService;
  const processorRegistryService = options.processorRegistryService;
  const runtimeEventStore = options.runtimeEventStore;

  app.get('/health', (context) =>
    context.json({
      service: '@helix/control-plane',
      status: 'ok',
    }),
  );

  app.post('/webhooks/stripe', async (context) => {
    if (options.stripeBillingWebhookHandler === undefined) {
      return context.json({ error: 'stripe_webhook_not_configured' }, 503);
    }

    try {
      const result = await options.stripeBillingWebhookHandler.handle({
        rawBody: await context.req.text(),
        signatureHeader: context.req.header('stripe-signature') ?? null,
      });

      return context.json({ received: true, duplicate: result.duplicate });
    } catch (error) {
      if (
        error instanceof StripeWebhookSignatureError ||
        error instanceof StripeWebhookPayloadError
      ) {
        return context.json({ error: 'invalid_stripe_webhook' }, 400);
      }

      if (error instanceof UnmappedStripeCustomerError) {
        return context.json({ error: 'unmapped_stripe_customer' }, 422);
      }

      throw error;
    }
  });

  app.use('/api/v1/*', createApiAuthMiddleware(options.apiAuthProvider));

  app.post('/api/v1/schedules', async (context) => {
    if (scheduleService === undefined) {
      return context.json({ error: 'schedule_service_not_configured' }, 503);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = createScheduleRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_schedule_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const schedule = await scheduleService.createSchedule(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        request: request.data,
      });
      return context.json({ schedule }, 201);
    } catch (error) {
      return handleScheduleApiError(context, error);
    }
  });

  app.get('/api/v1/schedules', async (context) => {
    if (scheduleService === undefined) {
      return context.json({ error: 'schedule_service_not_configured' }, 503);
    }

    try {
      const authContext = context.get('apiAuth');
      const schedules = await scheduleService.listSchedules(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
      });
      return context.json({ schedules });
    } catch (error) {
      return handleScheduleApiError(context, error);
    }
  });

  app.get('/api/v1/schedules/:scheduleId', async (context) => {
    if (scheduleService === undefined) {
      return context.json({ error: 'schedule_service_not_configured' }, 503);
    }

    const scheduleId = uuidV7Schema.safeParse(context.req.param('scheduleId'));

    if (!scheduleId.success) {
      return context.json({ error: 'invalid_schedule_id' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const schedule = await scheduleService.getSchedule(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        scheduleId: scheduleId.data,
      });

      if (schedule === null) {
        return context.json({ error: 'schedule_not_found' }, 404);
      }

      return context.json({ schedule });
    } catch (error) {
      return handleScheduleApiError(context, error);
    }
  });

  app.patch('/api/v1/schedules/:scheduleId', async (context) => {
    if (scheduleService === undefined) {
      return context.json({ error: 'schedule_service_not_configured' }, 503);
    }

    const scheduleId = uuidV7Schema.safeParse(context.req.param('scheduleId'));

    if (!scheduleId.success) {
      return context.json({ error: 'invalid_schedule_id' }, 400);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = updateScheduleRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_schedule_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const schedule = await scheduleService.updateSchedule(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        scheduleId: scheduleId.data,
        request: request.data,
      });

      if (schedule === null) {
        return context.json({ error: 'schedule_not_found' }, 404);
      }

      return context.json({ schedule });
    } catch (error) {
      return handleScheduleApiError(context, error);
    }
  });

  app.delete('/api/v1/schedules/:scheduleId', async (context) => {
    if (scheduleService === undefined) {
      return context.json({ error: 'schedule_service_not_configured' }, 503);
    }

    const scheduleId = uuidV7Schema.safeParse(context.req.param('scheduleId'));

    if (!scheduleId.success) {
      return context.json({ error: 'invalid_schedule_id' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const deleted = await scheduleService.deleteSchedule(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        scheduleId: scheduleId.data,
      });

      if (!deleted) {
        return context.json({ error: 'schedule_not_found' }, 404);
      }

      return context.body(null, 204);
    } catch (error) {
      return handleScheduleApiError(context, error);
    }
  });

  app.post('/api/v1/workflows', async (context) => {
    if (workflowService === undefined) {
      return context.json({ error: 'workflow_service_not_configured' }, 503);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = createWorkflowRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_workflow_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const workflow = await workflowService.createWorkflow(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        request: request.data,
      });
      return context.json({ workflow }, 201);
    } catch (error) {
      return handleWorkflowApiError(context, error);
    }
  });

  app.get('/api/v1/workflows', async (context) => {
    if (workflowService === undefined) {
      return context.json({ error: 'workflow_service_not_configured' }, 503);
    }

    try {
      const authContext = context.get('apiAuth');
      const workflows = await workflowService.listWorkflows(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
      });
      return context.json({ workflows });
    } catch (error) {
      return handleWorkflowApiError(context, error);
    }
  });

  app.get('/api/v1/workflows/:workflowId', async (context) => {
    if (workflowService === undefined) {
      return context.json({ error: 'workflow_service_not_configured' }, 503);
    }

    const workflowId = uuidV7Schema.safeParse(context.req.param('workflowId'));

    if (!workflowId.success) {
      return context.json({ error: 'invalid_workflow_id' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const workflow = await workflowService.getWorkflow(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        workflowId: workflowId.data,
      });

      if (workflow === null) {
        return context.json({ error: 'workflow_not_found' }, 404);
      }

      return context.json({ workflow });
    } catch (error) {
      return handleWorkflowApiError(context, error);
    }
  });

  app.get('/api/v1/workflows/:workflowId/stream', async (context) => {
    if (workflowService === undefined) {
      return context.json({ error: 'workflow_service_not_configured' }, 503);
    }

    if (runtimeEventStore === undefined) {
      return context.json({ error: 'runtime_event_store_not_configured' }, 503);
    }

    const workflowId = uuidV7Schema.safeParse(context.req.param('workflowId'));

    if (!workflowId.success) {
      return context.json({ error: 'invalid_workflow_id' }, 400);
    }

    const limit = parsePositiveIntegerQuery(context.req.query('limit') ?? null, 100, 500);

    if (limit === null) {
      return context.json({ error: 'invalid_limit' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const workflow = await workflowService.getWorkflow(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        workflowId: workflowId.data,
      });

      if (workflow === null) {
        return context.json({ error: 'workflow_not_found' }, 404);
      }

      const result = await runtimeEventStore.list({
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        workflowId: workflowId.data,
        after: context.req.query('cursor') ?? null,
        limit,
      });

      return new Response(formatSseEvents(result.events), {
        headers: {
          'cache-control': 'no-cache',
          'content-type': 'text/event-stream; charset=utf-8',
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid runtime event cursor.') {
        return context.json({ error: 'invalid_cursor' }, 400);
      }

      return handleWorkflowApiError(context, error);
    }
  });

  app.patch('/api/v1/workflows/:workflowId', async (context) => {
    if (workflowService === undefined) {
      return context.json({ error: 'workflow_service_not_configured' }, 503);
    }

    const workflowId = uuidV7Schema.safeParse(context.req.param('workflowId'));

    if (!workflowId.success) {
      return context.json({ error: 'invalid_workflow_id' }, 400);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = updateWorkflowDraftRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_workflow_update_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const workflow = await workflowService.updateDraft(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        workflowId: workflowId.data,
        request: request.data,
      });

      if (workflow === null) {
        return context.json({ error: 'workflow_not_found' }, 404);
      }

      return context.json({ workflow });
    } catch (error) {
      return handleWorkflowApiError(context, error);
    }
  });

  app.post('/api/v1/workflows/:workflowId/publish', async (context) => {
    if (workflowService === undefined) {
      return context.json({ error: 'workflow_service_not_configured' }, 503);
    }

    const workflowId = uuidV7Schema.safeParse(context.req.param('workflowId'));

    if (!workflowId.success) {
      return context.json({ error: 'invalid_workflow_id' }, 400);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = publishWorkflowRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_publish_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const version = await workflowService.publishWorkflow(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        workflowId: workflowId.data,
      });

      if (version === null) {
        return context.json({ error: 'workflow_not_found' }, 404);
      }

      return context.json({ version }, 201);
    } catch (error) {
      return handleWorkflowApiError(context, error);
    }
  });

  app.get('/api/v1/workflows/:workflowId/runs', async (context) => {
    if (workflowService === undefined) {
      return context.json({ error: 'workflow_service_not_configured' }, 503);
    }

    const workflowId = uuidV7Schema.safeParse(context.req.param('workflowId'));

    if (!workflowId.success) {
      return context.json({ error: 'invalid_workflow_id' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const runs = await workflowService.listRuns(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        workflowId: workflowId.data,
      });

      return context.json({ runs });
    } catch (error) {
      return handleWorkflowApiError(context, error);
    }
  });

  app.get('/api/v1/workflows/:workflowId/runs/:runId', async (context) => {
    if (workflowService === undefined) {
      return context.json({ error: 'workflow_service_not_configured' }, 503);
    }

    const workflowId = uuidV7Schema.safeParse(context.req.param('workflowId'));
    const runId = uuidV7Schema.safeParse(context.req.param('runId'));

    if (!workflowId.success) {
      return context.json({ error: 'invalid_workflow_id' }, 400);
    }

    if (!runId.success) {
      return context.json({ error: 'invalid_workflow_run_id' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const run = await workflowService.getRun(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        workflowId: workflowId.data,
        runId: runId.data,
      });

      if (run === null) {
        return context.json({ error: 'workflow_run_not_found' }, 404);
      }

      return context.json({ run });
    } catch (error) {
      return handleWorkflowApiError(context, error);
    }
  });

  app.post('/api/v1/workflows/:workflowId/runs', async (context) => {
    if (workflowService === undefined) {
      return context.json({ error: 'workflow_service_not_configured' }, 503);
    }

    const workflowId = uuidV7Schema.safeParse(context.req.param('workflowId'));

    if (!workflowId.success) {
      return context.json({ error: 'invalid_workflow_id' }, 400);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = startWorkflowRunRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_workflow_run_request' }, 400);
    }

    const idempotencyKey = idempotencyKeySchema.safeParse(
      context.req.header('idempotency-key'),
    );

    if (!idempotencyKey.success) {
      return context.json({ error: 'invalid_idempotency_key' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const result = await workflowService.startRun(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        workflowId: workflowId.data,
        idempotencyKey: idempotencyKey.data,
        request: request.data,
      });

      if (result === null) {
        return context.json({ error: 'workflow_not_found' }, 404);
      }

      return context.json({ run: result.run }, result.created ? 201 : 200);
    } catch (error) {
      return handleWorkflowApiError(context, error);
    }
  });

  app.post('/api/v1/workflows/:workflowId/runs/:runId/pause', async (context) => {
    if (workflowService === undefined) {
      return context.json({ error: 'workflow_service_not_configured' }, 503);
    }

    const workflowId = uuidV7Schema.safeParse(context.req.param('workflowId'));
    const runId = uuidV7Schema.safeParse(context.req.param('runId'));

    if (!workflowId.success) {
      return context.json({ error: 'invalid_workflow_id' }, 400);
    }

    if (!runId.success) {
      return context.json({ error: 'invalid_workflow_run_id' }, 400);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = pauseWorkflowRunRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_workflow_pause_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const run = await workflowService.pauseRun(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        workflowId: workflowId.data,
        runId: runId.data,
      });

      if (run === null) {
        return context.json({ error: 'workflow_run_not_found' }, 404);
      }

      return context.json({ run });
    } catch (error) {
      return handleWorkflowApiError(context, error);
    }
  });

  app.post('/api/v1/workflows/:workflowId/runs/:runId/resume', async (context) => {
    if (workflowService === undefined) {
      return context.json({ error: 'workflow_service_not_configured' }, 503);
    }

    const workflowId = uuidV7Schema.safeParse(context.req.param('workflowId'));
    const runId = uuidV7Schema.safeParse(context.req.param('runId'));

    if (!workflowId.success) {
      return context.json({ error: 'invalid_workflow_id' }, 400);
    }

    if (!runId.success) {
      return context.json({ error: 'invalid_workflow_run_id' }, 400);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = resumeWorkflowRunRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_workflow_resume_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const run = await workflowService.resumeRun(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        workflowId: workflowId.data,
        runId: runId.data,
      });

      if (run === null) {
        return context.json({ error: 'workflow_run_not_found' }, 404);
      }

      return context.json({ run });
    } catch (error) {
      return handleWorkflowApiError(context, error);
    }
  });

  app.post('/api/v1/signals/:workflowId', async (context) => {
    if (workflowService === undefined) {
      return context.json({ error: 'workflow_service_not_configured' }, 503);
    }

    const workflowId = uuidV7Schema.safeParse(context.req.param('workflowId'));

    if (!workflowId.success) {
      return context.json({ error: 'invalid_workflow_id' }, 400);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = deliverWorkflowSignalRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_workflow_signal_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const result = await workflowService.deliverSignal(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        workflowId: workflowId.data,
        request: request.data,
      });

      if (result === null) {
        return context.json({ error: 'workflow_signal_not_found' }, 404);
      }

      return context.json({ step: result.step, duplicate: result.duplicate }, result.duplicate ? 200 : 202);
    } catch (error) {
      return handleWorkflowApiError(context, error);
    }
  });

  app.post('/api/v1/workflows/:workflowId/runs/:runId/approvals/:stepId', async (context) => {
    if (workflowService === undefined) {
      return context.json({ error: 'workflow_service_not_configured' }, 503);
    }

    const workflowId = uuidV7Schema.safeParse(context.req.param('workflowId'));
    const runId = uuidV7Schema.safeParse(context.req.param('runId'));
    const stepId = context.req.param('stepId');

    if (!workflowId.success) {
      return context.json({ error: 'invalid_workflow_id' }, 400);
    }

    if (!runId.success) {
      return context.json({ error: 'invalid_workflow_run_id' }, 400);
    }

    if (stepId.trim().length === 0) {
      return context.json({ error: 'invalid_workflow_step_id' }, 400);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = completeWorkflowApprovalRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_workflow_approval_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const result = await workflowService.completeApproval(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        workflowId: workflowId.data,
        runId: runId.data,
        stepId,
        request: request.data,
      });

      if (result === null) {
        return context.json({ error: 'workflow_approval_not_found' }, 404);
      }

      return context.json({ step: result.step, duplicate: result.duplicate }, result.duplicate ? 200 : 202);
    } catch (error) {
      return handleWorkflowApiError(context, error);
    }
  });

  app.post('/api/v1/processors/register', async (context) => {
    if (processorRegistryService === undefined) {
      return context.json({ error: 'processor_registry_service_not_configured' }, 503);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = registerProcessorRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_processor_registration_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const processor = await processorRegistryService.registerProcessor(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        agentId: authContext.principal.id,
        ...request.data,
      });
      return context.json({ processor }, 201);
    } catch (error) {
      return handleProcessorApiError(context, error);
    }
  });

  app.post('/api/v1/processors/:processorId/heartbeat', async (context) => {
    if (processorRegistryService === undefined) {
      return context.json({ error: 'processor_registry_service_not_configured' }, 503);
    }

    const processorId = uuidV7Schema.safeParse(context.req.param('processorId'));

    if (!processorId.success) {
      return context.json({ error: 'invalid_processor_id' }, 400);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = processorHeartbeatRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_processor_heartbeat_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const processor = await processorRegistryService.reportHeartbeat(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        processorId: processorId.data,
        request: request.data,
      });

      if (processor === null) {
        return context.json({ error: 'processor_not_found' }, 404);
      }

      return context.json({ processor });
    } catch (error) {
      return handleProcessorApiError(context, error);
    }
  });

  app.patch('/api/v1/processors/:processorId/capabilities', async (context) => {
    if (processorRegistryService === undefined) {
      return context.json({ error: 'processor_registry_service_not_configured' }, 503);
    }

    const processorId = uuidV7Schema.safeParse(context.req.param('processorId'));

    if (!processorId.success) {
      return context.json({ error: 'invalid_processor_id' }, 400);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = updateProcessorCapabilitiesRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_processor_capabilities_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const processor = await processorRegistryService.updateCapabilities(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        processorId: processorId.data,
        ...request.data,
      });
      return context.json({ processor });
    } catch (error) {
      return handleProcessorApiError(context, error);
    }
  });

  app.get('/api/v1/processors', async (context) => {
    if (processorRegistryService === undefined) {
      return context.json({ error: 'processor_registry_service_not_configured' }, 503);
    }

    try {
      const authContext = context.get('apiAuth');
      const processors = await processorRegistryService.listProcessors(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
      });
      return context.json({ processors });
    } catch (error) {
      return handleProcessorApiError(context, error);
    }
  });

  app.get('/api/v1/jobs/stream', async (context) => {
    if (runtimeEventStore === undefined) {
      return context.json({ error: 'runtime_event_store_not_configured' }, 503);
    }

    const limit = parsePositiveIntegerQuery(context.req.query('limit') ?? null, 100, 500);
    const workflowId = context.req.query('workflowId');
    const parsedWorkflowId = workflowId === undefined ? undefined : uuidV7Schema.safeParse(workflowId);
    const metadata = parseMetadataFilters(context.req.query());

    if (limit === null || (parsedWorkflowId !== undefined && !parsedWorkflowId.success) || metadata === null) {
      return context.json({ error: 'invalid_stream_filter' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      assertProjectPermission(authContext, { tenantId: authContext.tenantId, projectId: authContext.projectId }, 'jobs:read');
      const result = await runtimeEventStore.list({
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        workflowId: parsedWorkflowId?.data,
        metadata,
        after: context.req.query('cursor') ?? null,
        limit,
      });

      return new Response(formatSseEvents(result.events), {
        headers: {
          'cache-control': 'no-cache',
          'content-type': 'text/event-stream; charset=utf-8',
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid runtime event cursor.') {
        return context.json({ error: 'invalid_cursor' }, 400);
      }

      return handleJobApiError(context, error);
    }
  });

  app.post('/api/v1/jobs', async (context) => {
    if (jobService === undefined) {
      return context.json({ error: 'job_service_not_configured' }, 503);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = createJobRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_job_request' }, 400);
    }

    const idempotencyKey = idempotencyKeySchema.safeParse(
      context.req.header('idempotency-key'),
    );

    if (!idempotencyKey.success) {
      return context.json({ error: 'invalid_idempotency_key' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const result = await jobService.createJob(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        idempotencyKey: idempotencyKey.data,
        request: request.data,
      });
      const response = { job: result.job, ready: result.ready };

      if (result.created) {
        return context.json(response, 201);
      }

      return context.json(response);
    } catch (error) {
      return handleJobApiError(context, error);
    }
  });

  app.post('/api/v1/jobs/claim', async (context) => {
    if (jobService === undefined) {
      return context.json({ error: 'job_service_not_configured' }, 503);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = claimJobRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_claim_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const claim = await jobService.claimReadyJob(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        request: request.data,
      });

      return context.json(claim);
    } catch (error) {
      return handleJobApiError(context, error);
    }
  });

  app.get('/api/v1/jobs', async (context) => {
    if (jobService === undefined) {
      return context.json({ error: 'job_service_not_configured' }, 503);
    }

    try {
      const authContext = context.get('apiAuth');
      const jobs = await jobService.listJobs(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
      });

      return context.json({ jobs });
    } catch (error) {
      return handleJobApiError(context, error);
    }
  });

  app.post('/api/v1/jobs/:jobId/leases/:leaseId/heartbeat', async (context) => {
    if (jobService === undefined) {
      return context.json({ error: 'job_service_not_configured' }, 503);
    }

    const jobId = uuidV7Schema.safeParse(context.req.param('jobId'));
    const leaseId = uuidV7Schema.safeParse(context.req.param('leaseId'));

    if (!jobId.success) {
      return context.json({ error: 'invalid_job_id' }, 400);
    }

    if (!leaseId.success) {
      return context.json({ error: 'invalid_lease_id' }, 400);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = heartbeatLeaseRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_heartbeat_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const lease = await jobService.heartbeatLease(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        jobId: jobId.data,
        leaseId: leaseId.data,
        request: request.data,
      });

      if (lease === null) {
        return context.json({ error: 'lease_not_found' }, 404);
      }

      return context.json({ lease });
    } catch (error) {
      return handleJobApiError(context, error);
    }
  });

  app.post('/api/v1/jobs/:jobId/attempts/:attemptId/leases/:leaseId/progress', async (context) => {
    if (jobService === undefined) {
      return context.json({ error: 'job_service_not_configured' }, 503);
    }

    const jobId = uuidV7Schema.safeParse(context.req.param('jobId'));
    const attemptId = uuidV7Schema.safeParse(context.req.param('attemptId'));
    const leaseId = uuidV7Schema.safeParse(context.req.param('leaseId'));

    if (!jobId.success) {
      return context.json({ error: 'invalid_job_id' }, 400);
    }

    if (!attemptId.success) {
      return context.json({ error: 'invalid_attempt_id' }, 400);
    }

    if (!leaseId.success) {
      return context.json({ error: 'invalid_lease_id' }, 400);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = reportJobProgressRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_progress_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const accepted = await jobService.reportProgress(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        jobId: jobId.data,
        attemptId: attemptId.data,
        leaseId: leaseId.data,
        request: request.data,
      });

      if (!accepted) {
        return context.json({ error: 'attempt_not_found' }, 404);
      }

      return context.json({ accepted: true }, 202);
    } catch (error) {
      return handleJobApiError(context, error);
    }
  });

  app.post('/api/v1/jobs/:jobId/attempts/:attemptId/leases/:leaseId/complete', async (context) => {
    if (jobService === undefined) {
      return context.json({ error: 'job_service_not_configured' }, 503);
    }

    const jobId = uuidV7Schema.safeParse(context.req.param('jobId'));
    const attemptId = uuidV7Schema.safeParse(context.req.param('attemptId'));
    const leaseId = uuidV7Schema.safeParse(context.req.param('leaseId'));

    if (!jobId.success) {
      return context.json({ error: 'invalid_job_id' }, 400);
    }

    if (!attemptId.success) {
      return context.json({ error: 'invalid_attempt_id' }, 400);
    }

    if (!leaseId.success) {
      return context.json({ error: 'invalid_lease_id' }, 400);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = completeJobAttemptRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_complete_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const result = await jobService.completeJobAttempt(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        jobId: jobId.data,
        attemptId: attemptId.data,
        leaseId: leaseId.data,
      });

      if (result === null) {
        return context.json({ error: 'attempt_not_found' }, 404);
      }

      return context.json(result);
    } catch (error) {
      return handleJobApiError(context, error);
    }
  });

  app.post('/api/v1/jobs/:jobId/attempts/:attemptId/leases/:leaseId/fail', async (context) => {
    if (jobService === undefined) {
      return context.json({ error: 'job_service_not_configured' }, 503);
    }

    const jobId = uuidV7Schema.safeParse(context.req.param('jobId'));
    const attemptId = uuidV7Schema.safeParse(context.req.param('attemptId'));
    const leaseId = uuidV7Schema.safeParse(context.req.param('leaseId'));

    if (!jobId.success) {
      return context.json({ error: 'invalid_job_id' }, 400);
    }

    if (!attemptId.success) {
      return context.json({ error: 'invalid_attempt_id' }, 400);
    }

    if (!leaseId.success) {
      return context.json({ error: 'invalid_lease_id' }, 400);
    }

    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    const request = failJobAttemptRequestSchema.safeParse(body.value);

    if (!request.success) {
      return context.json({ error: 'invalid_fail_request' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const result = await jobService.failJobAttempt(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        jobId: jobId.data,
        attemptId: attemptId.data,
        leaseId: leaseId.data,
        request: request.data,
      });

      if (result === null) {
        return context.json({ error: 'attempt_not_found' }, 404);
      }

      return context.json(result);
    } catch (error) {
      return handleJobApiError(context, error);
    }
  });

  app.get('/api/v1/jobs/:jobId/history', async (context) => {
    if (jobService === undefined) {
      return context.json({ error: 'job_service_not_configured' }, 503);
    }

    const jobId = uuidV7Schema.safeParse(context.req.param('jobId'));

    if (!jobId.success) {
      return context.json({ error: 'invalid_job_id' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const history = await jobService.getJobHistory(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        jobId: jobId.data,
      });

      if (history === null) {
        return context.json({ error: 'job_not_found' }, 404);
      }

      return context.json(history);
    } catch (error) {
      return handleJobApiError(context, error);
    }
  });

  app.get('/api/v1/jobs/:jobId', async (context) => {
    if (jobService === undefined) {
      return context.json({ error: 'job_service_not_configured' }, 503);
    }

    const jobId = uuidV7Schema.safeParse(context.req.param('jobId'));

    if (!jobId.success) {
      return context.json({ error: 'invalid_job_id' }, 400);
    }

    try {
      const authContext = context.get('apiAuth');
      const result = await jobService.getJob(authContext, {
        tenantId: authContext.tenantId,
        projectId: authContext.projectId,
        jobId: jobId.data,
      });

      if (result === null) {
        return context.json({ error: 'job_not_found' }, 404);
      }

      return context.json({ job: result.job, ready: result.ready });
    } catch (error) {
      return handleJobApiError(context, error);
    }
  });

  app.use('/admin', browserSecurity);
  app.use('/admin/*', browserSecurity);
  app.use('/admin', requireBrowserPermission(adminReadPermission));
  app.use('/admin/*', requireBrowserPermission(adminReadPermission));

  app.get('/admin/api/v1/session', (context) =>
    context.json(toSessionResponse(context.get('browserAuth'))),
  );

  app.get('/admin/api/v1/iam/custom-roles', async (context) => {
    try {
      const customRoles = await customRoleService.listCustomRoles(
        toAuthContext(context.get('browserAuth')),
        { tenantId: context.get('browserAuth').tenantId },
      );

      return context.json({
        customRoles: customRoles.map(toCustomRoleResponse),
      });
    } catch (error) {
      return handleCustomRoleError(context, error);
    }
  });

  app.post('/admin/api/v1/iam/custom-roles', async (context) => {
    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    try {
      const customRole = await customRoleService.createCustomRole(
        toAuthContext(context.get('browserAuth')),
        {
          tenantId: context.get('browserAuth').tenantId,
          slug: getStringField(body.value, 'slug'),
          name: getStringField(body.value, 'name'),
          permissions: getStringArrayField(body.value, 'permissions'),
        },
      );

      return context.json({ customRole: toCustomRoleResponse(customRole) }, 201);
    } catch (error) {
      return handleCustomRoleError(context, error);
    }
  });

  app.patch('/admin/api/v1/iam/custom-roles/:roleId', async (context) => {
    const body = await readJsonObject(context);

    if (!body.ok) {
      return context.json({ error: body.error }, 400);
    }

    try {
      const customRole = await customRoleService.updateCustomRole(
        toAuthContext(context.get('browserAuth')),
        {
          tenantId: context.get('browserAuth').tenantId,
          id: context.req.param('roleId'),
          name: getStringField(body.value, 'name'),
          permissions: getStringArrayField(body.value, 'permissions'),
        },
      );

      return context.json({ customRole: toCustomRoleResponse(customRole) });
    } catch (error) {
      return handleCustomRoleError(context, error);
    }
  });

  app.delete('/admin/api/v1/iam/custom-roles/:roleId', async (context) => {
    try {
      const customRole = await customRoleService.disableCustomRole(
        toAuthContext(context.get('browserAuth')),
        {
          tenantId: context.get('browserAuth').tenantId,
          id: context.req.param('roleId'),
        },
      );

      return context.json({ customRole: toCustomRoleResponse(customRole) });
    } catch (error) {
      return handleCustomRoleError(context, error);
    }
  });

  app.get('/admin', renderAdminRoute);
  app.get('/admin/*', renderAdminRoute);

  return app;
}

function getBearerToken(headers: Headers): string | null {
  const authorization = headers.get('authorization')?.trim();

  if (authorization === undefined || authorization.length === 0) {
    return null;
  }

  const parts = authorization.split(/\s+/u);
  const [scheme, token] = parts;

  if (parts.length !== 2 || scheme?.toLowerCase() !== 'bearer' || token === undefined) {
    return null;
  }

  return token;
}

function createApiAuthMiddleware(
  apiAuthProvider: ApiAuthProvider | undefined,
): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    if (apiAuthProvider === undefined) {
      return context.json({ error: 'api_auth_not_configured' }, 503);
    }

    const apiAuth = await apiAuthProvider.authenticate({
      headers: context.req.raw.headers,
      method: context.req.method,
      url: new URL(context.req.url),
    });

    if (apiAuth === null) {
      return context.json(
        {
          error: 'unauthenticated_api_request',
        },
        401,
        {
          'www-authenticate': 'Bearer realm="api"',
        },
      );
    }

    context.set('apiAuth', apiAuth);
    await next();
  };
}

function requireBrowserPermission(
  permission: string,
): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    const browserAuth = context.get('browserAuth');

    if (!browserAuth.permissions.includes(permission)) {
      return context.json({ error: 'missing_admin_read_permission' }, 403);
    }

    await next();
  };
}

async function renderAdminRoute(context: Context<AppEnvironment>): Promise<Response> {
  const stream = await renderAdminDocumentStream(
    new URL(context.req.url).pathname,
  );

  return new Response(stream, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  });
}

function createBrowserSecurityMiddleware(input: {
  readonly allowedOrigins: readonly string[];
  readonly browserAuthProvider: BrowserAuthProvider;
}): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    const originDecision = getBrowserOriginDecision(
      context.req.raw,
      input.allowedOrigins,
    );

    if (!originDecision.allowed) {
      return context.json(
        {
          error: 'browser_origin_not_allowed',
        },
        403,
      );
    }

    if (context.req.method === 'OPTIONS') {
      return createPreflightResponse(originDecision);
    }

    const browserAuth = await input.browserAuthProvider.authenticate({
      headers: context.req.raw.headers,
      method: context.req.method,
      url: new URL(context.req.url),
    });

    if (browserAuth === null) {
      return context.json(
        {
          error: 'unauthenticated_browser_session',
        },
        401,
        {
          'www-authenticate': 'HelixBrowserSession realm="admin"',
        },
      );
    }

    if (
      unsafeMethods.has(context.req.method) &&
      !hasValidCsrfToken(context.req.raw.headers)
    ) {
      return context.json(
        {
          error: 'invalid_csrf_token',
        },
        403,
      );
    }

    context.set('browserAuth', browserAuth);
    await next();
    applyCorsHeaders(context, originDecision);
  };
}

function toSessionResponse(authContext: BrowserAuthContext) {
  return {
    tenantId: authContext.tenantId,
    projectId: authContext.projectId,
    organizationId: authContext.organizationId,
    memberId: authContext.memberId,
    principal: authContext.principal,
    permissions: authContext.permissions,
  };
}

function getBrowserOriginDecision(
  request: Request,
  allowedOrigins: readonly string[],
):
  | { readonly allowed: true; readonly origin: string | null }
  | { readonly allowed: false } {
  const origin = request.headers.get('origin');

  if (origin === null) {
    return { allowed: true, origin: null };
  }

  const requestOrigin = new URL(request.url).origin;

  if (origin === requestOrigin || allowedOrigins.includes(origin)) {
    return { allowed: true, origin };
  }

  return { allowed: false };
}

function createPreflightResponse(
  originDecision: { readonly allowed: true; readonly origin: string | null },
): Response {
  const headers = new Headers({
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers':
      'content-type,x-csrf-token,x-helix-mock-session',
    vary: 'Origin',
  });

  if (originDecision.origin !== null) {
    headers.set('access-control-allow-origin', originDecision.origin);
  }

  return new Response(null, {
    headers,
    status: 204,
  });
}

function applyCorsHeaders(
  context: Context<AppEnvironment>,
  originDecision: { readonly allowed: true; readonly origin: string | null },
): void {
  if (originDecision.origin === null) {
    return;
  }

  context.res.headers.set('access-control-allow-origin', originDecision.origin);
  context.res.headers.append('vary', 'Origin');
}

class NoopSecurityAuditSink implements SecurityAuditSink {
  async record(): Promise<void> {
    return;
  }
}

function toAuthContext(browserAuth: BrowserAuthContext): AuthContext {
  return {
    tenantId: browserAuth.tenantId,
    projectId: browserAuth.projectId,
    principal: browserAuth.principal,
    permissions: [...browserAuth.permissions] as Permission[],
  };
}

function toCustomRoleResponse(record: CustomRoleRecord) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    slug: record.slug,
    name: record.name,
    permissions: [...record.permissions],
    disabledAt: record.disabledAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function readJsonObject(
  context: Context<AppEnvironment>,
): Promise<
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: string }
> {
  let body: unknown;

  try {
    body = await context.req.json();
  } catch {
    return { ok: false, error: 'invalid_json' };
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_request_body' };
  }

  return { ok: true, value: body as Record<string, unknown> };
}

function getStringField(body: Record<string, unknown>, field: string): string {
  const value = body[field];

  if (typeof value !== 'string') {
    throw new CustomRoleValidationError(`${field} must be a string.`);
  }

  return value;
}

function getStringArrayField(body: Record<string, unknown>, field: string): readonly string[] {
  const value = body[field];

  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new CustomRoleValidationError(`${field} must be a string array.`);
  }

  return value as string[];
}

function parseMetadataFilters(query: Record<string, string>): Readonly<Record<string, string>> | null {
  const filters: Record<string, string> = {};

  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith('metadata.')) {
      continue;
    }

    const metadataKey = key.slice('metadata.'.length);

    if (metadataKey.trim().length === 0 || value.trim().length === 0) {
      return null;
    }

    filters[metadataKey] = value;
  }

  return filters;
}

function parsePositiveIntegerQuery(value: string | null, defaultValue: number, maxValue: number): number | null {
  if (value === null) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= maxValue ? parsed : null;
}

function formatSseEvents(events: readonly RuntimeEventStoreRow[]): string {
  return events
    .map((event) => [
      `id: ${event.cursor}`,
      `event: ${event.eventType}`,
      `data: ${JSON.stringify({
        id: event.eventId,
        type: event.eventType,
        version: event.eventVersion,
        orderingKey: event.orderingKey,
        payload: event.payload,
        occurredAt: event.occurredAt.toISOString(),
        recordedAt: event.recordedAt.toISOString(),
      })}`,
      '',
    ].join('\n'))
    .join('\n');
}

function handleScheduleApiError(
  context: Context<AppEnvironment>,
  error: unknown,
): Response {
  if (error instanceof AuthorizationError) {
    return context.json({ error: error.reason }, 403);
  }

  throw error;
}

function handleWorkflowApiError(
  context: Context<AppEnvironment>,
  error: unknown,
): Response {
  if (error instanceof AuthorizationError) {
    return context.json({ error: error.reason }, 403);
  }

  if (error instanceof WorkflowVersionNotFoundError) {
    return context.json({ error: 'workflow_version_not_found' }, 404);
  }

  if (error instanceof WorkflowRunIdempotencyConflictError) {
    return context.json({ error: 'idempotency_conflict' }, 409);
  }

  if (error instanceof WorkflowGraphValidationError) {
    return context.json({ error: 'invalid_workflow_graph', details: error.details }, 400);
  }

  throw error;
}

function handleProcessorApiError(
  context: Context<AppEnvironment>,
  error: unknown,
): Response {
  if (error instanceof AuthorizationError) {
    return context.json({ error: error.reason }, 403);
  }

  if (error instanceof ProcessorAgentRequiredError) {
    return context.json({ error: 'agent_token_required' }, 403);
  }

  if (error instanceof ProcessorRegistrationNotFoundError) {
    return context.json({ error: 'processor_not_found' }, 404);
  }

  throw error;
}

function handleJobApiError(
  context: Context<AppEnvironment>,
  error: unknown,
): Response {
  if (error instanceof AuthorizationError) {
    return context.json({ error: error.reason }, 403);
  }

  if (error instanceof AgentClaimRequiredError) {
    return context.json({ error: 'agent_token_required' }, 403);
  }

  if (error instanceof StaleJobAttemptError) {
    return context.json({ error: 'stale_attempt' }, 409);
  }

  if (error instanceof Error && error.message.includes('idempotencyKey')) {
    return context.json({ error: 'invalid_idempotency_key' }, 400);
  }

  throw error;
}

function handleCustomRoleError(
  context: Context<AppEnvironment>,
  error: unknown,
): Response {
  if (error instanceof AuthorizationError) {
    return context.json({ error: error.reason }, 403);
  }

  if (error instanceof CustomRolePrivilegeEscalationError) {
    return context.json({ error: 'permission_privilege_escalation' }, 403);
  }

  if (error instanceof CustomRoleValidationError) {
    return context.json({ error: 'invalid_custom_role', message: error.message }, 400);
  }

  if (error instanceof DuplicateCustomRoleSlugError) {
    return context.json({ error: 'custom_role_slug_exists' }, 409);
  }

  if (error instanceof CustomRoleNotFoundError) {
    return context.json({ error: 'custom_role_not_found' }, 404);
  }

  throw error;
}
