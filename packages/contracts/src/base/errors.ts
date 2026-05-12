import { z } from 'zod';

const nonBlankStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Expected a non-empty string');

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: nonBlankStringSchema.max(128),
    message: nonBlankStringSchema.max(4096),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
