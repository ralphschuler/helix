import { describe, expect, it } from 'vitest';

import {
  agentRegistrationCredentialRecordSchema,
  agentTokenRecordSchema,
  authContextSchema,
  billingStatusSchema,
  catalogPermissionSchema,
  createCustomRoleRequestSchema,
  customRoleListResponseSchema,
  customRoleResponseSchema,
  customRoleSchema,
  errorEnvelopeSchema,
  eventEnvelopeSchema,
  claimJobRequestSchema,
  claimJobResponseSchema,
  jobClaimedEventPayloadSchema,
  jobClaimRejectedEventPayloadSchema,
  completeJobAttemptRequestSchema,
  completeJobAttemptResponseSchema,
  createJobRequestSchema,
  failJobAttemptRequestSchema,
  failJobAttemptResponseSchema,
  heartbeatLeaseRequestSchema,
  heartbeatLeaseResponseSchema,
  jobProgressEventPayloadSchema,
  reportJobProgressRequestSchema,
  reportJobProgressResponseSchema,
  idempotencyKeySchema,
  idempotencyKeyScopeSchema,
  jobAttemptRecordSchema,
  jobAttemptFailedEventPayloadSchema,
  jobCompletedEventPayloadSchema,
  jobCreatedEventPayloadSchema,
  jobLeaseRecordSchema,
  jobHistoryResponseSchema,
  jobListResponseSchema,
  jobReadyEventPayloadSchema,
  jobRecordSchema,
  jobResponseSchema,
  jobStateSchema,
  leaseStateSchema,
  opaqueCursorSchema,
  tenantIdSchema,
  tenantProjectScopeSchema,
  tenantScopeSchema,
  updateCustomRoleRequestSchema,
  processorCapabilitySchema,
  processorHardwareSchema,
  processorHeartbeatEventPayloadSchema,
  processorHeartbeatRequestSchema,
  processorHeartbeatResponseSchema,
  processorRegistryListResponseSchema,
  processorRegistryRecordSchema,
  processorRegistryResponseSchema,
  routingExplanationSchema,
  projectApiKeyRecordSchema,
  stripeCustomerMappingSchema,
  stripeWebhookEventRecordSchema,
  usageLedgerRecordSchema,
  uuidV7Schema,
  createWorkflowRequestSchema,
  updateWorkflowDraftRequestSchema,
  workflowDefinitionRecordSchema,
  workflowResponseSchema,
  workflowRunListResponseSchema,
  workflowRunRecordSchema,
  workflowRunResponseSchema,
  workflowRunStartedEventPayloadSchema,
  workflowVersionRecordSchema,
  workflowVersionResponseSchema,
  createScheduleRequestSchema,
  updateScheduleRequestSchema,
  scheduleRecordSchema,
  scheduleResponseSchema,
  scheduleListResponseSchema,
  scheduleModeSchema,
  scheduleTargetSchema,
  permissionCatalog,
} from '@helix/contracts';

const validTenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const validProjectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';
const validOrganizationId = '01890f42-98c4-7cc3-aa5e-0c567f1d3a85';

describe('base identifier contracts', () => {
  it('accepts UUIDv7-shaped resource identifiers and rejects other UUID versions', () => {
    expect(uuidV7Schema.parse(validTenantId)).toBe(validTenantId);
    expect(tenantIdSchema.parse(validTenantId)).toBe(validTenantId);

    expect(() =>
      uuidV7Schema.parse('01890f42-98c4-4cc3-8a5e-0c567f1d3a77'),
    ).toThrow();
    expect(() => uuidV7Schema.parse('not-a-uuid')).toThrow();
  });

  it('requires tenant and project scoped resources to carry valid IDs', () => {
    expect(
      tenantScopeSchema.parse({
        tenantId: validTenantId,
      }),
    ).toEqual({ tenantId: validTenantId });

    expect(
      tenantProjectScopeSchema.parse({
        tenantId: validTenantId,
        projectId: validProjectId,
      }),
    ).toEqual({ tenantId: validTenantId, projectId: validProjectId });

    expect(() => tenantScopeSchema.parse({})).toThrow();
    expect(() =>
      tenantProjectScopeSchema.parse({
        tenantId: validTenantId,
        projectId: 'not-a-uuid',
      }),
    ).toThrow();
  });
});

describe('base error contracts', () => {
  it('accepts framework-agnostic error envelopes and rejects incomplete errors', () => {
    const errorEnvelope = {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid tenant ID',
        details: {
          field: 'tenantId',
        },
      },
    };

    expect(errorEnvelopeSchema.parse(errorEnvelope)).toEqual(errorEnvelope);
    expect(() => errorEnvelopeSchema.parse({ error: { message: 'No code' } })).toThrow();
    expect(() => errorEnvelopeSchema.parse({ error: { code: '   ', message: 'Blank' } })).toThrow();
    expect(() => errorEnvelopeSchema.parse({ error: { code: 'EMPTY', message: '' } })).toThrow();
  });
});

