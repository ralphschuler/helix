## Problem Statement

Helix customers need a single, trustworthy B2B workspace where they can observe and manage the tenant/project resources they own without switching between APIs, logs, database tables, and future admin-only tools. From the customer's perspective, the root of the product should be the customer Control Plane: the main place to inspect jobs, workflows, processors, schedules, streams, API keys, billing posture, and project settings.

Helix platform operators and privileged administrators need a separate admin/operator interface for platform-wide oversight and elevated controls. That interface must remain behind `/admin`, must require admin permissions, and must not expose unsafe mutations before the underlying authorization, audit, idempotency, and state-machine guarantees exist.

The current codebase already has a protected `/admin` React SSR shell, browser-auth boundaries, CSRF protections for browser mutations, TanStack Router/Query route data loading, one real IAM custom-role editor, and many backend/API capabilities for jobs, workflows, processors, schedules, streams, billing, and audit-adjacent state. The missing product shape is a clear route split and control surface: `/` for authenticated customer B2B workspace, `/admin` for privileged admin/operator work, with shared deep modules that keep feature visibility, action gating, permissions, and blockers consistent.

## Solution

Add an authenticated customer Control Plane dashboard at `/` and keep the privileged admin/operator interface at `/admin`, both inside `apps/control-plane` and both built on the existing Hono + React streaming SSR + Vite + TanStack Router + TanStack Query stack.

The customer root (`/`) is the primary B2B product workspace. It is tenant/project scoped and shows customer-accessible features: jobs, workflows, processors, schedules, streams, API keys, billing, and project settings. Customer users see only resources and actions allowed by their tenant/project permissions.

The admin interface (`/admin`) remains a separate privileged surface. It is protected by `admin:read` and elevated permissions, and it exposes platform/operator features: tenants, projects, users/RBAC, audit, replay/DLQ, storage, quotas, health, global settings, billing posture, and other cross-cutting operational views.

A shared Control Plane registry describes all sections and actions with audience, permission requirements, risk level, backend readiness, enabled/disabled state, and blocker copy. This registry feeds both UI shells and browser read-model APIs. Unsafe or not-yet-backed actions are visible, but gated. They explain why they cannot be submitted yet. Enabled browser mutations must use CSRF protection, explicit permissions, tenant/project scoping, idempotency where relevant, and durable audit behavior where security-sensitive.

## User Stories

