import { describe, expect, it } from 'vitest';

import type { AuthContext, Permission } from '@helix/contracts';

import {
  AuthorizationError,
  assertProjectPermission,
  authorizeProjectPermission,
} from './features/iam/authorization.js';
import {
  CustomRolePrivilegeEscalationError,
  CustomRoleService,
  type CustomRoleRecord,
  type CustomRoleRepository,
} from './features/iam/custom-roles.js';
import {
  ProjectApiKeyService,
  type ProjectApiKeyRecord,
  type ProjectApiKeyRepository,
} from './features/iam/project-api-keys.js';
import {
  AgentAuthService,
  type AgentRecord,
  type AgentRepository,
  type AgentTokenRecord,
} from './features/agents/agent-auth.js';
import type { SecurityAuditEvent, SecurityAuditSink } from './features/iam/security-audit.js';

const tenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const otherTenantId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a76';
const projectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';
const otherProjectId = '01890f42-98c4-7cc3-aa5e-0c567f1d3a79';

function authContext(permissions: readonly Permission[]): AuthContext {
  return {
    tenantId,
    projectId,
    principal: {
      type: 'user',
      id: 'stytch-member-1',
    },
    permissions: [...permissions],
  };
}

function sequence(values: readonly string[]): () => string {
  let index = 0;

  return () => {
    const value = values[index];
    index += 1;

    if (value === undefined) {
      throw new Error('Sequence exhausted');
    }

    return value;
  };
}

class RecordingAuditSink implements SecurityAuditSink {
  readonly events: SecurityAuditEvent[] = [];

