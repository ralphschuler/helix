import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql, type Kysely } from 'kysely';

import type { HelixDatabase } from './schema.ts';

export interface MigrationFile {
  id: string;
  filename: string;
  path: string;
  sql: string;
  checksumSha256: string;
}

export interface MigrationStore {
  ensureMigrationTable(): Promise<void>;
  listAppliedMigrations(): Promise<Map<string, string>>;
  applyMigration(id: string, checksumSha256: string, sql: string): Promise<void>;
}

export interface MigrationRunResult {
  applied: string[];
  skipped: string[];
}

const migrationFilenamePattern = /^\d{4}_[a-z0-9_]+\.sql$/u;

export function getDefaultMigrationsDirectory(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');
}

export async function loadMigrationFiles(directory = getDefaultMigrationsDirectory()): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((filename) => filename.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    filenames.map(async (filename) => {
      if (!migrationFilenamePattern.test(filename)) {
        throw new Error(`Invalid migration filename: ${filename}`);
      }

      const filePath = path.join(directory, filename);
      const migrationSql = await readFile(filePath, 'utf8');
      const id = filename.slice(0, -'.sql'.length);

      return {
        id,
        filename,
        path: filePath,
        sql: migrationSql,
        checksumSha256: createHash('sha256').update(migrationSql).digest('hex'),
      };
    }),
  );
}

export async function migrateDatabase(
  store: MigrationStore,
  migrations: readonly MigrationFile[],
): Promise<MigrationRunResult> {
  await store.ensureMigrationTable();
  const appliedMigrations = await store.listAppliedMigrations();
  const result: MigrationRunResult = { applied: [], skipped: [] };

  for (const migration of migrations) {
    const appliedChecksum = appliedMigrations.get(migration.id);

    if (appliedChecksum !== undefined) {
      if (appliedChecksum !== migration.checksumSha256) {
        throw new Error(`checksum mismatch for applied migration ${migration.id}`);
      }

      result.skipped.push(migration.id);
      continue;
    }

    await store.applyMigration(migration.id, migration.checksumSha256, migration.sql);
    appliedMigrations.set(migration.id, migration.checksumSha256);
    result.applied.push(migration.id);
  }

  return result;
}

export class KyselyMigrationStore implements MigrationStore {
  private readonly db: Kysely<HelixDatabase>;

  constructor(db: Kysely<HelixDatabase>) {
    this.db = db;
  }

  async ensureMigrationTable(): Promise<void> {
    await sql`
      create table if not exists _schema_migrations (
        id text primary key,
        checksum_sha256 text not null,
        applied_at timestamptz not null default now()
      )
    `.execute(this.db);
  }

  async listAppliedMigrations(): Promise<Map<string, string>> {
    const rows = await this.db
      .selectFrom('_schema_migrations')
      .select(['id', 'checksum_sha256'])
      .execute();

    return new Map(rows.map((row) => [row.id, row.checksum_sha256]));
  }

  async applyMigration(id: string, checksumSha256: string, migrationSql: string): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      await sql.raw(migrationSql).execute(transaction);
      await transaction
        .insertInto('_schema_migrations')
        .values({ id, checksum_sha256: checksumSha256 })
        .execute();
    });
  }
}
