import { z } from 'zod';

import { tenantProjectScopeSchema } from './scope.js';

const nonBlankStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Expected a non-empty string');

export const principalTypeSchema = z.enum(['user', 'api_key', 'agent_token', 'service']);
export const principalIdSchema = nonBlankStringSchema.max(255);
export const permissionSchema = nonBlankStringSchema.max(128);

export const authPrincipalSchema = z.object({
  type: principalTypeSchema,
  id: principalIdSchema,
});

export const authContextSchema = tenantProjectScopeSchema.extend({
  principal: authPrincipalSchema,
  permissions: z.array(permissionSchema),
});

export type PrincipalType = z.infer<typeof principalTypeSchema>;
export type PrincipalId = z.infer<typeof principalIdSchema>;
export type Permission = z.infer<typeof permissionSchema>;
export type AuthPrincipal = z.infer<typeof authPrincipalSchema>;
export type AuthContext = z.infer<typeof authContextSchema>;
