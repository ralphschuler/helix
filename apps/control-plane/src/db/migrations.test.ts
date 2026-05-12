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
});