describe('workflow definition contracts', () => {
  it('models drafts, immutable published versions, and runs pinned to a version', () => {
    const workflow = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3c20',
      tenantId: validTenantId,
      projectId: validProjectId,
      slug: 'invoice-approval',
      name: 'Invoice Approval',
      description: 'Approves invoices',
      draftGraph: { nodes: [{ id: 'review' }], edges: [] },
      metadata: { owner: 'ops' },
      createdAt: '2026-05-15T13:00:00.000Z',
      updatedAt: '2026-05-15T13:01:00.000Z',
    };
    const version = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3c21',
      tenantId: validTenantId,
      projectId: validProjectId,
      workflowId: workflow.id,
      versionNumber: 1,
      graph: workflow.draftGraph,
      metadata: workflow.metadata,
      publishedAt: '2026-05-15T13:02:00.000Z',
      createdAt: '2026-05-15T13:02:00.000Z',
    };
    const run = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3c22',
      tenantId: validTenantId,
      projectId: validProjectId,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      state: 'queued',
      idempotencyKey: 'workflow-run:invoice-1',
      createdAt: '2026-05-15T13:03:00.000Z',
      updatedAt: '2026-05-15T13:03:00.000Z',
    };

    expect(createWorkflowRequestSchema.parse({
      slug: workflow.slug,
      name: workflow.name,
      description: workflow.description,
      draftGraph: workflow.draftGraph,
      metadata: workflow.metadata,
    })).toEqual({
      slug: workflow.slug,
      name: workflow.name,
      description: workflow.description,
      draftGraph: workflow.draftGraph,
      metadata: workflow.metadata,
    });
    expect(updateWorkflowDraftRequestSchema.parse({ draftGraph: { nodes: [] } })).toEqual({
      draftGraph: { nodes: [] },
    });
    expect(workflowDefinitionRecordSchema.parse(workflow)).toEqual(workflow);
    expect(workflowVersionRecordSchema.parse(version)).toEqual(version);
    expect(workflowRunRecordSchema.parse(run)).toEqual(run);
    expect(workflowResponseSchema.parse({ workflow })).toEqual({ workflow });
    expect(workflowVersionResponseSchema.parse({ version })).toEqual({ version });
    expect(workflowRunResponseSchema.parse({ run })).toEqual({ run });
    expect(workflowRunListResponseSchema.parse({ runs: [run] })).toEqual({ runs: [run] });
    expect(workflowRunStartedEventPayloadSchema.parse({
      tenantId: validTenantId,
      projectId: validProjectId,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      runId: run.id,
      state: 'queued',
      idempotencyKey: run.idempotencyKey,
      startedAt: run.createdAt,
    })).toEqual({
      tenantId: validTenantId,
      projectId: validProjectId,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      runId: run.id,
      state: 'queued',
      idempotencyKey: run.idempotencyKey,
      startedAt: run.createdAt,
    });
    expect(permissionCatalog).toContain('workflows:publish');
    expect(() => updateWorkflowDraftRequestSchema.parse({})).toThrow();
    expect(() => workflowVersionRecordSchema.parse({ ...version, versionNumber: 0 })).toThrow();
    expect(() => workflowVersionRecordSchema.parse({ ...version, graph: [] })).toThrow();
    expect(() => workflowDefinitionRecordSchema.parse({ ...workflow, unexpected: true })).toThrow();
  });
});

