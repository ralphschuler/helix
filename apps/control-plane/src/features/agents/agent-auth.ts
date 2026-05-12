import type { AuthContext, Permission, TenantProjectScope } from '@helix/contracts';

import { assertProjectPermission } from '../iam/authorization.js';
import type { SecurityAuditSink } from '../iam/security-audit.js';
import {
  parseDottedSecret,
  randomSecretPart,
  randomUuidV7LikeId,
  sha256Hex,
  timingSafeEqualHex,
} from '../iam/token-secrets.js';

const defaultTokenTtlMillis = 15 * 60 * 1000;

export interface AgentRecord extends TenantProjectScope {
  readonly id: string;
  readonly name: string;
  readonly credentialPrefix: string;
  readonly credentialHashSha256: string;
  readonly permissions: readonly Permission[];
  readonly createdByType: string;
  readonly createdById: string;
  readonly revokedAt: Date | null;
  readonly revokedByType: string | null;
  readonly revokedById: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AgentTokenRecord extends TenantProjectScope {
  readonly id: string;
  readonly agentId: string;
  readonly tokenPrefix: string;
  readonly tokenHashSha256: string;
  readonly permissions: readonly Permission[];
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface AgentRepository {
  insertAgent(record: AgentRecord): Promise<void>;
  findAgentById(id: string): Promise<AgentRecord | null>;
  findAgentByCredentialPrefix(credentialPrefix: string): Promise<AgentRecord | null>;
  markAgentRevoked(input: {
    readonly id: string;
    readonly revokedAt: Date;
    readonly revokedByType: string;
    readonly revokedById: string;
  }): Promise<void>;
  insertAgentToken(record: AgentTokenRecord): Promise<void>;
  findAgentTokenByPrefix(tokenPrefix: string): Promise<AgentTokenRecord | null>;
}

export interface RegisterAgentInput extends TenantProjectScope {
  readonly name: string;
  readonly permissions: readonly Permission[];
}

export interface RegisteredAgentCredential {
  readonly id: string;
  readonly credentialPrefix: string;
  readonly registrationCredential: string;
}

export interface IssuedAgentToken {
  readonly tokenId: string;
  readonly token: string;
  readonly expiresAt: Date;
}

export interface RevokeAgentInput extends TenantProjectScope {
  readonly id: string;
}

export interface AgentAuthServiceOptions {
  readonly repository: AgentRepository;
  readonly auditSink: SecurityAuditSink;
  readonly now?: () => Date;
  readonly generateId?: () => string;
  readonly generateSecretPart?: () => string;
  readonly tokenTtlMillis?: number;
}

export class AgentAuthService {
  private readonly repository: AgentRepository;
  private readonly auditSink: SecurityAuditSink;
  private readonly now: () => Date;
  private readonly generateId: () => string;
  private readonly generateSecretPart: () => string;
  private readonly tokenTtlMillis: number;

  constructor(options: AgentAuthServiceOptions) {
    this.repository = options.repository;
    this.auditSink = options.auditSink;
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => randomUuidV7LikeId(this.now()));
    this.generateSecretPart = options.generateSecretPart ?? (() => randomSecretPart());
    this.tokenTtlMillis = options.tokenTtlMillis ?? defaultTokenTtlMillis;
  }

  async registerAgent(
    actorContext: AuthContext,
    input: RegisterAgentInput,
  ): Promise<RegisteredAgentCredential> {
    assertProjectPermission(actorContext, input, 'agents:register');
    assertNonEmptyPermissions(input.permissions);

    const createdAt = this.now();
    const id = this.generateId();
    const credentialPrefix = `hag_${this.generateSecretPart()}`;
    const registrationCredential = `${credentialPrefix}.${this.generateSecretPart()}`;
    const record: AgentRecord = {
      id,
      tenantId: input.tenantId,
      projectId: input.projectId,
      name: input.name,
      credentialPrefix,
      credentialHashSha256: sha256Hex(registrationCredential),
      permissions: [...input.permissions],
      createdByType: actorContext.principal.type,
      createdById: actorContext.principal.id,
      revokedAt: null,
      revokedByType: null,
      revokedById: null,
      createdAt,
      updatedAt: createdAt,
    };

    await this.repository.insertAgent(record);
    await this.auditSink.record({
      id: this.generateId(),
      tenantId: input.tenantId,
      projectId: input.projectId,
      actor: actorContext.principal,
      action: 'agent.registered',
      resourceType: 'agent',
      resourceId: id,
      metadata: {
        credentialPrefix,
        permissions: [...input.permissions],
      },
      occurredAt: createdAt,
    });

    return { id, credentialPrefix, registrationCredential };
  }

  async exchangeRegistrationCredential(
    registrationCredential: string,
  ): Promise<IssuedAgentToken | null> {
    const parsedCredential = parseDottedSecret(registrationCredential, 'hag_');

    if (parsedCredential === null) {
      return null;
    }

    const agent = await this.repository.findAgentByCredentialPrefix(
      parsedCredential.publicPrefix,
    );

    if (agent === null || agent.revokedAt !== null) {
      return null;
    }

    if (!timingSafeEqualHex(agent.credentialHashSha256, sha256Hex(parsedCredential.fullSecret))) {
      return null;
    }

    const createdAt = this.now();
    const tokenId = this.generateId();
    const tokenPrefix = `hat_${this.generateSecretPart()}`;
    const token = `${tokenPrefix}.${this.generateSecretPart()}`;
    const expiresAt = new Date(createdAt.getTime() + this.tokenTtlMillis);
    const tokenRecord: AgentTokenRecord = {
      id: tokenId,
      tenantId: agent.tenantId,
      projectId: agent.projectId,
      agentId: agent.id,
      tokenPrefix,
      tokenHashSha256: sha256Hex(token),
      permissions: [...agent.permissions],
      expiresAt,
      revokedAt: null,
      createdAt,
    };

    await this.repository.insertAgentToken(tokenRecord);
    await this.auditSink.record({
      id: this.generateId(),
      tenantId: agent.tenantId,
      projectId: agent.projectId,
      actor: {
        type: 'service',
        id: 'agent-registration-exchange',
      },
      action: 'agent_token.issued',
      resourceType: 'agent_token',
      resourceId: tokenId,
      metadata: {
        agentId: agent.id,
        tokenPrefix,
        expiresAt: expiresAt.toISOString(),
      },
      occurredAt: createdAt,
    });

    return { tokenId, token, expiresAt };
  }

  async authenticateAgentToken(token: string): Promise<AuthContext | null> {
    const parsedToken = parseDottedSecret(token, 'hat_');

    if (parsedToken === null) {
      return null;
    }

    const tokenRecord = await this.repository.findAgentTokenByPrefix(parsedToken.publicPrefix);

    if (
      tokenRecord === null ||
      tokenRecord.revokedAt !== null ||
      this.now().getTime() >= tokenRecord.expiresAt.getTime()
    ) {
      return null;
    }

    if (!timingSafeEqualHex(tokenRecord.tokenHashSha256, sha256Hex(parsedToken.fullSecret))) {
      return null;
    }

    const agent = await this.repository.findAgentById(tokenRecord.agentId);

    if (agent === null || agent.revokedAt !== null) {
      return null;
    }

    return {
      tenantId: tokenRecord.tenantId,
      projectId: tokenRecord.projectId,
      principal: {
        type: 'agent_token',
        id: tokenRecord.id,
      },
      permissions: [...tokenRecord.permissions],
    };
  }

  async revokeAgent(actorContext: AuthContext, input: RevokeAgentInput): Promise<void> {
    const agent = await this.repository.findAgentById(input.id);

    if (agent === null) {
      return;
    }

    assertProjectPermission(actorContext, agent, 'agents:revoke');
    assertProjectPermission(actorContext, input, 'agents:revoke');

    if (agent.revokedAt !== null) {
      return;
    }

    const revokedAt = this.now();
    await this.repository.markAgentRevoked({
      id: agent.id,
      revokedAt,
      revokedByType: actorContext.principal.type,
      revokedById: actorContext.principal.id,
    });
    await this.auditSink.record({
      id: this.generateId(),
      tenantId: agent.tenantId,
      projectId: agent.projectId,
      actor: actorContext.principal,
      action: 'agent.revoked',
      resourceType: 'agent',
      resourceId: agent.id,
      metadata: {
        credentialPrefix: agent.credentialPrefix,
      },
      occurredAt: revokedAt,
    });
  }
}

function assertNonEmptyPermissions(permissions: readonly Permission[]): void {
  if (permissions.length === 0 || permissions.some((permission) => permission.trim().length === 0)) {
    throw new Error('At least one explicit permission is required.');
  }
}
