## Problem Statement

Teams need more than a background queue when they run critical work across external processors, GPU fleets, private infrastructure, and long-running workflows. They need jobs to survive crashes, route to capable processors, expose live progress, support waits and approvals, replay failures, and remain observable without forcing operators to reconstruct state from logs.

From the user's perspective, the platform should make distributed execution feel reliable and ergonomic: submit work, orchestrate workflows, connect processors, observe progress, recover from failure, and replay or redrive safely. It must keep the existing broker/processor/lease architecture as the foundation while adding higher-level Trigger.dev-style workflow, scheduling, replay, SDK, realtime, and operations capabilities.

## Solution

Build a SaaS-first durable distributed execution platform: a brokered execution fabric with declarative static DAG workflows, explicit leases, capability-based outbound processors, persistent state, replayable events, scheduling, signals, typed SDKs, and operator tooling.

The platform should layer workflow orchestration and developer ergonomics over an authoritative broker/lease core. Postgres is the durable source of truth for tenants, projects, workflows, jobs, attempts, leases, schedules, signals, checkpoints, retention policies, and audit state. Kafka is the high-throughput asynchronous event bus for fanout, integrations, observability, and stream delivery, but never the source of truth. External processors connect outbound to the SaaS control plane, authenticate with scoped short-lived credentials, advertise capabilities, claim eligible work, renew leases, emit progress, and complete attempts idempotently.

The result is not a queue-only product. It is a distributed execution fabric and workflow runtime with explicit SaaS tenancy, resumable realtime streams, replay/redrive semantics, static workflow graph validation, tenant-configurable retention, and first-class TypeScript SDKs.

## User Stories

