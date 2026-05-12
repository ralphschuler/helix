# Helix

Helix is a SaaS-first durable distributed execution platform: brokered execution, external processor fabric, static DAG workflows, persistent leases, replayable events, scheduling, signals, typed SDKs, and operations tooling.

See [PRD.md](./PRD.md) for product requirements and phased delivery.

## Architecture docs

- [Architecture Decision Records](./docs/adr/README.md)
- [Domain glossary](./docs/glossary.md)
- [Architecture checklist](./docs/architecture-checklist.md)

## Workspace

Yarn workspace layout:

- `apps/control-plane` — SaaS API/control plane shell.
- `apps/ops-console` — operator UI shell.
- `services/broker` — job, lease, attempt, and routing runtime shell.
- `services/scheduler` — schedules, timers, and wake-up runtime shell.
- `packages/contracts` — shared API/event contract shell.
- `packages/producer-sdk` — TypeScript producer SDK shell.
- `packages/processor-sdk` — TypeScript processor SDK shell.
- `packages/workflow-sdk` — TypeScript workflow SDK shell.

## Commands

```sh
yarn install --frozen-lockfile
yarn validate
```
