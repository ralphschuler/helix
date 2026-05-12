import { z } from 'zod';

export const opaqueCursorSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => value.trim().length > 0, 'Expected a non-empty cursor');

export type OpaqueCursor = z.infer<typeof opaqueCursorSchema>;