1. As a customer, I want `/` to open my authenticated tenant workspace, so that the product starts where I manage my work.
2. As a customer, I want to see my current tenant and project context, so that I know which resources I am operating on.
3. As a customer, I want a dashboard of jobs, workflows, processors, schedules, streams, API keys, billing, and settings, so that I can find every customer-facing capability from one place.
4. As a customer, I want only tenant/project-scoped resources to appear in my workspace, so that other customers' data cannot leak into my view.
5. As a customer, I want feature cards to show whether each capability is ready, disabled, not configured, or planned, so that I understand the state of the platform without reading issue trackers.
6. As a customer, I want disabled actions to explain the missing permission or backend blocker, so that I know whether to request access or wait for implementation.
7. As a customer, I want to inspect jobs and job history from the Control Plane, so that retries, leases, attempts, failures, and DLQ state are explainable without raw database access.
8. As a customer, I want to create or manage jobs only through supported safe controls, so that UI retries do not create duplicate work.
9. As a customer, I want to inspect workflows, workflow versions, runs, steps, checkpoints, and stream links, so that workflow execution is observable from the main workspace.
10. As a customer, I want workflow mutations to be gated by workflow permissions and idempotency requirements, so that start/publish/update actions remain safe.
11. As a customer, I want to inspect processor registration, capability coverage, health, region, labels, tags, and routing explanation, so that I can understand why jobs can or cannot route.
12. As a customer, I want processor steering controls to be visible but disabled until audited routing state machines exist, so that unsafe operator shortcuts are not exposed as product features.
13. As a customer, I want to inspect schedules and misfire policies, so that delayed, cron, and interval automation is visible.
14. As a customer, I want schedule mutations to require schedule permissions and CSRF protection, so that browser actions cannot be forged or overreach.
15. As a customer, I want stream observability for workflow and job events, including cursor and retention behavior, so that I can reason about live updates and reconnect semantics.
16. As a customer, I want raw payloads and logs hidden by default, so that sensitive data is not exposed casually in the browser UI.
17. As a customer tenant admin, I want to manage project API keys from the customer workspace when supported, so that SDK access can be administered without platform-operator help.
18. As a customer tenant admin, I want API key creation/revocation to use explicit permissions, masked secrets, audit events, and clear one-time secret handling, so that credential operations are safe.
19. As a customer tenant admin, I want billing status visible in the customer workspace, so that subscription and usage posture is discoverable.
20. As a customer tenant admin, I want billing mutations to remain disabled until Stripe-backed safe flows exist, so that entitlements cannot be changed incorrectly.
21. As a customer tenant admin, I want project settings and retention settings to be visible, so that cost, compliance, and replay windows are understandable.
22. As a customer tenant admin, I want retention changes gated by permissions and audit readiness, so that replay and compliance windows cannot be changed accidentally.
23. As an admin/operator, I want `/admin` to remain the privileged platform interface, so that platform-wide controls are separated from customer workspace actions.
24. As an admin/operator, I want `/admin` to require `admin:read`, so that ordinary customer users cannot inspect platform/operator surfaces.
25. As an admin/operator, I want to inspect tenants and projects from `/admin`, so that platform resource boundaries are visible.
26. As an admin/operator, I want to inspect Users/RBAC and custom roles from `/admin`, so that authorization is managed through the privileged interface.
27. As an admin/operator, I want existing custom role create/update/disable controls to continue working, so that current IAM functionality is preserved.
28. As an admin/operator, I want privilege escalation attempts rejected, so that role management cannot grant permissions the actor does not hold.
29. As an admin/operator, I want to inspect audit posture and future audit records from `/admin`, so that security-sensitive actions are reviewable.
30. As an admin/operator, I want replay/DLQ controls to be visible but disabled until replay compatibility, side-effect policy, idempotency, permissions, and audit are implemented, so that unsafe recovery workflows cannot be triggered prematurely.
31. As an admin/operator, I want quota and rate-limit controls visible but gated, so that future noisy-tenant management has a clear place in the product.
32. As an admin/operator, I want storage and BYO storage controls visible but gated, so that artifact/data residency work has a clear admin home without exposing credential mutation early.
33. As an admin/operator, I want platform health and runtime status surfaces under `/admin`, so that service health is separated from customer project state.
34. As an admin/operator, I want `/admin` to show blockers for planned features, so that operations staff can see roadmap gaps without mistaking placeholders for active controls.
35. As a platform maintainer, I want customer and admin surfaces to share a typed section/action registry, so that action availability cannot drift between UI and server APIs.
36. As a platform maintainer, I want customer and admin read models behind stable interfaces, so that UI components do not read private service state or database tables directly.
37. As a platform maintainer, I want enabled browser mutations to go through small server-side action handlers, so that permission, CSRF, idempotency, audit, and tenant/project scoping are centralized.
38. As a platform maintainer, I want public machine APIs under `/api/v1` to remain unchanged, so that SDK and processor integrations are not coupled to browser UI work.
39. As a platform maintainer, I want admin browser APIs to remain under `/admin/api/v1`, so that privileged browser routes stay isolated.
40. As a platform maintainer, I want customer browser APIs to use a distinct browser API prefix, so that customer workspace data loading is versioned and authorization-tested separately from machine APIs.
41. As a platform maintainer, I want SSR and hydration tests for both `/` and `/admin`, so that route splitting does not introduce client/server mismatch or unauthenticated data leaks.
42. As a platform maintainer, I want behavior-focused tests for action gating, so that disabled risky controls cannot submit requests by accident.
43. As a security reviewer, I want customer users without `admin:read` denied from `/admin`, so that route-level authorization is enforced.
44. As a security reviewer, I want all browser mutations to require CSRF tokens, so that authenticated sessions are protected from forged writes.
45. As a security reviewer, I want raw payloads and logs hidden by default in both surfaces, so that sensitive data exposure is opt-in and permissioned.
46. As a future agent, I want this PRD to preserve accepted ADR decisions, so that implementation does not create a separate ops console or bypass established SSR/IAM boundaries.

