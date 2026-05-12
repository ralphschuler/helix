import { permissionCatalog, type AuthContext, type CatalogPermission, type Permission, type TenantScope } from '@helix/contracts';

import { assertTenantPermission } from './authorization.js';
import type { SecurityAuditSink } from './security-audit.js';
import { randomUuidV7LikeId } from './token-secrets.js';

const roleReadPermission = 'iam:roles:read';
const roleWritePermission = 'iam:roles:write';
const catalogPermissions = new Set<string>(permissionCatalog);

export interface CustomRoleRecord extends TenantScope {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly permissions: readonly CatalogPermission[];
  readonly disabledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CustomRoleRepository {
  insertCustomRole(record: CustomRoleRecord): Promise<void>;
  findCustomRoleById(id: string): Promise<CustomRoleRecord | null>;
  findCustomRoleBySlug(input: TenantScope & {
    readonly slug: string;
  }): Promise<CustomRoleRecord | null>;
  listCustomRoles(input: TenantScope): Promise<CustomRoleRecord[]>;
  updateCustomRole(record: CustomRoleRecord): Promise<void>;
}

export interface CreateCustomRoleInput extends TenantScope {
  readonly slug: string;
  readonly name: string;
  readonly permissions: readonly Permission[];
}

export interface UpdateCustomRoleInput extends TenantScope {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly Permission[];
}

export interface DisableCustomRoleInput extends TenantScope {
  readonly id: string;
}

export interface CustomRoleServiceOptions {
  readonly repository: CustomRoleRepository;
  readonly auditSink: SecurityAuditSink;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export class CustomRoleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomRoleValidationError';
  }
}

export class DuplicateCustomRoleSlugError extends Error {
  constructor(slug: string) {
    super(`Custom role slug already exists: ${slug}`);
    this.name = 'DuplicateCustomRoleSlugError';
  }
}

export class CustomRoleNotFoundError extends Error {
  constructor(id: string) {
    super(`Custom role was not found: ${id}`);
    this.name = 'CustomRoleNotFoundError';
  }
}

export class CustomRolePrivilegeEscalationError extends Error {
  constructor(permission: string) {
    super(`Cannot grant permission the actor does not have: ${permission}`);
    this.name = 'CustomRolePrivilegeEscalationError';
  }
}

