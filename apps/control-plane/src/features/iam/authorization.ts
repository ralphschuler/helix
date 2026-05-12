import type { AuthContext, Permission, TenantProjectScope } from '@helix/contracts';

export type AuthorizationFailureReason =
  | 'missing_permission'
  | 'wrong_tenant_scope'
  | 'wrong_project_scope';

export type AuthorizationResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: AuthorizationFailureReason };

export class AuthorizationError extends Error {
  readonly reason: AuthorizationFailureReason;

  constructor(reason: AuthorizationFailureReason) {
    super(`Authorization failed: ${reason}`);
    this.name = 'AuthorizationError';
    this.reason = reason;
  }
}

export function authorizeProjectPermission(
  authContext: AuthContext,
  targetScope: TenantProjectScope,
  permission: Permission,
): AuthorizationResult {
  if (authContext.tenantId !== targetScope.tenantId) {
    return { allowed: false, reason: 'wrong_tenant_scope' };
  }

  if (authContext.projectId !== targetScope.projectId) {
    return { allowed: false, reason: 'wrong_project_scope' };
  }

  if (!authContext.permissions.includes(permission)) {
    return { allowed: false, reason: 'missing_permission' };
  }

  return { allowed: true };
}

export function assertProjectPermission(
  authContext: AuthContext,
  targetScope: TenantProjectScope,
  permission: Permission,
): void {
  const authorization = authorizeProjectPermission(authContext, targetScope, permission);

  if (!authorization.allowed) {
    throw new AuthorizationError(authorization.reason);
  }
}