describe('job execution contracts', () => {
  it('models scoped job, attempt, and lease records with explicit states', () => {
    const job = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a90',
      tenantId: validTenantId,
      projectId: validProjectId,
      state: 'queued',
      priority: 0,
      maxAttempts: 3,
      attemptCount: 0,
      readyAt: '2026-05-12T19:00:00.000Z',
      idempotencyKey: 'create-job:client-request-1',
      constraints: { capability: 'thumbnail' },
      metadata: { source: 'test' },
      createdAt: '2026-05-12T19:00:00.000Z',
      updatedAt: '2026-05-12T19:00:00.000Z',
      finishedAt: null,
    };
    const attempt = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a91',
      tenantId: validTenantId,
      projectId: validProjectId,
      jobId: job.id,
      attemptNumber: 1,
      state: 'running',
      agentId: '01890f42-98c4-7cc3-aa5e-0c567f1d3a92',
      startedAt: '2026-05-12T19:01:00.000Z',
      finishedAt: null,
      failureCode: null,
      failureMessage: null,
    };
    const lease = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a93',
      tenantId: validTenantId,
      projectId: validProjectId,
      jobId: job.id,
      attemptId: attempt.id,
      agentId: attempt.agentId,
      state: 'active',
      acquiredAt: '2026-05-12T19:01:00.000Z',
      expiresAt: '2026-05-12T19:06:00.000Z',
      lastHeartbeatAt: '2026-05-12T19:02:00.000Z',
      releasedAt: null,
      expiredAt: null,
      canceledAt: null,
    };

    expect(jobStateSchema.parse('dead_lettered')).toBe('dead_lettered');
    expect(leaseStateSchema.parse('released')).toBe('released');
    expect(jobRecordSchema.parse(job)).toEqual(job);
    expect(jobAttemptRecordSchema.parse(attempt)).toEqual(attempt);
    expect(jobLeaseRecordSchema.parse(lease)).toEqual(lease);
    expect(() => jobStateSchema.parse('started')).toThrow();
    expect(() => jobRecordSchema.parse({ ...job, projectId: undefined })).toThrow();
    expect(() => jobRecordSchema.parse({ ...job, priority: -1 })).toThrow();
    expect(() => jobRecordSchema.parse({ ...job, attemptCount: 4 })).toThrow();
    expect(() => jobRecordSchema.parse({ ...job, state: 'completed', finishedAt: null })).toThrow();
    expect(() => jobRecordSchema.parse({ ...job, rawPayload: 'not allowed' })).toThrow();
    expect(() => jobAttemptRecordSchema.parse({ ...attempt, attemptNumber: 0 })).toThrow();
    expect(() =>
      jobAttemptRecordSchema.parse({ ...attempt, state: 'completed', finishedAt: null }),
    ).toThrow();
    expect(() =>
      jobAttemptRecordSchema.parse({
        ...attempt,
        state: 'failed',
        finishedAt: '2026-05-12T19:05:00.000Z',
        failureCode: null,
      }),
    ).toThrow();
    expect(() =>
      jobAttemptRecordSchema.parse({
        ...attempt,
        state: 'running',
        finishedAt: '2026-05-12T19:05:00.000Z',
      }),
    ).toThrow();
    expect(() => jobLeaseRecordSchema.parse({ ...lease, state: 'renewing' })).toThrow();
    expect(() =>
      jobLeaseRecordSchema.parse({
        ...lease,
        state: 'expired',
        releasedAt: '2026-05-12T19:03:00.000Z',
        expiredAt: '2026-05-12T19:04:00.000Z',
      }),
    ).toThrow();
  });

  it('models job API requests, responses, and durable runtime event payloads', () => {
    const job = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3b90',
      tenantId: validTenantId,
      projectId: validProjectId,
      state: 'queued',
      priority: 5,
      maxAttempts: 2,
      attemptCount: 0,
      readyAt: '2026-05-12T19:00:00.000Z',
      idempotencyKey: 'create-job:client-request-2',
      constraints: { capability: 'thumbnail' },
      metadata: { source: 'sdk' },
      createdAt: '2026-05-12T19:00:00.000Z',
      updatedAt: '2026-05-12T19:00:00.000Z',
      finishedAt: null,
    };
    const createRequest = {
      priority: 5,
      maxAttempts: 2,
      constraints: { capability: 'thumbnail' },
      metadata: { source: 'sdk' },
    };

    const attempt = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3b91',
      tenantId: validTenantId,
      projectId: validProjectId,
      jobId: job.id,
      attemptNumber: 1,
      state: 'running',
      agentId: '01890f42-98c4-7cc3-aa5e-0c567f1d3b92',
      startedAt: '2026-05-12T19:01:00.000Z',
      finishedAt: null,
      failureCode: null,
      failureMessage: null,
    };
    const lease = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3b93',
      tenantId: validTenantId,
      projectId: validProjectId,
      jobId: job.id,
      attemptId: attempt.id,
      agentId: attempt.agentId,
      state: 'active',
      acquiredAt: '2026-05-12T19:01:00.000Z',
      expiresAt: '2026-05-12T19:06:00.000Z',
      lastHeartbeatAt: '2026-05-12T19:02:00.000Z',
      releasedAt: null,
      expiredAt: null,
      canceledAt: null,
    };

    expect(createJobRequestSchema.parse(createRequest)).toEqual(createRequest);
    expect(claimJobRequestSchema.parse({ leaseTtlSeconds: 600 })).toEqual({ leaseTtlSeconds: 600 });
    expect(heartbeatLeaseRequestSchema.parse({ leaseTtlSeconds: 300 })).toEqual({ leaseTtlSeconds: 300 });
    expect(jobResponseSchema.parse({ job, ready: true })).toEqual({ job, ready: true });
    expect(jobListResponseSchema.parse({ jobs: [job] })).toEqual({ jobs: [job] });
    expect(jobHistoryResponseSchema.parse({ job, attempts: [attempt], leases: [lease] })).toEqual({
      job,
      attempts: [attempt],
      leases: [lease],
    });
    expect(claimJobResponseSchema.parse({ claim: { job, attempt, lease } })).toEqual({
      claim: { job, attempt, lease },
    });
    expect(claimJobResponseSchema.parse({ claim: null })).toEqual({ claim: null });
    expect(
      claimJobResponseSchema.parse({
        claim: null,
        rejection: {
          reason: 'routing_constraints_unmatched',
          jobId: job.id,
          processorId: '01890f42-98c4-7cc3-aa5e-0c567f1d3b94',
          agentId: lease.agentId,
          explanation: {
            eligible: false,
            reasons: [],
            matchedCapabilities: [],
            rejectedConstraints: ['capability thumbnail unavailable'],
            metadata: { constraintKeys: ['capability'] },
          },
        },
      }),
    ).toMatchObject({ rejection: { reason: 'routing_constraints_unmatched', jobId: job.id } });
    const completedJob = {
      ...job,
      state: 'completed',
      attemptCount: 1,
      updatedAt: '2026-05-12T19:05:00.000Z',
      finishedAt: '2026-05-12T19:05:00.000Z',
    };
    const completedAttempt = {
      ...attempt,
      state: 'completed',
      finishedAt: '2026-05-12T19:05:00.000Z',
    };
    const releasedLease = {
      ...lease,
      state: 'released',
      releasedAt: '2026-05-12T19:05:00.000Z',
    };

    expect(heartbeatLeaseResponseSchema.parse({ lease })).toEqual({ lease });
    expect(completeJobAttemptRequestSchema.parse({})).toEqual({});
    expect(
      completeJobAttemptResponseSchema.parse({
        transition: { job: completedJob, attempt: completedAttempt, lease: releasedLease },
        duplicate: false,
      }),
    ).toEqual({
      transition: { job: completedJob, attempt: completedAttempt, lease: releasedLease },
      duplicate: false,
    });
    expect(
      jobClaimedEventPayloadSchema.parse({
        tenantId: validTenantId,
        projectId: validProjectId,
        jobId: job.id,
        attemptId: attempt.id,
        leaseId: lease.id,
        agentId: lease.agentId,
        claimedAt: '2026-05-12T19:01:00.000Z',
      }),
    ).toEqual({
      tenantId: validTenantId,
      projectId: validProjectId,
      jobId: job.id,
      attemptId: attempt.id,
      leaseId: lease.id,
      agentId: lease.agentId,
      claimedAt: '2026-05-12T19:01:00.000Z',
    });
    expect(
      jobClaimRejectedEventPayloadSchema.parse({
        tenantId: validTenantId,
        projectId: validProjectId,
        jobId: job.id,
        processorId: '01890f42-98c4-7cc3-aa5e-0c567f1d3b94',
        agentId: lease.agentId,
        reason: 'routing_constraints_unmatched',
        explanation: {
          eligible: false,
          reasons: [],
          matchedCapabilities: [],
          rejectedConstraints: ['capability thumbnail unavailable'],
          metadata: { constraintKeys: ['capability'] },
        },
        rejectedAt: '2026-05-12T19:01:00.000Z',
      }),
    ).toMatchObject({ reason: 'routing_constraints_unmatched', jobId: job.id });
    expect(
      jobCompletedEventPayloadSchema.parse({
        tenantId: validTenantId,
        projectId: validProjectId,
        jobId: job.id,
        attemptId: attempt.id,
        leaseId: lease.id,
        agentId: attempt.agentId,
        completedAt: '2026-05-12T19:05:00.000Z',
      }),
    ).toEqual({
      tenantId: validTenantId,
      projectId: validProjectId,
      jobId: job.id,
      attemptId: attempt.id,
      leaseId: lease.id,
      agentId: attempt.agentId,
      completedAt: '2026-05-12T19:05:00.000Z',
    });

    const failedJob = {
      ...job,
      state: 'retrying',
      attemptCount: 1,
      readyAt: '2026-05-12T19:06:00.000Z',
      updatedAt: '2026-05-12T19:06:00.000Z',
    };
    const failedAttempt = {
      ...attempt,
      state: 'failed',
      finishedAt: '2026-05-12T19:06:00.000Z',
      failureCode: 'processor_error',
      failureMessage: 'GPU unavailable',
    };
    const failedLease = {
      ...lease,
      state: 'released',
      releasedAt: '2026-05-12T19:06:00.000Z',
    };

    expect(
      failJobAttemptRequestSchema.parse({
        failureCode: 'processor_error',
        failureMessage: 'GPU unavailable',
      }),
    ).toEqual({ failureCode: 'processor_error', failureMessage: 'GPU unavailable' });
    expect(
      failJobAttemptResponseSchema.parse({
        transition: { job: failedJob, attempt: failedAttempt, lease: failedLease },
        duplicate: false,
      }),
    ).toEqual({
      transition: { job: failedJob, attempt: failedAttempt, lease: failedLease },
      duplicate: false,
    });
    expect(
      jobAttemptFailedEventPayloadSchema.parse({
        tenantId: validTenantId,
        projectId: validProjectId,
        jobId: job.id,
        attemptId: attempt.id,
        leaseId: lease.id,
        agentId: attempt.agentId,
        failureCode: 'processor_error',
        failureMessage: 'GPU unavailable',
        failedAt: '2026-05-12T19:06:00.000Z',
      }),
    ).toEqual({
      tenantId: validTenantId,
      projectId: validProjectId,
      jobId: job.id,
      attemptId: attempt.id,
      leaseId: lease.id,
      agentId: attempt.agentId,
      failureCode: 'processor_error',
      failureMessage: 'GPU unavailable',
      failedAt: '2026-05-12T19:06:00.000Z',
    });
    expect(() => failJobAttemptRequestSchema.parse({ failureCode: '   ' })).toThrow();
    expect(
      jobCreatedEventPayloadSchema.parse({
        tenantId: validTenantId,
        projectId: validProjectId,
        jobId: job.id,
        state: 'queued',
        idempotencyKey: job.idempotencyKey,
        readyAt: job.readyAt,
      }),
    ).toEqual({
      tenantId: validTenantId,
      projectId: validProjectId,
      jobId: job.id,
      state: 'queued',
      idempotencyKey: job.idempotencyKey,
      readyAt: job.readyAt,
    });
    expect(
      jobReadyEventPayloadSchema.parse({
        tenantId: validTenantId,
        projectId: validProjectId,
        jobId: job.id,
        readyAt: job.readyAt,
      }),
    ).toEqual({
      tenantId: validTenantId,
      projectId: validProjectId,
      jobId: job.id,
      readyAt: job.readyAt,
    });
    expect(() => createJobRequestSchema.parse({ priority: -1 })).toThrow();
    expect(() => claimJobRequestSchema.parse({ leaseTtlSeconds: 0 })).toThrow();
    expect(() => heartbeatLeaseRequestSchema.parse({ leaseTtlSeconds: 86_401 })).toThrow();

    const progress = {
      percent: 42,
      message: 'Rendered frame 42',
      metadata: { frame: 42 },
    };
    expect(reportJobProgressRequestSchema.parse(progress)).toEqual(progress);
    expect(reportJobProgressResponseSchema.parse({ accepted: true })).toEqual({ accepted: true });
    expect(jobProgressEventPayloadSchema.parse({
      tenantId: validTenantId,
      projectId: validProjectId,
      jobId: '01890f42-98c4-7cc3-aa5e-0c567f1d3b94',
      attemptId: '01890f42-98c4-7cc3-aa5e-0c567f1d3b95',
      leaseId: '01890f42-98c4-7cc3-aa5e-0c567f1d3b96',
      agentId: '01890f42-98c4-7cc3-aa5e-0c567f1d3b97',
      progress,
      reportedAt: '2026-05-15T14:05:00.000Z',
    })).toMatchObject({ progress });
    expect(() => reportJobProgressRequestSchema.parse({ percent: 101 })).toThrow();
    expect(() => reportJobProgressRequestSchema.parse({ message: 'x'.repeat(4097) })).toThrow();
    expect(() => createJobRequestSchema.parse({ rawPayload: 'not allowed' })).toThrow();
  });
});

