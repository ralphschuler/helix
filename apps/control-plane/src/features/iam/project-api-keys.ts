import type { Kysely, Selectable } from 'kysely';
import type { AuthContext, Permission, TenantProjectScope } from '@helix/contracts';

import type { HelixDatabase } from '../../db/schema.js';
import { assertProjectPermission } from './authorization.js';
import type { SecurityAuditSink } from './security-audit.js';
import {
  parseDottedSecret,
  randomSecretPart,
  randomUuidV7LikeId,
  sha256Hex,
  timingSafeEqualHex,
} from './token-secrets.js';

export interface ProjectApiKeyRecord extends TenantProjectScope {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly secretHashSha256: string;
  readonly permissions: readonly Permission[];
  readonly createdByType: string;
  readonly createdById: string;
  readonly revokedAt: Date | null;
  readonly revokedByType: string | null;
  readonly revokedById: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProjectApiKeyRepository {
  insert(record: ProjectApiKeyRecord): Promise<void>;
  findById(id: string): Promise<ProjectApiKeyRecord | null>;
  findByKeyPrefix(keyPrefix: string): Promise<ProjectApiKeyRecord | null>;
  markRevoked(input: {
    readonly id: string;
    readonly revokedAt: Date;
    readonly revokedByType: string;
    readonly revokedById: string;
  }): Promise<void>;
}

export interface CreateProjectApiKeyInput extends TenantProjectScope {
  readonly name: string;
  readonly permissions: readonly Permission[];
}

export interface CreatedProjectApiKey {
  readonly id: string;
  readonly keyPrefix: string;
  readonly token: string;
}

export interface RevokeProjectApiKeyInput extends TenantProjectScope {
  readonly id: string;
}

export interface ProjectApiKeyServiceOptions {
  readonly repository: ProjectApiKeyRepository;
  readonly auditSink: SecurityAuditSink;
  readonly now?: () => Date;
  readonly generateId?: () => string;
  readonly generateSecretPart?: () => string;
}

export class KyselyProjectApiKeyRepository implements ProjectApiKeyRepository {
  private readonly db: Kysely<HelixDatabase>;

  constructor(db: Kysely<HelixDatabase>) {
    this.db = db;
  }

  async insert(record: ProjectApiKeyRecord): Promise<void> {
    await this.db
      .insertInto('project_api_keys')
      .values({
        id: record.id,
        tenant_id: record.tenantId,
        project_id: record.projectId,
        name: record.name,
        key_prefix: record.keyPrefix,
        secret_hash_sha256: record.secretHashSha256,
        permissions_json: record.permissions,
        created_by_type: record.createdByType,
        created_by_id: record.createdById,
        revoked_at: record.revokedAt,
        revoked_by_type: record.revokedByType,
        revoked_by_id: record.revokedById,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      })
      .execute();
  }

  async findById(id: string): Promise<ProjectApiKeyRecord | null> {
    const row = await this.db
      .selectFrom('project_api_keys')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toProjectApiKeyRecord(row);
  }

  async findByKeyPrefix(keyPrefix: string): Promise<ProjectApiKeyRecord | null> {
    const row = await this.db
      .selectFrom('project_api_keys')
      .selectAll()
      .where('key_prefix', '=', keyPrefix)
      .executeTakeFirst();

    return row === undefined ? null : toProjectApiKeyRecord(row);
  }

  async markRevoked(input: {
    readonly id: string;
    readonly revokedAt: Date;
    readonly revokedByType: string;
    readonly revokedById: string;
  }): Promise<void> {
    await this.db
      .updateTable('project_api_keys')
      .set({
        revoked_at: input.revokedAt,
        revoked_by_type: input.revokedByType,
        revoked_by_id: input.revokedById,
        updated_at: input.revokedAt,
      })
      .where('id', '=', input.id)
      .execute();
  }
}

export class ProjectApiKeyService {
  private readonly repository: ProjectApiKeyRepository;
  private readonly auditSink: SecurityAuditSink;
  private readonly now: () => Date;
  private readonly generateId: () => string;
  private readonly generateSecretPart: () => string;

