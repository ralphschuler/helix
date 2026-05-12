# @helix/contracts

Framework-agnostic public contracts for Helix API, event, stream, and SDK boundaries.

This package exports Zod schemas only. It must not import Hono, app code, service internals, database clients, or transport-specific glue.

## Current baseline

Base contracts live under `src/base/` and are re-exported from `src/index.ts`:

- UUIDv7-shaped durable IDs: tenant, project, and event IDs.
- Tenant and tenant/project scope objects.
- Tenant/project auth context for user, API key, agent token, and service principals.
- Framework-neutral error envelopes.
- Versioned event envelopes with ID, type, timestamp, tenant/project scope, and payload.
- Opaque stream cursors.
- Tenant/project-scoped idempotency keys.

## Versioning and compatibility

- Additive fields should be optional until all producers and consumers are migrated.
- Removing or renaming fields is a breaking contract change and needs an issue/ADR-backed migration path.
- Event `version` identifies the event contract revision, not Kafka ordering or retry count.
- Cursors are opaque client tokens. Do not document or depend on their internal encoding.
- Idempotency keys are always interpreted inside tenant/project scope.

## Schema artifacts

Generated artifacts are not produced yet because no public API routes exist in this package. When API/event schemas stabilize, add a generator that writes reviewable artifacts to:

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
