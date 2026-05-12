import type { ColumnType } from 'kysely';
import type { BillingStatus } from '@helix/contracts';

export type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;
export type NullableTimestampColumn = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;
export type JsonObject = Record<string, unknown>;
export type JsonColumn = ColumnType<JsonObject, JsonObject | string | undefined, JsonObject | string>;
export type StringArrayJsonColumn = ColumnType<
  readonly string[],
  readonly string[] | string | undefined,
  readonly string[] | string
>;
export type ProjectStatusColumn = ColumnType<
  'active' | 'archived',
  'active' | 'archived' | undefined,
  'active' | 'archived'
>;

export interface SchemaMigrationsTable {
  id: string;
  checksum_sha256: string;
  applied_at: TimestampColumn;
}

export interface TenantsTable {
  id: string;
  slug: string;
  name: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface OrganizationsTable {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  stytch_organization_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface ProjectsTable {
  id: string;
  tenant_id: string;
  organization_id: string;
  slug: string;
  name: string;
  status: ProjectStatusColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface AuditEventsTable {
  id: string;
  tenant_id: string;
  project_id: string | null;
  actor_type: string | null;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata_json: JsonColumn;
  occurred_at: TimestampColumn;
}

export interface CustomRolesTable {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  permissions_json: StringArrayJsonColumn;
  disabled_at: NullableTimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface ProjectApiKeysTable {
  id: string;
  tenant_id: string;
  project_id: string;
  name: string;
  key_prefix: string;
  secret_hash_sha256: string;
  permissions_json: StringArrayJsonColumn;
  created_by_type: string;
  created_by_id: string;
  revoked_at: NullableTimestampColumn;
  revoked_by_type: string | null;
  revoked_by_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface AgentsTable {
  id: string;
  tenant_id: string;
  project_id: string;
  name: string;
  credential_prefix: string;
  credential_hash_sha256: string;
  permissions_json: StringArrayJsonColumn;
  created_by_type: string;
  created_by_id: string;
  revoked_at: NullableTimestampColumn;
  revoked_by_type: string | null;
  revoked_by_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface AgentTokensTable {
  id: string;
  tenant_id: string;
  project_id: string;
  agent_id: string;
  token_prefix: string;
  token_hash_sha256: string;
  permissions_json: StringArrayJsonColumn;
  expires_at: TimestampColumn;
  revoked_at: NullableTimestampColumn;
  created_at: TimestampColumn;
}

export type BillingStatusColumn = ColumnType<
  BillingStatus,
  BillingStatus | undefined,
  BillingStatus
>;

export interface BillingStripeCustomersTable {
  id: string;
  tenant_id: string;
  organization_id: string;
  stripe_customer_id: string;
  billing_status: BillingStatusColumn;
  current_subscription_id: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface BillingStripeWebhookEventsTable {
  stripe_event_id: string;
  tenant_id: string;
  organization_id: string;
  stripe_customer_id: string;
  event_type: string;
  payload_json: JsonColumn;
  processed_at: TimestampColumn;
}

export interface BillingUsageLedgerTable {
  id: string;
  tenant_id: string;
  organization_id: string;
  project_id: string | null;
  usage_type: string;
  quantity: number;
  idempotency_key: string;
  metadata_json: JsonColumn;
  recorded_at: TimestampColumn;
}

export interface RetentionPoliciesTable {
  id: string;
  tenant_id: string;
  project_id: string | null;
  target: string;
  retain_for_days: number;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface HelixDatabase {
  _schema_migrations: SchemaMigrationsTable;
  tenants: TenantsTable;
  organizations: OrganizationsTable;
  projects: ProjectsTable;
  audit_events: AuditEventsTable;
  retention_policies: RetentionPoliciesTable;
  custom_roles: CustomRolesTable;
  project_api_keys: ProjectApiKeysTable;
  agents: AgentsTable;
  agent_tokens: AgentTokensTable;
  billing_stripe_customers: BillingStripeCustomersTable;
  billing_stripe_webhook_events: BillingStripeWebhookEventsTable;
  billing_usage_ledger: BillingUsageLedgerTable;
}
