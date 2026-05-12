# Glossary

Core Helix terms used by the PRD, ADRs, contracts, issues, tests, and operator docs.

## Tenant

Top-level SaaS isolation boundary for an organization or customer. Every durable resource is tenant scoped.

## Project

A tenant-owned workspace/environment boundary used for jobs, workflows, API keys, agents, schedules, storage refs, quotas, and runtime policies. Resources are project scoped when they can vary by environment or application.

## Workflow

A declarative static DAG that describes ordered durable work. Workflows can include job steps, waits, signals, timers, approvals, pauses, joins, and completion semantics.

## Workflow version

An immutable published workflow definition. Runs reference a version so old executions remain explainable, recoverable, and replayable.

## Run

One execution instance of a published workflow version. A run owns step state, events, waits, checkpoints, and final outcome.

## Step

A node in a workflow DAG. Steps declare dependencies and type-specific behavior such as job execution, signal wait, approval wait, durable timer, pause, or join.

## Job

A unit of brokered work submitted through public APIs or activated by workflow/schedule runtime. Jobs are claimed by eligible processors through attempts and leases.

## Attempt

One execution try for a job. Attempts capture claim, heartbeat, completion, failure, retry, and DLQ history.

## Lease

An explicit time-bounded claim that lets one processor work on one attempt. Heartbeats extend leases; expired leases allow safe requeue according to policy.

## Processor

An outbound worker/agent that authenticates to Helix, advertises capabilities, claims eligible jobs, renews leases, reports progress, and completes or fails attempts idempotently.

## Signal

An external event delivered through an API to resume a waiting workflow once. Signals are tenant/project scoped and idempotent.

## Event

A versioned domain record emitted from committed state changes for fanout, streams, integrations, observability, or audit. Events are derived from authoritative Postgres state.

## Schedule

A durable delayed, cron, interval, recurring job, or recurring workflow definition. Schedules enqueue work idempotently and define explicit misfire behavior.

## Replay

A controlled redrive of a job, workflow run, failed step, or checkpoint. Replay must preserve version compatibility, idempotency, audit history, and side-effect warnings.

## Checkpoint

A persisted workflow recovery point used to resume or replay from a known state. Checkpoints are scoped, retained, and immutable enough for audit.

## DLQ

Dead-letter queue. A durable isolation state for work that permanently failed or exceeded retry policy and needs inspection or authorized replay.

## Artifact

Large payload, file, log bundle, model output, or external object associated with execution. Artifact bytes live outside Kafka/Redpanda and outside unbounded core state rows; Postgres stores refs and metadata.

## Usage event

A durable metering record for billing, quotas, analytics, or entitlement checks. Usage events are tenant/org scoped and idempotent before billing export.

## Role

A named bundle of permissions for users or principals. Helix uses permission-only custom roles rather than hard-coded authorization logic.

## Permission

An explicit allowed action over a scoped resource. Permission checks gate browser APIs, admin APIs, SDK APIs, agent claims, storage access, replay, billing, IAM, and audit-sensitive mutations.

## API key

A hashed project-scoped machine credential for producer/workflow SDK access. API keys are separate from browser sessions and agent tokens.

## Agent token

A short-lived project-scoped credential issued to a processor agent after registration. Agent tokens authorize capability-scoped runtime actions and must respect expiry and revocation.