  async record(event: SecurityAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

class RecordingCustomRoleRepository implements CustomRoleRepository {
  readonly records = new Map<string, CustomRoleRecord>();

  async insertCustomRole(record: CustomRoleRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async findCustomRoleById(id: string): Promise<CustomRoleRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findCustomRoleBySlug(input: {
    readonly tenantId: string;
    readonly slug: string;
  }): Promise<CustomRoleRecord | null> {
    for (const record of this.records.values()) {
      if (record.tenantId === input.tenantId && record.slug === input.slug) {
        return record;
      }
    }

    return null;
  }

  async listCustomRoles(input: {
    readonly tenantId: string;
  }): Promise<CustomRoleRecord[]> {
    return [...this.records.values()].filter(
      (record) => record.tenantId === input.tenantId,
    );
  }

  async updateCustomRole(record: CustomRoleRecord): Promise<void> {
    this.records.set(record.id, record);
  }
}

class RecordingProjectApiKeyRepository implements ProjectApiKeyRepository {
  readonly records = new Map<string, ProjectApiKeyRecord>();

  async insert(record: ProjectApiKeyRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async findById(id: string): Promise<ProjectApiKeyRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findByKeyPrefix(keyPrefix: string): Promise<ProjectApiKeyRecord | null> {
    for (const record of this.records.values()) {
      if (record.keyPrefix === keyPrefix) {
        return record;
      }
    }

    return null;
  }

  async markRevoked(input: {
    readonly id: string;
    readonly revokedAt: Date;
    readonly revokedByType: string;
    readonly revokedById: string;
  }): Promise<void> {
    const record = this.records.get(input.id);

    if (record === undefined) {
      return;
    }

    this.records.set(input.id, {
      ...record,
      revokedAt: input.revokedAt,
      revokedByType: input.revokedByType,
      revokedById: input.revokedById,
    });
  }
}

class RecordingAgentRepository implements AgentRepository {
  readonly agents = new Map<string, AgentRecord>();
  readonly tokens = new Map<string, AgentTokenRecord>();

  async insertAgent(record: AgentRecord): Promise<void> {
    this.agents.set(record.id, record);
  }

  async findAgentById(id: string): Promise<AgentRecord | null> {
    return this.agents.get(id) ?? null;
  }

  async findAgentByCredentialPrefix(credentialPrefix: string): Promise<AgentRecord | null> {
    for (const record of this.agents.values()) {
      if (record.credentialPrefix === credentialPrefix) {
        return record;
      }
    }

    return null;
  }

  async markAgentRevoked(input: {
    readonly id: string;
    readonly revokedAt: Date;
    readonly revokedByType: string;
    readonly revokedById: string;
  }): Promise<void> {
    const record = this.agents.get(input.id);

    if (record === undefined) {
      return;
    }

    this.agents.set(input.id, {
      ...record,
      revokedAt: input.revokedAt,
      revokedByType: input.revokedByType,
      revokedById: input.revokedById,
    });
  }

  async insertAgentToken(record: AgentTokenRecord): Promise<void> {
    this.tokens.set(record.id, record);
  }

  async findAgentTokenByPrefix(tokenPrefix: string): Promise<AgentTokenRecord | null> {
    for (const record of this.tokens.values()) {
      if (record.tokenPrefix === tokenPrefix) {
        return record;
      }
    }

    return null;
  }
}

describe('IAM permission authorization', () => {
  it('requires an explicit permission inside the same tenant and project scope', () => {
    const context = authContext(['project_api_keys:create']);

    expect(
      authorizeProjectPermission(context, { tenantId, projectId }, 'project_api_keys:create'),
    ).toEqual({ allowed: true });
    expect(() =>
      assertProjectPermission(context, { tenantId, projectId }, 'project_api_keys:create'),
    ).not.toThrow();

    expect(
      authorizeProjectPermission(authContext(['iam:roles:write']), { tenantId, projectId }, 'project_api_keys:create'),
    ).toEqual({
      allowed: false,
      reason: 'missing_permission',
    });
    expect(() =>
      assertProjectPermission(
        authContext(['iam:roles:write']),
        { tenantId, projectId },
        'project_api_keys:create',
      ),
    ).toThrow(AuthorizationError);
    expect(
      authorizeProjectPermission(context, { tenantId: otherTenantId, projectId }, 'project_api_keys:create'),
    ).toEqual({
      allowed: false,
      reason: 'wrong_tenant_scope',
    });
    expect(
      authorizeProjectPermission(context, { tenantId, projectId: otherProjectId }, 'project_api_keys:create'),
    ).toEqual({
      allowed: false,
      reason: 'wrong_project_scope',
    });
  });
});

describe('custom role editor internals', () => {
  it('creates, updates, disables, lists, and audits tenant-scoped permission roles', async () => {
    const repository = new RecordingCustomRoleRepository();
    const auditSink = new RecordingAuditSink();
    const writerContext = authContext([
      'iam:roles:read',
      'iam:roles:write',
      'agents:register',
      'agents:claim',
    ]);
    const service = new CustomRoleService({
      auditSink,
      generateId: sequence([
        '01890f42-98c4-7cc3-aa5e-0c567f1d3c01',
        '01890f42-98c4-7cc3-ba5e-0c567f1d3c02',
        '01890f42-98c4-7cc3-8a5e-0c567f1d3c03',
        '01890f42-98c4-7cc3-9a5e-0c567f1d3c04',
      ]),
      now: () => new Date('2026-05-12T18:10:00.000Z'),
      repository,
    });

    const created = await service.createCustomRole(writerContext, {
      tenantId,
      slug: 'processor-operator',
      name: 'Processor operator',
      permissions: ['agents:register'],
    });
    const updated = await service.updateCustomRole(writerContext, {
      tenantId,
      id: created.id,
      name: 'Processor operator v2',
      permissions: ['agents:register', 'agents:claim'],
    });
    const listed = await service.listCustomRoles(authContext(['iam:roles:read']), {
      tenantId,
    });
    const disabled = await service.disableCustomRole(writerContext, {
      tenantId,
      id: created.id,
    });

    expect(created).toMatchObject({
      tenantId,
      slug: 'processor-operator',
      name: 'Processor operator',
      permissions: ['agents:register'],
      disabledAt: null,
    });
    expect(updated).toMatchObject({
      id: created.id,
      name: 'Processor operator v2',
      permissions: ['agents:register', 'agents:claim'],
      disabledAt: null,
    });
    expect(listed).toHaveLength(1);
    expect(disabled).toMatchObject({
      id: created.id,
      disabledAt: new Date('2026-05-12T18:10:00.000Z'),
    });
    expect(auditSink.events.map((event) => event.action)).toEqual([
      'iam.custom_role.created',
      'iam.custom_role.updated',
      'iam.custom_role.disabled',
    ]);
    expect(auditSink.events[0]).toMatchObject({
      tenantId,
      projectId: null,
      actor: {
        type: 'user',
        id: 'stytch-member-1',
      },
      resourceType: 'custom_role',
      resourceId: created.id,
    });
  });

  it('rejects role writes without authorization or when granting permissions the actor lacks', async () => {
    const repository = new RecordingCustomRoleRepository();
    const auditSink = new RecordingAuditSink();
    const service = new CustomRoleService({
      auditSink,
      generateId: sequence(['01890f42-98c4-7cc3-aa5e-0c567f1d3c11']),
      now: () => new Date('2026-05-12T18:20:00.000Z'),
      repository,
    });

    await expect(
      service.createCustomRole(authContext(['agents:register']), {
        tenantId,
        slug: 'unauthorized',
        name: 'Unauthorized',
        permissions: ['agents:register'],
      }),
    ).rejects.toThrow(AuthorizationError);

    await expect(
      service.createCustomRole(authContext(['iam:roles:write']), {
        tenantId,
        slug: 'escalates',
        name: 'Escalates',
        permissions: ['agents:revoke'],
      }),
    ).rejects.toThrow(CustomRolePrivilegeEscalationError);

    expect(repository.records).toHaveLength(0);
    expect(auditSink.events).toHaveLength(0);
  });
});

describe('project API key internals', () => {
  it('creates a hashed project API key, authenticates it as a project principal, and revokes it with audit events', async () => {
    const repository = new RecordingProjectApiKeyRepository();
    const auditSink = new RecordingAuditSink();
    const service = new ProjectApiKeyService({
      auditSink,
      generateId: sequence([
        '01890f42-98c4-7cc3-aa5e-0c567f1d3a91',
        '01890f42-98c4-7cc3-ba5e-0c567f1d3a92',
        '01890f42-98c4-7cc3-8a5e-0c567f1d3a93',
      ]),
      generateSecretPart: sequence(['testprefix', 'testsecret']),
      now: () => new Date('2026-05-12T16:10:00.000Z'),
      repository,
    });

    const created = await service.createProjectApiKey(
      authContext(['project_api_keys:create']),
      {
        tenantId,
        projectId,
        name: 'CI producer',
        permissions: ['jobs:create'],
      },
    );

    expect(created).toEqual({
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a91',
      keyPrefix: 'hpx_testprefix',
      token: 'hpx_testprefix.testsecret',
    });
    expect(JSON.stringify([...repository.records.values()])).not.toContain('testsecret');
    expect(repository.records.get(created.id)).toMatchObject({
      id: created.id,
      tenantId,
      projectId,
      keyPrefix: created.keyPrefix,
      permissions: ['jobs:create'],
      revokedAt: null,
      secretHashSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });

    await expect(service.authenticateProjectApiKey(created.token)).resolves.toEqual({
      tenantId,
      projectId,
      principal: {
        type: 'api_key',
        id: created.id,
      },
      permissions: ['jobs:create'],
    });
    await expect(service.authenticateProjectApiKey('hpx_testprefix.wrong')).resolves.toBeNull();

    await service.revokeProjectApiKey(authContext(['project_api_keys:revoke']), {
      tenantId,
      projectId,
      id: created.id,
    });

    await expect(service.authenticateProjectApiKey(created.token)).resolves.toBeNull();
    expect(auditSink.events.map((event) => event.action)).toEqual([
      'project_api_key.created',
      'project_api_key.revoked',
    ]);
    expect(auditSink.events[0]).toMatchObject({
      tenantId,
      projectId,
      actor: {
        type: 'user',
        id: 'stytch-member-1',
      },
      resourceType: 'project_api_key',
      resourceId: created.id,
    });
  });
});

describe('agent credential and token internals', () => {
  it('exchanges a project-scoped registration credential for a short-lived token and blocks revoked agents', async () => {
    const repository = new RecordingAgentRepository();
    const auditSink = new RecordingAuditSink();
    const service = new AgentAuthService({
      auditSink,
      generateId: sequence([
        '01890f42-98c4-7cc3-aa5e-0c567f1d3aa1',
        '01890f42-98c4-7cc3-ba5e-0c567f1d3aa2',
        '01890f42-98c4-7cc3-8a5e-0c567f1d3aa3',
        '01890f42-98c4-7cc3-9a5e-0c567f1d3aa4',
        '01890f42-98c4-7cc3-aa5e-0c567f1d3aa5',
      ]),
      generateSecretPart: sequence(['agentprefix', 'agentsecret', 'tokenprefix', 'tokensecret']),
      now: () => new Date('2026-05-12T16:10:00.000Z'),
      repository,
      tokenTtlMillis: 15 * 60 * 1000,
    });

    const registered = await service.registerAgent(authContext(['agents:register']), {
      tenantId,
      projectId,
      name: 'GPU runner',
      permissions: ['agents:claim'],
    });

    expect(registered).toEqual({
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3aa1',
      credentialPrefix: 'hag_agentprefix',
      registrationCredential: 'hag_agentprefix.agentsecret',
    });
    expect(JSON.stringify([...repository.agents.values()])).not.toContain('agentsecret');

    const issuedToken = await service.exchangeRegistrationCredential(
      registered.registrationCredential,
    );

    if (issuedToken === null) {
      throw new Error('Expected agent token exchange to succeed');
    }

    expect(issuedToken).toEqual({
      tokenId: '01890f42-98c4-7cc3-8a5e-0c567f1d3aa3',
      token: 'hat_tokenprefix.tokensecret',
      expiresAt: new Date('2026-05-12T16:25:00.000Z'),
    });
    expect(JSON.stringify([...repository.tokens.values()])).not.toContain('tokensecret');
    await expect(service.authenticateAgentToken(issuedToken.token)).resolves.toEqual({
      tenantId,
      projectId,
      principal: {
        type: 'agent_token',
        id: issuedToken.tokenId,
      },
      permissions: ['agents:claim'],
    });
    await expect(service.authenticateAgentToken('hat_tokenprefix.wrong')).resolves.toBeNull();

    const afterExpiryService = new AgentAuthService({
      auditSink,
      now: () => new Date('2026-05-12T16:26:00.000Z'),
      repository,
    });
    await expect(afterExpiryService.authenticateAgentToken(issuedToken.token)).resolves.toBeNull();

    await service.revokeAgent(authContext(['agents:revoke']), {
      tenantId,
      projectId,
      id: registered.id,
    });

    await expect(
      service.exchangeRegistrationCredential(registered.registrationCredential),
    ).resolves.toBeNull();
    await expect(service.authenticateAgentToken(issuedToken.token)).resolves.toBeNull();
    expect(auditSink.events.map((event) => event.action)).toEqual([
      'agent.registered',
      'agent_token.issued',
      'agent.revoked',
    ]);
  });
});
