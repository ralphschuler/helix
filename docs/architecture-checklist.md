# Architecture Checklist

Use this checklist before merging implementation slices that affect durable execution, contracts, tenancy, events, admin operations, storage, replay, or runtime policy.

## Durable truth and derived streams

- [ ] Postgres is authoritative for durable state transitions, workflow/job/run/attempt/lease state, schedules, signals, checkpoints, retention, storage refs, usage, and audit records.
- [ ] Kafka/Redpanda is never authoritative for durable state; it is a derived event bus for fanout, integrations, observability, and stream delivery.
- [ ] State changes that emit events write state and outbox rows in the same Postgres transaction.
- [ ] Consumers dedupe by stable event id before applying platform-side effects.
- [ ] Public API/state contracts distinguish authoritative state from emitted events and projections.

## Tenancy and authorization

- [ ] Durable resources are tenant and project scoped wherever product behavior can cross environments, applications, workers, billing, storage, schedules, or streams.
- [ ] Browser users, API keys, agent tokens, and internal service paths cannot cross tenant/project boundaries without explicit authorized policy.
- [ ] Permission checks use explicit permissions rather than hard-coded role names.
- [ ] Stytch browser sessions, project API keys, and agent tokens remain separate authentication paths.

## Idempotency, leases, and recovery

- [ ] Idempotency keys are tenant/project scoped for API writes, workflow starts, job creation, completion, signal delivery, replay requests, and event consumption.
- [ ] Leases are explicit: claims are atomic, heartbeats extend lease windows, and expired leases requeue safely without losing attempt history.
- [ ] Duplicate completion, stale completion, duplicate signal, duplicate schedule fire, and duplicate event delivery are safe.
- [ ] Runtime recovery uses persisted Postgres state, not process memory.

## Workflow and replay safety

- [ ] Static DAG constraints are preserved: workflow nodes/dependencies are known before a run starts; arbitrary runtime graph mutation is out of scope for v1.
- [ ] Workflow versions are immutable after publication.
- [ ] Replay/redrive behavior checks version compatibility, records audit history, and warns about side effects before enabling mutation APIs.
- [ ] Checkpoints are scoped and immutable enough for replay audit.

## Storage and payloads

- [ ] Large payloads and artifacts stay out of Kafka/Redpanda and out of unbounded core state rows.
- [ ] Postgres stores artifact refs, checksums, metadata, ownership scope, and retention fields.
- [ ] Signed URLs and BYO storage credentials must be permission-gated and audit-sensitive.

## Admin and operations safety

- [ ] Dangerous admin controls stay disabled until audited state machines, permissions, idempotency, and audit events exist.
- [ ] Replay/DLQ mutation, processor steering, quota overrides, role mutation, storage credential mutation, and billing entitlement overrides require explicit audit coverage.
- [ ] The `/admin` surface reads persisted product history rather than reconstructing truth from logs.

## Observability and retention

- [ ] Product-visible event, audit, processor, lease, attempt, timeline, and stream history are persisted domain data.
- [ ] Logs and traces help debug but are not the only product source for timelines, billing, audit, or replay.
- [ ] Streams are resumable projections over persisted state/events with cursors and retention semantics.
- [ ] Retention policy is explicit for events, checkpoints, logs, artifacts, audit records, and stream replay.

## Stop conditions

Stop if any implementation path:

- makes Kafka/Redpanda, logs, object metadata, or process memory more authoritative than Postgres for core state;
- weakens tenant/project scope or permission checks;
- cannot make retries, duplicate delivery, or stale completions idempotent;
- stores large artifacts directly in Kafka/Redpanda or unbounded core state rows;
- enables replay/redrive without version compatibility, audit, idempotency, and side effects policy;
- enables dangerous admin mutations before audited state machines and permission gates exist;
- requires real Stytch, Stripe, production infrastructure, or secrets in CI;
- contradicts an accepted ADR without a new ADR replacing it.