## Implementation Decisions

- Product route topology: `/` is the authenticated customer B2B tenant/project workspace. `/admin` is the privileged admin/operator interface. Both live in `apps/control-plane`; do not create a separate active `apps/ops-console`.
- Route compatibility: keep `/admin` working. Do not remove or route-break the existing admin shell. The existing protected `/admin` SSR route remains the foundation for privileged admin/operator work.
- Customer root is not a public marketing page and not an onboarding-only page for this PRD. It is an authenticated customer workspace using the same browser-auth foundation as the existing protected browser experience.
- Browser auth: continue to validate browser sessions server-side before protected SSR/API access. Stytch B2B remains the browser identity provider, with deterministic mock browser auth in tests.
- Authorization split: customer workspace access is based on tenant/project resource permissions. Admin/operator access requires `admin:read` plus feature-specific elevated permissions for each enabled action.
- Machine API stability: keep public machine APIs under `/api/v1` unchanged. SDKs, agent tokens, project API keys, processor registration/claim/heartbeat/complete/fail, and SSE streams remain independent from browser UI routing.
- Browser API split: keep admin browser APIs under `/admin/api/v1`. Add or reserve a separate versioned customer browser API namespace for the root workspace, such as `/app/api/v1` or another explicit browser-only prefix. Do not overload `/api/v1` browser routes with session auth.
- SSR architecture: use the accepted React streaming SSR, Vite client/SSR entries, TanStack Router route matching/loaders, and TanStack Query prefetch/dehydrate/rehydrate pattern for both root customer workspace and `/admin`.
- Durable state ownership: UI components and local client state must not become durable truth. Durable resource state continues to come from server APIs/contracts backed by authoritative services and Postgres-backed state.
- Shared Control Plane registry: build a deep module with a small stable interface that describes sections and actions for both surfaces. Each registry entry should include stable id, label, path, audience (`customer`, `admin`, or `both`), summary, feature domain, required permissions, backend readiness, risk level, raw-data policy, enabled state, and blocker reason.
- Registry consumers: the customer shell, admin shell, customer overview API, admin overview API, SSR route loaders, and tests should use the same registry data to avoid UI/server drift.
- Customer section map: customer-facing sections include Overview, Jobs, Workflows, Processors, Schedules, Streams, API Keys, Billing, Project Settings, and any customer-visible future capabilities with planned/gated state.
- Admin section map: admin/operator sections include Overview, Tenants, Projects, Users/RBAC, Billing, Processors, Jobs, Workflows, Schedules, Streams, Replay/DLQ, Audit, Settings, Storage, Quotas, and Health.
- Action gating: unsafe or not-yet-backed controls are visible but disabled. They must show blocker copy that distinguishes missing permission, backend not configured, planned feature, disabled by policy, and unsafe until audited.
- Dangerous controls: replay/redrive, DLQ mutation, processor steering, quota overrides, storage credential changes, role/permission mutation, billing entitlement overrides, and any cross-tenant/raw-data access require explicit permission checks, tenant/project scoping, idempotency where relevant, and audit logging before they can be enabled.
- Existing IAM editor: preserve the existing custom-role editor under `/admin/users-rbac`. It remains privileged admin functionality and should continue to enforce permission-only roles and privilege-escalation rejection.
- Customer resource read models: build small server-side read-model interfaces for customer-scoped jobs, workflows, processors, schedules, streams, API keys, billing, and project settings. Read models should hide service complexity and return display-safe DTOs, not raw database rows or unbounded payloads.
- Admin resource read models: build small server-side read-model interfaces for platform/operator views over tenants, projects, IAM, audit, replay/DLQ, storage, quotas, health, and global settings. Admin read models should default to metadata/status and avoid raw cross-tenant payloads.
- Mutation adapters: enabled browser actions should call narrow server-side action handlers rather than directly binding UI forms to internal service methods. Each action handler should centralize CSRF, permission, scope, idempotency, audit, validation, and error translation.
- Customer mutations: enable only project/tenant-scoped operations already supported safely by backend contracts, such as supported workflow, schedule, job, API key, or settings operations. Unsupported operations remain gated.
- Admin mutations: enable only privileged operations with complete safety backing. Existing custom-role create/update/disable is the prior-art admin mutation pattern.
- Idempotency: browser actions that create jobs, start workflows, fire schedules, request replay/redrive, revoke credentials, or perform other retry-sensitive writes must use idempotency semantics where the underlying contract requires or benefits from it.
- CSRF: all browser-authenticated mutations must use the existing CSRF protection pattern. GET/read APIs must remain side-effect free.
- Raw data policy: raw payloads and logs are hidden by default. Display summaries, metadata, state, timestamps, ids, and safe explanations first. Any future raw payload/log reveal must be permissioned, audited, and intentionally scoped.
- Streams: the UI should expose customer-scoped workflow/job stream observability and explain cursor resume and retention-expired behavior. Live consoles may remain gated unless browser-safe SSE clients and retention/error handling are implemented.
- Admin streams/health: admin should see platform stream health/status and operational blockers. Do not show raw cross-tenant event payloads by default.
- Documentation: update control-plane docs to describe `/` as customer workspace and `/admin` as admin/operator interface, including focused validation commands and safety posture.
- ADR alignment: preserve accepted ADR decisions: no separate active ops console, React SSR route data loading, Stytch B2B browser auth with Helix-owned authorization, deny-by-default browser security, and disabled dangerous admin controls until audited.
- Deep module opportunities:
  - Control Plane registry: centralizes sections/actions/capabilities/blockers.
  - Capability/action gating engine: computes enabled/disabled states from registry, permissions, backend readiness, and risk policy.
  - Customer overview read model: returns tenant/project-scoped dashboard data through a stable contract.
  - Admin overview read model: returns platform/operator dashboard data through a stable contract.
  - Browser action adapter: normalizes CSRF, authz, idempotency, audit, and error handling for enabled UI actions.
  - Safe display DTO mappers: convert internal records to redacted, display-safe browser payloads.
  - Route shell factory or shared SSR hydration utilities: prevent customer/admin SSR divergence while keeping authorization separate.

