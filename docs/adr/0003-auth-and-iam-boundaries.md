# ADR 0003: Auth and IAM Boundaries

## Status

Accepted.

## Context

Helix is SaaS-first and must separate browser identity, project-scoped machine access, agent access, platform administration, and permission checks. The PRD selects Stytch B2B for browser auth while Helix owns projects, permissions, API tokens, agent identities, and resource authorization.

## Decision

- Use Stytch B2B as the browser user authentication provider.
- Map Stytch Organizations to Helix tenant/org records and Stytch Members to Helix user memberships.
- Validate browser sessions server-side before protected SSR/API access.
- Store Helix projects, permissions, API tokens, agent identities, and resource authorization in Helix-controlled Postgres state.
- Use permission-only custom roles for long-term IAM; avoid hard-coded product role names in authorization checks.
- Use hashed project API keys for producer/workflow SDK access.
- Use project-scoped agent registration credentials exchanged for short-lived agent tokens.
- Keep SDK/agent machine auth independent from browser sessions.
- Use deny-by-default CORS, CSRF protection for browser-authenticated mutations, secure cookie defaults where cookies are used, bearer/token auth for machine APIs, and a raw-body Stripe webhook route.

## Rejected options

- Treating Stytch as the authorization source of truth for Helix resources.
- Reusing browser sessions for SDKs or processor agents.
- Hard-coding owner/admin role names as the long-term permission model.
- Allowing cross-tenant or cross-project access by default for internal admin convenience.

## Consequences

- Every durable resource needs tenant scope and project scope where applicable.
- Permission checks must be explicit at public API, admin API, stream, storage, replay, schedule, and agent paths.
- CI must use deterministic Stytch/auth mocks and never require real Stytch secrets.
- Agent token expiry and revocation become runtime security requirements before claims ship.

## Validation

- Future auth tests cover Stytch mock sessions, tenant/project isolation, API key scope, agent token expiry/revocation, and permission-only authorization.
- Manual schema review verifies all durable resources carry tenant/project scope where required.
- Security review verifies browser and machine auth paths are separate.

## Stop/rollback point

Stop before SaaS execution features if browser users, API keys, or agents can access another tenant/project, if revocation cannot prevent new claims, or if browser auth becomes required for SDK/agent APIs.
