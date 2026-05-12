# ADR 0004: Billing and Usage Ledger

## Status

Accepted.

## Context

Helix needs hybrid SaaS billing without coupling runtime correctness to live billing-provider calls. The PRD selects Stripe, lazy customer creation, subscription entitlements, and durable usage ledger records.

## Decision

- Use Stripe as the billing provider for customers, subscriptions, invoices, and metered billing integration.
- Map each Helix org/tenant to a Stripe customer when billing setup begins.
- Model subscription entitlements in Helix as a projection of Stripe state plus product-owned defaults.
- Record durable usage events in Postgres before any metered billing export.
- Treat Stripe webhooks as signed, raw-body, idempotent inputs that update Helix billing projections.
- Audit security-sensitive billing events and entitlement changes.
- Keep runtime quota decisions explainable from Helix state rather than live Stripe requests.

## Rejected options

- Live Stripe API reads as the authoritative source for every quota/runtime decision.
- Metered usage only in Stripe without a Helix usage ledger.
- Unsigned or non-idempotent webhook handling.
- Billing events without tenant/org scope.

## Consequences

- Billing code needs an adapter boundary and fixture-driven tests.
- Usage ledgers must be tenant/org scoped and idempotent.
- Runtime quota enforcement can be built later from durable entitlement and usage state.
- CI must not require live Stripe credentials or network calls.

## Validation

- Future tests use local webhook signature fixtures and mocked Stripe clients.
- Billing projection tests prove duplicate webhooks are safe.
- Usage ledger tests prove usage records are scoped and cannot double-count retried events.

## Stop/rollback point

Stop before enabling paid quotas or metered billing if webhook signature verification, idempotency, tenant scope, or usage-ledger durability is missing.
