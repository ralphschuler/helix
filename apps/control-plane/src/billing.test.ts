import { describe, expect, it } from 'vitest';

import type { AuthPrincipal } from '@helix/contracts';

import { createApp } from './server/app.js';
import {
  BillingService,
  type BillingRepository,
  type StripeCustomerMappingRecord,
  type StripeWebhookEventRecord,
  type UsageLedgerRecord,
} from './features/billing/billing-service.js';
import {
  LocalStripeBillingAdapter,
  type StripeBillingAdapter,
  type StripeWebhookEvent,
} from './features/billing/stripe-adapter.js';
import { StripeBillingWebhookHandler } from './features/billing/stripe-webhook.js';
import type { SecurityAuditEvent, SecurityAuditSink } from './features/iam/security-audit.js';

const tenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const otherTenantId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a76';
const projectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';
const organizationId = '01890f42-98c4-7cc3-aa5e-0c567f1d3a85';
const otherOrganizationId = '01890f42-98c4-7cc3-ba5e-0c567f1d3a86';
const actor: AuthPrincipal = { type: 'service', id: 'billing-test' };

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

class RecordingBillingRepository implements BillingRepository {
  readonly usageRecords: UsageLedgerRecord[] = [];
  readonly customerMappings = new Map<string, StripeCustomerMappingRecord>();
  readonly webhookEvents = new Map<string, StripeWebhookEventRecord>();
  projectionUpdateCount = 0;

  async insertUsage(record: UsageLedgerRecord): Promise<void> {
    this.usageRecords.push(record);
  }

  async findUsageByIdempotencyKey(input: {
    readonly tenantId: string;
    readonly organizationId: string;
    readonly idempotencyKey: string;
  }): Promise<UsageLedgerRecord | null> {
    return (
      this.usageRecords.find(
        (record) =>
          record.tenantId === input.tenantId &&
          record.organizationId === input.organizationId &&
          record.idempotencyKey === input.idempotencyKey,
      ) ?? null
    );
  }

  async listUsage(input: {
    readonly tenantId: string;
    readonly organizationId: string;
    readonly projectId?: string | null;
  }): Promise<UsageLedgerRecord[]> {
    return this.usageRecords.filter(
      (record) =>
        record.tenantId === input.tenantId &&
        record.organizationId === input.organizationId &&
        (input.projectId === undefined || record.projectId === input.projectId),
    );
  }

  async findStripeCustomerMappingByCustomerId(
    stripeCustomerId: string,
  ): Promise<StripeCustomerMappingRecord | null> {
    return this.customerMappings.get(stripeCustomerId) ?? null;
  }

  async hasProcessedStripeWebhookEvent(stripeEventId: string): Promise<boolean> {
    return this.webhookEvents.has(stripeEventId);
  }

  async recordStripeWebhookEvent(record: StripeWebhookEventRecord): Promise<void> {
    this.webhookEvents.set(record.stripeEventId, record);
  }

  async updateStripeCustomerProjection(input: {
    readonly stripeCustomerId: string;
    readonly billingStatus: StripeCustomerMappingRecord['billingStatus'];
    readonly currentSubscriptionId: string | null;
    readonly updatedAt: Date;
  }): Promise<void> {
    const mapping = this.customerMappings.get(input.stripeCustomerId);

    if (mapping === undefined) {
      return;
    }

    this.projectionUpdateCount += 1;
    this.customerMappings.set(input.stripeCustomerId, {
      ...mapping,
      billingStatus: input.billingStatus,
      currentSubscriptionId: input.currentSubscriptionId,
      updatedAt: input.updatedAt,
    });
  }
}

class MockStripeBillingAdapter implements StripeBillingAdapter {
  constructCount = 0;

  constructor(private readonly event: StripeWebhookEvent) {}

  async constructWebhookEvent(): Promise<StripeWebhookEvent> {
    this.constructCount += 1;
    return this.event;
  }
}

function createMappedRepository(): RecordingBillingRepository {
  const repository = new RecordingBillingRepository();
  repository.customerMappings.set('cus_test_123', {
    id: '01890f42-98c4-7cc3-ba5e-0c567f1d3a90',
    tenantId,
    organizationId,
    stripeCustomerId: 'cus_test_123',
    billingStatus: 'unconfigured',
    currentSubscriptionId: null,
    createdAt: new Date('2026-05-12T17:00:00.000Z'),
    updatedAt: new Date('2026-05-12T17:00:00.000Z'),
  });

  return repository;
}

