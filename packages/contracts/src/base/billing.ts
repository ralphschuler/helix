import { z } from 'zod';

import { idempotencyKeySchema } from './idempotency.js';
import { projectIdSchema, uuidV7Schema } from './ids.js';
import { tenantScopeSchema } from './scope.js';

const nonBlankStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Expected a non-empty string');

const isoDateTimeSchema = z.string().datetime({ offset: true });

export const billingStatusCatalog = [
  'unconfigured',
  'active',
  'past_due',
  'canceled',
  'incomplete',
] as const;

export const billingStatusSchema = z.enum(billingStatusCatalog);

const organizationScopedSchema = tenantScopeSchema.extend({
  organizationId: uuidV7Schema,
});

export const stripeCustomerMappingSchema = organizationScopedSchema
  .extend({
    id: uuidV7Schema,
    stripeCustomerId: nonBlankStringSchema.max(255),
    billingStatus: billingStatusSchema,
    currentSubscriptionId: nonBlankStringSchema.max(255).nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const usageLedgerRecordSchema = organizationScopedSchema
  .extend({
    id: uuidV7Schema,
    projectId: projectIdSchema.nullable(),
    usageType: nonBlankStringSchema.max(128),
    quantity: z.number().int().positive(),
    idempotencyKey: idempotencyKeySchema,
    metadata: z.record(z.string(), z.unknown()),
    recordedAt: isoDateTimeSchema,
  })
  .strict();

export const stripeWebhookEventRecordSchema = organizationScopedSchema
  .extend({
    stripeEventId: nonBlankStringSchema.max(255),
    stripeCustomerId: nonBlankStringSchema.max(255),
    eventType: nonBlankStringSchema.max(255),
    processedAt: isoDateTimeSchema,
  })
  .strict();

export type BillingStatus = z.infer<typeof billingStatusSchema>;
export type StripeCustomerMapping = z.infer<typeof stripeCustomerMappingSchema>;
export type UsageLedgerRecord = z.infer<typeof usageLedgerRecordSchema>;
export type StripeWebhookEventRecord = z.infer<typeof stripeWebhookEventRecordSchema>;