describe('processor registry contracts', () => {
  it('models project-scoped processor capabilities, hardware, labels, tags, and routing explanations', () => {
    const processor = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d10',
      tenantId: validTenantId,
      projectId: validProjectId,
      agentId: '01890f42-98c4-7cc3-aa5e-0c567f1d3d11',
      capabilities: [
        { name: 'thumbnail', version: '1.2.0' },
        { name: 'transcode', version: '2026-05-15' },
      ],
      hardware: {
        gpu: true,
        gpuModel: 'nvidia-l4',
        gpuCount: 1,
        memoryMb: 24_576,
        cpuCores: 8,
        architecture: 'linux/amd64',
      },
      region: 'us-east-1',
      labels: {
        tier: 'interactive',
        'node.kubernetes.io/instance-type': 'g6.xlarge',
      },
      tags: ['gpu', 'image'],
      routingExplanation: {
        eligible: true,
        reasons: ['capability thumbnail@1.2.0 matched', 'region us-east-1 matched'],
        matchedCapabilities: ['thumbnail'],
        rejectedConstraints: [],
        metadata: { score: 98 },
      },
      createdAt: '2026-05-15T14:00:00.000Z',
      updatedAt: '2026-05-15T14:01:00.000Z',
    };

    expect(processorCapabilitySchema.parse({ name: 'thumbnail', version: '1.2.0' })).toEqual({
      name: 'thumbnail',
      version: '1.2.0',
    });
    expect(processorHardwareSchema.parse(processor.hardware)).toEqual(processor.hardware);
    expect(routingExplanationSchema.parse(processor.routingExplanation)).toEqual(
      processor.routingExplanation,
    );
    expect(processorRegistryRecordSchema.parse(processor)).toEqual(processor);
    const heartbeat = {
      status: 'healthy' as const,
      activeJobCount: 2,
      message: 'processing normally',
      metrics: { loadAverage: 0.42 },
    };

    expect(processorHeartbeatRequestSchema.parse(heartbeat)).toEqual(heartbeat);
    expect(processorHeartbeatResponseSchema.parse({ processor: { ...processor, lastHeartbeatAt: '2026-05-15T14:05:00.000Z', healthStatus: 'healthy' } })).toMatchObject({
      processor: { lastHeartbeatAt: '2026-05-15T14:05:00.000Z', healthStatus: 'healthy' },
    });
    expect(processorHeartbeatEventPayloadSchema.parse({
      tenantId: validTenantId,
      projectId: validProjectId,
      processorId: processor.id,
      agentId: processor.agentId,
      status: 'healthy',
      activeJobCount: 2,
      message: 'processing normally',
      metrics: { loadAverage: 0.42 },
      reportedAt: '2026-05-15T14:05:00.000Z',
    })).toMatchObject({ status: 'healthy', activeJobCount: 2 });
    expect(processorRegistryResponseSchema.parse({ processor })).toEqual({ processor });
    expect(processorRegistryListResponseSchema.parse({ processors: [processor] })).toEqual({
      processors: [processor],
    });
    expect(() => processorHeartbeatRequestSchema.parse({ status: 'lost' })).toThrow();
    expect(() => processorHeartbeatRequestSchema.parse({ activeJobCount: -1 })).toThrow();
    expect(() => processorRegistryRecordSchema.parse({ ...processor, projectId: undefined })).toThrow();
    expect(() => processorRegistryRecordSchema.parse({ ...processor, capabilities: [] })).toThrow();
    expect(() =>
      processorRegistryRecordSchema.parse({
        ...processor,
        hardware: { gpu: false, gpuModel: 'nvidia-l4', memoryMb: 24_576 },
      }),
    ).toThrow();
    expect(() => processorRegistryRecordSchema.parse({ ...processor, region: '   ' })).toThrow();
    expect(() => processorRegistryRecordSchema.parse({ ...processor, labels: { '': 'bad' } })).toThrow();
    expect(() => processorRegistryRecordSchema.parse({ ...processor, rawSecret: 'not allowed' })).toThrow();
  });
});

