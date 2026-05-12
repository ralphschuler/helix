import { describe, expect, it } from 'vitest';

import {
  agentRegistrationCredentialRecordSchema,
  agentTokenRecordSchema,
  authContextSchema,
  billingStatusSchema,
  catalogPermissionSchema,
  customRoleSchema,
  errorEnvelopeSchema,
  eventEnvelopeSchema,
  idempotencyKeySchema,
  idempotencyKeyScopeSchema,
  opaqueCursorSchema,
  tenantIdSchema,
  tenantProjectScopeSchema,
  tenantScopeSchema,
  permissionCatalog,
  projectApiKeyRecordSchema,
  stripeCustomerMappingSchema,
  stripeWebhookEventRecordSchema,
  usageLedgerRecordSchema,
  uuidV7Schema,
} from '@helix/contracts';

const validTenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const validProjectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';
const validOrganizationId = '01890f42-98c4-7cc3-aa5e-0c567f1d3a85';

describe('base identifier contracts', () => {
  it('accepts UUIDv7-shaped resource identifiers and rejects other UUID versions', () => {
    expect(uuidV7Schema.parse(validTenantId)).toBe(validTenantId);
    expect(tenantIdSchema.parse(validTenantId)).toBe(validTenantId);

    expect(() =>
      uuidV7Schema.parse('01890f42-98c4-4cc3-8a5e-0c567f1d3a77'),
    ).toThrow();
    expect(() => uuidV7Schema.parse('not-a-uuid')).toThrow();
  });

  it('requires tenant and project scoped resources to carry valid IDs', () => {
    expect(
      tenantScopeSchema.parse({
        tenantId: validTenantId,
      }),
    ).toEqual({ tenantId: validTenantId });

    expect(
      tenantProjectScopeSchema.parse({
        tenantId: validTenantId,
        projectId: validProjectId,
      }),
    ).toEqual({ tenantId: validTenantId, projectId: validProjectId });

    expect(() => tenantScopeSchema.parse({})).toThrow();
    expect(() =>
      tenantProjectScopeSchema.parse({
        tenantId: validTenantId,
        projectId: 'not-a-uuid',
      }),
    ).toThrow();
  });
});

describe('base error contracts', () => {
  it('accepts framework-agnostic error envelopes and rejects incomplete errors', () => {
    const errorEnvelope = {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid tenant ID',
        details: {
          field: 'tenantId',
        },
      },
    };

    expect(errorEnvelopeSchema.parse(errorEnvelope)).toEqual(errorEnvelope);
    expect(() => errorEnvelopeSchema.parse({ error: { message: 'No code' } })).toThrow();
    expect(() => errorEnvelopeSchema.parse({ error: { code: '   ', message: 'Blank' } })).toThrow();
    expect(() => errorEnvelopeSchema.parse({ error: { code: 'EMPTY', message: '' } })).toThrow();
  });
});