## Testing Decisions

- Prefer behavior-focused tests through routes, browser APIs, SSR output, hydration behavior, and permission outcomes. Avoid tests that assert private component structure or implementation details.
- Existing prior-art tests to follow include admin SSR coverage, admin hydration mismatch prevention, admin IAM API behavior tests, browser auth tests, job/workflow stream tests, and API permission tests.
- Route tests must prove `/` renders the authenticated customer workspace and `/admin` renders the admin/operator interface only for users with `admin:read`.
- Authorization tests must prove customer users without `admin:read` cannot access `/admin` HTML or `/admin/api/v1/*` APIs.
- SSR tests must prove both `/` and `/admin` include the expected route data, navigation/section map, safe disabled controls, and no raw payload/log leakage by default.
- Hydration tests must prove both shells hydrate without React mismatch warnings and preserve server-loaded route data.
- Registry tests must prove each section/action has a stable id, audience, permissions, risk label, enabled state or blocker reason, and valid path ownership.
- Action-gating tests must prove unsafe actions are disabled until all required permissions and backend readiness conditions are met.
- Browser API contract tests must prove customer overview APIs return tenant/project-scoped data and admin overview APIs return privileged/admin-scoped data.
- CSRF tests must cover every enabled browser mutation and reject missing or invalid CSRF tokens.
- Permission tests must cover every enabled browser mutation and reject missing permissions, cross-tenant access, and cross-project access.
- Mutation tests must cover idempotency behavior where applicable, especially job creation, workflow starts, schedule actions, replay/redrive requests, and credential operations.
- Raw-data safety tests must prove raw payloads/logs are hidden by default from customer and admin surfaces.
- Stream UI/API tests should build on existing stream behavior tests: workflow stream, job stream, filtered resume, reconnect with cursor, authorization on resume, and retention-expired cursors.
- Existing IAM editor tests must continue passing and should be extended only through public admin API behavior, not private service internals.
- Validation commands for implementation slices should start targeted and then run broad validation:
  - `yarn workspace @helix/control-plane test -- admin-ssr`
  - `yarn workspace @helix/control-plane test -- admin-hydration`
  - `yarn workspace @helix/control-plane test -- auth`
  - `yarn workspace @helix/control-plane test -- admin-iam-api`
  - `yarn workspace @helix/control-plane test -- streams`
  - `yarn validate`

