import type { ColumnType } from 'kysely';
import type { AttemptState, BillingStatus, JobState, LeaseState, ProcessorHealthStatus, WorkflowRunRecord, WorkflowStepRecord } from '@helix/contracts';

export type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;
export type NullableTimestampColumn = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;
export type JsonObject = Record<string, unknown>;
export type JsonColumn = ColumnType<JsonObject, JsonObject | string | undefined, JsonObject | string>;
export type JsonArrayColumn<T> = ColumnType<readonly T[], readonly T[] | string | undefined, readonly T[] | string>;
export type NullableTextColumn = ColumnType<string | null, string | null | undefined, string | null>;
export type DefaultedNumberColumn = ColumnType<number, number | undefined, number>;
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

export interface RuntimeEventsTable {
  id: string;
  tenant_id: string;
  project_id: string;
  event_type: string;
  event_version: number;
  ordering_key: string;
  payload_json: JsonColumn;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
}

export type RuntimeOutboxStatus = 'pending' | 'published' | 'failed';
export type RuntimeOutboxStatusColumn = ColumnType<
  RuntimeOutboxStatus,
  RuntimeOutboxStatus | undefined,
  RuntimeOutboxStatus
>;

export interface RuntimeOutboxTable {
  id: string;
  tenant_id: string;
  project_id: string;
  event_id: string;
  topic: string;
  partition_key: string;
  status: RuntimeOutboxStatusColumn;
  publish_attempts: DefaultedNumberColumn;
  next_attempt_at: TimestampColumn;
  published_at: NullableTimestampColumn;
  last_error: NullableTextColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export type RuntimeInboxStatus = 'processing' | 'processed' | 'failed';
export type RuntimeInboxStatusColumn = ColumnType<
  RuntimeInboxStatus,
  RuntimeInboxStatus | undefined,
  RuntimeInboxStatus
>;

export interface RuntimeInboxTable {
  id: string;
  consumer_name: string;
  event_id: string;
  tenant_id: string;
  project_id: string;
  status: RuntimeInboxStatusColumn;
  processing_started_at: TimestampColumn;
  processed_at: NullableTimestampColumn;
  attempt_count: DefaultedNumberColumn;
  last_error: NullableTextColumn;
  updated_at: TimestampColumn;
}

export type JobStateColumn = ColumnType<JobState, JobState | undefined, JobState>;
export type AttemptStateColumn = ColumnType<AttemptState, AttemptState | undefined, AttemptState>;
export type LeaseStateColumn = ColumnType<LeaseState, LeaseState | undefined, LeaseState>;
export type WorkflowRunStateColumn = ColumnType<
  WorkflowRunRecord['state'],
  WorkflowRunRecord['state'] | undefined,
  WorkflowRunRecord['state']
>;
export type WorkflowStepStateColumn = ColumnType<
  WorkflowStepRecord['state'],
  WorkflowStepRecord['state'] | undefined,
  WorkflowStepRecord['state']
>;
export type WorkflowStepTypeColumn = ColumnType<
  WorkflowStepRecord['type'],
  WorkflowStepRecord['type'] | undefined,
  WorkflowStepRecord['type']
>;
export type ProcessorHealthStatusColumn = ColumnType<
  ProcessorHealthStatus | null,
  ProcessorHealthStatus | null | undefined,
  ProcessorHealthStatus | null
>;

export interface WorkflowDefinitionsTable {
  id: string;
  tenant_id: string;
  project_id: string;
  slug: string;
  name: string;
  description: NullableTextColumn;
  draft_graph_json: JsonColumn;
  metadata_json: JsonColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface WorkflowVersionsTable {
  id: string;
  tenant_id: string;
  project_id: string;
  workflow_id: string;
  version_number: number;
  graph_json: JsonColumn;
  metadata_json: JsonColumn;
  published_at: TimestampColumn;
  created_at: TimestampColumn;
}

export interface WorkflowRunsTable {
  id: string;
  tenant_id: string;
  project_id: string;
  workflow_id: string;
  workflow_version_id: string;
  state: WorkflowRunStateColumn;
  idempotency_key: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface WorkflowStepsTable {
  id: string;
  tenant_id: string;
  project_id: string;
  workflow_id: string;
  workflow_version_id: string;
  run_id: string;
  step_id: string;
  type: WorkflowStepTypeColumn;
  state: WorkflowStepStateColumn;
  job_id: NullableTextColumn;
  metadata_json: JsonColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface WorkflowStepDependenciesTable {
  tenant_id: string;
  project_id: string;
  workflow_id: string;
  workflow_version_id: string;
  run_id: string;
  from_step_id: string;
  to_step_id: string;
  created_at: TimestampColumn;
}

export interface JobsTable {
  id: string;
  tenant_id: string;
  project_id: string;
  state: JobStateColumn;
  priority: DefaultedNumberColumn;
  max_attempts: DefaultedNumberColumn;
  attempt_count: DefaultedNumberColumn;
  ready_at: TimestampColumn;
  idempotency_key: NullableTextColumn;
  constraints_json: JsonColumn;
  metadata_json: JsonColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
  finished_at: NullableTimestampColumn;
}

export interface JobAttemptsTable {
  id: string;
  tenant_id: string;
  project_id: string;
  job_id: string;
  attempt_number: number;
  state: AttemptStateColumn;
  agent_id: NullableTextColumn;
  started_at: TimestampColumn;
  finished_at: NullableTimestampColumn;
  failure_code: NullableTextColumn;
  failure_message: NullableTextColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface JobLeasesTable {
  id: string;
  tenant_id: string;
  project_id: string;
  job_id: string;
  attempt_id: string;
  agent_id: string;
  state: LeaseStateColumn;
  acquired_at: TimestampColumn;
  expires_at: TimestampColumn;
  last_heartbeat_at: TimestampColumn;
  released_at: NullableTimestampColumn;
  expired_at: NullableTimestampColumn;
  canceled_at: NullableTimestampColumn;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface ProcessorRegistrationsTable {
  id: string;
  tenant_id: string;
  project_id: string;
  agent_id: string;
  capabilities_json: JsonColumn;
  hardware_json: JsonColumn;
  region: string;
  labels_json: JsonColumn;
  tags_json: JsonArrayColumn<string>;
  routing_explanation_json: JsonColumn;
  last_heartbeat_at: NullableTimestampColumn;
  health_status: ProcessorHealthStatusColumn;
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
  workflow_definitions: WorkflowDefinitionsTable;
  workflow_versions: WorkflowVersionsTable;
  workflow_runs: WorkflowRunsTable;
  workflow_steps: WorkflowStepsTable;
  workflow_step_dependencies: WorkflowStepDependenciesTable;
  jobs: JobsTable;
  job_attempts: JobAttemptsTable;
  job_leases: JobLeasesTable;
  processor_registrations: ProcessorRegistrationsTable;
  runtime_events: RuntimeEventsTable;
  runtime_outbox: RuntimeOutboxTable;
  runtime_inbox: RuntimeInboxTable;
}