describe('base API boundary contracts', () => {
  it('keeps stream cursors opaque and idempotency keys tenant/project scoped', () => {
    expect(opaqueCursorSchema.parse('cursor-v1.opaque-token')).toBe(
      'cursor-v1.opaque-token',
    );
    expect(() => opaqueCursorSchema.parse('')).toThrow();
    expect(() => opaqueCursorSchema.parse('   ')).toThrow();

    expect(idempotencyKeySchema.parse('create-job:client-request-1')).toBe(
      'create-job:client-request-1',
    );
    expect(() => idempotencyKeySchema.parse('')).toThrow();
    expect(() => idempotencyKeySchema.parse('x'.repeat(256))).toThrow();

    expect(
      idempotencyKeyScopeSchema.parse({
        tenantId: validTenantId,
        projectId: validProjectId,
        idempotencyKey: 'start-workflow:client-request-1',
      }),
    ).toEqual({
      tenantId: validTenantId,
      projectId: validProjectId,
      idempotencyKey: 'start-workflow:client-request-1',
    });
    expect(() =>
      idempotencyKeyScopeSchema.parse({
        tenantId: validTenantId,
        idempotencyKey: 'missing-project',
      }),
    ).toThrow();
  });

  it('represents authenticated principals inside tenant/project scope', () => {
    const authContext = {
      tenantId: validTenantId,
      projectId: validProjectId,
      principal: {
        type: 'user',
        id: 'stytch-member-1',
      },
      permissions: ['jobs:create', 'workflows:start'],
    };

    expect(authContextSchema.parse(authContext)).toEqual(authContext);

    for (const principalType of ['user', 'api_key', 'agent_token', 'service']) {
      expect(
        authContextSchema.parse({
          ...authContext,
          principal: { type: principalType, id: `${principalType}-1` },
        }).principal.type,
      ).toBe(principalType);
    }

    expect(() =>
      authContextSchema.parse({
        ...authContext,
        principal: { type: 'role', id: 'owner' },
      }),
    ).toThrow();
    expect(() =>
      authContextSchema.parse({ ...authContext, projectId: undefined }),
    ).toThrow();
    expect(() =>
      authContextSchema.parse({ ...authContext, permissions: ['   '] }),
    ).toThrow();
  });
});

describe('IAM contracts', () => {
  it('defines permission-only custom roles from an explicit catalog', () => {
    const customRole = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a81',
      tenantId: validTenantId,
      slug: 'project-operator',
      name: 'Project operator',
      permissions: ['project_api_keys:create', 'agents:register'],
      createdAt: '2026-05-12T16:00:00.000Z',
      updatedAt: '2026-05-12T16:00:00.000Z',
    };

    expect(permissionCatalog).toContain('project_api_keys:create');
    expect(catalogPermissionSchema.parse('agents:claim')).toBe('agents:claim');
    expect(customRoleSchema.parse(customRole)).toEqual(customRole);
    expect(() => customRoleSchema.parse({ ...customRole, permissions: ['owner'] })).toThrow();
    expect(() =>
      customRoleSchema.parse({
        ...customRole,
        permissions: ['agents:register', 'agents:register'],
      }),
    ).toThrow();
  });

  it('models API key, agent credential, and agent token records as scoped hashes without token material', () => {
    const apiKeyRecord = {
      id: '01890f42-98c4-7cc3-ba5e-0c567f1d3a82',
      tenantId: validTenantId,
      projectId: validProjectId,
      name: 'CI producer',
      keyPrefix: 'hpx_ci_12345678',
      secretHashSha256: 'a'.repeat(64),
      permissions: ['jobs:create'],
      createdAt: '2026-05-12T16:01:00.000Z',
      revokedAt: null,
    };
    const agentCredentialRecord = {
      id: '01890f42-98c4-7cc3-8a5e-0c567f1d3a83',
      tenantId: validTenantId,
      projectId: validProjectId,
      name: 'gpu-runner',
      credentialPrefix: 'hag_gpu_12345678',
      credentialHashSha256: 'b'.repeat(64),
      permissions: ['agents:claim'],
      createdAt: '2026-05-12T16:02:00.000Z',
      revokedAt: null,
    };
    const agentTokenRecord = {
      id: '01890f42-98c4-7cc3-9a5e-0c567f1d3a84',
      tenantId: validTenantId,
      projectId: validProjectId,
      agentId: agentCredentialRecord.id,
      tokenPrefix: 'hat_gpu_12345678',
      tokenHashSha256: 'c'.repeat(64),
      permissions: ['agents:claim'],
      createdAt: '2026-05-12T16:03:00.000Z',
      expiresAt: '2026-05-12T16:18:00.000Z',
      revokedAt: null,
    };

    expect(projectApiKeyRecordSchema.parse(apiKeyRecord)).toEqual(apiKeyRecord);
    expect(agentRegistrationCredentialRecordSchema.parse(agentCredentialRecord)).toEqual(
      agentCredentialRecord,
    );
    expect(agentTokenRecordSchema.parse(agentTokenRecord)).toEqual(agentTokenRecord);
    expect(() => projectApiKeyRecordSchema.parse({ ...apiKeyRecord, secret: 'plain-text' })).toThrow();
    expect(() =>
      agentRegistrationCredentialRecordSchema.parse({
        ...agentCredentialRecord,
        credential: 'plain-text',
      }),
    ).toThrow();
    expect(() =>
      agentTokenRecordSchema.parse({ ...agentTokenRecord, expiresAt: 'not-a-date' }),
    ).toThrow();
  });
});

