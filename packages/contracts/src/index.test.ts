import { describe, expect, it } from 'vitest';

import {
  authContextSchema,
  errorEnvelopeSchema,
  eventEnvelopeSchema,
  idempotencyKeySchema,
  idempotencyKeyScopeSchema,
  opaqueCursorSchema,
  tenantIdSchema,
  tenantProjectScopeSchema,
  tenantScopeSchema,
  uuidV7Schema,
} from '@helix/contracts';

const validTenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const validProjectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';

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
