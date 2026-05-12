import { z } from 'zod';

const uuidV7Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const uuidV7Schema = z
  .string()
  .regex(uuidV7Pattern, 'Expected a UUIDv7-shaped identifier');

export const tenantIdSchema = uuidV7Schema.describe('Tenant identifier');
export const projectIdSchema = uuidV7Schema.describe('Project identifier');
export const eventIdSchema = uuidV7Schema.describe('Event identifier');

export type UuidV7 = z.infer<typeof uuidV7Schema>;
export type TenantId = z.infer<typeof tenantIdSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;
export type EventId = z.infer<typeof eventIdSchema>;
