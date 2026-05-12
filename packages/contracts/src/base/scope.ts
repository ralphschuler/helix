import { z } from 'zod';

import { projectIdSchema, tenantIdSchema } from './ids.js';

export const tenantScopeSchema = z.object({
  tenantId: tenantIdSchema,
});

export const tenantProjectScopeSchema = tenantScopeSchema.extend({
  projectId: projectIdSchema,
});

export type TenantScope = z.infer<typeof tenantScopeSchema>;
export type TenantProjectScope = z.infer<typeof tenantProjectScopeSchema>;
