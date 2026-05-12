#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import net from 'node:net';

const help = `Helix infrastructure smoke check

Usage:
  yarn infra:smoke
  node scripts/infra-smoke.mjs

Before running:
  docker compose up -d

Checks:
  - Postgres published localhost port accepts TCP connections
  - Postgres answers SELECT 1 over passworded TCP
  - Redpanda published Kafka localhost port accepts TCP connections
  - Redpanda returns Kafka broker metadata

Environment:
  HELIX_POSTGRES_HOST, HELIX_POSTGRES_PORT, HELIX_POSTGRES_DB, HELIX_POSTGRES_USER, HELIX_POSTGRES_PASSWORD
  HELIX_REDPANDA_HOST, HELIX_REDPANDA_KAFKA_PORT
`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(help);
  process.exit(0);
}

const postgresHost = process.env.HELIX_POSTGRES_HOST || '127.0.0.1';
const postgresPort = Number.parseInt(process.env.HELIX_POSTGRES_PORT || '5432', 10);
const postgresUser = process.env.HELIX_POSTGRES_USER || 'helix';
const postgresDb = process.env.HELIX_POSTGRES_DB || 'helix';
const postgresPassword = process.env.HELIX_POSTGRES_PASSWORD || 'helix_dev_password';
const redpandaHost = process.env.HELIX_REDPANDA_HOST || '127.0.0.1';
const redpandaKafkaPort = Number.parseInt(process.env.HELIX_REDPANDA_KAFKA_PORT || '9092', 10);

const attempts = Number.parseInt(process.env.HELIX_INFRA_SMOKE_ATTEMPTS || '30', 10);
const intervalMs = Number.parseInt(process.env.HELIX_INFRA_SMOKE_INTERVAL_MS || '2000', 10);

const checks = [
  {
    name: `Postgres localhost TCP ${postgresHost}:${postgresPort}`,
    run: () => checkTcp(postgresHost, postgresPort),
  },
  {
    name: 'Postgres answers SELECT 1 over passworded TCP',
    run: () => runDocker([
      'compose',
      'exec',
      '-T',
      'postgres',
      'env',
      `PGPASSWORD=${postgresPassword}`,
      'psql',
      '-h',
      '127.0.0.1',
      '-U',
      postgresUser,
      '-d',
      postgresDb,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'select 1 as helix_infra_smoke;',
    ]),
  },
  {
    name: `Redpanda Kafka localhost TCP ${redpandaHost}:${redpandaKafkaPort}`,
    run: () => checkTcp(redpandaHost, redpandaKafkaPort),
  },
  {
    name: 'Redpanda returns broker metadata',
    run: () => runDocker(['compose', 'exec', '-T', 'redpanda', 'rpk', 'cluster', 'info', '--brokers', 'redpanda:9092']),
  },
];

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function checkTcp(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    socket.setTimeout(2000);
    socket.once('connect', () => {
      socket.destroy();
      resolve({ ok: true });
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve({ ok: false, message: `timeout connecting to ${host}:${port}` });
    });
    socket.once('error', (error) => {
      socket.destroy();
      resolve({ ok: false, message: error.message });
    });
  });
}

function runDocker(dockerArgs) {
  const result = spawnSync('docker', dockerArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    return { ok: false, message: `failed to run docker: ${result.error.message}` };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      message: [result.stdout, result.stderr].filter(Boolean).join(''),
    };
  }

  return { ok: true };
}

async function runCheck(check) {
  process.stdout.write(`→ ${check.name}\n`);
  let lastResult;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await check.run();
    lastResult = result;

    if (result.ok) {
      process.stdout.write(`✓ ${check.name}\n`);
      return;
    }

    if (attempt < attempts) {
      process.stdout.write(`  waiting for ${check.name} (${attempt}/${attempts})\n`);
      await sleep(intervalMs);
    }
  }

  process.stderr.write(`infra:smoke failed: ${check.name}\n`);
  if (lastResult?.message) process.stderr.write(lastResult.message);
  process.stderr.write('\nStart local services with: docker compose up -d\n');
  process.exit(1);
}

process.stdout.write('infra:smoke starting\n');
for (const check of checks) await runCheck(check);
process.stdout.write('infra:smoke passed\n');