1. As an application developer, I want to create a job through a stable API, so that work can be executed outside my request path.
2. As an application developer, I want to start a workflow from a published version, so that multi-step work executes consistently over time.
3. As a workflow author, I want to define a static DAG with dependencies, so that execution order is validated before runtime.
4. As a workflow author, I want invalid graphs with cycles or missing dependencies to be rejected, so that workflows do not fail unpredictably after launch.
5. As a workflow author, I want immutable published workflow versions, so that old runs remain explainable and replayable.
6. As a workflow author, I want steps for jobs, waits, signals, timers, approvals, and pauses, so that real business workflows can model asynchronous external events.
7. As a workflow author, I want fan-out and fan-in represented in the static graph, so that parallel work and joins are durable and visible.
8. As a producer, I want idempotency keys on create/start APIs, so that retries from my application do not create duplicate work.
9. As a producer, I want to wait for a job or workflow result, so that synchronous product flows can bridge to durable execution when appropriate.
10. As a producer, I want to stream progress and events, so that users can see live state without polling.
11. As a producer, I want resumable streams with cursors, so that clients recover missed events after disconnects.
12. As a processor owner, I want to register outbound processor agents, so that my private workers can execute SaaS-orchestrated work without inbound firewall exposure.
13. As a processor owner, I want processors to advertise capabilities, versions, hardware, memory, GPU availability, region, and labels, so that jobs route only to compatible workers.
14. As a processor owner, I want agents to use project-scoped short-lived tokens, so that leaked credentials have limited blast radius.
15. As an enterprise processor owner, I want optional mTLS, so that high-trust deployments can bind agents to stronger identities.
16. As a processor developer, I want to renew leases from the SDK, so that long-running jobs are not requeued while still healthy.
17. As a processor developer, I want to report progress and structured logs, so that producers and operators can monitor execution.
18. As a processor developer, I want duplicate completion calls to be safe, so that network retries do not corrupt final state.
19. As an operator, I want expired leases to requeue safely, so that crashed processors do not leave work stuck forever.
20. As an operator, I want attempt history, so that each retry, lease, failure, and completion remains auditable.
21. As an operator, I want a dead-letter queue, so that permanently failed work is isolated for inspection and replay.
22. As an operator, I want replay controls for failed jobs, failed workflow steps, checkpoints, and full workflows, so that recovery is a product feature instead of manual surgery.
23. As an operator, I want replay to respect idempotency and prior side effects, so that redrive does not silently duplicate completed work.
24. As an operator, I want execution timelines, so that I can diagnose a workflow without querying raw tables or logs.
25. As an operator, I want a workflow graph UI, so that I can see which steps are pending, running, waiting, failed, or complete.
26. As an operator, I want processor monitoring, so that worker health, capability coverage, region distribution, and lease activity are visible.
27. As an operator, I want lease history, retry history, and event history, so that distributed execution failures are explainable.
28. As an operator, I want tenant-configurable retention policies, so that cost, compliance, replay windows, and audit needs can be balanced.
29. As a tenant admin, I want org/project boundaries, so that teams and environments are isolated.
30. As a tenant admin, I want role-based access controls, so that users, tokens, and agents only access authorized resources.
31. As a tenant admin, I want audit logs for user, token, agent, job, workflow, replay, and storage access, so that security-sensitive actions are reviewable.
32. As a SaaS operator, I want every durable resource scoped by tenant and project, so that shared infrastructure does not leak data across tenants.
33. As a SaaS operator, I want logical isolation by default and dedicated enterprise isolation tiers later, so that the platform can launch efficiently while supporting stricter customers.
34. As a SaaS operator, I want tenant quotas, rate limits, concurrency groups, and priority policies, so that noisy tenants and expensive workloads cannot starve others.
35. As a SaaS operator, I want Kafka consumers to dedupe events, so that duplicate delivery does not duplicate platform-side effects.
36. As a SaaS operator, I want Kafka outages to leave Postgres state correct, so that the system degrades without corrupting durable truth.
37. As an integration developer, I want internal event hooks and subscriptions, so that platform events can trigger notifications, analytics, and follow-up workflows.
38. As an application developer, I want schedules for delayed, cron, and recurring jobs or workflows, so that time-based automation is native.
39. As a workflow author, I want durable timers, so that waits survive restarts and resume at the correct time.
40. As a workflow author, I want external signals, so that webhooks, payments, uploads, approvals, and moderation events can resume waiting workflows.
41. As a reviewer or approver, I want approval wait states, so that human decisions can pause and continue workflows safely.
42. As a storage user, I want large payloads and artifacts stored outside Postgres and Kafka, so that media and logs do not degrade control-plane performance.
43. As a storage user, I want signed URLs with expiration, so that artifacts can be accessed safely by authorized clients and processors.
44. As an enterprise tenant, I want BYO object storage, so that data residency, ownership, and compliance needs can be met.
45. As an SDK user, I want TypeScript producer, processor, and workflow SDKs, so that common platform operations are typed and ergonomic.
46. As an SDK user, I want the SDK to expose failure, retry, lease, and idempotency semantics clearly, so that convenience does not hide distributed-system behavior.
47. As an SDK user, I want local workflow validation before publishing, so that authoring errors are caught early.
48. As a platform maintainer, I want small stable module interfaces with deep internal implementations, so that broker policy, workflow state, streaming, storage, and agent protocols can evolve independently.
49. As a platform maintainer, I want behavior-focused tests around public contracts, so that refactors do not break distributed semantics.
50. As a platform maintainer, I want architecture decisions captured before implementation, so that future agents do not accidentally replace the broker/lease foundation with a queue-only design.

## Implementation Decisions

