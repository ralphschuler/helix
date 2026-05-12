import { z } from 'zod';

import { uuidV7Schema } from './ids.js';
import { tenantProjectScopeSchema, tenantScopeSchema } from './scope.js';

const nonBlankStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Expected a non-empty string');

const isoDateTimeSchema = z.string().datetime({ offset: true });
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u, 'Expected a SHA-256 hex digest');

export const permissionCatalog = [
  'admin:read',
  'iam:permissions:read',
  'iam:roles:read',
  'iam:roles:write',
  'project_api_keys:create',
  'project_api_keys:read',
  'project_api_keys:revoke',
  'agents:register',
  'agents:read',
  'agents:revoke',
  'agents:claim',
  'jobs:create',
  'workflows:start',
  'audit:read',
] as const;

export const catalogPermissionSchema = z.enum(permissionCatalog);

const catalogPermissionSetSchema = z
  .array(catalogPermissionSchema)
  .min(1)
  .refine(
    (permissions) => new Set(permissions).size === permissions.length,
    'Permissions must be unique',
  );

export const customRoleSchema = tenantScopeSchema
  .extend({
    id: uuidV7Schema,
    slug: nonBlankStringSchema.max(128),
    name: nonBlankStringSchema.max(128),
    permissions: catalogPermissionSetSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const projectApiKeyRecordSchema = tenantProjectScopeSchema
  .extend({
    id: uuidV7Schema,
    name: nonBlankStringSchema.max(128),
    keyPrefix: nonBlankStringSchema.max(64),
    secretHashSha256: sha256HexSchema,
    permissions: catalogPermissionSetSchema,
    createdAt: isoDateTimeSchema,
    revokedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const agentRegistrationCredentialRecordSchema = tenantProjectScopeSchema
  .extend({
    id: uuidV7Schema,
    name: nonBlankStringSchema.max(128),
    credentialPrefix: nonBlankStringSchema.max(64),
    credentialHashSha256: sha256HexSchema,
    permissions: catalogPermissionSetSchema,
    createdAt: isoDateTimeSchema,
    revokedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const agentTokenRecordSchema = tenantProjectScopeSchema
  .extend({
    id: uuidV7Schema,
    agentId: uuidV7Schema,
    tokenPrefix: nonBlankStringSchema.max(64),
    tokenHashSha256: sha256HexSchema,
    permissions: catalogPermissionSetSchema,
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    revokedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export type CatalogPermission = z.infer<typeof catalogPermissionSchema>;
export type CustomRole = z.infer<typeof customRoleSchema>;
export type ProjectApiKeyRecord = z.infer<typeof projectApiKeyRecordSchema>;
export type AgentRegistrationCredentialRecord = z.infer<
  typeof agentRegistrationCredentialRecordSchema
>;
export type AgentTokenRecord = z.infer<typeof agentTokenRecordSchema>;