export class CustomRoleService {
  private readonly repository: CustomRoleRepository;
  private readonly auditSink: SecurityAuditSink;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options: CustomRoleServiceOptions) {
    this.repository = options.repository;
    this.auditSink = options.auditSink;
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => randomUuidV7LikeId(this.now()));
  }

  async listCustomRoles(
    actorContext: AuthContext,
    input: TenantScope,
  ): Promise<CustomRoleRecord[]> {
    assertTenantPermission(actorContext, input, roleReadPermission);

    return this.repository.listCustomRoles(input);
  }

  async createCustomRole(
    actorContext: AuthContext,
    input: CreateCustomRoleInput,
  ): Promise<CustomRoleRecord> {
    assertTenantPermission(actorContext, input, roleWritePermission);

    const slug = normalizeNonBlank(input.slug, 'slug');
    const name = normalizeNonBlank(input.name, 'name');
    const permissions = validatePermissions(input.permissions);
    assertActorCanGrantPermissions(actorContext, permissions);

    if (await this.repository.findCustomRoleBySlug({ tenantId: input.tenantId, slug })) {
      throw new DuplicateCustomRoleSlugError(slug);
    }

    const createdAt = this.now();
    const id = this.generateId();
    const record: CustomRoleRecord = {
      id,
      tenantId: input.tenantId,
      slug,
      name,
      permissions,
      disabledAt: null,
      createdAt,
      updatedAt: createdAt,
    };

    await this.repository.insertCustomRole(record);
    await this.auditSink.record({
      id: this.generateId(),
      tenantId: input.tenantId,
      projectId: null,
      actor: actorContext.principal,
      action: 'iam.custom_role.created',
      resourceType: 'custom_role',
      resourceId: id,
      metadata: {
        slug,
        permissions: [...permissions],
      },
      occurredAt: createdAt,
    });

    return record;
  }

  async updateCustomRole(
    actorContext: AuthContext,
    input: UpdateCustomRoleInput,
  ): Promise<CustomRoleRecord> {
    assertTenantPermission(actorContext, input, roleWritePermission);

    const existing = await this.findOwnedRole(input.tenantId, input.id);
    const name = normalizeNonBlank(input.name, 'name');
    const permissions = validatePermissions(input.permissions);
    assertActorCanGrantPermissions(actorContext, permissions);

    const updatedAt = this.now();
    const updated: CustomRoleRecord = {
      ...existing,
      name,
      permissions,
      updatedAt,
    };

    await this.repository.updateCustomRole(updated);
    await this.auditSink.record({
      id: this.generateId(),
      tenantId: input.tenantId,
      projectId: null,
      actor: actorContext.principal,
      action: 'iam.custom_role.updated',
      resourceType: 'custom_role',
      resourceId: existing.id,
      metadata: {
        slug: existing.slug,
        previousPermissions: [...existing.permissions],
        nextPermissions: [...permissions],
      },
      occurredAt: updatedAt,
    });

    return updated;
  }

  async disableCustomRole(
    actorContext: AuthContext,
    input: DisableCustomRoleInput,
  ): Promise<CustomRoleRecord> {
    assertTenantPermission(actorContext, input, roleWritePermission);

    const existing = await this.findOwnedRole(input.tenantId, input.id);

    if (existing.disabledAt !== null) {
      return existing;
    }

    const disabledAt = this.now();
    const disabled: CustomRoleRecord = {
      ...existing,
      disabledAt,
      updatedAt: disabledAt,
    };

    await this.repository.updateCustomRole(disabled);
    await this.auditSink.record({
      id: this.generateId(),
      tenantId: input.tenantId,
      projectId: null,
      actor: actorContext.principal,
      action: 'iam.custom_role.disabled',
      resourceType: 'custom_role',
      resourceId: existing.id,
      metadata: {
        slug: existing.slug,
      },
      occurredAt: disabledAt,
    });

    return disabled;
  }

  private async findOwnedRole(tenantId: string, id: string): Promise<CustomRoleRecord> {
    const record = await this.repository.findCustomRoleById(id);

    if (record === null || record.tenantId !== tenantId) {
      throw new CustomRoleNotFoundError(id);
    }

    return record;
  }
}

export class InMemoryCustomRoleRepository implements CustomRoleRepository {
  private readonly records = new Map<string, CustomRoleRecord>();

  async insertCustomRole(record: CustomRoleRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async findCustomRoleById(id: string): Promise<CustomRoleRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findCustomRoleBySlug(input: TenantScope & {
    readonly slug: string;
  }): Promise<CustomRoleRecord | null> {
    return (
      [...this.records.values()].find(
        (record) => record.tenantId === input.tenantId && record.slug === input.slug,
      ) ?? null
    );
  }

  async listCustomRoles(input: TenantScope): Promise<CustomRoleRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.tenantId === input.tenantId)
      .sort((left, right) => left.slug.localeCompare(right.slug));
  }

  async updateCustomRole(record: CustomRoleRecord): Promise<void> {
    this.records.set(record.id, record);
  }
}

function normalizeNonBlank(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new CustomRoleValidationError(`${field} must be non-empty.`);
  }

  if (normalized.length > 128) {
    throw new CustomRoleValidationError(`${field} must be at most 128 characters.`);
  }

  return normalized;
}

function validatePermissions(permissions: readonly Permission[]): readonly CatalogPermission[] {
  if (permissions.length === 0) {
    throw new CustomRoleValidationError('At least one explicit permission is required.');
  }

  const uniquePermissions = new Set<string>();
  const catalogOnlyPermissions: CatalogPermission[] = [];

  for (const permission of permissions) {
    if (!catalogPermissions.has(permission)) {
      throw new CustomRoleValidationError(`Unknown permission: ${permission}`);
    }

    if (uniquePermissions.has(permission)) {
      throw new CustomRoleValidationError(`Duplicate permission: ${permission}`);
    }

    uniquePermissions.add(permission);
    catalogOnlyPermissions.push(permission as CatalogPermission);
  }

  return catalogOnlyPermissions;
}

function assertActorCanGrantPermissions(
  actorContext: AuthContext,
  permissions: readonly CatalogPermission[],
): void {
  const actorPermissions = new Set(actorContext.permissions);

  for (const permission of permissions) {
    if (!actorPermissions.has(permission)) {
      throw new CustomRolePrivilegeEscalationError(permission);
    }
  }
}
