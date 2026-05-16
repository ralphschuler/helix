import { z } from 'zod';

import { createJobRequestSchema } from './jobs.js';
import { startWorkflowRunRequestSchema } from './workflows.js';
import { idempotencyKeySchema } from './idempotency.js';
import { uuidV7Schema } from './ids.js';
import { tenantProjectScopeSchema } from './scope.js';

const isoTimestampSchema = z.string().datetime({ offset: true });
const nonBlankTextSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Expected non-blank text');
const metadataSchema = z.record(z.string(), z.unknown());
const cronFieldBounds = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
] as const;

export const scheduleStateValues = ['enabled', 'disabled'] as const;
export const scheduleMisfirePolicyValues = ['skip', 'fire_once', 'catch_up'] as const;

export const scheduleStateSchema = z.enum(scheduleStateValues);
export const scheduleMisfirePolicySchema = z.enum(scheduleMisfirePolicyValues);

export const scheduleTargetSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('job'),
      request: createJobRequestSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('workflow'),
      workflowId: uuidV7Schema,
      request: startWorkflowRunRequestSchema,
    })
    .strict(),
]);

export const delayedScheduleModeSchema = z
  .object({
    type: z.literal('delayed'),
    runAt: isoTimestampSchema,
  })
  .strict();

export const cronScheduleModeSchema = z
  .object({
    type: z.literal('cron'),
    expression: z
      .string()
      .trim()
      .refine((value) => value.split(/\s+/u).length === 5, 'Expected five-field cron expression')
      .refine(
        (value) => value.split(/\s+/u).every((field, index) => isValidCronField(field, cronFieldBounds[index])),
        'Expected simple bounded numeric cron fields',
      ),
    timezone: nonBlankTextSchema.max(128),
  })
  .strict();

export const intervalScheduleModeSchema = z
  .object({
    type: z.literal('interval'),
    everySeconds: z.number().int().positive(),
    startAt: isoTimestampSchema.optional(),
    endAt: isoTimestampSchema.optional(),
  })
  .strict()
  .refine(
    (mode) => mode.startAt === undefined || mode.endAt === undefined || Date.parse(mode.endAt) > Date.parse(mode.startAt),
    { message: 'Interval endAt must be after startAt', path: ['endAt'] },
  );

export const scheduleModeSchema = z.discriminatedUnion('type', [
  delayedScheduleModeSchema,
  cronScheduleModeSchema,
  intervalScheduleModeSchema,
]);

export const createScheduleRequestSchema = z
  .object({
    name: nonBlankTextSchema.max(256),
    description: nonBlankTextSchema.max(2048).nullable().optional(),
    state: scheduleStateSchema.optional(),
    target: scheduleTargetSchema,
    mode: scheduleModeSchema,
    misfirePolicy: scheduleMisfirePolicySchema.optional(),
    fireIdempotencyKeyPrefix: idempotencyKeySchema,
    metadata: metadataSchema.optional(),
  })
  .strict();

export const updateScheduleRequestSchema = z
  .object({
    name: nonBlankTextSchema.max(256).optional(),
    description: nonBlankTextSchema.max(2048).nullable().optional(),
    state: scheduleStateSchema.optional(),
    target: scheduleTargetSchema.optional(),
    mode: scheduleModeSchema.optional(),
    misfirePolicy: scheduleMisfirePolicySchema.optional(),
    fireIdempotencyKeyPrefix: idempotencyKeySchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Expected at least one schedule update');

export const scheduleRecordSchema = tenantProjectScopeSchema
  .extend({
    id: uuidV7Schema,
    name: nonBlankTextSchema.max(256),
    description: nonBlankTextSchema.max(2048).nullable(),
    state: scheduleStateSchema,
    target: scheduleTargetSchema,
    mode: scheduleModeSchema,
    misfirePolicy: scheduleMisfirePolicySchema,
    fireIdempotencyKeyPrefix: idempotencyKeySchema,
    metadata: metadataSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const scheduleResponseSchema = z
  .object({
    schedule: scheduleRecordSchema,
  })
  .strict();

export const scheduleListResponseSchema = z
  .object({
    schedules: z.array(scheduleRecordSchema),
  })
  .strict();

export type ScheduleState = z.infer<typeof scheduleStateSchema>;
export type ScheduleMisfirePolicy = z.infer<typeof scheduleMisfirePolicySchema>;
export type ScheduleTarget = z.infer<typeof scheduleTargetSchema>;
export type ScheduleMode = z.infer<typeof scheduleModeSchema>;
export type CreateScheduleRequest = z.infer<typeof createScheduleRequestSchema>;
export type UpdateScheduleRequest = z.infer<typeof updateScheduleRequestSchema>;
export type ScheduleRecord = z.infer<typeof scheduleRecordSchema>;
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>;
export type ScheduleListResponse = z.infer<typeof scheduleListResponseSchema>;

function isValidCronField(field: string, bounds: { readonly min: number; readonly max: number } | undefined): boolean {
  if (bounds === undefined) {
    return false;
  }

  if (field === '*') {
    return true;
  }

  return field.split(',').every((part) => isValidCronPart(part, bounds));
}

function isValidCronPart(part: string, bounds: { readonly min: number; readonly max: number }): boolean {
  const [range, step] = part.split('/');

  if (range === undefined || range.length === 0) {
    return false;
  }

  if (step !== undefined && !isValidCronNumber(step, { min: 1, max: bounds.max })) {
    return false;
  }

  if (range === '*') {
    return true;
  }

  const rangeParts = range.split('-');

  if (rangeParts.length === 1) {
    return isValidCronNumber(rangeParts[0], bounds);
  }

  if (rangeParts.length !== 2) {
    return false;
  }

  const [startRaw, endRaw] = rangeParts;

  if (startRaw === undefined || endRaw === undefined) {
    return false;
  }

  const start = parseCronNumber(startRaw);
  const end = parseCronNumber(endRaw);

  if (start === null || end === null || start > end) {
    return false;
  }

  return start >= bounds.min && end <= bounds.max;
}

function isValidCronNumber(value: string | undefined, bounds: { readonly min: number; readonly max: number }): boolean {
  const parsed = parseCronNumber(value);
  return parsed !== null && parsed >= bounds.min && parsed <= bounds.max;
}

function parseCronNumber(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/u.test(value)) {
    return null;
  }

  return Number(value);
}
