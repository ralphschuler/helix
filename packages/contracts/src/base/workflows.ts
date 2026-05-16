import { z } from 'zod';

import { idempotencyKeySchema } from './idempotency.js';
import { uuidV7Schema } from './ids.js';
import { tenantProjectScopeSchema } from './scope.js';

const isoTimestampSchema = z.string().datetime({ offset: true });
const nonBlankTextSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Expected non-blank text');
const metadataSchema = z.record(z.string(), z.unknown());
const workflowGraphSchema = z.record(z.string(), z.unknown());

export const workflowDefinitionRecordSchema = tenantProjectScopeSchema
  .extend({
    id: uuidV7Schema,
    slug: nonBlankTextSchema.max(128),
    name: nonBlankTextSchema.max(256),
    description: nonBlankTextSchema.max(2048).nullable(),
    draftGraph: workflowGraphSchema,
    metadata: metadataSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const workflowVersionRecordSchema = tenantProjectScopeSchema
  .extend({
    id: uuidV7Schema,
    workflowId: uuidV7Schema,
    versionNumber: z.number().int().positive(),
    graph: workflowGraphSchema,
    metadata: metadataSchema,
    publishedAt: isoTimestampSchema,
    createdAt: isoTimestampSchema,
  })
  .strict();

export const workflowRunRecordSchema = tenantProjectScopeSchema
  .extend({
    id: uuidV7Schema,
    workflowId: uuidV7Schema,
    workflowVersionId: uuidV7Schema,
    state: z.enum(['queued', 'running', 'completed', 'failed', 'canceled']),
    idempotencyKey: idempotencyKeySchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const workflowStepStateValues = ['pending', 'running', 'waiting_for_signal', 'completed', 'failed', 'canceled'] as const;
export const workflowStepTypeValues = ['job', 'wait_signal', 'approval', 'timer', 'pause', 'join', 'completion'] as const;
export const workflowStepStateSchema = z.enum(workflowStepStateValues);
export const workflowStepTypeSchema = z.enum(workflowStepTypeValues);

export const workflowStepRecordSchema = tenantProjectScopeSchema
  .extend({
    id: uuidV7Schema,
    workflowId: uuidV7Schema,
    workflowVersionId: uuidV7Schema,
    runId: uuidV7Schema,
    stepId: nonBlankTextSchema.max(256),
    type: workflowStepTypeSchema,
    state: workflowStepStateSchema,
    jobId: uuidV7Schema.nullable(),
    metadata: metadataSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const createWorkflowRequestSchema = z
  .object({
    slug: nonBlankTextSchema.max(128),
    name: nonBlankTextSchema.max(256),
    description: nonBlankTextSchema.max(2048).optional(),
    draftGraph: workflowGraphSchema,
    metadata: metadataSchema.optional(),
  })
  .strict();

export const updateWorkflowDraftRequestSchema = z
  .object({
    name: nonBlankTextSchema.max(256).optional(),
    description: nonBlankTextSchema.max(2048).nullable().optional(),
    draftGraph: workflowGraphSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Expected at least one draft update');

export const publishWorkflowRequestSchema = z.object({}).strict();

export const startWorkflowRunRequestSchema = z
  .object({
    workflowVersionId: uuidV7Schema.optional(),
  })
  .strict();

export const deliverWorkflowSignalRequestSchema = z
  .object({
    runId: uuidV7Schema,
    stepId: nonBlankTextSchema.max(256),
    payload: metadataSchema.optional(),
  })
  .strict();

export const workflowResponseSchema = z
  .object({
    workflow: workflowDefinitionRecordSchema,
  })
  .strict();

export const workflowListResponseSchema = z
  .object({
    workflows: z.array(workflowDefinitionRecordSchema),
  })
  .strict();

export const workflowVersionResponseSchema = z
  .object({
    version: workflowVersionRecordSchema,
  })
  .strict();

export const workflowRunResponseSchema = z
  .object({
    run: workflowRunRecordSchema,
  })
  .strict();

export const workflowSignalResponseSchema = z
  .object({
    step: workflowStepRecordSchema,
    duplicate: z.boolean(),
  })
  .strict();

export const workflowRunListResponseSchema = z
  .object({
    runs: z.array(workflowRunRecordSchema),
  })
  .strict();

export const workflowRunStartedEventPayloadSchema = tenantProjectScopeSchema
  .extend({
    workflowId: uuidV7Schema,
    workflowVersionId: uuidV7Schema,
    runId: uuidV7Schema,
    state: z.literal('queued'),
    idempotencyKey: idempotencyKeySchema,
    startedAt: isoTimestampSchema,
  })
  .strict();

export type WorkflowDefinitionRecord = z.infer<typeof workflowDefinitionRecordSchema>;
export type WorkflowVersionRecord = z.infer<typeof workflowVersionRecordSchema>;
export type WorkflowRunRecord = z.infer<typeof workflowRunRecordSchema>;
export type WorkflowStepState = z.infer<typeof workflowStepStateSchema>;
export type WorkflowStepType = z.infer<typeof workflowStepTypeSchema>;
export type WorkflowStepRecord = z.infer<typeof workflowStepRecordSchema>;
export type CreateWorkflowRequest = z.infer<typeof createWorkflowRequestSchema>;
export type UpdateWorkflowDraftRequest = z.infer<typeof updateWorkflowDraftRequestSchema>;
export type PublishWorkflowRequest = z.infer<typeof publishWorkflowRequestSchema>;
export type StartWorkflowRunRequest = z.infer<typeof startWorkflowRunRequestSchema>;
export type DeliverWorkflowSignalRequest = z.infer<typeof deliverWorkflowSignalRequestSchema>;
export type WorkflowSignalResponse = z.infer<typeof workflowSignalResponseSchema>;
export type WorkflowRunStartedEventPayload = z.infer<typeof workflowRunStartedEventPayloadSchema>;