- Product posture: SaaS-first durable execution platform, not a queue-only library and not a WebSocket dispatcher.
- Core differentiator: keep brokered execution, explicit leases, external processors, capability routing, resumable SSE streams, and replayable event history as foundational concepts.
- Workflow model: declarative static DAG core. All workflow nodes and dependencies are known before a run starts. Runtime-created arbitrary graph nodes are out of scope for v1.
- Workflow step types: job, wait for signal, wait for approval, durable timer/sleep, pause, and completion/join semantics.
- Durable state source: Postgres is authoritative for state transitions, schedules, definitions, versions, checkpoints, attempts, leases, signals, idempotency, retention policies, storage refs, and audit records.
- Event bus: Kafka is used for high-throughput async fanout, observability, subscriptions, integration events, and stream delivery. Kafka is not authoritative state.
- Consistency pattern: all durable state changes that emit events must write a transactional outbox row in the same Postgres transaction. Kafka publishers drain the outbox. Consumers use inbox/dedupe records keyed by event id.
- Delivery guarantee: at-least-once execution with first-class idempotency. The platform guarantees idempotent broker state transitions, not exactly-once external side effects.
- Idempotency scope: idempotency keys must be tenant/project scoped and applicable to API writes, run starts, job creation, task completion, signal delivery, replay requests, and event consumption.
- Tenant model: every resource must be tenant-scoped and, where applicable, project-scoped. Default tier uses logical isolation in shared infrastructure. Enterprise tiers may provide dedicated Kafka topics, worker pools, schemas/databases, object storage, regions, or full stacks.
- Agent trust model: outbound processor agents authenticate with project-scoped registration credentials, exchange them for short-lived tokens, and receive capability-scoped authorization. Revocation must be immediate enough to prevent further claims. Enterprise deployments may require mTLS.
- Processor connectivity: processors connect outbound to the control plane. A realtime control channel may improve latency, but durable HTTP/API claim, heartbeat, complete, fail, and progress operations remain authoritative.
- Processor routing: jobs declare constraints such as capability, version, GPU requirement, memory, region, storage locality, labels, tags, and affinity. Broker routing matches eligible processors only.
- Lease runtime: jobs execute through attempts and leases. Claims are atomic. Heartbeats extend leases. Expired leases requeue eligible attempts. Attempt history is immutable enough for audit and replay.
- Workflow runtime module: responsible for workflow definitions, versions, runs, step state, dependency tracking, graph validation, step activation, joins, state recovery, and checkpoint coordination.
- Broker module: responsible for job readiness, atomic claims, leases, retries, attempt lifecycle, DLQ, priority, concurrency groups, rate limits, and routing policies.
- Scheduler module: responsible for delayed jobs, cron schedules, recurring starts, durable timers, wake-ups, misfire handling, and idempotent enqueueing.
- Signal manager module: responsible for external signals, approval continuations, signal idempotency, waiting workflow lookup, and safe resume.
- Replay/redrive module: responsible for replaying jobs, workflow runs, failed steps, and checkpoints while preserving version compatibility and side-effect warnings.
- Event store/streaming module: responsible for persisted event cursors, SSE streams, workflow streams, job streams, multiplexed subscriptions, filters, replay windows, and retention enforcement.
- Storage module: responsible for object refs, platform object storage, future BYO providers, checksums, signed URL creation, credential references, retention, and artifact metadata. Large blobs must not be stored in Kafka and should not be stored directly in core state tables.
- SDK modules: TypeScript-first producer SDK, processor SDK, and workflow SDK. SDKs should wrap public platform contracts rather than depend on private internals.
- Producer SDK responsibilities: create jobs, start workflows, wait for completion, stream events, provide idempotency options, and expose typed metadata/tags/labels.
- Processor SDK responsibilities: register handlers, claim/receive jobs, report progress, renew leases, complete/fail attempts, access scoped artifacts, and provide idempotency helpers.
- Workflow SDK responsibilities: define static DAGs, validate dependencies locally, declare waits/signals/timers/approvals, publish versions, and start runs.
- Control plane module: responsible for tenants, orgs, projects, auth, RBAC, agent identities, API tokens, quotas, billing-ready usage records, retention policies, and audit events.
- Operations plane module: responsible for dashboard views, workflow graph visualization, live event console, processor health, DLQ management, retry/replay controls, timeline, metrics, and audit exploration.
- Observability: OpenTelemetry-style traces, metrics, structured events, processor history, lease history, step durations, retry timeline, queue depth, claim latency, and stream replay should be first-class platform outputs.
- Retention: tenants configure retention policies for events, checkpoints, logs, artifacts, audit records, and stream replay where safe. Defaults must protect cost and product usability.
- Scheduling semantics: delayed, cron, interval, recurring job, and recurring workflow schedules must be idempotent. Misfire behavior must be explicit.
- Priority model: formal levels such as critical, high, normal, low, and background. Broker policy should support weighted queues, quotas, and starvation prevention.
- Concurrency model: jobs may specify concurrency group keys with limits, such as per-user render limits, per-project deployment limits, or global GPU limits.
- Rate limit model: jobs/workflows may reference tenant, project, processor, external API, or capability buckets with fixed or sliding interval policies.
- Metadata model: jobs, workflows, processors, events, schedules, artifacts, and runs support metadata, tags, and labels for filtering, routing, observability, and billing/usage analytics.
- API contracts to define before implementation include workflow CRUD/versioning, run start/status/list, job create/status/replay, processor registration/claim/heartbeat/complete/fail, signal delivery, schedule CRUD, stream endpoints, storage refs, and replay endpoints.
- Prototype-derived API decision examples:
  - `GET /workflows/:id/stream` streams workflow events with cursor resume.
  - `GET /jobs/stream?workflowId=...` streams filtered job events.
  - `POST /signals/:workflowId` delivers an external signal to a waiting workflow.
  - `POST /jobs/:id/replay` and `POST /workflows/:id/replay` request redrive under explicit replay modes.