describe('base API boundary contracts', () => {
  it('keeps stream cursors opaque and idempotency keys tenant/project scoped', () => {
    expect(opaqueCursorSchema.parse('cursor-v1.opaque-token')).toBe(
      'cursor-v1.opaque-token',
    );
    expect(() => opaqueCursorSchema.parse('')).toThrow();
    expect(() => opaqueCursorSchema.parse('   ')).toThrow();

    expect(idempotencyKeySchema.parse('create-job:client-request-1')).toBe(
      'create-job:client-request-1',
    );
    expect(() => idempotencyKeySchema.parse('')).toThrow();
    expect(() => idempotencyKeySchema.parse('x'.repeat(256))).toThrow();

    expect(
      idempotencyKeyScopeSchema.parse({
        tenantId: validTenantId,
        projectId: validProjectId,
        idempotencyKey: 'start-workflow:client-request-1',
      }),
    ).toEqual({
      tenantId: validTenantId,
      projectId: validProjectId,
      idempotencyKey: 'start-workflow:client-request-1',
    });
    expect(() =>
      idempotencyKeyScopeSchema.parse({
        tenantId: validTenantId,
        idempotencyKey: 'missing-project',
      }),
    ).toThrow();
  });

  it('represents authenticated principals inside tenant/project scope', () => {
    const authContext = {
      tenantId: validTenantId,
      projectId: validProjectId,
      principal: {
        type: 'user',
        id: 'stytch-member-1',
      },
      permissions: ['jobs:create', 'workflows:start'],
    };

    expect(authContextSchema.parse(authContext)).toEqual(authContext);

    for (const principalType of ['user', 'api_key', 'agent_token', 'service']) {
      expect(
        authContextSchema.parse({
          ...authContext,
          principal: { type: principalType, id: `${principalType}-1` },
        }).principal.type,
      ).toBe(principalType);
    }

    expect(() =>
      authContextSchema.parse({
        ...authContext,
        principal: { type: 'role', id: 'owner' },
      }),
    ).toThrow();
    expect(() =>
      authContextSchema.parse({ ...authContext, projectId: undefined }),
    ).toThrow();
    expect(() =>
      authContextSchema.parse({ ...authContext, permissions: ['   '] }),
    ).toThrow();
  });
});

