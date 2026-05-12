# ADR 0008: Observability and Product History

## Status

Accepted.

## Context

Helix must support operators and users diagnosing distributed execution across processors, leases, events, streams, workflows, storage, schedules, and replay. The PRD chooses OpenTelemetry APIs and structured JSON logs while making product-visible history persisted domain data.

## Decision

- Use OpenTelemetry APIs for traces, metrics, and instrumentation seams from the first executable scaffold.
- Emit structured JSON logs from services and apps.
- Keep product-visible event, audit, processor, lease, attempt, timeline, and stream history as persisted domain data, not reconstructed from raw logs.
- SSE and realtime streams are projections over persisted events/state with resumable cursors and retention rules.
- Metrics must support runtime operations such as queue depth, claim latency, event publish lag, stream resume latency, heartbeat volume, quota behavior, and policy decisions.
- Logs may aid debugging but must not become the only product data source for audit, billing, replay, or timelines.

## Rejected options

- Raw logs as the source of truth for product timelines or audit history.
- In-memory-only stream state.
- Vendor-specific observability code in domain modules.
- Observability without tenant/project context where user data or resource access is involved.

## Consequences

- Runtime features must emit durable events/audit records alongside logs and traces.
- Stream retention and cursor semantics need explicit contracts before client reliance.
- Admin troubleshooting features should read persisted domain history rather than scraping logs.
- OpenTelemetry usage should stay behind stable instrumentation boundaries where practical.

## Validation

- Future stream tests cover live SSE delivery, cursor resume, filtered subscriptions, retention expiration, and authorization on resume.
- Audit/timeline tests verify product history survives restarts and does not depend on log ingestion.
- Metrics reviews verify fairness and runtime health signals are observable.

## Stop/rollback point

Stop if a feature can only be explained by raw logs, if stream replay relies on process memory, or if audit/timeline/billing history cannot be reconstructed from persisted domain state.
