# ADR 0005: Postgres, Migrations, and Identifiers

## Status

Accepted.

## Context

Helix durable behavior depends on authoritative state for tenants, projects, workflows, jobs, attempts, leases, schedules, signals, checkpoints, retention, storage refs, and audit records. The PRD chooses Postgres, Kysely, `pg`, repo-owned plain SQL migrations, and UUIDv7 identifiers.

## Decision

- Postgres is the authoritative durable source of truth for state transitions and persisted domain state.
- Use Kysely with `pg` for typed database access.
- Use repo-owned plain SQL migrations tracked in Postgres with `_schema_migrations`.
- Migrations must be repeatable from a clean database and reviewed as source artifacts.
- Use UUIDv7 for primary durable resource identifiers.
- Scope every durable resource by tenant and by project where applicable.
- Store large payloads/artifacts outside Postgres core state rows and outside Kafka/Redpanda; store object refs, checksums, metadata, and retention fields in Postgres.

## Rejected options

- ORM auto-sync or hidden migrations, because schema changes must be reviewable and repeatable.
- Kafka/Redpanda as durable state authority.
- Process-memory state as recovery source.
- Unscoped global IDs as the only authorization boundary.
- Large blobs directly in Kafka or unbounded core state rows.

## Consequences

- Feature slices must start with schema/contracts before mutable behavior depends on them.
- Local/CI infrastructure must provide Postgres for service-backed checks.
- Data migrations are product-risk changes and need explicit rollback/stop points.
- Storage and artifact features must keep payload bytes out of core state and event streams.

## Validation

- Future migration tests apply migrations from an empty database.
- Schema reviews verify tenant/project scope and `_schema_migrations` behavior.
- Recovery tests prove workflows, leases, waits, and schedules resume from Postgres state after restart.

## Stop/rollback point

Stop if a design makes Kafka/Redpanda, process memory, logs, or object storage metadata more authoritative than Postgres for core state transitions.
