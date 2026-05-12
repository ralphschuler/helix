import { z } from 'zod';

import { tenantProjectScopeSchema } from './scope.js';

export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value.trim().length > 0, 'Expected a non-empty idempotency key');

export const idempotencyKeyScopeSchema = tenantProjectScopeSchema.extend({
  idempotencyKey: idempotencyKeySchema,
});

export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;
export type IdempotencyKeyScope = z.infer<typeof idempotencyKeyScopeSchema>;