describe('IAM contracts', () => {
  it('defines permission-only custom roles from an explicit catalog', () => {
    const customRole = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a81',
      tenantId: validTenantId,
      slug: 'project-operator',
      name: 'Project operator',
      permissions: ['project_api_keys:create', 'agents:register'],
      disabledAt: null,
      createdAt: '2026-05-12T16:00:00.000Z',
      updatedAt: '2026-05-12T16:00:00.000Z',
    };
    const createRequest = {
      slug: 'project-operator',
      name: 'Project operator',
      permissions: ['project_api_keys:create', 'agents:register'],
    };
    const updateRequest = {
      name: 'Project operator v2',
      permissions: ['agents:register'],
    };

    expect(permissionCatalog).toContain('project_api_keys:create');
    expect(permissionCatalog).toContain('jobs:read');
    expect(catalogPermissionSchema.parse('agents:claim')).toBe('agents:claim');
    expect(customRoleSchema.parse(customRole)).toEqual(customRole);
    expect(createCustomRoleRequestSchema.parse(createRequest)).toEqual(createRequest);
    expect(updateCustomRoleRequestSchema.parse(updateRequest)).toEqual(updateRequest);
    expect(customRoleResponseSchema.parse({ customRole })).toEqual({ customRole });
    expect(customRoleListResponseSchema.parse({ customRoles: [customRole] })).toEqual({
      customRoles: [customRole],
    });
    expect(() => customRoleSchema.parse({ ...customRole, permissions: ['owner'] })).toThrow();
    expect(() =>
      customRoleSchema.parse({
        ...customRole,
        permissions: ['agents:register', 'agents:register'],
      }),
    ).toThrow();
  });

  it('models API key, agent credential, and agent token records as scoped hashes without token material', () => {
    const apiKeyRecord = {
      id: '01890f42-98c4-7cc3-ba5e-0c567f1d3a82',
      tenantId: validTenantId,
      projectId: validProjectId,
      name: 'CI producer',
      keyPrefix: 'hpx_ci_12345678',
      secretHashSha256: 'a'.repeat(64),
      permissions: ['jobs:create'],
      createdAt: '2026-05-12T16:01:00.000Z',
      revokedAt: null,
    };
    const agentCredentialRecord = {
      id: '01890f42-98c4-7cc3-8a5e-0c567f1d3a83',
      tenantId: validTenantId,
      projectId: validProjectId,
      name: 'gpu-runner',
      credentialPrefix: 'hag_gpu_12345678',
      credentialHashSha256: 'b'.repeat(64),
      permissions: ['agents:claim'],
      createdAt: '2026-05-12T16:02:00.000Z',
      revokedAt: null,
    };
    const agentTokenRecord = {
      id: '01890f42-98c4-7cc3-9a5e-0c567f1d3a84',
      tenantId: validTenantId,
      projectId: validProjectId,
      agentId: agentCredentialRecord.id,
      tokenPrefix: 'hat_gpu_12345678',
      tokenHashSha256: 'c'.repeat(64),
      permissions: ['agents:claim'],
      createdAt: '2026-05-12T16:03:00.000Z',
      expiresAt: '2026-05-12T16:18:00.000Z',
      revokedAt: null,
    };

    expect(projectApiKeyRecordSchema.parse(apiKeyRecord)).toEqual(apiKeyRecord);
    expect(agentRegistrationCredentialRecordSchema.parse(agentCredentialRecord)).toEqual(
      agentCredentialRecord,
    );
    expect(agentTokenRecordSchema.parse(agentTokenRecord)).toEqual(agentTokenRecord);
    expect(() => projectApiKeyRecordSchema.parse({ ...apiKeyRecord, secret: 'plain-text' })).toThrow();
    expect(() =>
      agentRegistrationCredentialRecordSchema.parse({
        ...agentCredentialRecord,
        credential: 'plain-text',
      }),
    ).toThrow();
    expect(() =>
      agentTokenRecordSchema.parse({ ...agentTokenRecord, expiresAt: 'not-a-date' }),
    ).toThrow();
  });
});