- Deep modules with small stable interfaces should be prioritized for broker policy, workflow graph validation, state transition engine, outbox/event publishing, signal delivery, scheduler enqueueing, storage refs, stream cursors, and agent authentication. These modules should hide complex implementation details behind contract-tested interfaces.
- Avoid framework-specific commitments in this PRD. Architecture decisions are stack-neutral except for approved platform choices: Postgres, Kafka, TypeScript-first SDKs, outbound agents, and SaaS-first tenancy.

## Testing Decisions

- Testing must prove externally observable behavior through public APIs, SDK contracts, event contracts, state-machine contracts, and stream behavior. Avoid tests that rely on private implementation details.
- Workflow graph validation tests must cover valid DAGs, cycles, missing dependencies, unsupported step types, invalid joins, version immutability, and static graph constraints.
- Workflow runtime tests must cover step activation, dependency completion, fan-in/fan-out modeled statically, waiting states, pause/resume, crash recovery, checkpoint creation, and workflow finalization.
- Broker tests must cover atomic claim, lease heartbeat, lease expiry, safe requeue, retry policy, max attempts, DLQ transition, duplicate completion, stale completion, cancellation, and attempt history.
- State transition tests must verify legal transitions and reject invalid transitions for workflow runs, jobs, attempts, leases, schedules, signals, and replays.
- Outbox/Kafka tests must cover transactionally written outbox events, publisher retry, duplicate publish, consumer dedupe, Kafka outage, delayed publish recovery, and event ordering expectations within documented partition keys.
- Idempotency tests must cover duplicate API calls, duplicate job creation, duplicate workflow starts, duplicate signal delivery, duplicate task completion, duplicate replay requests, and duplicate Kafka consumption.
- Tenant isolation tests must attempt cross-tenant and cross-project access across APIs, streams, agents, storage refs, schedules, events, replay, and audit records.
- Agent auth tests must cover registration, short-lived token exchange, token expiry, revocation, capability scoping, wrong-tenant claims, wrong-project claims, and enterprise mTLS policy hooks where available.
- Processor routing tests must cover capability matching, version matching, GPU/memory/region constraints, labels/tags, unavailable capability handling, and route rejection for unauthorized processors.
- Scheduler tests must cover delayed execution, cron recurrence, interval recurrence, misfires, clock skew, duplicate scheduler instances, durable timers, and idempotent enqueueing.
- Signal manager tests must cover waiting workflow lookup, signal idempotency, wrong workflow/tenant rejection, approval continuation, pause/resume, and restart while waiting.
- Replay/redrive tests must cover replay from start, from failed step, from checkpoint, job replay, incompatible version rejection, idempotency behavior, and side-effect warnings.
- Stream tests must cover live SSE delivery, reconnect with cursor, filtered subscriptions, workflow stream, job stream, event retention expiration, and authorization on stream resume.
- Storage tests must cover platform object refs, signed URL expiry, checksum validation, tenant/project path isolation, artifact retention, denied access, BYO credential reference isolation, and BYO provider failure.
- SDK contract tests must verify that TypeScript producer, processor, and workflow SDKs call public APIs correctly, validate workflows locally, expose idempotency options, and surface distributed execution states clearly.
- Control plane tests must cover RBAC, tenant/project scoping, API tokens, agent identities, audit events, quotas, retention policies, and billing-ready usage event generation.
- Operations plane tests should be behavior-focused: an operator can inspect a failed workflow, identify the failed step and processor attempt, view logs/events, and initiate an authorized replay.
- Chaos/failure tests must include agent crash, broker restart, Postgres transaction rollback, Kafka outage, duplicate Kafka messages, network timeout during completion, stream disconnect, scheduler duplicate execution, and storage provider denial.
- Performance and fairness tests must measure queue depth, claim latency, event publish lag, stream resume latency, processor heartbeat volume, tenant quota behavior, weighted priority behavior, and concurrency group enforcement.
- Security tests must include authorization fuzzing, token expiry/revocation, signed URL constraints, tenant isolation, audit coverage, BYO storage confused-deputy scenarios, and sensitive data leakage in events/logs.
- Since the repository is currently empty and non-git, no prior tests or codebase patterns exist yet. The first implementation phase should establish test structure and commands before feature code.

