import type { AuthPrincipal, BillingStatus } from '@helix/contracts';

import type { SecurityAuditSink } from '../iam/security-audit.js';
import { randomUuidV7LikeId } from '../iam/token-secrets.js';
import type { StripeWebhookEvent } from './stripe-adapter.js';

export interface OrganizationScope {
  readonly tenantId: string;
  readonly organizationId: string;
}

export interface StripeCustomerMappingRecord extends OrganizationScope {
  readonly id: string;
  readonly stripeCustomerId: string;
  readonly billingStatus: BillingStatus;
  readonly currentSubscriptionId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UsageLedgerRecord extends OrganizationScope {
  readonly id: string;
  readonly projectId: string | null;
  readonly usageType: string;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly recordedAt: Date;
}

export interface StripeWebhookEventRecord extends OrganizationScope {
  readonly stripeEventId: string;
  readonly stripeCustomerId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly processedAt: Date;
}

export interface BillingRepository {
  insertUsage(record: UsageLedgerRecord): Promise<void>;
  findUsageByIdempotencyKey(input: OrganizationScope & {
    readonly idempotencyKey: string;
  }): Promise<UsageLedgerRecord | null>;
  listUsage(input: OrganizationScope & {
    readonly projectId?: string | null;
  }): Promise<UsageLedgerRecord[]>;
  findStripeCustomerMappingByCustomerId(
    stripeCustomerId: string,
  ): Promise<StripeCustomerMappingRecord | null>;
  hasProcessedStripeWebhookEvent(stripeEventId: string): Promise<boolean>;
  recordStripeWebhookEvent(record: StripeWebhookEventRecord): Promise<void>;
  updateStripeCustomerProjection(input: {
    readonly stripeCustomerId: string;
    readonly billingStatus: BillingStatus;
    readonly currentSubscriptionId: string | null;
    readonly updatedAt: Date;
  }): Promise<void>;
}

export interface RecordUsageInput extends OrganizationScope {
  readonly projectId?: string | null;
  readonly usageType: string;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly actor: AuthPrincipal;
}

export interface BillingServiceOptions {
  readonly repository: BillingRepository;
  readonly auditSink: SecurityAuditSink;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export interface HandleStripeWebhookResult {
  readonly duplicate: boolean;
}

export class UnmappedStripeCustomerError extends Error {
  constructor(stripeCustomerId: string) {
    super(`No Stripe customer mapping exists for ${stripeCustomerId}`);
    this.name = 'UnmappedStripeCustomerError';
  }
}

export class BillingService {
  private readonly repository: BillingRepository;
  private readonly auditSink: SecurityAuditSink;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options: BillingServiceOptions) {
    this.repository = options.repository;
    this.auditSink = options.auditSink;
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => randomUuidV7LikeId(this.now()));
  }

  async recordUsage(input: RecordUsageInput): Promise<UsageLedgerRecord> {
    assertNonBlank(input.usageType, 'usageType');
    assertNonBlank(input.idempotencyKey, 'idempotencyKey');

    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new Error('Usage quantity must be a positive integer.');
    }

    const existing = await this.repository.findUsageByIdempotencyKey({
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey,
    });

    if (existing !== null) {
      return existing;
    }

    const recordedAt = this.now();
    const record: UsageLedgerRecord = {
      id: this.generateId(),
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      usageType: input.usageType,
      quantity: input.quantity,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata ?? {},
      recordedAt,
    };

    await this.repository.insertUsage(record);
    await this.auditSink.record({
      id: this.generateId(),
      tenantId: input.tenantId,
      projectId: record.projectId,
      actor: input.actor,
      action: 'billing.usage_recorded',
      resourceType: 'billing_usage',
      resourceId: record.id,
      metadata: {
        organizationId: input.organizationId,
        usageType: input.usageType,
        quantity: input.quantity,
      },
      occurredAt: recordedAt,
    });

    return record;
  }

  async listUsage(input: OrganizationScope & {
    readonly projectId?: string | null;
  }): Promise<UsageLedgerRecord[]> {
    return this.repository.listUsage(input);
  }

  async handleStripeWebhook(event: StripeWebhookEvent): Promise<HandleStripeWebhookResult> {
    if (await this.repository.hasProcessedStripeWebhookEvent(event.id)) {
      return { duplicate: true };
    }

    const mapping = await this.repository.findStripeCustomerMappingByCustomerId(
      event.customerId,
    );

    if (mapping === null) {
      throw new UnmappedStripeCustomerError(event.customerId);
    }

    const processedAt = this.now();
    const nextStatus = event.subscriptionStatus ?? inferBillingStatusFromEventType(event.type);
    const nextSubscriptionId = event.subscriptionId ?? mapping.currentSubscriptionId;

    await this.repository.recordStripeWebhookEvent({
      stripeEventId: event.id,
      tenantId: mapping.tenantId,
      organizationId: mapping.organizationId,
      stripeCustomerId: mapping.stripeCustomerId,
      eventType: event.type,
      payload: event.payload,
      processedAt,
    });

    if (nextStatus !== null || nextSubscriptionId !== mapping.currentSubscriptionId) {
      await this.repository.updateStripeCustomerProjection({
        stripeCustomerId: mapping.stripeCustomerId,
        billingStatus: nextStatus ?? mapping.billingStatus,
        currentSubscriptionId: nextSubscriptionId,
        updatedAt: processedAt,
      });
    }

    await this.auditSink.record({
      id: this.generateId(),
      tenantId: mapping.tenantId,
      projectId: null,
      actor: {
        type: 'service',
        id: 'stripe-webhook',
      },
      action: 'billing.stripe_webhook.processed',
      resourceType: 'stripe_webhook_event',
      resourceId: null,
      metadata: {
        organizationId: mapping.organizationId,
        stripeCustomerId: mapping.stripeCustomerId,
        stripeEventId: event.id,
        eventType: event.type,
      },
      occurredAt: processedAt,
    });

    return { duplicate: false };
  }
}

function assertNonBlank(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} must be non-empty.`);
  }
}

function inferBillingStatusFromEventType(eventType: string): BillingStatus | null {
  switch (eventType) {
    case 'invoice.paid':
      return 'active';
    case 'invoice.payment_failed':
      return 'past_due';
    case 'customer.subscription.deleted':
      return 'canceled';
    default:
      return null;
  }
}