describe('billing contracts', () => {
  it('models Stripe customer projection, webhook idempotency, and tenant/org scoped usage ledger rows', () => {
    const stripeCustomerMapping = {
      id: '01890f42-98c4-7cc3-ba5e-0c567f1d3a86',
      tenantId: validTenantId,
      organizationId: validOrganizationId,
      stripeCustomerId: 'cus_test_123',
      billingStatus: 'active',
      currentSubscriptionId: 'sub_test_123',
      createdAt: '2026-05-12T17:00:00.000Z',
      updatedAt: '2026-05-12T17:01:00.000Z',
    };
    const usageLedgerRecord = {
      id: '01890f42-98c4-7cc3-8a5e-0c567f1d3a87',
      tenantId: validTenantId,
      organizationId: validOrganizationId,
      projectId: validProjectId,
      usageType: 'job.execution',
      quantity: 3,
      idempotencyKey: 'usage:job-123',
      metadata: { jobId: 'job-123' },
      recordedAt: '2026-05-12T17:02:00.000Z',
    };
    const webhookEventRecord = {
      stripeEventId: 'evt_test_123',
      tenantId: validTenantId,
      organizationId: validOrganizationId,
      stripeCustomerId: 'cus_test_123',
      eventType: 'customer.subscription.updated',
      processedAt: '2026-05-12T17:03:00.000Z',
    };

    expect(billingStatusSchema.parse('past_due')).toBe('past_due');
    expect(stripeCustomerMappingSchema.parse(stripeCustomerMapping)).toEqual(
      stripeCustomerMapping,
    );
    expect(usageLedgerRecordSchema.parse(usageLedgerRecord)).toEqual(usageLedgerRecord);
    expect(stripeWebhookEventRecordSchema.parse(webhookEventRecord)).toEqual(
      webhookEventRecord,
    );
    expect(() => usageLedgerRecordSchema.parse({ ...usageLedgerRecord, quantity: 0 })).toThrow();
    expect(() =>
      stripeCustomerMappingSchema.parse({
        ...stripeCustomerMapping,
        stripeCustomerId: '',
      }),
    ).toThrow();
  });
});

describe('base event contracts', () => {
  it('requires versioned events to carry IDs, tenant/project scope, and timestamps', () => {
    const eventEnvelope = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a79',
      type: 'workflow.run.started',
      version: 1,
      occurredAt: '2026-05-12T15:59:00.000Z',
      scope: {
        tenantId: validTenantId,
        projectId: validProjectId,
      },
      payload: {
        runId: '01890f42-98c4-7cc3-ba5e-0c567f1d3a80',
      },
    };

    expect(eventEnvelopeSchema.parse(eventEnvelope)).toEqual(eventEnvelope);
    expect(() => eventEnvelopeSchema.parse({ ...eventEnvelope, type: '' })).toThrow();
    expect(() => eventEnvelopeSchema.parse({ ...eventEnvelope, version: 0 })).toThrow();
    expect(() =>
      eventEnvelopeSchema.parse({ ...eventEnvelope, occurredAt: 'not-a-date' }),
    ).toThrow();
    expect(() => eventEnvelopeSchema.parse({ ...eventEnvelope, payload: undefined })).toThrow();
    expect(() =>
      eventEnvelopeSchema.parse({
        ...eventEnvelope,
        scope: { tenantId: validTenantId },
      }),
    ).toThrow();
  });
});