## Feature Phases

### Phase 1: Product Specification and ADR Set

Goal: Freeze platform invariants before implementation.

Major modules/areas:
- Architecture decision records.
- Glossary and domain model.
- API/event contract drafts.
- Test strategy and acceptance checklist.

Acceptance criteria:
- Decisions documented for execution semantics, consistency, tenancy, storage, agent trust, replay, scheduling, retention, and observability.
- Glossary defines tenant, project, workflow, workflow version, run, step, job, attempt, lease, processor, signal, event, schedule, replay, checkpoint, DLQ, and artifact.
- API and event contracts distinguish authoritative state from emitted events.
- Stop conditions are documented for unsafe semantic conflicts.

Validation commands/checks:
- Documentation review confirms every approved decision in this PRD has an ADR or tracked follow-up.
- Architecture checklist verifies Kafka is not described as source of truth.
- Domain glossary review verifies terms are used consistently.

Rollback/stop point:
- Stop before code if execution, replay, isolation, or idempotency semantics conflict.

### Phase 2: Tenant, Security, and Control Plane Foundation

Goal: Establish SaaS-safe tenant/project boundaries and agent identity before execution features depend on them.

Major modules/areas:
- Tenant/org/project model.
- RBAC and API token model.
- Agent identity and registration.
- Audit log model.
- Retention policy model.

Acceptance criteria:
- Every durable resource has tenant scope; project scope exists where appropriate.
- API users, API tokens, and agents cannot access other tenants or projects.
- Agents receive scoped short-lived tokens.
- Agent revocation prevents new claims.
- Enterprise mTLS path is documented even if not implemented in the first slice.
- Audit events exist for security-sensitive user, token, agent, replay, and storage actions.

Validation commands/checks:
- Run tenant isolation test suite once test infrastructure exists.
- Run authz contract tests for all public resource APIs.
- Manually review resource schema for tenant/project scope coverage.

Rollback/stop point:
- Do not launch SaaS execution features if cross-tenant access tests fail.

### Phase 3: Durable State and Event Consistency Foundation

Goal: Make Postgres authoritative and Kafka safely derived.

Major modules/areas:
- State schema.
- Transactional outbox.
- Kafka publisher.
- Consumer inbox/dedupe.
- Event schema registry or equivalent contract system.

Acceptance criteria:
- State changes and outbox events are committed in the same transaction.
- Kafka publish retry is safe.
- Consumer duplicate events are ignored by event id.
- Kafka outage does not corrupt durable state.
- Event contracts include tenant/project scope and stable event ids.