describe('billing contracts', () => {
  it('models Stripe customer projection, webhook idempotency, and tenant/org scoped usage ledger rows', () => {
    const stripeCustomerMapping = {
      id: '01890f42-98c4-7cc3-ba5e-0c567f1d3a86',
      tenantId: validTenantId,
      organizationId: validOrganizationId,
      stripeCustomerId: 'cus_test_123',
      billingStatus: 'active',
      currentSubscriptionId: 'sub_test_123',
      createdAt: '2026-05-12T17:00:00.000Z',
      updatedAt: '2026-05-12T17:01:00.000Z',
    };
    const usageLedgerRecord = {
      id: '01890f42-98c4-7cc3-8a5e-0c567f1d3a87',
      tenantId: validTenantId,
      organizationId: validOrganizationId,
      projectId: validProjectId,
      usageType: 'job.execution',
      quantity: 3,
      idempotencyKey: 'usage:job-123',
      metadata: { jobId: 'job-123' },
      recordedAt: '2026-05-12T17:02:00.000Z',
    };
    const webhookEventRecord = {
      stripeEventId: 'evt_test_123',
      tenantId: validTenantId,
      organizationId: validOrganizationId,
      stripeCustomerId: 'cus_test_123',
      eventType: 'customer.subscription.updated',
      processedAt: '2026-05-12T17:03:00.000Z',
    };

    expect(billingStatusSchema.parse('past_due')).toBe('past_due');
    expect(stripeCustomerMappingSchema.parse(stripeCustomerMapping)).toEqual(
      stripeCustomerMapping,
    );
    expect(usageLedgerRecordSchema.parse(usageLedgerRecord)).toEqual(usageLedgerRecord);
    expect(stripeWebhookEventRecordSchema.parse(webhookEventRecord)).toEqual(
      webhookEventRecord,
    );
    expect(() => usageLedgerRecordSchema.parse({ ...usageLedgerRecord, quantity: 0 })).toThrow();
    expect(() =>
      stripeCustomerMappingSchema.parse({
        ...stripeCustomerMapping,
        stripeCustomerId: '',
      }),
    ).toThrow();
  });
});

