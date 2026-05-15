import { z } from 'zod';

import { idempotencyKeySchema } from './idempotency.js';
import { uuidV7Schema } from './ids.js';
import { routingExplanationSchema } from './processors.js';
import { tenantProjectScopeSchema } from './scope.js';

export const jobStateValues = [
  'queued',
  'running',
  'retrying',
  'completed',
  'failed',
  'dead_lettered',
  'canceled',
] as const;
export const attemptStateValues = ['running', 'completed', 'failed', 'expired', 'canceled'] as const;
export const leaseStateValues = ['active', 'released', 'expired', 'canceled'] as const;

export const jobStateSchema = z.enum(jobStateValues);
export const attemptStateSchema = z.enum(attemptStateValues);
export const leaseStateSchema = z.enum(leaseStateValues);

const terminalJobStates = new Set<string>(['completed', 'failed', 'dead_lettered', 'canceled']);
const terminalAttemptStates = new Set<string>(['completed', 'failed', 'expired', 'canceled']);

const isoTimestampSchema = z.string().datetime({ offset: true });
const nullableIsoTimestampSchema = isoTimestampSchema.nullable();
const nonBlankTextSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Expected non-blank text');
const nullableNonBlankTextSchema = nonBlankTextSchema.nullable();
const metadataSchema = z.record(z.string(), z.unknown());

export const jobRecordSchema = tenantProjectScopeSchema
  .extend({
    id: uuidV7Schema,
    state: jobStateSchema,
    priority: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    attemptCount: z.number().int().nonnegative(),
    readyAt: isoTimestampSchema,
    idempotencyKey: idempotencyKeySchema.nullable(),
    constraints: metadataSchema,
    metadata: metadataSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    finishedAt: nullableIsoTimestampSchema,
  })
  .strict()
  .refine((job) => job.attemptCount <= job.maxAttempts, {
    message: 'Attempt count cannot exceed max attempts',
    path: ['attemptCount'],
  })
  .refine((job) => terminalJobStates.has(job.state) === (job.finishedAt !== null), {
    message: 'Terminal job states require finishedAt and nonterminal states must not set it',
    path: ['finishedAt'],
  });

export const jobAttemptRecordSchema = tenantProjectScopeSchema
  .extend({
    id: uuidV7Schema,
    jobId: uuidV7Schema,
    attemptNumber: z.number().int().positive(),
    state: attemptStateSchema,
    agentId: uuidV7Schema.nullable(),
    startedAt: isoTimestampSchema,
    finishedAt: nullableIsoTimestampSchema,
    failureCode: nullableNonBlankTextSchema,
    failureMessage: nullableNonBlankTextSchema,
  })
  .strict()
  .refine((attempt) => terminalAttemptStates.has(attempt.state) === (attempt.finishedAt !== null), {
    message: 'Terminal attempt states require finishedAt and running attempts must not set it',
    path: ['finishedAt'],
  })
  .refine((attempt) => attempt.state !== 'failed' || attempt.failureCode !== null, {
    message: 'Failed attempts require a failure code',
    path: ['failureCode'],
  });