Validation commands/checks:
- Run outbox transaction tests.
- Simulate Kafka unavailable during state transition; verify state remains correct and outbox drains later.
- Simulate duplicate Kafka delivery; verify one platform-side effect.

Rollback/stop point:
- Stop if any design path requires Kafka to be authoritative for core state.

### Phase 4: Core Job, Attempt, Lease, and Broker Runtime

Goal: Deliver reliable brokered job execution before workflow orchestration.

Major modules/areas:
- Broker state machine.
- Job queue/readiness selection.
- Attempt lifecycle.
- Lease claim/heartbeat/expiry.
- Retry and DLQ policy.
- Idempotent completion/failure handling.

Acceptance criteria:
- Jobs can be created, claimed, heartbeated, completed, failed, retried, and dead-lettered.
- Claims are atomic and tenant/project authorized.
- Expired leases become eligible for safe requeue.
- Duplicate completion/failure calls are idempotent.
- Attempt and lease history are visible for audit.

Validation commands/checks:
- Run broker state-machine tests.
- Run crash simulation: processor claims job, stops heartbeating, lease expires, job requeues.
- Run duplicate completion simulation.

Rollback/stop point:
- Stop if idempotent state transitions or lease expiry behavior are unreliable.

### Phase 5: Outbound Processor Fabric and Capability Routing

Goal: Support external heterogeneous processors as first-class execution capacity.

Major modules/areas:
- Processor registry.
- Agent protocol.
- Capability/version/hardware/region declarations.
- Routing policy engine.
- Agent SDK-facing contracts.

Acceptance criteria:
- Processors register and authenticate outbound.
- Processors advertise capabilities, versions, hardware traits, regions, labels, and tags.
- Broker only routes matching jobs to authorized processors.
- Revoked agents cannot claim new work.
- Routing decisions are explainable in logs/events.

Validation commands/checks:
- Run fake processor routing tests for GPU, memory, region, version, and labels.
- Run wrong-tenant/wrong-project agent claim rejection tests.
- Run agent token expiry/revocation tests.

Rollback/stop point:
- Stop if a rogue or misconfigured agent can claim unauthorized work.

### Phase 6: Static Workflow DAG Runtime

Goal: Build durable workflow orchestration over the broker.

Major modules/areas:
- Workflow definitions.
- Workflow versions.
- Workflow runs.
- Step state machine.
- DAG validator.
- Dependency scheduler.

Acceptance criteria:
- Workflow definitions can be created and published as immutable versions.
- Runs start from a specific version.
- DAG validation rejects cycles and missing dependencies.
- Step readiness follows dependency completion.
- Static fan-out/fan-in is represented and durable.
- Workflow state survives broker/runtime restart.

Validation commands/checks:
- Run DAG validator tests.
- Run workflow crash-resume tests.
- Run workflow with parallel branches and join step.

Rollback/stop point:
- Reject arbitrary dynamic graph creation until a later ADR explicitly approves it.

### Phase 7: Waits, Signals, Timers, Approvals, and Pauses

Goal: Make workflows durable across human and external asynchronous boundaries.

Major modules/areas:
- Signal manager.
- Durable timer/wake-up scheduler.
- Approval state model.
- Pause/resume controls.
- Waiting state transitions.

Acceptance criteria:
- Workflows can enter `waiting_for_signal`, `waiting_for_approval`, and `paused` states.
- External signal API resumes the correct waiting workflow idempotently.
- Durable timers persist wake-up timestamps and resume after restart.
- Approval actions are authorized and audited.
- No wait state depends on in-memory process state.

Validation commands/checks:
- Run restart-while-waiting test, then deliver signal and verify continuation.
- Run duplicate signal delivery test.
- Run unauthorized approval rejection test.

Rollback/stop point:
- Stop if waits cannot survive process restart.

### Phase 8: Scheduling System

Goal: Support delayed, cron, interval, recurring job, and recurring workflow starts.

Major modules/areas:
- Schedule definitions.
- Schedule evaluator.
- Idempotent enqueue loop.
- Misfire policy.
- Schedule audit/events.

