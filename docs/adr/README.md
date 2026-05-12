# Architecture Decision Records

Accepted Helix implementation decisions. ADRs narrow broad PRD choices into reviewable constraints for future implementation slices.

| ADR | Decision | PRD coverage |
| --- | --- | --- |
| [0001](./0001-web-and-runtime-topology.md) | Web and runtime topology | Hono on Node 22, control-plane app, separate broker/scheduler runtimes, ops-console extraction policy |
| [0002](./0002-ssr-and-route-data-loading.md) | SSR and route data loading | React streaming SSR, Vite entries, TanStack Router, TanStack Query, local-only Zustand |
| [0003](./0003-auth-and-iam-boundaries.md) | Auth and IAM boundaries | Stytch B2B, tenant/member mapping, permission IAM, API keys, agent tokens, browser security defaults |
| [0004](./0004-billing-and-usage-ledger.md) | Billing and usage ledger | Stripe, entitlements, durable usage events, webhook idempotency |
| [0005](./0005-postgres-migrations-and-identifiers.md) | Postgres, migrations, and identifiers | Kysely/Postgres, plain SQL migrations, `_schema_migrations`, UUIDv7, tenant/project scope |
| [0006](./0006-event-consistency-and-derived-streams.md) | Event consistency and derived streams | Postgres authority, transactional outbox, Redpanda/Kafka fanout, inbox/dedupe, event contracts |
| [0007](./0007-admin-safety-and-operations-surface.md) | Admin safety and operations surface | `/admin` topology, disabled dangerous controls, audit/permission gates |
| [0008](./0008-observability-and-product-history.md) | Observability and product history | OpenTelemetry, JSON logs, persisted product-visible events, audit/timeline/stream history |

## Decision coverage notes

- Execution semantics, replay, scheduling, retention, storage, and agent trust are constrained by ADR 0005 and ADR 0006 plus the [architecture checklist](../architecture-checklist.md). Detailed mutation APIs remain follow-up implementation issues.
- API/event contract drafting is tracked by downstream contract slices; ADR 0006 requires public contracts to distinguish authoritative state from emitted events.
- Real TypeScript/test/lint validation, Docker Compose, and the Hono/React scaffold are follow-up Phase 1 slices after this documentation foundation.
