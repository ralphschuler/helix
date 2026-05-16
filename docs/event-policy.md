# Event Policy

Helix events are public contract artifacts for integrations, streams, observability, and product history. They describe durable state changes after those changes are committed to authoritative storage.

## Authority and delivery

- Postgres is authoritative for durable state transitions.
- Kafka/Redpanda is derived from transactional outbox rows; it is not a source of truth.
- Producers write durable state and an outbox row in the same Postgres transaction.
- Publishers may retry delivery, so consumers must dedupe by stable event id.
- Delivery is at least once. Helix does not promise exactly-once external side effects.

## Event envelope fields

Every public event contract must define or inherit:

- `id`: stable event id used for dedupe.
- `type`: stable event type, such as `workflow.run.started`.
- `version`: positive integer event contract revision.
- `occurredAt`: timestamp for when the authoritative change occurred.
- `scope`: tenant/project scope for product resources.
- `orderingKey`: logical key for ordered projections, such as a workflow run id or job id.
- `partitionKey`: event bus key. By default this should match `orderingKey` unless an ADR-backed fanout pattern requires a different key.
- `payload`: versioned event payload.

## Partition keys and ordering

Partitioning protects tenant/project isolation and gives clients precise ordering expectations:

- Tenant/project scope is mandatory for workflow, job, processor, schedule, replay, storage, audit, and stream events that belong to a project.
- `orderingKey` identifies the domain stream that must be replayed in order, for example one workflow run, one job, or one processor heartbeat stream.
- `partitionKey` is the Kafka/Redpanda key used by publishers. Use the same value as `orderingKey` for per-stream ordering unless a feature ADR defines otherwise.
- Helix can rely on per-partition ordering for events with the same `partitionKey` after they leave the outbox.
- Helix makes no global ordering guarantee across different partition keys, topics, tenants, projects, workflow runs, jobs, or processors.
- Projections that combine multiple streams must order by persisted event sequence/cursor rules, not by Kafka offset alone.

## Versioning and compatibility

Event `version` identifies the event contract revision, not Kafka retry count, offset, partition, or ordering position.

Compatibility rules:

- Additive payload fields should be optional until all producers and consumers are migrated.
- Consumers must ignore unknown additive fields.
- Removing, renaming, or changing meaning/type of an existing field is breaking and needs an issue/ADR-backed migration path.
- New event types should start at `version: 1`.
- Incompatible replay/redrive must reject old event versions rather than silently reinterpreting them.

## Generated artifacts

Generated artifacts are not produced yet. Until public API/event generators are added, Zod sources in `packages/contracts/src/` are the reviewed contract source of truth.

When schema generation is introduced, generated artifacts should be reviewable and written to:

- `packages/contracts/artifacts/json-schema/`
- `packages/contracts/artifacts/openapi/`

Generated artifacts must preserve envelope fields, version numbers, tenant/project scope, `orderingKey`, `partitionKey`, and compatibility notes.

## Stop/rollback point

Stop if an implementation:

- treats Kafka/Redpanda as authoritative durable state;
- depends on global ordering across unrelated partition keys;
- emits events without an outbox transaction paired with the authoritative state change;
- omits tenant/project scope for project resources;
- changes event version semantics without an ADR-backed migration path.