Acceptance criteria:
- Schedules can be enabled, disabled, and evaluated.
- Cron, interval, delayed, recurring job, and recurring workflow modes are represented.
- Duplicate scheduler instances do not enqueue duplicate runs.
- Misfire behavior is explicit and tested.
- Tenant quotas and retention policies apply.

Validation commands/checks:
- Run time-skew and duplicate scheduler tests.
- Run cron/interval/delay schedule tests.
- Verify idempotency on repeated schedule evaluation.

Rollback/stop point:
- Stop if scheduler enqueueing is not idempotent.

### Phase 9: Priority, Concurrency Groups, Rate Limits, and Fairness

Goal: Control scarce execution resources and prevent noisy-neighbor behavior.

Major modules/areas:
- Broker policy engine.
- Priority queue policy.
- Concurrency group counters.
- Rate limit buckets.
- Quota enforcement.

Acceptance criteria:
- Jobs support priority levels: critical, high, normal, low, and background.
- Weighted queues prevent starvation.
- Concurrency groups limit simultaneous work by key.
- Rate limits apply to tenant/project/capability/external-service buckets.
- Policy decisions are observable and auditable.

Validation commands/checks:
- Run fairness simulation across tenants and priorities.
- Run concurrency group limit tests.
- Run rate limit bucket tests.

Rollback/stop point:
- Stop if high-volume tenants can bypass quotas or starve others.

### Phase 10: Replay, Redrive, Checkpoints, and Version Compatibility

Goal: Make failure recovery safe and operator-friendly.

Major modules/areas:
- Replay API.
- Redrive state machine.
- Workflow checkpoints.
- Version compatibility policy.
- Side-effect/idempotency warnings.

Acceptance criteria:
- Jobs and workflows can be replayed by authorized users.
- Replay modes include from start, from failed step, and from checkpoint.
- Replays are idempotent by request key.
- Incompatible workflow/job/processor versions are rejected or require explicit migration policy.
- Completed side effects are not silently duplicated.

Validation commands/checks:
- Run failed workflow redrive tests.
- Run checkpoint replay tests.
- Run incompatible version replay rejection test.

Rollback/stop point:
- Stop if replay can duplicate completed side effects without warning or guardrail.

### Phase 11: Realtime Streams and Replayable Event Store

Goal: Provide live and resumable observability APIs.

Major modules/areas:
- Event store.
- SSE stream service.
- Cursor/resume logic.
- Stream filters and multiplexing.
- Retention enforcement.

Acceptance criteria:
- Workflow stream endpoint emits typed workflow events.
- Job stream endpoint supports workflow and filter query parameters.
- Clients can reconnect with a cursor and receive missed retained events.
- Stream access is tenant/project authorized.
- Tenant-configurable retention controls replay availability.

Validation commands/checks:
- Run stream reconnect/resume tests.
- Run filtered subscription tests.
- Run expired-retention cursor test.
- Run unauthorized stream access rejection test.

Rollback/stop point:
- Stop if streams become a source of truth instead of a projection of persisted events/state.

### Phase 12: Payload, Artifact, Log, and BYO Storage

Goal: Store large data safely outside core state and event infrastructure.

Major modules/areas:
- Storage object metadata.
- Object references.
- Platform object storage provider.
- BYO provider abstraction.
- Signed URL service.
- Retention/deletion policy.

Acceptance criteria:
- Large payloads, artifacts, and logs are referenced by metadata rows and object refs.
- Signed URLs expire and are tenant/project scoped.
- Checksums or content metadata support integrity checks.
- Platform storage works by default.
- BYO storage design isolates credentials and supports rotation.
- Retention policy can remove or expire eligible objects.

Validation commands/checks:
- Run signed URL expiry tests.
- Run tenant/project object isolation tests.
- Run storage provider denial tests.
- Run retention deletion dry-run tests where available.

Rollback/stop point:
- Stop if implementation stores large blobs in Kafka or unbounded core state rows.

### Phase 13: TypeScript SDKs and Developer Ergonomics

Goal: Make producer, processor, and workflow authoring ergonomic without hiding distributed semantics.

