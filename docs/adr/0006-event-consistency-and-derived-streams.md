# ADR 0006: Event Consistency and Derived Streams

## Status

Accepted.

## Context

Helix needs high-throughput fanout, integrations, observability, and resumable streams while keeping durable state correct through outages and retries. The PRD selects Kafka/Redpanda as a derived event bus and requires transactional outbox plus inbox/dedupe records.

## Decision

- Postgres remains authoritative for durable state; Kafka/Redpanda is derived only.
- Every state change that emits an event writes the state change and outbox row in the same Postgres transaction.
- Publishers drain the transactional outbox to Kafka/Redpanda with safe retry.
- Consumers record inbox/dedupe rows keyed by stable event id before applying platform-side effects.
- Event contracts are versioned Zod schemas under `packages/contracts` and include tenant/project scope where applicable.
- Event ordering, partition keys, and generated artifact expectations follow the [event policy](../event-policy.md).
- Public API/state contracts must distinguish authoritative state from emitted events and projections.
- Delivery is at least once. Helix guarantees idempotent broker/control-plane state transitions, not exactly-once external side effects.
- Redpanda is the local/CI Kafka-compatible target; external schema registry is deferred until event-bus hardening.

## Rejected options

- Publishing to Kafka before committing authoritative state.
- Treating Kafka logs as the only source of truth for current workflow/job state.
- Promising exactly-once external side effects.
- Consumer code without event-id dedupe.
- Undocumented event payloads without versioned reviewable schemas.

## Consequences

- Outbox/inbox tables are required foundation before eventful runtime features.
- Stream APIs are projections over persisted events/state and must support cursors and retention.
- Replay/redrive APIs need explicit side-effect warnings and idempotency behavior.
- Kafka outages may delay fanout but must not corrupt Postgres state.

## Validation

- Future tests simulate Kafka unavailable during state transition and verify outbox drains later.
- Duplicate Kafka delivery tests verify one platform-side effect.
- Contract review verifies event schemas include ids, versions, timestamps, tenant/project scope, and ordering/partition notes where relevant.
- `yarn docs:check` verifies the event policy remains linked and states ordering, partitioning, versioning, artifact, and derived-stream constraints.

## Stop/rollback point

Stop if any implementation path requires Kafka/Redpanda to be authoritative for core state, emits events outside the committing transaction, or cannot dedupe duplicate event delivery.
