# @helix/scheduler

Schedules, durable timers, and wake-up service shell.

## Evaluation safety model

- Scheduler instances acquire an observable evaluation lease before scanning due schedules.
- A busy lease makes the contending instance skip that pass instead of enqueueing work.
- Enqueue writes still use a durable idempotency key per schedule fire: `${fireIdempotencyKeyPrefix}:${fireTime}`.
- Clock skew tolerance is explicit. `clockSkewToleranceMs` extends the due cutoff by the documented tolerance; default is `0`.
- The first HA slice supports delayed schedules. Cron/interval expansion remains future scheduler work.