Major modules/areas:
- TypeScript producer SDK.
- TypeScript processor SDK.
- TypeScript workflow SDK.
- Example workflows.
- Contract test suite.

Acceptance criteria:
- Producer SDK supports job create, workflow start, wait for completion, stream events, and idempotency options.
- Processor SDK supports handler registration, progress, lease renewal, completion/failure, and artifact access.
- Workflow SDK supports static DAG authoring, waits, signals, timers, approvals, local validation, and publishing.
- SDK errors expose retryable/non-retryable and idempotency-related states clearly.
- SDK behavior is contract-tested against public API semantics.

Validation commands/checks:
- Run SDK contract tests.
- Run example workflow end-to-end against local test services once available.
- Run TypeScript typecheck once package infrastructure exists.

Rollback/stop point:
- Stop if SDK convenience hides lease, retry, idempotency, or at-least-once semantics from users.

### Phase 14: Operations Plane and Control UI

Goal: Make the platform operable without database archaeology.

Major modules/areas:
- Dashboard.
- Workflow graph view.
- Live event console.
- Processor monitor.
- DLQ management.
- Replay/redrive UI.
- Audit and timeline views.

Acceptance criteria:
- Operator can inspect a workflow graph and identify step states.
- Operator can view live events, retained events, logs, attempts, leases, and retries.
- Operator can inspect processor health and capability coverage.
- Operator can replay or redrive authorized failed work.
- Operator can manage DLQ entries.
- Security-sensitive operations are audited.

Validation commands/checks:
- Run UI/e2e flow where an operator diagnoses and replays a failed workflow without raw database access.
- Run authorization tests for replay and audit views.
- Run stream-backed live console reconnect test.

Rollback/stop point:
- Do not beta the SaaS product without enough failure visibility to debug production workflows.

## Out of Scope

- Replacing the broker/processor/lease foundation with a generic queue-only system.
- Building only a WebSocket dispatcher.
- Promising exactly-once execution for arbitrary external side effects.
- Fully dynamic runtime-created workflow graphs in v1.
- Code-first deterministic durable functions in v1.
- Mandatory mTLS for all tenants; mTLS is an enterprise option.
- Choosing a specific web framework, frontend framework, ORM, test runner, deployment platform, or infrastructure-as-code tool in this PRD.
- Storing large payloads or artifacts directly in Kafka.
- Treating Kafka as the authoritative state store.
- Launching SaaS execution features without tenant isolation, idempotency, and lease safety tests.
- Building enterprise dedicated stacks before the shared logical-isolation SaaS path is proven.
- Implementing the plan as part of this PRD-only task.

## Further Notes

- Current repository context: `/home/ralph/Github/helix` is empty and not a git repository at PRD creation time. No `CONTEXT.md`, `docs/adr/`, or existing markdown docs were found.
- This PRD intentionally avoids volatile file paths because project structure does not exist yet.
- First follow-up should create project/repository scaffolding and documentation locations before feature implementation.
- Recommended early ADRs: execution semantics, state/Kafka consistency, SaaS tenancy/isolation, agent trust, workflow graph model, idempotency, replay/redrive, storage/BYO, retention, and scheduling.
- Highest-risk areas: cross-tenant isolation, duplicate delivery, external side effects, rogue/stolen agents, replay safety, Kafka/Postgres consistency, BYO storage credentials, and cost control for retained events/artifacts.
- Product terminology should consistently describe the system as a durable distributed execution platform, execution fabric, workflow runtime, and worker control plane.
- Operational SLOs should be defined before beta: claim latency, workflow start latency, stream resume latency, event publish lag, heartbeat tolerance, scheduler drift, replay latency, RPO/RTO, and maximum acceptable duplicate execution windows.
- Issue-tracker follow-up: split each feature phase into implementation issues only after ADRs and initial project scaffolding exist.
- Rollout recommendation: internal alpha with core jobs/leases/processors before workflows; private beta after workflows, signals, streams, isolation tests, and minimum operations UI; public beta only after replay, retention, quotas, and security review.