## Feature Phases

### Phase 1: Route topology split

Build the authenticated customer root at `/` while preserving `/admin` as admin-only.

Acceptance criteria:
- `/` renders a customer workspace shell for an authenticated browser user.
- `/admin` continues to render the admin/operator shell.
- A browser user without `admin:read` is denied access to `/admin` and `/admin/api/v1/*`.
- Existing `/admin` section routes continue to work.
- Public machine APIs under `/api/v1` remain unchanged.

Validation:
- `yarn workspace @helix/control-plane test -- admin-ssr auth`
- `yarn workspace @helix/control-plane test -- admin-hydration`

Rollback/stop point:
- Revert the root route addition if protected root SSR leaks unauthenticated data, if `/admin` compatibility breaks, or if customer users can access admin surfaces without `admin:read`.

### Phase 2: Shared Control Plane registry

Define the shared section/action registry with audience split and safety metadata.

Acceptance criteria:
- Registry includes customer sections: Overview, Jobs, Workflows, Processors, Schedules, Streams, API Keys, Billing, Project Settings.
- Registry includes admin sections: Overview, Tenants, Projects, Users/RBAC, Billing, Processors, Jobs, Workflows, Schedules, Streams, Replay/DLQ, Audit, Settings, Storage, Quotas, Health.
- Every action includes required permissions, risk classification, backend readiness, enabled state or blocker reason, and audience.
- UI and server read-model APIs consume the same registry data.

Validation:
- Registry unit tests for schema/coverage/invariants.
- `yarn workspace @helix/control-plane test -- admin-ssr`

Rollback/stop point:
- Restore the static section list if registry integration causes route or hydration instability.

### Phase 3: Customer dashboard at `/`

Create the main B2B tenant/project dashboard.

Acceptance criteria:
- Root page title and copy identify the customer Control Plane/workspace.
- Current tenant/project context is visible.
- Customer feature cards link to all customer-facing sections.
- Platform-wide admin controls are not visible from `/`.
- Planned/unimplemented customer features show clear blockers rather than blank pages.

Validation:
- SSR test for `/`.
- Hydration test for `/`.
- Authorization test for customer-only visibility.

Rollback/stop point:
- Fall back to a minimal authenticated customer placeholder if full dashboard data loading is not ready.

### Phase 4: Admin/operator interface at `/admin`

Refine the existing admin shell into the privileged admin/operator Control Pane while preserving current behavior.

Acceptance criteria:
- `/admin` is visibly labeled as the admin/operator interface.
- Existing custom-role editor remains available under Users/RBAC.
- Platform/operator sections remain behind `admin:read`.
- Dangerous admin controls are visible but gated with blocker reasons.

Validation:
- `yarn workspace @helix/control-plane test -- admin-ssr`
- `yarn workspace @helix/control-plane test -- admin-iam-api`

Rollback/stop point:
- Keep the existing admin shell if new admin layout work risks breaking IAM controls.

### Phase 5: Customer and admin browser read APIs

Add separate browser read models for customer and admin dashboards.

Acceptance criteria:
- Customer overview API returns tenant/project-scoped sections, actions, statuses, and safe summary counts.
- Admin overview API returns privileged platform/operator sections, actions, statuses, and blockers.
- Customer browser APIs do not require `admin:read` unless an action or view is explicitly admin-only.
- Admin browser APIs require `admin:read`.
- No raw payloads or logs are returned by default.

Validation:
- Customer overview API authz tests.
- Admin overview API authz tests.
- Raw-data redaction tests.

Rollback/stop point:
- UI may temporarily use static registry data if read-model APIs are incomplete; do not ship APIs that leak cross-tenant data.

### Phase 6: Observable feature sections

Make all current and future product areas visible in the correct audience.

Acceptance criteria:
- Customer sections expose backed resource visibility for jobs, workflows, processors, schedules, streams, API keys, billing, and settings where services exist.
- Admin sections expose platform/operator visibility for tenants, projects, users/RBAC, audit, replay/DLQ, quotas, storage, health, and global settings where services exist.
- Future or unimplemented features render planned/gated cards with blockers.
- Tenant/project isolation is enforced in every data path.

