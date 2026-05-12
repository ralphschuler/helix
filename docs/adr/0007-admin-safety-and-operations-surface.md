# ADR 0007: Admin Safety and Operations Surface

## Status

Accepted.

## Context

The admin plane must help operators inspect and steer execution without exposing unsafe mutation controls before state machines, permissions, audit events, and replay policy are ready. The PRD places the v1 admin surface under `/admin` in `apps/control-plane`.

## Decision

- Build the v1 operations/admin surface under `/admin` in `apps/control-plane`.
- Render a full control map early: Overview, Tenants, Projects, Users/RBAC, Billing, Processors, Jobs, Workflows, Schedules, Replay/DLQ, Audit, and Settings.
- Keep dangerous controls disabled or placeholder-only until audited state machines and permissions exist.
- Dangerous controls include replay/redrive, DLQ mutation, processor steering, quota overrides, storage credential changes, role/permission mutation, and billing entitlement overrides.
- All enabled admin mutations must pass permission checks, tenant/project scoping, idempotency where relevant, and audit logging.
- Standalone ops console extraction requires a future ADR.

## Rejected options

- Shipping hidden or unaudited admin mutation endpoints for operator convenience.
- Enabling replay/DLQ/steering controls before side-effect and permission policy exists.
- Splitting an active `apps/ops-console` product surface before `/admin` has stable IAM, billing, and audit primitives.

## Consequences

- Early UI may show disabled controls and explanatory stop states.
- Admin work must prioritize explainability, auditability, and authorization over fast mutation coverage.
- Operator workflows require product-visible event, attempt, lease, timeline, DLQ, and audit history.

## Validation

- Future admin tests prove an operator can inspect failed workflows without enabling unsafe mutation paths.
- Permission tests verify every enabled admin mutation rejects unauthorized users and wrong-tenant access.
- Audit tests verify security-sensitive admin actions emit durable audit events.

## Stop/rollback point

Stop if an admin mutation can bypass permissions, tenant/project scope, idempotency, or audit logging, or if a UI control can trigger replay/steering before the underlying state machine is audited.
