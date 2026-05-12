import type { Kysely } from 'kysely';

import type { HelixDatabase, JsonObject } from '../../db/schema.js';
import type {
  BillingRepository,
  StripeCustomerMappingRecord,
  StripeWebhookEventRecord,
  UsageLedgerRecord,
} from './billing-service.js';

export class KyselyBillingRepository implements BillingRepository {
  private readonly db: Kysely<HelixDatabase>;

  constructor(db: Kysely<HelixDatabase>) {
    this.db = db;
  }

  async insertUsage(record: UsageLedgerRecord): Promise<void> {
    await this.db
      .insertInto('billing_usage_ledger')
      .values({
        id: record.id,
        tenant_id: record.tenantId,
        organization_id: record.organizationId,
        project_id: record.projectId,
        usage_type: record.usageType,
        quantity: record.quantity,
        idempotency_key: record.idempotencyKey,
        metadata_json: record.metadata,
        recorded_at: record.recordedAt,
      })
      .execute();
  }

  async findUsageByIdempotencyKey(input: {
    readonly tenantId: string;
    readonly organizationId: string;
    readonly idempotencyKey: string;
  }): Promise<UsageLedgerRecord | null> {
    const row = await this.db
      .selectFrom('billing_usage_ledger')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('organization_id', '=', input.organizationId)
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirst();

    return row === undefined ? null : toUsageLedgerRecord(row);
  }

  async listUsage(input: {
    readonly tenantId: string;
    readonly organizationId: string;
    readonly projectId?: string | null;
  }): Promise<UsageLedgerRecord[]> {
    let query = this.db
      .selectFrom('billing_usage_ledger')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('organization_id', '=', input.organizationId)
      .orderBy('recorded_at', 'desc');

    if (input.projectId !== undefined) {
      query = query.where('project_id', input.projectId === null ? 'is' : '=', input.projectId);
    }

    const rows = await query.execute();

    return rows.map(toUsageLedgerRecord);
  }

  async findStripeCustomerMappingByCustomerId(
    stripeCustomerId: string,
  ): Promise<StripeCustomerMappingRecord | null> {
    const row = await this.db
      .selectFrom('billing_stripe_customers')
      .selectAll()
      .where('stripe_customer_id', '=', stripeCustomerId)
      .executeTakeFirst();

    return row === undefined ? null : toStripeCustomerMappingRecord(row);
  }

  async hasProcessedStripeWebhookEvent(stripeEventId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('billing_stripe_webhook_events')
      .select('stripe_event_id')
      .where('stripe_event_id', '=', stripeEventId)
      .executeTakeFirst();

    return row !== undefined;
  }

  async recordStripeWebhookEvent(record: StripeWebhookEventRecord): Promise<void> {
    await this.db
      .insertInto('billing_stripe_webhook_events')
      .values({
        stripe_event_id: record.stripeEventId,
        tenant_id: record.tenantId,
        organization_id: record.organizationId,
        stripe_customer_id: record.stripeCustomerId,
        event_type: record.eventType,
        payload_json: record.payload,
        processed_at: record.processedAt,
      })
      .execute();
  }

  async updateStripeCustomerProjection(input: {
    readonly stripeCustomerId: string;
    readonly billingStatus: StripeCustomerMappingRecord['billingStatus'];
    readonly currentSubscriptionId: string | null;
    readonly updatedAt: Date;
  }): Promise<void> {
    await this.db
      .updateTable('billing_stripe_customers')
      .set({
        billing_status: input.billingStatus,
        current_subscription_id: input.currentSubscriptionId,
        updated_at: input.updatedAt,
      })
      .where('stripe_customer_id', '=', input.stripeCustomerId)
      .execute();
  }
}

function toUsageLedgerRecord(row: {
  readonly id: string;
  readonly tenant_id: string;
  readonly organization_id: string;
  readonly project_id: string | null;
  readonly usage_type: string;
  readonly quantity: number;
  readonly idempotency_key: string;
  readonly metadata_json: JsonObject;
  readonly recorded_at: Date;
}): UsageLedgerRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    usageType: row.usage_type,
    quantity: row.quantity,
    idempotencyKey: row.idempotency_key,
    metadata: row.metadata_json,
    recordedAt: row.recorded_at,
  };
}

function toStripeCustomerMappingRecord(row: {
  readonly id: string;
  readonly tenant_id: string;
  readonly organization_id: string;
  readonly stripe_customer_id: string;
  readonly billing_status: StripeCustomerMappingRecord['billingStatus'];
  readonly current_subscription_id: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}): StripeCustomerMappingRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    stripeCustomerId: row.stripe_customer_id,
    billingStatus: row.billing_status,
    currentSubscriptionId: row.current_subscription_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
