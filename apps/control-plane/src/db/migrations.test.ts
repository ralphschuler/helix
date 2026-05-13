import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  getDefaultMigrationsDirectory,
  loadMigrationFiles,
  migrateDatabase,
  type MigrationStore,
} from './migrations.ts';

class RecordingMigrationStore implements MigrationStore {
  readonly applied = new Map<string, string>();
  readonly executedSql: string[] = [];
  ensured = false;

  async ensureMigrationTable(): Promise<void> {
    this.ensured = true;
  }

  async listAppliedMigrations(): Promise<Map<string, string>> {
    return new Map(this.applied);
  }

  async applyMigration(id: string, checksumSha256: string, sql: string): Promise<void> {
    this.executedSql.push(sql);
    this.applied.set(id, checksumSha256);
  }
}

describe('database migration runner', () => {
  it('applies pending SQL migrations in filename order and skips them on rerun', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'helix-migrations-'));
    try {
      await writeFile(path.join(dir, '0002_second.sql'), 'select 2;\n');
      await writeFile(path.join(dir, '0001_first.sql'), 'select 1;\n');
      await writeFile(path.join(dir, 'README.md'), 'ignored\n');

      const store = new RecordingMigrationStore();
      const firstRun = await migrateDatabase(store, await loadMigrationFiles(dir));
      const secondRun = await migrateDatabase(store, await loadMigrationFiles(dir));

      expect(store.ensured).toBe(true);
      expect(firstRun.applied).toEqual(['0001_first', '0002_second']);
      expect(firstRun.skipped).toEqual([]);
      expect(secondRun.applied).toEqual([]);
      expect(secondRun.skipped).toEqual(['0001_first', '0002_second']);
      expect(store.executedSql).toEqual(['select 1;\n', 'select 2;\n']);
      expect(store.applied.get('0001_first')).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects an already-applied migration when its checksum changed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'helix-migrations-'));
    try {
      await writeFile(path.join(dir, '0001_first.sql'), 'select 1;\n');
      const store = new RecordingMigrationStore();
      store.applied.set('0001_first', '0'.repeat(64));

      await expect(migrateDatabase(store, await loadMigrationFiles(dir))).rejects.toThrow(
        /checksum mismatch for applied migration 0001_first/u,
      );
      expect(store.executedSql).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ships a base SQL migration with tenant/project-scoped foundation tables', async () => {
    const migrations = await loadMigrationFiles(getDefaultMigrationsDirectory());
    const baseMigration = migrations.find((migration) => migration.id === '0001_base_tenant_project_schema');

    expect(baseMigration).toBeDefined();
    expect(baseMigration?.sql).toContain('create table if not exists tenants');
    expect(baseMigration?.sql).toContain('create table if not exists organizations');
    expect(baseMigration?.sql).toContain('create table if not exists projects');
    expect(baseMigration?.sql).toContain('create table if not exists audit_events');
    expect(baseMigration?.sql).toContain('create table if not exists retention_policies');
    expect(baseMigration?.sql).toMatch(/projects[\s\S]*tenant_id uuid not null/u);
    expect(baseMigration?.sql).toMatch(/audit_events[\s\S]*tenant_id uuid not null[\s\S]*project_id uuid/u);
    expect(baseMigration?.sql).toMatch(/retention_policies[\s\S]*tenant_id uuid not null[\s\S]*project_id uuid/u);

    await expect(readFile(path.join(getDefaultMigrationsDirectory(), '0001_base_tenant_project_schema.sql'), 'utf8')).resolves.toBe(baseMigration?.sql);
  });

  it('ships runtime event persistence schema with scoped outbox and inbox primitives', async () => {
    const migrations = await loadMigrationFiles(getDefaultMigrationsDirectory());
    const runtimeMigration = migrations.find(
      (migration) => migration.id === '0005_runtime_event_persistence',
    );

    expect(runtimeMigration).toBeDefined();
    expect(runtimeMigration?.sql).toContain('create table if not exists runtime_events');
    expect(runtimeMigration?.sql).toContain('create table if not exists runtime_outbox');
    expect(runtimeMigration?.sql).toContain('create table if not exists runtime_inbox');
    expect(runtimeMigration?.sql).toMatch(/runtime_events[\s\S]*tenant_id uuid not null[\s\S]*project_id uuid not null/u);
    expect(runtimeMigration?.sql).toMatch(/runtime_events[\s\S]*id uuid primary key/u);
    expect(runtimeMigration?.sql).toMatch(/runtime_events[\s\S]*event_type text not null[\s\S]*event_version integer not null[\s\S]*ordering_key text not null/u);
    expect(runtimeMigration?.sql).toContain('runtime_events_project_scope_fk');
    expect(runtimeMigration?.sql).toContain('runtime_events_scope_id_unique');
    expect(runtimeMigration?.sql).toContain("payload_json jsonb not null default '{}'::jsonb");
    expect(runtimeMigration?.sql).toContain('runtime_events_payload_is_object');
    expect(runtimeMigration?.sql).toMatch(/runtime_outbox[\s\S]*tenant_id uuid not null[\s\S]*project_id uuid not null[\s\S]*event_id uuid not null/u);
    expect(runtimeMigration?.sql).toContain('runtime_outbox_event_scope_fk');
    expect(runtimeMigration?.sql).toContain('runtime_outbox_event_unique');
    expect(runtimeMigration?.sql).toContain('partition_key text not null');
    expect(runtimeMigration?.sql).toContain('runtime_outbox_pending_idx');
    expect(runtimeMigration?.sql).toMatch(/runtime_inbox[\s\S]*consumer_name text not null[\s\S]*event_id uuid not null[\s\S]*tenant_id uuid not null[\s\S]*project_id uuid not null/u);
    expect(runtimeMigration?.sql).toContain('runtime_inbox_event_scope_fk');
    expect(runtimeMigration?.sql).toContain('runtime_inbox_consumer_event_unique');
    expect(runtimeMigration?.sql).toContain("status text not null default 'processing'");

    await expect(
      readFile(path.join(getDefaultMigrationsDirectory(), '0005_runtime_event_persistence.sql'), 'utf8'),
    ).resolves.toBe(runtimeMigration?.sql);
  });

  it('ships job, attempt, and lease schema with scoped audit history foundations', async () => {
    const migrations = await loadMigrationFiles(getDefaultMigrationsDirectory());
    const jobMigration = migrations.find(
      (migration) => migration.id === '0006_job_attempt_lease_schema',
    );

    expect(jobMigration).toBeDefined();
    expect(jobMigration?.sql).toContain('create table if not exists jobs');
    expect(jobMigration?.sql).toContain('create table if not exists job_attempts');
    expect(jobMigration?.sql).toContain('create table if not exists job_leases');
    expect(jobMigration?.sql).toMatch(/jobs[\s\S]*tenant_id uuid not null[\s\S]*project_id uuid not null/u);
    expect(jobMigration?.sql).toContain('jobs_project_scope_fk');
    expect(jobMigration?.sql).toContain("jobs_state_check check (state in ('queued', 'running', 'retrying', 'completed', 'failed', 'dead_lettered', 'canceled'))");
    expect(jobMigration?.sql).toContain("constraints_json jsonb not null default '{}'::jsonb");
    expect(jobMigration?.sql).toContain("metadata_json jsonb not null default '{}'::jsonb");
    expect(jobMigration?.sql).toContain('jobs_scope_id_unique');
    expect(jobMigration?.sql).toContain('jobs_idempotency_key_unique');
    expect(jobMigration?.sql).toMatch(/job_attempts[\s\S]*tenant_id uuid not null[\s\S]*project_id uuid not null[\s\S]*job_id uuid not null/u);
    expect(jobMigration?.sql).toContain('job_attempts_job_scope_fk');
    expect(jobMigration?.sql).toContain('job_attempts_agent_scope_fk');
    expect(jobMigration?.sql).toContain("job_attempts_state_check check (state in ('running', 'completed', 'failed', 'expired', 'canceled'))");
    expect(jobMigration?.sql).toContain('job_attempts_job_attempt_number_unique');
    expect(jobMigration?.sql).toContain('job_attempts_job_id_id_unique');
    expect(jobMigration?.sql).toMatch(/job_leases[\s\S]*tenant_id uuid not null[\s\S]*project_id uuid not null[\s\S]*job_id uuid not null[\s\S]*attempt_id uuid not null/u);
    expect(jobMigration?.sql).toContain('canceled_at timestamptz');
    expect(jobMigration?.sql).toContain('job_leases_attempt_job_scope_fk');
    expect(jobMigration?.sql).toContain('job_leases_agent_scope_fk');
    expect(jobMigration?.sql).toContain("job_leases_state_check check (state in ('active', 'released', 'expired', 'canceled'))");
    expect(jobMigration?.sql).toContain('job_leases_terminal_state_timestamp_check');
    expect(jobMigration?.sql).toContain('job_leases_active_attempt_unique');
    expect(jobMigration?.sql).toContain('job_leases_project_history_idx');
    expect(jobMigration?.sql).not.toContain('payload_bytes');

    await expect(
      readFile(path.join(getDefaultMigrationsDirectory(), '0006_job_attempt_lease_schema.sql'), 'utf8'),
    ).resolves.toBe(jobMigration?.sql);
  });

  it('ships custom role disable migration for safe soft-disable semantics', async () => {
    const migrations = await loadMigrationFiles(getDefaultMigrationsDirectory());
    const customRoleDisableMigration = migrations.find(
      (migration) => migration.id === '0004_custom_role_disable',
    );

    expect(customRoleDisableMigration).toBeDefined();
    expect(customRoleDisableMigration?.sql).toContain(
      'alter table custom_roles add column if not exists disabled_at timestamptz',
    );
    expect(customRoleDisableMigration?.sql).toContain('custom_roles_active_tenant_slug_idx');

    await expect(
      readFile(path.join(getDefaultMigrationsDirectory(), '0004_custom_role_disable.sql'), 'utf8'),
    ).resolves.toBe(customRoleDisableMigration?.sql);
  });

  it('ships billing schema with org-scoped Stripe mapping, webhook idempotency, and usage ledger rows', async () => {
    const migrations = await loadMigrationFiles(getDefaultMigrationsDirectory());
    const billingMigration = migrations.find((migration) => migration.id === '0003_billing_schema');

    expect(billingMigration).toBeDefined();
    expect(billingMigration?.sql).toContain('create table if not exists billing_stripe_customers');
    expect(billingMigration?.sql).toContain('create table if not exists billing_stripe_webhook_events');
    expect(billingMigration?.sql).toContain('create table if not exists billing_usage_ledger');
    expect(billingMigration?.sql).toMatch(/billing_stripe_customers[\s\S]*tenant_id uuid not null[\s\S]*organization_id uuid not null/u);
    expect(billingMigration?.sql).toMatch(/billing_stripe_webhook_events[\s\S]*stripe_event_id text primary key/u);
    expect(billingMigration?.sql).toMatch(/billing_usage_ledger[\s\S]*tenant_id uuid not null[\s\S]*organization_id uuid not null/u);
    expect(billingMigration?.sql).toContain('billing_usage_ledger_idempotency_unique');
    expect(billingMigration?.sql).not.toContain('stripe_secret');

    await expect(readFile(path.join(getDefaultMigrationsDirectory(), '0003_billing_schema.sql'), 'utf8')).resolves.toBe(billingMigration?.sql);
  });

  it('ships IAM, API key, and agent token schema with project scope and hashed secrets only', async () => {
    const migrations = await loadMigrationFiles(getDefaultMigrationsDirectory());
    const iamMigration = migrations.find((migration) => migration.id === '0002_permission_iam_agent_tokens');

    expect(iamMigration).toBeDefined();
    expect(iamMigration?.sql).toContain('create table if not exists custom_roles');
    expect(iamMigration?.sql).toContain('create table if not exists project_api_keys');
    expect(iamMigration?.sql).toContain('create table if not exists agents');
    expect(iamMigration?.sql).toContain('create table if not exists agent_tokens');
    expect(iamMigration?.sql).toMatch(/project_api_keys[\s\S]*tenant_id uuid not null[\s\S]*project_id uuid not null/u);
    expect(iamMigration?.sql).toMatch(/agents[\s\S]*tenant_id uuid not null[\s\S]*project_id uuid not null/u);
    expect(iamMigration?.sql).toMatch(/agent_tokens[\s\S]*expires_at timestamptz not null/u);
    expect(iamMigration?.sql).toContain('secret_hash_sha256');
    expect(iamMigration?.sql).toContain('credential_hash_sha256');
    expect(iamMigration?.sql).toContain('token_hash_sha256');
    expect(iamMigration?.sql).not.toContain('plain_secret');
    expect(iamMigration?.sql).not.toContain('token_material');

    await expect(readFile(path.join(getDefaultMigrationsDirectory(), '0002_permission_iam_agent_tokens.sql'), 'utf8')).resolves.toBe(iamMigration?.sql);
  });
});