  constructor(options: ProjectApiKeyServiceOptions) {
    this.repository = options.repository;
    this.auditSink = options.auditSink;
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => randomUuidV7LikeId(this.now()));
    this.generateSecretPart = options.generateSecretPart ?? (() => randomSecretPart());
  }

  async createProjectApiKey(
    actorContext: AuthContext,
    input: CreateProjectApiKeyInput,
  ): Promise<CreatedProjectApiKey> {
    assertProjectPermission(actorContext, input, 'project_api_keys:create');
    assertNonEmptyPermissions(input.permissions);

    const createdAt = this.now();
    const id = this.generateId();
    const keyPrefix = `hpx_${this.generateSecretPart()}`;
    const token = `${keyPrefix}.${this.generateSecretPart()}`;
    const record: ProjectApiKeyRecord = {
      id,
      tenantId: input.tenantId,
      projectId: input.projectId,
      name: input.name,
      keyPrefix,
      secretHashSha256: sha256Hex(token),
      permissions: [...input.permissions],
      createdByType: actorContext.principal.type,
      createdById: actorContext.principal.id,
      revokedAt: null,
      revokedByType: null,
      revokedById: null,
      createdAt,
      updatedAt: createdAt,
    };

    await this.repository.insert(record);
    await this.auditSink.record({
      id: this.generateId(),
      tenantId: input.tenantId,
      projectId: input.projectId,
      actor: actorContext.principal,
      action: 'project_api_key.created',
      resourceType: 'project_api_key',
      resourceId: id,
      metadata: {
        keyPrefix,
        permissions: [...input.permissions],
      },
      occurredAt: createdAt,
    });

    return { id, keyPrefix, token };
  }

  async authenticateProjectApiKey(token: string): Promise<AuthContext | null> {
    const parsedToken = parseDottedSecret(token, 'hpx_');

    if (parsedToken === null) {
      return null;
    }

    const record = await this.repository.findByKeyPrefix(parsedToken.publicPrefix);

    if (record === null || record.revokedAt !== null) {
      return null;
    }

    if (!timingSafeEqualHex(record.secretHashSha256, sha256Hex(parsedToken.fullSecret))) {
      return null;
    }

    return {
      tenantId: record.tenantId,
      projectId: record.projectId,
      principal: {
        type: 'api_key',
        id: record.id,
      },
      permissions: [...record.permissions],
    };
  }

  async revokeProjectApiKey(
    actorContext: AuthContext,
    input: RevokeProjectApiKeyInput,
  ): Promise<void> {
    const record = await this.repository.findById(input.id);

    if (record === null) {
      return;
    }

    assertProjectPermission(actorContext, record, 'project_api_keys:revoke');
    assertProjectPermission(actorContext, input, 'project_api_keys:revoke');

    if (record.revokedAt !== null) {
      return;
    }

    const revokedAt = this.now();
    await this.repository.markRevoked({
      id: record.id,
      revokedAt,
      revokedByType: actorContext.principal.type,
      revokedById: actorContext.principal.id,
    });
    await this.auditSink.record({
      id: this.generateId(),
      tenantId: record.tenantId,
      projectId: record.projectId,
      actor: actorContext.principal,
      action: 'project_api_key.revoked',
      resourceType: 'project_api_key',
      resourceId: record.id,
      metadata: {
        keyPrefix: record.keyPrefix,
      },
      occurredAt: revokedAt,
    });
  }
}

function toProjectApiKeyRecord(
  row: Selectable<HelixDatabase['project_api_keys']>,
): ProjectApiKeyRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    secretHashSha256: row.secret_hash_sha256,
    permissions: [...row.permissions_json] as Permission[],
    createdByType: row.created_by_type,
    createdById: row.created_by_id,
    revokedAt: row.revoked_at,
    revokedByType: row.revoked_by_type,
    revokedById: row.revoked_by_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertNonEmptyPermissions(permissions: readonly Permission[]): void {
  if (permissions.length === 0 || permissions.some((permission) => permission.trim().length === 0)) {
    throw new Error('At least one explicit permission is required.');
  }
}
