# @helix/contracts

Framework-agnostic public contracts for Helix API, event, stream, and SDK boundaries.

This package exports Zod schemas only. It must not import Hono, app code, service internals, database clients, or transport-specific glue.

## Current baseline

Base contracts live under `src/base/` and are re-exported from `src/index.ts`:

- UUIDv7-shaped durable IDs: tenant, project, and event IDs.
- Tenant and tenant/project scope objects.
- Tenant/project auth context for user, API key, agent token, and service principals.
- Framework-neutral error envelopes.
- Versioned event envelopes with ID, type, timestamp, ordering key, partition key, tenant/project scope, and payload.
- Opaque stream cursors.
- Tenant/project-scoped idempotency keys.

## Versioning and compatibility

- Additive fields should be optional until all producers and consumers are migrated.
- Removing or renaming fields is a breaking contract change and needs an issue/ADR-backed migration path.
- Event `version` identifies the event contract revision, not Kafka ordering or retry count.
- Event `orderingKey` identifies the logical ordered domain stream; `partitionKey` identifies the event bus partition key. Helix relies on per-partition ordering only and provides no global ordering guarantee.
- Cursors are opaque client tokens. Do not document or depend on their internal encoding.
- Idempotency keys are always interpreted inside tenant/project scope.

## Schema artifacts

Generated artifacts are not produced yet because no public API routes exist in this package. When API/event schemas stabilize, add a generator that writes reviewable artifacts preserving event envelope version, scope, `orderingKey`, and `partitionKey` to:

- `packages/contracts/artifacts/json-schema/`
- `packages/contracts/artifacts/openapi/`

Until then, the Zod sources in `src/` are the reviewed contract source of truth. Hono route adapters and OpenAPI serving belong in `apps/control-plane`, not here.

## Validation

```sh
yarn workspace @helix/contracts build
yarn workspace @helix/contracts check
yarn workspace @helix/contracts test
yarn workspace @helix/contracts lint
```
