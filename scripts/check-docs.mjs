#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';

const failures = [];

const requiredAdrs = [
  {
    path: 'docs/adr/0001-web-and-runtime-topology.md',
    title: 'ADR 0001: Web and Runtime Topology',
    topic: 'web/runtime topology',
  },
  {
    path: 'docs/adr/0002-ssr-and-route-data-loading.md',
    title: 'ADR 0002: SSR and Route Data Loading',
    topic: 'SSR/data loading',
  },
  {
    path: 'docs/adr/0003-auth-and-iam-boundaries.md',
    title: 'ADR 0003: Auth and IAM Boundaries',
    topic: 'auth/IAM',
  },
  {
    path: 'docs/adr/0004-billing-and-usage-ledger.md',
    title: 'ADR 0004: Billing and Usage Ledger',
    topic: 'billing',
  },
  {
    path: 'docs/adr/0005-postgres-migrations-and-identifiers.md',
    title: 'ADR 0005: Postgres, Migrations, and Identifiers',
    topic: 'DB/migrations',
  },
  {
    path: 'docs/adr/0006-event-consistency-and-derived-streams.md',
    title: 'ADR 0006: Event Consistency and Derived Streams',
    topic: 'event consistency',
  },
  {
    path: 'docs/adr/0007-admin-safety-and-operations-surface.md',
    title: 'ADR 0007: Admin Safety and Operations Surface',
    topic: 'admin safety',
  },
  {
    path: 'docs/adr/0008-observability-and-product-history.md',
    title: 'ADR 0008: Observability and Product History',
    topic: 'observability',
  },
];

const requiredAdrSections = [
  '## Status',
  '## Context',
  '## Decision',
  '## Rejected options',
  '## Consequences',
  '## Validation',
  '## Stop/rollback point',
];

const requiredGlossaryTerms = [
  'Tenant',
  'Project',
  'Workflow',
  'Workflow version',
  'Run',
  'Step',
  'Job',
  'Attempt',
  'Lease',
  'Processor',
  'Signal',
  'Event',
  'Schedule',
  'Replay',
  'Checkpoint',
  'DLQ',
  'Artifact',
  'Usage event',
  'Role',
  'Permission',
  'API key',
  'Agent token',
];

const requiredChecklistSnippets = [
  'Kafka/Redpanda is never authoritative for durable state',
  'Postgres is authoritative',
  'tenant and project scoped',
  'Idempotency keys are tenant/project scoped',
  'Leases are explicit',
  'Static DAG constraints are preserved',
  'Large payloads and artifacts stay out of Kafka/Redpanda',
  'Dangerous admin controls stay disabled',
  'Stop if',
  'side effects',
];

function read(path) {
  return readFileSync(path, 'utf8');
}

function requireFile(path) {
  if (!existsSync(path)) {
    failures.push(`missing required file: ${path}`);
    return false;
  }
  return true;
}

function requireIncludes(path, needle, label = needle) {
  if (!requireFile(path)) return;

  const content = read(path);
  if (!content.includes(needle)) {
    failures.push(`${path} missing ${label}`);
  }
}

function requireAllIncludes(path, needles) {
  if (!requireFile(path)) return;

  const content = read(path);
  for (const needle of needles) {
    if (!content.includes(needle)) {
      failures.push(`${path} missing ${needle}`);
    }
  }
}

requireFile('README.md');
requireFile('PRD.md');
requireFile('docs/adr/README.md');
requireFile('docs/glossary.md');
requireFile('docs/architecture-checklist.md');

requireIncludes('README.md', './docs/adr/README.md', 'ADR index link');
requireIncludes('README.md', './docs/glossary.md', 'glossary link');
requireIncludes('README.md', './docs/architecture-checklist.md', 'architecture checklist link');

for (const adr of requiredAdrs) {
  requireAllIncludes(adr.path, [adr.title, ...requiredAdrSections]);
  requireIncludes('docs/adr/README.md', adr.path.replace('docs/adr/', './'), `${adr.topic} ADR link`);
}

for (const term of requiredGlossaryTerms) {
  requireIncludes('docs/glossary.md', `## ${term}`, `${term} glossary heading`);
}

requireAllIncludes('docs/architecture-checklist.md', requiredChecklistSnippets);

if (failures.length > 0) {
  console.error('docs:check failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('docs:check passed');