Validation:
- Section-level SSR tests.
- Customer/admin API permission tests.
- `yarn validate`

Rollback/stop point:
- Revert or disable individual sections independently through registry flags.

### Phase 7: Safe controls and forms

Enable only browser mutations that are backed by safe server behavior.

Acceptance criteria:
- Customer users can perform allowed tenant/project-scoped actions only when they hold the required permissions.
- Admin users can perform elevated actions only when they hold `admin:read` and action-specific permissions.
- All enabled browser mutations use CSRF protection.
- Idempotency is used where required by the underlying operation.
- Security-sensitive mutations emit or integrate with durable audit behavior before being enabled.
- Unsupported replay/DLQ/steering/quota/storage/billing mutations remain disabled.

Validation:
- Mutation API behavior tests.
- CSRF rejection tests.
- Permission and cross-scope rejection tests.
- Idempotency tests for retry-sensitive writes.

Rollback/stop point:
- Disable the affected action in the registry if safety requirements are incomplete.

### Phase 8: Live and stream observability

Expose stream status and safe live-observability affordances for both audiences.

Acceptance criteria:
- Customer UI explains workflow/job stream endpoints, filters, cursor resume, reconnect, and retention-expired behavior for tenant/project-scoped streams.
- Admin UI shows stream health/status without exposing raw cross-tenant payloads by default.
- Any live console implementation handles authorization, reconnect, cursor retention expiry, and redaction.
- If browser-safe live SSE is not implemented, live controls remain gated with blockers.

Validation:
- `yarn workspace @helix/control-plane test -- streams`
- UI tests for stream status/blocked controls.
- Authorization tests for stream-related browser APIs.

Rollback/stop point:
- Hide or disable live console controls while retaining static stream documentation/status.

### Phase 9: Documentation and validation hardening

Document the route split, safety posture, and focused validation commands.

Acceptance criteria:
- Control-plane docs describe `/` as the authenticated customer workspace.
- Control-plane docs describe `/admin` as the admin/operator interface.
- Docs state that unsafe/unbacked actions are visible but gated.
- Focused test commands are listed.
- Full validation passes.

Validation:
- `yarn validate`

Rollback/stop point:
- Docs-only changes are reversible independently.

## Out of Scope

- A public marketing site at `/`.
- An onboarding-only root route as the primary product experience.
- Removing or breaking `/admin`.
- Creating a separate active `apps/ops-console` application.
- Enabling replay/redrive, DLQ mutation, processor steering, quota overrides, storage credential changes, billing entitlement overrides, or other dangerous mutations before safety requirements are met.
- Replacing existing public machine APIs under `/api/v1` with browser-session APIs.
- Requiring browser auth for SDKs or processor agents.
- Storing raw blobs, large payloads, or logs in UI state or core event rows.
- Showing raw cross-tenant payloads/logs by default in admin views.
- Production-grade design polish beyond a usable, tested control surface.
- Cloud infrastructure, enterprise dedicated-stack provisioning, or a new deployment topology.

## Further Notes

- Existing accepted ADRs already support this direction: `/admin` remains the admin/operator surface, React SSR/TanStack Router/Query remain the route-data architecture, browser auth uses Stytch B2B with Helix-owned authorization, and dangerous controls stay disabled until audited.
- The user explicitly wants the customer B2B page at the root and the admin interface behind `/admin`.
- The implementation should avoid a big uncontrolled UI rewrite. Even though this PRD describes the full product shape, each phase should remain independently testable and reversible.
- The likely first implementation issue should focus on the route topology split, shared registry foundation, and minimal customer root shell before enabling more controls.
- Future issue creation should preserve dependencies: route split before customer sections; registry before broad action gating; read APIs before data-rich dashboards; audit/idempotency before dangerous mutations.
- Major risks are route/auth confusion, leaking admin data into customer root, enabling unsafe actions too early, duplicating section/action definitions across UI and server, and allowing browser APIs to bypass service-level permissions.
- Stop implementation immediately if a customer user can access `/admin`, if SSR leaks unauthenticated data, if raw payloads/logs are exposed by default, or if any dangerous action can be submitted without complete permission, CSRF, idempotency, scope, and audit guarantees.
