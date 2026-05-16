# @helix/broker

Broker, job, attempt, lease, and routing service shell.

Current foundation:

- Job, attempt, and lease state contracts live in `@helix/contracts`.
- `src/job-state-machine.ts` rejects illegal job, attempt, and lease transitions before persistence code mutates authoritative Postgres state.
- Durable broker rows are owned by the control-plane migration `0006_job_attempt_lease_schema.sql` until service-backed repositories land.
- Runtime retry policy uses `maxAttempts`: non-exhausted failures/expired leases return to `retrying`; exhausted failures/expired leases move the job to `dead_lettered` and keep attempt/lease rows inspectable.
- `runBrokerServiceLoop` provides the lease-expiry worker loop. It calls the host `expireLeases` service with tenant/project scope, caps batch size, polls quickly after work, backs off when idle, backs off after errors, and stops through `AbortSignal`.
- `createBrokerPolicyEngine` isolates claim ordering policy from claim transaction plumbing. Formal priority levels are `critical`, `high`, `normal`, `low`, and `background`; invalid levels are rejected at the policy boundary.
- `createConcurrencyGroupPolicy` reserves and releases tenant/project-scoped group counters around claims. Reservations reject excess concurrent work at the configured positive integer limit, and duplicate/stale releases are idempotent so terminal retry paths cannot corrupt counters.

Run/validation commands:

```sh
# Broker loop and state-machine behavior
yarn workspace @helix/broker test

# Crash/requeue simulation: processor claims, heartbeats, stops, lease expires, job requeues
yarn workspace @helix/control-plane test -- jobs.test.ts

# Durable job/lease schema coverage
yarn workspace @helix/control-plane test -- src/db/migrations.test.ts src/db/job-attempt-lease-schema.test.ts
```

Host the loop from the service process that owns a `JobService`/repository instance:

```ts
await runBrokerServiceLoop({
  tenantId,
  projectId,
  expireLeases: (input) => jobService.expireLeases(input),
  signal,
});
```
