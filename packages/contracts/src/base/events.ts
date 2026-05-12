import { z } from 'zod';

import { eventIdSchema } from './ids.js';
import { tenantProjectScopeSchema } from './scope.js';

const nonBlankStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Expected a non-empty string');

export const eventEnvelopeSchema = z.object({
  id: eventIdSchema,
  type: nonBlankStringSchema,
  version: z.number().int().positive(),
  occurredAt: z.string().datetime({ offset: true }),
  scope: tenantProjectScopeSchema,
  payload: z.record(z.string(), z.unknown()),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
