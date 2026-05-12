import type { ColumnType } from 'kysely';

export type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;
export type JsonObject = Record<string, unknown>;
export type JsonColumn = ColumnType<JsonObject, JsonObject | string | undefined, JsonObject | string>;
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
}