export const jobLeaseRecordSchema = tenantProjectScopeSchema
  .extend({
    id: uuidV7Schema,
    jobId: uuidV7Schema,
    attemptId: uuidV7Schema,
    agentId: uuidV7Schema,
    state: leaseStateSchema,
    acquiredAt: isoTimestampSchema,
    expiresAt: isoTimestampSchema,
    lastHeartbeatAt: isoTimestampSchema,
    releasedAt: nullableIsoTimestampSchema,
    expiredAt: nullableIsoTimestampSchema,
    canceledAt: nullableIsoTimestampSchema,
  })
  .strict()
  .refine((lease) => Date.parse(lease.expiresAt) > Date.parse(lease.acquiredAt), {
    message: 'Lease expiry must be after acquisition',
    path: ['expiresAt'],
  })
  .refine(
    (lease) =>
      Date.parse(lease.lastHeartbeatAt) >= Date.parse(lease.acquiredAt) &&
      Date.parse(lease.lastHeartbeatAt) <= Date.parse(lease.expiresAt),
    {
      message: 'Lease heartbeat must stay inside the lease window',
      path: ['lastHeartbeatAt'],
    },
  )
  .refine(
    (lease) => {
      if (lease.state === 'active') {
        return lease.releasedAt === null && lease.expiredAt === null && lease.canceledAt === null;
      }
      if (lease.state === 'released') {
        return lease.releasedAt !== null && lease.expiredAt === null && lease.canceledAt === null;
      }
      if (lease.state === 'expired') {
        return lease.releasedAt === null && lease.expiredAt !== null && lease.canceledAt === null;
      }

      return lease.releasedAt === null && lease.expiredAt === null && lease.canceledAt !== null;
    },
    {
      message: 'Lease terminal timestamp must match exactly one terminal state',
      path: ['state'],
    },
  );