describe('base event contracts', () => {
  it('requires versioned events to carry IDs, tenant/project scope, timestamps, and ordering keys', () => {
    const eventEnvelope = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a79',
      type: 'workflow.run.started',
      version: 1,
      occurredAt: '2026-05-12T15:59:00.000Z',
      orderingKey: 'workflow-run:01890f42-98c4-7cc3-ba5e-0c567f1d3a80',
      partitionKey: 'workflow-run:01890f42-98c4-7cc3-ba5e-0c567f1d3a80',
      scope: {
        tenantId: validTenantId,
        projectId: validProjectId,
      },
      payload: {
        runId: '01890f42-98c4-7cc3-ba5e-0c567f1d3a80',
      },
    };

    expect(eventEnvelopeSchema.parse(eventEnvelope)).toEqual(eventEnvelope);
    expect(() => eventEnvelopeSchema.parse({ ...eventEnvelope, type: '' })).toThrow();
    expect(() => eventEnvelopeSchema.parse({ ...eventEnvelope, version: 0 })).toThrow();
    expect(() =>
      eventEnvelopeSchema.parse({ ...eventEnvelope, occurredAt: 'not-a-date' }),
    ).toThrow();
    expect(() => eventEnvelopeSchema.parse({ ...eventEnvelope, orderingKey: '   ' })).toThrow();
    expect(() => eventEnvelopeSchema.parse({ ...eventEnvelope, partitionKey: '' })).toThrow();
    expect(() => eventEnvelopeSchema.parse({ ...eventEnvelope, payload: undefined })).toThrow();
    expect(() =>
      eventEnvelopeSchema.parse({
        ...eventEnvelope,
        scope: { tenantId: validTenantId },
      }),
    ).toThrow();
  });
});

describe('schedule contracts', () => {
  const validJobTarget = {
    type: 'job' as const,
    request: {
      priority: 5,
      maxAttempts: 2,
      constraints: { capability: 'thumbnail' },
      metadata: { source: 'schedule' },
    },
  };
  const validWorkflowTarget = {
    type: 'workflow' as const,
    workflowId: '01890f42-98c4-7cc3-aa5e-0c567f1d4a01',
    request: {
      workflowVersionId: '01890f42-98c4-7cc3-aa5e-0c567f1d4a02',
    },
  };

  it('models tenant/project scoped schedules for jobs and workflows with deterministic fire idempotency', () => {
    const record = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d4a03',
      tenantId: validTenantId,
      projectId: validProjectId,
      name: 'Nightly thumbnail batch',
      description: 'Runs once per night',
      state: 'enabled',
      target: validJobTarget,
      mode: {
        type: 'cron',
        expression: '0 2 * * *',
        timezone: 'UTC',
      },
      misfirePolicy: 'fire_once',
      fireIdempotencyKeyPrefix: 'schedule:nightly-thumbnail',
      metadata: { owner: 'ops' },
      createdAt: '2026-05-16T10:00:00.000Z',
      updatedAt: '2026-05-16T10:00:00.000Z',
    };

    expect(createScheduleRequestSchema.parse({
      name: record.name,
      description: record.description,
      target: record.target,
      mode: record.mode,
      misfirePolicy: record.misfirePolicy,
      fireIdempotencyKeyPrefix: record.fireIdempotencyKeyPrefix,
      metadata: record.metadata,
    })).toEqual({
      name: record.name,
      description: record.description,
      target: record.target,
      mode: record.mode,
      misfirePolicy: record.misfirePolicy,
      fireIdempotencyKeyPrefix: record.fireIdempotencyKeyPrefix,
      metadata: record.metadata,
    });
    expect(scheduleTargetSchema.parse(validWorkflowTarget)).toEqual(validWorkflowTarget);
    expect(scheduleRecordSchema.parse(record)).toEqual(record);
    expect(scheduleResponseSchema.parse({ schedule: record })).toEqual({ schedule: record });
    expect(scheduleListResponseSchema.parse({ schedules: [record] })).toEqual({ schedules: [record] });
    expect(updateScheduleRequestSchema.parse({ state: 'disabled' })).toEqual({ state: 'disabled' });
    expect(permissionCatalog).toContain('schedules:create');
    expect(permissionCatalog).toContain('schedules:read');
    expect(permissionCatalog).toContain('schedules:update');
    expect(permissionCatalog).toContain('schedules:delete');
  });

  it('rejects invalid schedule definitions before persistence or runtime enqueue', () => {
    expect(() => createScheduleRequestSchema.parse({
      name: 'Missing idempotency prefix',
      target: validJobTarget,
      mode: { type: 'delayed', runAt: '2026-05-16T11:00:00.000Z' },
    })).toThrow();
    expect(() => createScheduleRequestSchema.parse({
      name: 'Missing target scope',
      fireIdempotencyKeyPrefix: 'schedule:missing-target',
      mode: { type: 'delayed', runAt: '2026-05-16T11:00:00.000Z' },
    })).toThrow();
    expect(() => scheduleModeSchema.parse({ type: 'interval', everySeconds: 0 })).toThrow();
    expect(() => scheduleModeSchema.parse({ type: 'cron', expression: 'not cron', timezone: 'UTC' })).toThrow();
    expect(() => scheduleModeSchema.parse({ type: 'cron', expression: '99 99 99 99 99', timezone: 'UTC' })).toThrow();
    expect(() => scheduleModeSchema.parse({ type: 'cron', expression: '0 0 32 13 8', timezone: 'UTC' })).toThrow();
    expect(() => scheduleModeSchema.parse({
      type: 'interval',
      everySeconds: 60,
      startAt: '2026-05-16T12:00:00.000Z',
      endAt: '2026-05-16T11:00:00.000Z',
    })).toThrow();
    expect(() => scheduleTargetSchema.parse({ type: 'workflow', request: {} })).toThrow();
    expect(() => updateScheduleRequestSchema.parse({})).toThrow();
  });
});