describe('billing usage ledger internals', () => {
  it('records tenant/org scoped usage once per idempotency key and lists only matching scope', async () => {
    const repository = new RecordingBillingRepository();
    const auditSink = new RecordingAuditSink();
    const service = new BillingService({
      auditSink,
      generateId: sequence([
        '01890f42-98c4-7cc3-aa5e-0c567f1d3a91',
        '01890f42-98c4-7cc3-ba5e-0c567f1d3a92',
      ]),
      now: () => new Date('2026-05-12T17:10:00.000Z'),
      repository,
    });

    const first = await service.recordUsage({
      tenantId,
      organizationId,
      projectId,
      usageType: 'job.execution',
      quantity: 3,
      idempotencyKey: 'usage:job-123',
      metadata: { jobId: 'job-123' },
      actor,
    });
    const duplicate = await service.recordUsage({
      tenantId,
      organizationId,
      projectId,
      usageType: 'job.execution',
      quantity: 99,
      idempotencyKey: 'usage:job-123',
      metadata: { jobId: 'job-123', duplicate: true },
      actor,
    });

    expect(duplicate).toEqual(first);
    expect(repository.usageRecords).toHaveLength(1);
    expect(await service.listUsage({ tenantId, organizationId })).toEqual([first]);
    await expect(
      service.listUsage({ tenantId: otherTenantId, organizationId }),
    ).resolves.toEqual([]);
    await expect(
      service.listUsage({ tenantId, organizationId: otherOrganizationId }),
    ).resolves.toEqual([]);
    expect(auditSink.events.map((event) => event.action)).toEqual([
      'billing.usage_recorded',
    ]);
    expect(auditSink.events[0]).toMatchObject({
      tenantId,
      projectId,
      resourceType: 'billing_usage',
      resourceId: first.id,
    });
  });
});

describe('Stripe billing webhooks', () => {
  it('accepts a locally signed Stripe fixture through the public webhook route and ignores duplicate delivery', async () => {
    const repository = createMappedRepository();
    const auditSink = new RecordingAuditSink();
    const service = new BillingService({
      auditSink,
      generateId: sequence(['01890f42-98c4-7cc3-aa5e-0c567f1d3b01']),
      now: () => new Date(1770000000 * 1000),
      repository,
    });
    const adapter = new LocalStripeBillingAdapter({
      endpointSecret: 'whsec_test_secret',
      now: () => new Date(1770000000 * 1000),
    });
    const app = createApp({
      stripeBillingWebhookHandler: new StripeBillingWebhookHandler({ adapter, service }),
    });
    const rawBody = '{"id":"evt_subscription_updated","type":"customer.subscription.updated","created":1770000000,"data":{"object":{"id":"sub_123","customer":"cus_test_123","status":"active"}}}';
    const stripeSignature = 't=1770000000,v1=e4fd29dbf96bd789774b83af8f06af9156aaa8b51b585522f6f185b0e977f26f';

    const firstResponse = await app.request('/webhooks/stripe', {
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': stripeSignature,
      },
      method: 'POST',
    });
    const duplicateResponse = await app.request('/webhooks/stripe', {
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': stripeSignature,
      },
      method: 'POST',
    });

    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toEqual({
      duplicate: false,
      received: true,
    });
    expect(duplicateResponse.status).toBe(200);
    await expect(duplicateResponse.json()).resolves.toEqual({
      duplicate: true,
      received: true,
    });
    expect(repository.webhookEvents).toHaveLength(1);
    expect(repository.projectionUpdateCount).toBe(1);
    expect(repository.customerMappings.get('cus_test_123')).toMatchObject({
      billingStatus: 'active',
      currentSubscriptionId: 'sub_123',
    });
    expect(auditSink.events.map((event) => event.action)).toEqual([
      'billing.stripe_webhook.processed',
    ]);
  });

  it('rejects invalid Stripe signatures before mutating billing state', async () => {
    const repository = createMappedRepository();
    const service = new BillingService({
      auditSink: new RecordingAuditSink(),
      repository,
    });
    const app = createApp({
      stripeBillingWebhookHandler: new StripeBillingWebhookHandler({
        adapter: new LocalStripeBillingAdapter({
          endpointSecret: 'whsec_test_secret',
          now: () => new Date(1770000000 * 1000),
        }),
        service,
      }),
    });

    const response = await app.request('/webhooks/stripe', {
      body: '{"id":"evt_bad","type":"customer.subscription.updated","created":1770000000,"data":{"object":{"id":"sub_123","customer":"cus_test_123","status":"active"}}}',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1770000000,v1=bad',
      },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_stripe_webhook',
    });
    expect(repository.webhookEvents).toHaveLength(0);
    expect(repository.projectionUpdateCount).toBe(0);
  });

  it('can be driven by a mock Stripe adapter without live Stripe network calls', async () => {
    const repository = createMappedRepository();
    const service = new BillingService({
      auditSink: new RecordingAuditSink(),
      generateId: sequence(['01890f42-98c4-7cc3-aa5e-0c567f1d3b02']),
      now: () => new Date('2026-05-12T17:30:00.000Z'),
      repository,
    });
    const mockAdapter = new MockStripeBillingAdapter({
      id: 'evt_mock_payment_failed',
      type: 'invoice.payment_failed',
      customerId: 'cus_test_123',
      subscriptionId: 'sub_123',
      subscriptionStatus: 'past_due',
      createdAt: new Date('2026-05-12T17:29:00.000Z'),
      payload: { fixture: true },
    });
    const handler = new StripeBillingWebhookHandler({ adapter: mockAdapter, service });

    await expect(
      handler.handle({ rawBody: 'not-used-by-mock', signatureHeader: null }),
    ).resolves.toEqual({ duplicate: false });
    expect(mockAdapter.constructCount).toBe(1);
    expect(repository.customerMappings.get('cus_test_123')).toMatchObject({
      billingStatus: 'past_due',
    });
  });
});
