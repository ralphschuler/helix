# @helix/control-plane

SaaS API, control-plane application, and v1 `/admin` UI shell.

## Implemented shell

- Hono app factory with `GET /health`.
- Server-protected `/admin` route rendered by React streaming SSR.
- Browser auth provider boundary with deterministic mock sessions and Stytch adapter seam.
- Strict browser origin defaults plus double-submit CSRF checks for browser-authenticated mutations.
- TanStack Router route for `/admin`.
- React Query route data prefetch plus dehydrated state for client hydration.
- Vite client and SSR entry points.
- Repo-owned SQL migration runner plus tenant/org/project/audit/retention base schema.
- Runtime transactional outbox writer seam for committing durable state changes and scoped outbox events together.
- Runtime outbox publisher service boundary for draining due events to Kafka/Redpanda-style producers with retry.
- Runtime consumer inbox helpers for event-id dedupe, retryable failed processing, and tenant/project-scoped consumption records.
- Runtime event store projection boundary for tenant/project-scoped event views, opaque cursors, and retention metadata without making projections authoritative state.
- Workflow event stream endpoint `GET /api/v1/workflows/:workflowId/stream` emits retained events as SSE and resumes from opaque cursors.
- Project API key-authenticated job API for creating/listing/statusing tenant/project-scoped jobs with idempotent creation and runtime outbox events.
- Retry/DLQ job behavior: exhausted failed attempts or expired leases transition jobs to `dead_lettered`, while attempt and lease history remains inspectable.
- Agent token-authenticated processor registration API for outbound processor capability updates with scoped audit events.
- Workflow checkpoint persistence model for tenant/project-scoped replay audit refs, immutable sequence ordering, and retention targeting metadata.

## Commands

```sh
yarn workspace @helix/control-plane dev
yarn workspace @helix/control-plane build
yarn workspace @helix/control-plane db:migrate
yarn workspace @helix/control-plane test
# focused runtime checks:
yarn workspace @helix/control-plane test -- jobs
yarn workspace @helix/control-plane test -- processors
yarn workspace @helix/control-plane test -- outbox
yarn workspace @helix/control-plane test -- inbox
yarn workspace @helix/control-plane test -- event-store
yarn workspace @helix/control-plane test -- workflow-stream
yarn workspace @helix/control-plane test -- workflow-checkpoints
yarn workspace @helix/control-plane check
yarn workspace @helix/control-plane lint
```

`dev` runs the Vite asset server. The Hono Node entry is `src/server/node.ts`; production bundling/wiring can mount the same `createApp()` factory.

## Job API

Machine clients authenticate with `Authorization: Bearer <project-api-key>`. Job creation requires `Idempotency-Key`; duplicate creates with the same key return the original job.

```sh
curl -X POST http://localhost:3000/api/v1/jobs \
  -H 'Authorization: Bearer hpx_<prefix>.<secret>' \
  -H 'Idempotency-Key: create-job:client-request-1' \
  -H 'Content-Type: application/json' \
  -d '{"metadata":{"source":"producer-sdk"}}'

curl http://localhost:3000/api/v1/jobs \
  -H 'Authorization: Bearer hpx_<prefix>.<secret>'

curl http://localhost:3000/api/v1/jobs/<job-id> \
  -H 'Authorization: Bearer hpx_<prefix>.<secret>'

curl http://localhost:3000/api/v1/jobs/<job-id>/history \
  -H 'Authorization: Bearer hpx_<prefix>.<secret>'
```

## Processor registration API

Outbound agents authenticate with `Authorization: Bearer <agent-token>`. Processor registration derives tenant, project, and agent identity from the authenticated token; request bodies cannot select another scope.

```sh
curl -X POST http://localhost:3000/api/v1/processors/register \
  -H 'Authorization: Bearer hat_<prefix>.<secret>' \
  -H 'Content-Type: application/json' \
  -d '{"capabilities":[{"name":"thumbnail","version":"1.2.0"}],"hardware":{"gpu":false,"memoryMb":1024},"region":"us-east-1","routingExplanation":{"eligible":true,"reasons":["registered"],"matchedCapabilities":["thumbnail"],"rejectedConstraints":[],"metadata":{}}}'

curl -X PATCH http://localhost:3000/api/v1/processors/<processor-id>/capabilities \
  -H 'Authorization: Bearer hat_<prefix>.<secret>' \
  -H 'Content-Type: application/json' \
  -d '{"capabilities":[{"name":"video-transcode","version":"2.0.0"}],"routingExplanation":{"eligible":true,"reasons":["updated"],"matchedCapabilities":["video-transcode"],"rejectedConstraints":[],"metadata":{}}}'

curl http://localhost:3000/api/v1/processors \
  -H 'Authorization: Bearer hat_<prefix>.<secret>'
```

## Runtime consumer idempotency

Consumers of Kafka/Redpanda-delivered runtime events must call the runtime inbox helpers before applying platform-side effects. The inbox is keyed by `(consumerName, eventId)`: a processed or in-flight duplicate delivery is skipped for that consumer, while a failed delivery is marked retryable and can be reclaimed on the next delivery. Every inbox row carries `tenantId` and `projectId`; complete/fail updates are scoped by those IDs and must not cross project boundaries.

For tests/local integration, the default mock browser session accepts `x-helix-mock-session: dev-session`. Real Stytch validation is isolated behind the auth provider seam, so CI does not need Stytch secrets or network calls.
