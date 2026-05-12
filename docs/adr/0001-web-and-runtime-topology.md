# ADR 0001: Web and Runtime Topology

## Status

Accepted.

## Context

Helix needs one SaaS web/API deployable plus long-running execution roles. The PRD selects Hono on Node 22 for the first web/API app and keeps brokered execution, leases, schedulers, and event publishing outside the request/SSR process.

## Decision

- `apps/control-plane` is the first full-stack web/API deployable.
- `apps/control-plane` owns REST/JSON APIs, internal admin APIs, webhooks, health checks, and React server rendering.
- The admin UI lives under `/admin` in `apps/control-plane`.
- `services/broker`, `services/scheduler`, and a future outbox publisher run as separate Node processes.
- Runtime services share Postgres and shared contracts; they do not depend on web process memory.
- A standalone `apps/ops-console` is not an active v1 product surface. It may return only after an ADR-backed extraction from `apps/control-plane`.

## Rejected options

- Queue-only library posture, because Helix must be a durable SaaS execution platform.
- Running broker/scheduler loops inside the web server, because leases, schedule evaluation, and publishing need independent runtime lifecycles.
- Maintaining a separate active ops console for v1, because it duplicates navigation, IAM, billing, and audit surfaces before the admin model is stable.

## Consequences

- Web/API and runtime failures can be isolated and scaled separately.
- Public contracts must be shared without coupling services to app internals.
- Local and CI setup must eventually run multiple Node entry points.
- No active v1 workspace owns a standalone `apps/ops-console` surface; future extraction requires a new ADR.

## Validation

- Future scaffold checks prove `apps/control-plane` serves health and protected-ready `/admin` routes.
- Runtime tests prove broker and scheduler behavior without depending on web process memory.
- Workspace/docs review confirms no active v1 feature is added to `apps/ops-console` without a new ADR.

## Stop/rollback point

Stop before feature code if a design requires broker leases, schedule evaluation, or outbox publishing to depend on the Hono web process lifecycle.
