# @helix/broker

Broker, job, attempt, lease, and routing service shell.

Current foundation:

- Job, attempt, and lease state contracts live in `@helix/contracts`.
- `src/job-state-machine.ts` rejects illegal job, attempt, and lease transitions before persistence code mutates authoritative Postgres state.
- Durable broker rows are owned by the control-plane migration `0006_job_attempt_lease_schema.sql` until service-backed repositories land.
- Runtime retry policy uses `maxAttempts`: non-exhausted failures/expired leases return to `retrying`; exhausted failures/expired leases move the job to `dead_lettered` and keep attempt/lease rows inspectable.

Validation:

```sh
yarn workspace @helix/broker test
yarn workspace @helix/control-plane test -- src/db/migrations.test.ts src/db/job-attempt-lease-schema.test.ts
```