export const createJobRequestSchema = z
  .object({
    priority: z.number().int().nonnegative().optional(),
    maxAttempts: z.number().int().positive().optional(),
    readyAt: isoTimestampSchema.optional(),
    constraints: metadataSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .strict();

const leaseTtlSecondsSchema = z.number().int().positive().max(86_400);

export const claimJobRequestSchema = z
  .object({
    leaseTtlSeconds: leaseTtlSecondsSchema.optional(),
  })
  .strict();

export const heartbeatLeaseRequestSchema = z
  .object({
    leaseTtlSeconds: leaseTtlSecondsSchema.optional(),
  })
  .strict();

export const completeJobAttemptRequestSchema = z.object({}).strict();

export const failJobAttemptRequestSchema = z
  .object({
    failureCode: nonBlankTextSchema,
    failureMessage: nonBlankTextSchema.optional(),
  })
  .strict();

export const claimedJobSchema = z
  .object({
    job: jobRecordSchema,
    attempt: jobAttemptRecordSchema,
    lease: jobLeaseRecordSchema,
  })
  .strict();

export const jobResponseSchema = z
  .object({
    job: jobRecordSchema,
    ready: z.boolean(),
  })
  .strict();

export const jobListResponseSchema = z
  .object({
    jobs: z.array(jobRecordSchema),
  })
  .strict();

export const jobHistoryResponseSchema = z
  .object({
    job: jobRecordSchema,
    attempts: z.array(jobAttemptRecordSchema),
    leases: z.array(jobLeaseRecordSchema),
  })
  .strict();

export const claimRejectionReasonSchema = z.enum([
  'processor_not_registered',
  'routing_constraints_unmatched',
]);

export const claimRejectionSchema = z
  .object({
    reason: claimRejectionReasonSchema,
    jobId: uuidV7Schema.nullable(),
    processorId: uuidV7Schema.nullable(),
    agentId: uuidV7Schema,
    explanation: routingExplanationSchema.nullable(),
  })
  .strict();

export const claimJobResponseSchema = z
  .object({
    claim: claimedJobSchema.nullable(),
    rejection: claimRejectionSchema.nullable().optional(),
  })
  .strict();

export const heartbeatLeaseResponseSchema = z
  .object({
    lease: jobLeaseRecordSchema,
  })
  .strict();

export const completeJobAttemptResponseSchema = z
  .object({
    transition: claimedJobSchema,
    duplicate: z.boolean(),
  })
  .strict();

export const failJobAttemptResponseSchema = z
  .object({
    transition: claimedJobSchema,
    duplicate: z.boolean(),
  })
  .strict();

export const jobCreatedEventPayloadSchema = tenantProjectScopeSchema
  .extend({
    jobId: uuidV7Schema,
    state: jobStateSchema,
    idempotencyKey: idempotencyKeySchema,
    readyAt: isoTimestampSchema,
  })
  .strict();

export const jobReadyEventPayloadSchema = tenantProjectScopeSchema
  .extend({
    jobId: uuidV7Schema,
    readyAt: isoTimestampSchema,
  })
  .strict();

export const jobClaimedEventPayloadSchema = tenantProjectScopeSchema
  .extend({
    jobId: uuidV7Schema,
    attemptId: uuidV7Schema,
    leaseId: uuidV7Schema,
    agentId: uuidV7Schema,
    claimedAt: isoTimestampSchema,
  })
  .strict();

export const jobClaimRejectedEventPayloadSchema = tenantProjectScopeSchema
  .extend({
    jobId: uuidV7Schema.nullable(),
    processorId: uuidV7Schema.nullable(),
    agentId: uuidV7Schema,
    reason: claimRejectionReasonSchema,
    explanation: routingExplanationSchema.nullable(),
    rejectedAt: isoTimestampSchema,
  })
  .strict();

export const jobCompletedEventPayloadSchema = tenantProjectScopeSchema
  .extend({
    jobId: uuidV7Schema,
    attemptId: uuidV7Schema,
    leaseId: uuidV7Schema,
    agentId: uuidV7Schema,
    completedAt: isoTimestampSchema,
  })
  .strict();

export const jobAttemptFailedEventPayloadSchema = tenantProjectScopeSchema
  .extend({
    jobId: uuidV7Schema,
    attemptId: uuidV7Schema,
    leaseId: uuidV7Schema,
    agentId: uuidV7Schema,
    failureCode: nonBlankTextSchema,
    failureMessage: nullableNonBlankTextSchema,
    failedAt: isoTimestampSchema,
  })
  .strict();

export type JobState = z.infer<typeof jobStateSchema>;
export type AttemptState = z.infer<typeof attemptStateSchema>;
export type LeaseState = z.infer<typeof leaseStateSchema>;
export type JobRecord = z.infer<typeof jobRecordSchema>;
export type JobAttemptRecord = z.infer<typeof jobAttemptRecordSchema>;
export type JobLeaseRecord = z.infer<typeof jobLeaseRecordSchema>;
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;
export type ClaimJobRequest = z.infer<typeof claimJobRequestSchema>;
export type ClaimRejectionReason = z.infer<typeof claimRejectionReasonSchema>;
export type ClaimRejection = z.infer<typeof claimRejectionSchema>;
export type HeartbeatLeaseRequest = z.infer<typeof heartbeatLeaseRequestSchema>;
export type CompleteJobAttemptRequest = z.infer<typeof completeJobAttemptRequestSchema>;
export type FailJobAttemptRequest = z.infer<typeof failJobAttemptRequestSchema>;
export type ClaimedJob = z.infer<typeof claimedJobSchema>;
export type JobResponse = z.infer<typeof jobResponseSchema>;
export type JobListResponse = z.infer<typeof jobListResponseSchema>;
export type JobHistoryResponse = z.infer<typeof jobHistoryResponseSchema>;
export type ClaimJobResponse = z.infer<typeof claimJobResponseSchema>;
export type HeartbeatLeaseResponse = z.infer<typeof heartbeatLeaseResponseSchema>;
export type CompleteJobAttemptResponse = z.infer<typeof completeJobAttemptResponseSchema>;
export type FailJobAttemptResponse = z.infer<typeof failJobAttemptResponseSchema>;
export type JobCreatedEventPayload = z.infer<typeof jobCreatedEventPayloadSchema>;
export type JobReadyEventPayload = z.infer<typeof jobReadyEventPayloadSchema>;
export type JobClaimedEventPayload = z.infer<typeof jobClaimedEventPayloadSchema>;
export type JobClaimRejectedEventPayload = z.infer<typeof jobClaimRejectedEventPayloadSchema>;
export type JobCompletedEventPayload = z.infer<typeof jobCompletedEventPayloadSchema>;
export type JobAttemptFailedEventPayload = z.infer<typeof jobAttemptFailedEventPayloadSchema>;
