import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Pool as PgPool, PoolConfig } from 'pg';

import type { HelixDatabase } from './schema.ts';

const DEFAULT_POSTGRES_PORT = 5432;

export interface PostgresEnv {
  HELIX_DATABASE_URL?: string | undefined;
  HELIX_POSTGRES_HOST?: string | undefined;
  HELIX_POSTGRES_PORT?: string | undefined;
  HELIX_POSTGRES_DB?: string | undefined;
  HELIX_POSTGRES_USER?: string | undefined;
  HELIX_POSTGRES_PASSWORD?: string | undefined;
}

export function createPostgresPoolConfig(env: PostgresEnv = process.env): PoolConfig {
  if (env.HELIX_DATABASE_URL) {
    return {
      application_name: 'helix-control-plane',
      connectionString: env.HELIX_DATABASE_URL,
    };
  }

  return {
    application_name: 'helix-control-plane',
    host: env.HELIX_POSTGRES_HOST ?? '127.0.0.1',
    port: Number.parseInt(env.HELIX_POSTGRES_PORT ?? `${DEFAULT_POSTGRES_PORT}`, 10),
    database: env.HELIX_POSTGRES_DB ?? 'helix',
    user: env.HELIX_POSTGRES_USER ?? 'helix',
    password: env.HELIX_POSTGRES_PASSWORD ?? 'helix_dev_password',
  };
}

export function createPostgresPool(config: PoolConfig = createPostgresPoolConfig()): PgPool {
  return new pg.Pool(config);
}

export function createHelixDatabase(pool: PgPool = createPostgresPool()): Kysely<HelixDatabase> {
  return new Kysely<HelixDatabase>({
    dialect: new PostgresDialect({ pool }),
  });
}
